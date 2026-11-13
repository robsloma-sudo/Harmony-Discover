// Discover DEV enrichment queue worker.
// Intentionally claims identity_match only. Official-source lookup stays queued until
// a reviewed, source-specific provider is implemented; no speculative evidence is written.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { readUtf8RequestBodyWithinLimit } from "./requestLimits.ts";
import { DEFERRED_JOB_TYPES, SUPPORTED_JOB_TYPES, getIdentityJobRetryPlan, validateIdentityJobReferences } from "./workerPolicy.ts";

const PROJECT = "lqqmwqrffelgnbngrkep";
const MAX_BATCH = 5;
const MAX_BODY_BYTES = 2048;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) return json({ error: "worker_not_configured" }, 503);
  try {
    if (new URL(url).hostname !== PROJECT + ".supabase.co") return json({ error: "environment_refused" }, 503);
  } catch { return json({ error: "environment_refused" }, 503); }

  const supplied = req.headers.get("x-discover-cron-secret") ?? "";
  if (supplied.length < 32 || supplied.length > 512) return json({ error: "unauthorized" }, 401);
  if (req.headers.get("content-type")?.toLowerCase().startsWith("application/json") !== true) {
    return json({ error: "content_type_must_be_json" }, 415);
  }
  const bodyRead = await readUtf8RequestBodyWithinLimit(req, MAX_BODY_BYTES);
  if (bodyRead.tooLarge) return json({ error: "payload_too_large" }, 413);
  const raw = bodyRead.body;
  let body: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_request" }, 400);
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: "invalid_json" }, 400); }
  const requestedLimit = Number(body.limit ?? MAX_BATCH);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_BATCH) {
    return json({ error: "invalid_limit", max: MAX_BATCH }, 400);
  }
  const worker = String(body.worker ?? "discover-identity-worker").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 80) || "discover-identity-worker";

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error: authError } = await db.rpc("discover_check_cron_secret", { p_given: supplied });
  if (authError || allowed !== true) return json({ error: "unauthorized" }, 401);

  const { data: claimed, error: claimError } = await db.rpc("discover_claim_enrichment_jobs", {
    p_worker: worker,
    p_limit: requestedLimit,
    p_stale_after_seconds: 600,
    p_job_types: [...SUPPORTED_JOB_TYPES],
  });
  if (claimError) {
    console.error(JSON.stringify({ event: "queue_claim_failed", message: claimError.message.slice(0, 180) }));
    return json({ error: "queue_claim_failed" }, 503);
  }

  const jobs = Array.isArray(claimed) ? claimed : [];
  const results: Array<{ id: string; outcome: string }> = [];
  for (const job of jobs) {
    const jobId = String(job.id ?? "");
    const productId = String(job.discover_product_id ?? "");
    try {
      const input = job.input_payload && typeof job.input_payload === "object" ? job.input_payload as Record<string, unknown> : {};
      const sightingId = String(input.sighting_id ?? "");
      if (!jobId || !productId || !sightingId) throw new Error("job_missing_product_or_sighting_reference");

      const [{ data: product, error: productError }, { data: sighting, error: sightingError }] = await Promise.all([
        db.from("discover_products").select("id,status,brand_name,product_name,identity_payload")
          .eq("id", productId).maybeSingle(),
        db.from("bottle_sightings").select("id,discover_product_id,product_index_id,read_brand,read_product")
          .eq("id", sightingId).maybeSingle(),
      ]);
      if (productError) throw new Error("discover_product_not_found");
      if (sightingError) throw new Error("sighting_product_link_mismatch");
      const output = {
        result: "identity_checked",
        ...validateIdentityJobReferences(job, product, sighting),
        checked_at: new Date().toISOString(),
      };
      const { data: completedRow, error: completeError } = await db.from("discover_enrichment_jobs").update({
        status: "complete",
        output_payload: output,
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId).eq("status", "processing").eq("locked_by", worker).select("id").maybeSingle();
      if (completeError || !completedRow) throw new Error("job_completion_write_failed_or_lock_lost");
      results.push({ id: jobId, outcome: "complete" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_worker_error";
      const retryPlan = getIdentityJobRetryPlan(job.attempts, job.max_attempts);
      const { data: retriedRow, error: retryError } = await db.from("discover_enrichment_jobs").update({
        status: retryPlan.status,
        available_at: retryPlan.availableAt,
        locked_at: null,
        locked_by: null,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId).eq("status", "processing").eq("locked_by", worker).select("id").maybeSingle();
      if (retryError || !retriedRow) console.error(JSON.stringify({ event: "job_retry_write_failed_or_lock_lost", job_id: jobId }));
      results.push({ id: jobId, outcome: retryPlan.status });
    }
  }

  return json({
    ok: true,
    worker,
    claimed: jobs.length,
    completed: results.filter(x => x.outcome === "complete").length,
    retried: results.filter(x => x.outcome === "retry").length,
    failed: results.filter(x => x.outcome === "failed").length,
    results,
    supported_job_types: [...SUPPORTED_JOB_TYPES],
    deferred_job_types: [...DEFERRED_JOB_TYPES],
  });
});
