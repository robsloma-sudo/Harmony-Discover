// Discover DEV enrichment queue worker. Product identity and source evidence remain separate.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ATTRIBUTE_CODE_MAP,
  DEFERRED_JOB_TYPES,
  RESEARCH_FIELD_KEYS,
  getIdentityJobRetryPlan,
  getSupportedJobTypes,
  filterResearchFields,
  validateIdentityJobReferences,
} from "./workerPolicy.ts";

const PROJECT = "lqqmwqrffelgnbngrkep";
const VERSION = "0.2.0";
const MAX_BATCH = 5;
const MAX_BODY_BYTES = 2048;
const DAILY_RESEARCH_ATTEMPT_CAP = 30;
const RESEARCH_MODEL = Deno.env.get("DISCOVER_ENRICHMENT_MODEL") || "claude-haiku-5-5";

const ENRICHMENT_TOOL = {
  name: "bottle_enrichment",
  description: "Return missing exact-expression beverage facts, each directly supported by a source.",
  input_schema: {
    type: "object",
    required: ["fields", "field_confidence", "sources"],
    properties: {
      fields: { type: "object", additionalProperties: { type: "string" } },
      field_confidence: { type: "object", additionalProperties: { type: "number" } },
      sources: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          required: ["url", "title", "supports", "source_type"],
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            supports: { type: "array", items: { type: "string" } },
            source_type: {
              type: "string",
              enum: ["manufacturer", "distillery", "winery", "brand_owner", "regulator", "gs1"],
            },
          },
        },
      },
    },
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const clean = (value: unknown, max = 240) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const unit = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};
const normalize = (value: unknown) => clean(value, 240).toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function updateJob(db: any, job: any, worker: string, values: Record<string, unknown>) {
  const { data, error } = await db.from("discover_enrichment_jobs").update({
    ...values,
    locked_at: null,
    locked_by: null,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("status", "processing").eq("locked_by", worker).select("id").maybeSingle();
  if (error || !data) throw new Error("job_update_failed_or_lock_lost");
}
async function completeJob(db: any, job: any, worker: string, output: Record<string, unknown>) {
  await updateJob(db, job, worker, { status: "complete", output_payload: output, last_error: null });
}
async function retryJob(db: any, job: any, worker: string, errorValue: unknown) {
  const retryPlan = getIdentityJobRetryPlan(job.attempts, job.max_attempts);
  await updateJob(db, job, worker, {
    status: retryPlan.status,
    available_at: retryPlan.availableAt,
    last_error: clean(errorValue instanceof Error ? errorValue.message : errorValue, 500),
  });
  return retryPlan.status;
}

async function loadProductAndSighting(db: any, job: any) {
  const input = job.input_payload && typeof job.input_payload === "object"
    ? job.input_payload as Record<string, unknown> : {};
  const sightingId = clean(input.sighting_id, 80);
  if (!sightingId) throw new Error("job_missing_product_or_sighting_reference");
  const [{ data: product, error: productError }, { data: sighting, error: sightingError }] = await Promise.all([
    db.from("discover_products")
      .select("id,status,brand_name,product_name,product_class,identity_payload")
      .eq("id", job.discover_product_id).maybeSingle(),
    db.from("bottle_sightings")
      .select("id,discover_product_id,product_index_id,read_brand,read_product,read_category,read_proof,read_size,read_vintage,label_details")
      .eq("id", sightingId).maybeSingle(),
  ]);
  if (productError || !product) throw new Error("discover_product_not_found");
  if (sightingError || !sighting) throw new Error("sighting_not_found");
  return { product, sighting };
}

async function processIdentityJob(db: any, job: any, worker: string) {
  const { product, sighting } = await loadProductAndSighting(db, job);
  const output = {
    result: "identity_checked",
    ...validateIdentityJobReferences(job, product, sighting),
    checked_at: new Date().toISOString(),
  };
  await completeJob(db, job, worker, output);
  return { id: job.id, outcome: "complete" };
}

async function callOfficialResearch(apiKey: string, product: Record<string, unknown>, sighting: Record<string, unknown>, missing: string[]) {
  const details = (sighting.label_details && typeof sighting.label_details === "object"
    ? sighting.label_details : {}) as Record<string, unknown>;
  const identity = {
    brand: clean(product.brand_name, 100),
    product: clean(product.product_name, 120),
    category: clean(product.product_class, 60),
    proof: clean(sighting.read_proof, 40),
    package_size: clean(sighting.read_size, 40),
    vintage: sighting.read_vintage,
    known_label_details: Object.fromEntries(RESEARCH_FIELD_KEYS
      .filter(key => clean(details[key], 120))
      .map(key => [key, clean(details[key], 120)])),
  };
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      max_tokens: 2200,
      system: "You research beverage product facts. Search for this exact brand and product expression, not merely the producer or a similar SKU. Use only official producer, distillery, winery, brand-owner, TTB/regulator and GS1 sources. Do not use retailers, general reference pages, or aggregator sites as evidence. Never infer or invent facts. Return only missing fields explicitly supported for this exact expression. Do not return tasting impressions as technical flavouring facts. Every returned field must have a source URL that directly supports it. If identity is ambiguous, return no fields. Mark field confidence conservatively.",
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 3 },
        ENRICHMENT_TOOL,
      ],
      tool_choice: { type: "auto" },
      messages: [{
        role: "user",
        content: "Research these missing facts for the exact beverage product below.\nIDENTITY: " +
          JSON.stringify(identity) + "\nMISSING FIELD KEYS: " + missing.join(", ") +
          "\nReturn bottle_enrichment with field values, confidence scores, and supporting HTTPS sources.",
      }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("official_source_research_failed_" + response.status);
  const usage = (payload.usage && typeof payload.usage === "object" ? payload.usage : {}) as Record<string, unknown>;
  const content = (Array.isArray(payload.content) ? payload.content : []) as Array<Record<string, unknown>>;
  const searchPerformed = content.some(item =>
    (item.type === "server_tool_use" || item.type === "tool_use") && item.name === "web_search",
  ) || content.some(item => item.type === "web_search_tool_result");
  if (!searchPerformed) throw new Error("official_source_web_search_not_performed");
  const block = content.find(item =>
    item.type === "tool_use" && item.name === "bottle_enrichment",
  ) as Record<string, unknown> | undefined;
  return {
    fields: filterResearchFields(block?.input, missing),
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    searchPerformed: true,
  };
}

async function persistResearch(db: any, productId: string, job: any, fields: Awaited<ReturnType<typeof callOfficialResearch>>["fields"]) {
  let evidenceCount = 0;
  let attributeCount = 0;
  let conflictCount = 0;

  for (const field of fields) {
    const sourceRecordId = "worker:" + job.id + ":" + field.code;
    const { data: evidence, error: evidenceError } = await db.from("discover_product_evidence").upsert({
      discover_product_id: productId,
      attribute_code: field.code,
      source_type: field.source.source_type,
      source_record_id: sourceRecordId,
      source_name: field.source.title,
      source_url: field.source.url,
      observed_value: { value: field.value },
      confidence: field.confidence,
      verification_state: "unreviewed",
      metadata: { worker_version: VERSION, job_id: job.id, research_model: RESEARCH_MODEL, research_only: true },
    }, { onConflict: "discover_product_id,source_record_id" }).select("id").single();
    if (evidenceError || !evidence) throw new Error("evidence_write_failed");
    evidenceCount++;

    const attributeCode = ATTRIBUTE_CODE_MAP[field.code];
    if (!attributeCode) continue;
    const { data: existing, error: lookupError } = await db.from("discover_product_attributes")
      .select("id,value_text,value_json,state,confidence,evidence_id")
      .eq("discover_product_id", productId).eq("attribute_code", attributeCode).maybeSingle();
    if (lookupError) throw new Error("attribute_lookup_failed");

    const now = new Date().toISOString();
    if (!existing) {
      const { error } = await db.from("discover_product_attributes").insert({
        discover_product_id: productId,
        attribute_code: attributeCode,
        value_text: field.value,
        state: "needs_review",
        confidence: field.confidence,
        evidence_id: evidence.id,
        updated_at: now,
      });
      if (error) throw new Error("attribute_insert_failed");
      attributeCount++;
      continue;
    }

    const existingValue = clean(existing.value_text, 240);
    if (!existingValue || ["not_disclosed", "not_applicable"].includes(String(existing.state))) {
      const { error } = await db.from("discover_product_attributes").update({
        value_text: field.value,
        value_json: null,
        state: "needs_review",
        confidence: field.confidence,
        evidence_id: evidence.id,
        updated_at: now,
      }).eq("id", existing.id);
      if (error) throw new Error("attribute_update_failed");
      attributeCount++;
    } else if (normalize(existingValue) === normalize(field.value)) {
      const { error } = await db.from("discover_product_attributes").update({
        state: existing.state === "verified" ? "verified" : existing.state === "conflicting" ? "conflicting" : "needs_review",
        confidence: Math.max(unit(existing.confidence), field.confidence),
        evidence_id: evidence.id,
        updated_at: now,
      }).eq("id", existing.id);
      if (error) throw new Error("attribute_evidence_link_failed");
      attributeCount++;
    } else {
      const { error } = await db.from("discover_product_attributes").update({
        state: "conflicting",
        value_json: {
          current_value: existingValue,
          incoming_value: field.value,
          current_evidence_id: existing.evidence_id,
          incoming_evidence_id: evidence.id,
        },
        confidence: Math.min(unit(existing.confidence), field.confidence),
        updated_at: now,
      }).eq("id", existing.id);
      if (error) throw new Error("attribute_conflict_write_failed");
      conflictCount++;
    }
  }
  return { evidenceCount, attributeCount, conflictCount };
}

async function processOfficialSourceJob(db: any, job: any, worker: string, apiKey: string) {
  const { product, sighting } = await loadProductAndSighting(db, job);
  const identity = product.identity_payload && typeof product.identity_payload === "object"
    ? product.identity_payload as Record<string, unknown> : {};
  const details = (sighting.label_details && typeof sighting.label_details === "object"
    ? sighting.label_details : {}) as Record<string, unknown>;
  const fieldConfidence = (details._field_confidence && typeof details._field_confidence === "object"
    ? details._field_confidence : {}) as Record<string, unknown>;

  if (identity.identity_status !== "catalog_exact" ||
      !["identified", "verified"].includes(String(product.status)) ||
      !clean(product.brand_name, 100) || !clean(product.product_name, 120) ||
      unit(fieldConfidence.brand) < 0.90 || unit(fieldConfidence.product) < 0.90) {
    await completeJob(db, job, worker, {
      result: "skipped_unresolved_identity",
      product_status: product.status,
      identity_status: identity.identity_status ?? "candidate",
      no_external_search: true,
    });
    return { id: job.id, outcome: "complete", result: "skipped_unresolved_identity" };
  }

  const { data: existingAttributes, error: attributesError } = await db.from("discover_product_attributes")
    .select("attribute_code,state,value_text")
    .eq("discover_product_id", product.id);
  if (attributesError) throw new Error("existing_attribute_read_failed");
  const existingCodes = new Set((existingAttributes ?? [])
    .filter((item: Record<string, unknown>) => clean(item.value_text, 240) || ["not_disclosed", "not_applicable"].includes(String(item.state)))
    .map((item: Record<string, unknown>) => String(item.attribute_code)));

  const missing = RESEARCH_FIELD_KEYS.filter(code =>
    !clean(details[code], 120) &&
    !(ATTRIBUTE_CODE_MAP[code] && existingCodes.has(ATTRIBUTE_CODE_MAP[code])),
  );
  if (!missing.length) {
    await completeJob(db, job, worker, { result: "no_missing_fields", no_external_search: true });
    return { id: job.id, outcome: "complete", result: "no_missing_fields" };
  }

  const research = await callOfficialResearch(apiKey, product, sighting, missing);
  const persisted = await persistResearch(db, product.id, job, research.fields);
  await completeJob(db, job, worker, {
    result: research.fields.length ? "evidence_recorded_unreviewed" : "no_supported_fields",
    fields_found: research.fields.length,
    evidence_rows: persisted.evidenceCount,
    attribute_rows_needing_review: persisted.attributeCount,
    attribute_conflicts: persisted.conflictCount,
    input_tokens: research.inputTokens,
    output_tokens: research.outputTokens,
    official_web_search_performed: research.searchPerformed,
  });
  return {
    id: job.id,
    outcome: "complete",
    result: research.fields.length ? "evidence_recorded_unreviewed" : "no_supported_fields",
    fields: research.fields.length,
    evidence: persisted.evidenceCount,
    conflicts: persisted.conflictCount,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const workerToken = Deno.env.get("DISCOVER_ENRICHMENT_WORKER_TOKEN") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!workerToken || !serviceKey) return json({ error: "worker_not_configured" }, 503);
  try {
    if (new URL(url).hostname !== PROJECT + ".supabase.co") return json({ error: "environment_refused" }, 503);
  } catch { return json({ error: "environment_refused" }, 503); }

  const supplied = req.headers.get("x-discover-worker-token") ?? "";
  if (!safeEqual(supplied, workerToken)) return json({ error: "unauthorized" }, 401);
  if (req.headers.get("content-type")?.toLowerCase().startsWith("application/json") !== true) {
    return json({ error: "content_type_must_be_json" }, 415);
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
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
  const worker = String(body.worker ?? "discover-enrichment-worker").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 80) || "discover-enrichment-worker";

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let dailyResearchAttempts = 0;
  let dailyCapReached = true;
  if (anthropicKey) {
    const { data: recentResearchJobs, error } = await db.from("discover_enrichment_jobs")
      .select("id,attempts")
      .eq("job_type", "official_source_lookup")
      .gt("attempts", 0)
      .gte("updated_at", new Date(Date.now() - 86400000).toISOString())
      .limit(1000);
    if (error) return json({ error: "daily_research_budget_check_failed" }, 503);
    dailyResearchAttempts = (recentResearchJobs ?? []).reduce(
      (sum: number, item: Record<string, unknown>) => sum + Math.max(0, Number(item.attempts) || 0),
      0,
    );
    dailyCapReached = dailyResearchAttempts >= DAILY_RESEARCH_ATTEMPT_CAP;
  }
  const supportedTypes = getSupportedJobTypes(!!anthropicKey, dailyCapReached);
  const { data: claimed, error: claimError } = await db.rpc("discover_claim_enrichment_jobs", {
    p_worker: worker,
    p_limit: requestedLimit,
    p_stale_after_seconds: 600,
    p_job_types: [...supportedTypes],
  });
  if (claimError) {
    console.error(JSON.stringify({ event: "queue_claim_failed", message: claimError.message.slice(0, 180) }));
    return json({ error: "queue_claim_failed" }, 503);
  }

  const jobs = Array.isArray(claimed) ? claimed : [];
  const results: Array<Record<string, unknown>> = [];
  for (const job of jobs) {
    try {
      if (job.job_type === "identity_match") {
        results.push(await processIdentityJob(db, job, worker));
      } else if (job.job_type === "official_source_lookup") {
        if (!anthropicKey) throw new Error("anthropic_api_key_missing");
        results.push(await processOfficialSourceJob(db, job, worker, anthropicKey));
      } else {
        await completeJob(db, job, worker, { result: "unsupported_job_type", job_type: job.job_type });
        results.push({ id: job.id, outcome: "skipped" });
      }
    } catch (error) {
      const retryStatus = await retryJob(db, job, worker, error).catch(() => "state_update_failed");
      results.push({ id: job.id, outcome: retryStatus });
    }
  }

  const deferredTypes = [
    ...DEFERRED_JOB_TYPES,
    ...(!supportedTypes.some(type => type === "official_source_lookup") ? ["official_source_lookup"] : []),
  ];
  return json({
    ok: true,
    version: VERSION,
    worker,
    claimed: jobs.length,
    completed: results.filter(x => x.outcome === "complete").length,
    retried: results.filter(x => x.outcome === "retry").length,
    failed: results.filter(x => x.outcome === "failed").length,
    research_budget: { daily_attempt_cap: DAILY_RESEARCH_ATTEMPT_CAP, attempts_in_last_24h: dailyResearchAttempts, cap_reached: dailyCapReached },
    results,
    supported_job_types: [...supportedTypes],
    deferred_job_types: deferredTypes,
  });
});
