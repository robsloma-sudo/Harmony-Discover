// Discover DEV enrichment queue worker.
// Intentionally claims identity_match only. Official-source lookup stays queued until
// a reviewed, source-specific provider is implemented; no speculative evidence is written.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { readUtf8RequestBodyWithinLimit } from "./requestLimits.ts";
import { DEFERRED_JOB_TYPES, SUPPORTED_JOB_TYPES, getIdentityJobRetryPlan, validateIdentityJobReferences } from "./workerPolicy.ts";
import { buildProfilePrompt } from "./researchProfiles.ts";
import { RESEARCH_DETAIL_FIELDS, researchBottleDetails } from "./researchEngine.ts";

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

  const researchApiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const claimJobTypes = SUPPORTED_JOB_TYPES.filter(type => type !== "official_source_lookup" || !!researchApiKey);
  const { data: claimed, error: claimError } = await db.rpc("discover_claim_enrichment_jobs", {
    p_worker: worker,
    p_limit: requestedLimit,
    p_stale_after_seconds: 600,
    p_job_types: [...claimJobTypes],
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
        db.from("bottle_sightings").select("id,consumer_id,discover_product_id,product_index_id,read_brand,read_product,read_category,read_proof,read_size,read_vintage,read_confidence,label_details")
          .eq("id", sightingId).maybeSingle(),
      ]);
      if (productError) throw new Error("discover_product_not_found");
      if (sightingError) throw new Error("sighting_product_link_mismatch");
      const validated = validateIdentityJobReferences(job, product, sighting);
      let output: Record<string, unknown>;

      if (job.job_type === "official_source_lookup") {
        const labelDetails = sighting.label_details && typeof sighting.label_details === "object"
          ? sighting.label_details as Record<string, unknown> : {};
        const fieldConfidence = labelDetails._field_confidence && typeof labelDetails._field_confidence === "object"
          ? labelDetails._field_confidence as Record<string, unknown> : {};
        const brandIsStrong = !!sighting.read_brand && Number(fieldConfidence.brand ?? 0) >= 0.90;
        const productIsStrong = !!sighting.read_product && Number(fieldConfidence.product ?? 0) >= 0.90;
        if (!brandIsStrong || !productIsStrong) {
          output = { result: "abstained_low_identity_confidence", ...validated, evidence_saved: 0, attributes_added: 0 };
        } else {
          const knownDetails: Record<string, unknown> = {
            ...labelDetails,
            vintage: labelDetails.vintage ?? sighting.read_vintage ?? undefined,
            package_size: labelDetails.package_size ?? sighting.read_size ?? undefined,
          };
          const missing = RESEARCH_DETAIL_FIELDS.filter(field =>
            !String(knownDetails[field] ?? "").replace(/\s+/g, " ").trim()
          );
          if (!missing.length) {
            output = { result: "no_missing_research_fields", ...validated, evidence_saved: 0, attributes_added: 0 };
          } else {
            const identity = {
              brand: sighting.read_brand, product: sighting.read_product,
              category: sighting.read_category, proof: sighting.read_proof,
              size: sighting.read_size, details: knownDetails,
            };
            const profile = buildProfilePrompt(String(sighting.read_category ?? "other"), identity, missing);
            const { data: budgetOk, error: budgetError } = await db.rpc("discover_reserve_bottle_research_budget", {
              p_consumer: sighting.consumer_id, p_jobs: 1, p_search_units: profile.searchUses,
              p_user_jobs_max: 5, p_project_jobs_max: 100, p_user_search_max: 10, p_project_search_max: 200,
            });
            if (budgetError) throw new Error("research_budget_unavailable");
            if (budgetOk !== true) {
              const now = new Date();
              const nextUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
              const { data: deferredRow, error: deferError } = await db.from("discover_enrichment_jobs").update({
                status: "retry",
                attempts: Math.max(0, Number(job.attempts ?? 1) - 1),
                available_at: nextUtcDay,
                locked_at: null,
                locked_by: null,
                last_error: "daily_research_budget_exhausted",
                updated_at: now.toISOString(),
              }).eq("id", jobId).eq("status", "processing").eq("locked_by", worker).select("id").maybeSingle();
              if (deferError || !deferredRow) throw new Error("research_budget_defer_write_failed_or_lock_lost");
              results.push({ id: jobId, outcome: "deferred" });
              continue;
            }

            const model = Deno.env.get("DISCOVER_RESEARCH_MODEL") || Deno.env.get("DISCOVER_BOTTLE_MODEL") || "claude-haiku-5-5";
            const research = await researchBottleDetails(
              researchApiKey, model, identity, missing, profile.prompt, profile.searchUses,
            );
            const evidenceRows: Array<Record<string, unknown>> = [];
            const sourceType = (kind: string, sourceUrl: string) => {
              if (["manufacturer", "distillery", "winery", "brand_owner"].includes(kind)) return "official_producer";
              if (kind === "regulator") {
                const host = (() => { try { return new URL(sourceUrl).hostname.toLowerCase(); } catch { return ""; } })();
                return host.includes("ttb.gov") || host.includes("ttbonline.gov") ? "ttb_cola" : "government_registry";
              }
              if (kind === "gs1") return "barcode_registry";
              if (kind === "retailer") return "retailer";
              return "other";
            };
            for (const [attributeCode, value] of Object.entries(research.details)) {
              const confidence = Number(research.scores[attributeCode] ?? 0);
              const supporting = research.sources.filter(source => source.supports.includes(attributeCode)).slice(0, 2);
              for (const source of supporting) {
                evidenceRows.push({
                  discover_product_id: productId,
                  attribute_code: attributeCode,
                  source_type: sourceType(source.source_type, source.url),
                  source_name: source.title || "Product research source",
                  source_url: source.url,
                  observed_value: { value, attribute_code: attributeCode, product_expression: identity.product },
                  confidence,
                  verification_state: "unreviewed",
                  metadata: { sighting_id: sightingId, profile: profile.key, supports: [attributeCode] },
                });
              }
            }
            let insertedEvidence: Array<{ id: string; attribute_code: string }> = [];
            if (evidenceRows.length) {
              const { data, error } = await db.from("discover_product_evidence").insert(evidenceRows).select("id,attribute_code");
              if (error || !Array.isArray(data)) throw new Error("research_evidence_insert_failed");
              insertedEvidence = data;
            }
            const evidenceByAttribute = new Map<string, string>();
            for (const row of insertedEvidence) {
              if (row.attribute_code && !evidenceByAttribute.has(row.attribute_code)) evidenceByAttribute.set(row.attribute_code, row.id);
            }
            const attributeRows = [...evidenceByAttribute.entries()].flatMap(([attributeCode, evidenceId]) => {
              const value = research.details[attributeCode];
              return value ? [{
                discover_product_id: productId,
                attribute_code: attributeCode,
                value_text: value,
                state: "found",
                confidence: research.scores[attributeCode],
                evidence_id: evidenceId,
              }] : [];
            });
            if (attributeRows.length) {
              const { error } = await db.from("discover_product_attributes")
                .upsert(attributeRows, { onConflict: "discover_product_id,attribute_code", ignoreDuplicates: true });
              if (error) throw new Error("research_attribute_insert_failed");
            }
            output = {
              result: Object.keys(research.details).length ? "research_complete" : "no_verified_research",
              ...validated,
              research_profile: profile.key,
              evidence_saved: insertedEvidence.length,
              attributes_added: attributeRows.length,
              researched_fields: Object.keys(research.details),
            };
          }
        }
      } else {
        output = { result: "identity_checked", ...validated };
      }

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
    deferred_job_types: [...DEFERRED_JOB_TYPES, ...(!researchApiKey ? ["official_source_lookup"] : [])],
  });
});
