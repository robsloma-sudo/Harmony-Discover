// phg-taxonomy-cola-search v0.3 -- taxonomy.cola.search READ-ONLY gateway
//
// v0.3 CHANGE (single, narrow): the `category` filter no longer hardcodes the 2026-09-23
// batch names. It now matches the category's own batches of any date
// (colacloud_<cat>_* and colacloud_sample_<cat>_*) PLUS full-registry labels
// (colacloud_registry_*) whose class belongs to that category. The class list comes from
// public.phg_cola_category_filter (server-defined rules in public.cola_category_class_rules,
// expanded into public.cola_class_category_map). No user text reaches the rule values.
// Before this, 876k registry labels were invisible to every category search.
//
// v0.2 CHANGE (single, narrow): coverage resolution now goes through the
// public.phg_cola_coverage_lookup SECURITY DEFINER RPC instead of
// sb.schema("phg").from("cola_category_coverage"). The phg schema is deliberately
// NOT exposed to PostgREST, so the direct call always failed with PGRST106 and
// returned coverage_lookup_failed (HTTP 500). Nothing else changed: the phg schema
// remains unexposed and all coverage semantics are identical.
//
// Owner: Taxonomy / governed taxonomy-data layer. Harmony is a read-only consumer.
// Contract: CONTRACT_taxonomy_cola_search_v0.1.md
//
// INVARIANTS:
//  - READ ONLY. No INSERT/UPDATE/DELETE anywhere. No ingestion. No taxonomy writes.
//  - No arbitrary SQL, no arbitrary column names, no client-authored ORDER BY.
//  - coverage_status is READ from phg.cola_category_coverage via the narrow RPC.
//    NEVER derived from row counts or date ranges. Never defaults to 'complete'.
//  - Unresolved state is preserved and never silently omitted.
//  - mapped_code is descriptive, never a ranking/quality/confidence signal.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CAPABILITY = "taxonomy.cola.search";
const VERSION = "0.3";
const SOURCE_CODE = "US-TTB-COLA";
const EVIDENCE_TABLE = "public.cola_label_approvals";
const COVERAGE_RPC = "phg_cola_coverage_lookup";
const CATEGORY_RULE_RPC = "phg_cola_category_filter";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MAX_OFFSET = 5000;
const MIN_TEXT_LEN = 2;
const MAX_TEXT_LEN = 120;
const MAX_CATEGORIES = 100;
const MAX_RULE_CLASSES = 200;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const out = (x: any, s = 200) =>
  new Response(JSON.stringify(x), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Sanitized errors only. Never echo SQL, driver messages, tokens or upstream payloads.
function fail(code: string, status: number, detail?: string) {
  console.error(JSON.stringify({ evt: "cola_search_error", capability: CAPABILITY, version: VERSION, code }));
  return out({ status: "error", capability: CAPABILITY, version: VERSION, code, detail: detail ?? null }, status);
}

// ---- whitelists. Anything not listed here is rejected. ----
const ALLOWED_FILTERS = new Set([
  "brand_text", "fanciful_text", "class_type_code", "class_type_desc",
  "origin_desc", "origin_code", "application_status", "category",
  "completed_date_from", "completed_date_to", "class_unmapped", "origin_resolution",
  "limit", "offset", "sort"
]);
const ALLOWED_SORTS: Record<string, { col: string; asc: boolean }> = {
  // Fixed, server-defined. Clients pick a key, never an expression.
  // NOTE: no sort key is derived from origin_resolution or match_method --
  // mapped_code must never act as an ordering/ranking signal.
  completed_date_desc: { col: "completed_date", asc: false },
  completed_date_asc:  { col: "completed_date", asc: true }
};
const ALLOWED_ORIGIN_RESOLUTION = new Set(["mapped_code", "text_only", "unknown"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Za-z0-9 ._-]{1,40}$/;
const CATEGORY_RE = /^[a-z0-9_]{1,40}$/;

// Escape LIKE metacharacters so user text cannot alter match semantics.
function likeLiteral(s: string) {
  return s.replace(/([\\%_])/g, "\\$1");
}

// Quote a server-defined value for a PostgREST logic tree (handles commas, parentheses, quotes).
function pq(s: string) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// Category -> PostgREST `or` filter: the category's own batches (any date) plus registry labels whose
// class (and, for some categories, origin or name) belongs to it. Rule values are server-defined.
function categoryOrFilter(v: string, rule: any): string {
  const parts = [`import_batch.like.colacloud_${v}_*`, `import_batch.like.colacloud_sample_${v}_*`];
  const classes = Array.isArray(rule?.classes)
    ? rule.classes.filter((c: unknown) => typeof c === "string" && c.length > 0).slice(0, MAX_RULE_CLASSES) : [];
  const reg: string[] = [];
  if (classes.length) reg.push(`class_type_desc.in.(${classes.map(pq).join(",")})`);
  if (rule?.name_regex) reg.push(`or(brand_name_raw.imatch.${pq(rule.name_regex)},fanciful_name.imatch.${pq(rule.name_regex)})`);
  if (reg.length && rule?.origin_regex) reg.push(`origin_desc.imatch.${pq(rule.origin_regex)}`);
  if (reg.length) parts.push(`and(import_batch.like.colacloud_registry_*,${reg.join(",")})`);
  return parts.join(",");
}

function cleanText(v: any, field: string): string {
  const s = String(v ?? "").trim();
  if (s.length < MIN_TEXT_LEN) throw new Error(`${field}_too_short`);
  if (s.length > MAX_TEXT_LEN) throw new Error(`${field}_too_long`);
  return s;
}

// Deterministic category derivation -- mirrors the coverage-registry seeding rule.
function categoryFromBatch(batch: string | null): string | null {
  if (!batch) return null;
  const m = batch.replace(/^colacloud_(sample_)?/, "").replace(/_\d{4}-\d{2}-\d{2}$/, "");
  return m || null;
}

function originResolution(origin_desc: string | null, origin_code: string | null) {
  if (origin_desc == null) return "unknown";
  return origin_code == null ? "text_only" : "mapped_code";
}

const COVERAGE_RANK: Record<string, number> = { partial: 0, newest_first_sample: 1, complete: 2 };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return fail("runtime_configuration_missing", 500);

  // ---- AUTH: reuse the existing PHG model. Fail closed. JWT is the only identity source.
  // The service-role key stays server-side and is never returned to any caller.
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return fail("login_required", 401);
  const jwt = auth.slice(7).trim();
  const sb = createClient(url, service, { auth: { persistSession: false } });
  const { data: ud, error: ue } = await sb.auth.getUser(jwt);
  if (ue || !ud?.user) return fail("invalid_or_expired_login", 401);
  const user = ud.user;

  // ---- AUTHORIZATION BOUNDARY
  // COLA label approvals are GLOBAL REFERENCE DATA (a public US regulator register), not
  // account-owned data. There is therefore no per-account row filter to apply and no
  // cross-account leakage surface in the result set. The normal authenticated PHG boundary
  // is still enforced: the caller must be a signed-in user with a valid account membership,
  // validated server-side by phg_language_context. No new auth model is introduced.
  const { data: ctx, error: ctxErr } = await sb.rpc("phg_language_context", {
    p_user_id: user.id, p_account_id: null, p_menu_project_id: null
  });
  if (ctxErr) return fail("account_authorization_failed", 403);
  const accountId = (ctx as any)?.account?.id;
  if (!accountId) return fail("no_active_account_membership", 403);

  const body = await req.json().catch(() => ({} as any));
  const filters = (body && typeof body.filters === "object" && body.filters) ? body.filters : body;

  // Reject unknown keys outright rather than ignoring them.
  for (const k of Object.keys(filters || {})) {
    if (!ALLOWED_FILTERS.has(k)) return fail("unsupported_filter", 400, `unsupported filter: ${k}`);
  }

  // ---- bounded pagination
  let limit = Number(filters?.limit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(Math.floor(limit), MAX_LIMIT);
  let offset = Number(filters?.offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);
  if (offset > MAX_OFFSET) return fail("offset_too_large", 400, `max offset ${MAX_OFFSET}`);

  const sortKey = String(filters?.sort ?? "completed_date_desc");
  const sort = ALLOWED_SORTS[sortKey];
  if (!sort) return fail("unsupported_sort", 400, `allowed: ${Object.keys(ALLOWED_SORTS).join(", ")}`);

  // ---- build a parameterised query. No string-concatenated SQL anywhere.
  const COLUMNS = "ttb_id,completed_date,brand_name_raw,fanciful_name,class_type_code,class_type_desc," +
                  "origin_code,origin_desc,match_method,brand_id,application_status,import_batch";
  let q = sb.from("cola_label_approvals").select(COLUMNS, { count: "exact" });

  try {
    if (filters?.brand_text != null) {
      q = q.ilike("brand_name_raw", `%${likeLiteral(cleanText(filters.brand_text, "brand_text"))}%`);
    }
    if (filters?.fanciful_text != null) {
      q = q.ilike("fanciful_name", `%${likeLiteral(cleanText(filters.fanciful_text, "fanciful_text"))}%`);
    }
    if (filters?.class_type_desc != null) {
      q = q.ilike("class_type_desc", `%${likeLiteral(cleanText(filters.class_type_desc, "class_type_desc"))}%`);
    }
    if (filters?.origin_desc != null) {
      // Origin text filtering is first-class and intentionally NOT restricted to origin_code.
      q = q.ilike("origin_desc", `%${likeLiteral(cleanText(filters.origin_desc, "origin_desc"))}%`);
    }
    if (filters?.class_type_code != null) {
      const v = String(filters.class_type_code);
      if (!CODE_RE.test(v)) return fail("invalid_class_type_code", 400);
      q = q.eq("class_type_code", v);
    }
    if (filters?.origin_code != null) {
      const v = String(filters.origin_code);
      if (!CODE_RE.test(v)) return fail("invalid_origin_code", 400);
      // NOTE: filtering on origin_code = '81' selects Mexico-origin labels. It does NOT
      // imply tequila or any class, and nothing downstream may treat it as such.
      q = q.eq("origin_code", v);
    }
    if (filters?.application_status != null) {
      const v = String(filters.application_status);
      if (!CODE_RE.test(v)) return fail("invalid_application_status", 400);
      q = q.eq("application_status", v);
    }
    if (filters?.category != null) {
      const v = String(filters.category).toLowerCase();
      if (!CATEGORY_RE.test(v)) return fail("invalid_category", 400);
      // Deterministic: the category's own batches (any load date) plus registry labels whose
      // class belongs to the category, per the server-side rule table.
      const { data: rule, error: ruleErr } = await sb.rpc(CATEGORY_RULE_RPC, { p_category: v });
      if (ruleErr) return fail("category_rule_lookup_failed", 500);
      q = q.or(categoryOrFilter(v, rule));
    }
    if (filters?.class_unmapped != null) {
      if (typeof filters.class_unmapped !== "boolean") return fail("invalid_class_unmapped", 400);
      q = filters.class_unmapped ? q.is("class_type_code", null) : q.not("class_type_code", "is", null);
    }
    if (filters?.origin_resolution != null) {
      const v = String(filters.origin_resolution);
      if (!ALLOWED_ORIGIN_RESOLUTION.has(v)) return fail("invalid_origin_resolution", 400);
      if (v === "unknown") q = q.is("origin_desc", null);
      else if (v === "text_only") q = q.not("origin_desc", "is", null).is("origin_code", null);
      else q = q.not("origin_desc", "is", null).not("origin_code", "is", null);
    }
    if (filters?.completed_date_from != null) {
      const v = String(filters.completed_date_from);
      if (!DATE_RE.test(v)) return fail("invalid_completed_date_from", 400);
      q = q.gte("completed_date", v);
    }
    if (filters?.completed_date_to != null) {
      const v = String(filters.completed_date_to);
      if (!DATE_RE.test(v)) return fail("invalid_completed_date_to", 400);
      q = q.lte("completed_date", v);
    }
  } catch (e: any) {
    return fail("invalid_filter_value", 400, String(e?.message || "invalid filter"));
  }

  q = q.order(sort.col, { ascending: sort.asc }).order("ttb_id", { ascending: false })
       .range(offset, offset + limit - 1);

  const started = Date.now();
  const { data, error, count } = await q;
  const latency_ms = Date.now() - started;
  if (error) return fail("query_failed", 500);

  const rows = (data as any[]) || [];

  // ---- COVERAGE: read from the authoritative registry via the narrow SECURITY DEFINER RPC.
  // The phg schema stays unexposed to PostgREST. Coverage is never derived here.
  const categories = Array.from(new Set(rows.map(r => categoryFromBatch(r.import_batch)).filter(Boolean))) as string[];
  const covByCat = new Map<string, string>();
  if (categories.length) {
    if (categories.length > MAX_CATEGORIES) return fail("too_many_categories_in_scope", 400);
    const { data: cov, error: covErr } = await sb.rpc(COVERAGE_RPC, {
      p_source_code: SOURCE_CODE,
      p_category_slugs: categories
    });
    if (covErr) return fail("coverage_lookup_failed", 500);
    for (const c of (cov as any[]) || []) covByCat.set(c.category_slug, c.coverage_status);
  }

  // Fail closed: an in-scope category with no authoritative coverage record is an explicit
  // error. We never fall back to 'complete', and never invent a status.
  const missing = categories.filter(c => !covByCat.has(c));
  if (missing.length) {
    return out({
      status: "error", capability: CAPABILITY, version: VERSION,
      code: "coverage_unresolved",
      detail: "No authoritative coverage record exists for one or more categories in scope.",
      unresolved_categories: missing,
      coverage_status: null
    }, 409);
  }

  // Weakest-status rule across all categories present in scope.
  let responseCoverage: string | null = null;
  for (const c of categories) {
    const s = covByCat.get(c)!;
    if (responseCoverage === null || COVERAGE_RANK[s] < COVERAGE_RANK[responseCoverage]) responseCoverage = s;
  }

  // ---- shape rows to the contract
  const results = rows.map(r => {
    const cat = categoryFromBatch(r.import_batch);
    return {
      ttb_id: r.ttb_id,
      completed_date: r.completed_date,
      brand_name_raw: r.brand_name_raw,
      fanciful_name: r.fanciful_name ?? null,
      // class: unresolved state preserved, desc verbatim, code never guessed
      class_type_code: r.class_type_code ?? null,
      class_type_desc: r.class_type_desc ?? null,
      class_unmapped: r.class_type_code == null,
      // origin: text_only never presented as a verified numeric code
      origin_desc: r.origin_desc ?? null,
      origin_code: r.origin_code ?? null,
      origin_resolution: originResolution(r.origin_desc ?? null, r.origin_code ?? null),
      // identity: unmatched is never canonical identity
      brand_id: r.brand_id ?? null,
      match_method: r.match_method ?? null,
      brand_identity_resolved: r.match_method === "exact" || r.match_method === "stripped_class_word",
      match_strength: r.match_method === "exact" ? "strong"
                    : r.match_method === "stripped_class_word" ? "weak"
                    : "none",
      application_status: r.application_status ?? null,
      category: cat,
      import_batch: r.import_batch ?? null,
      coverage_status: cat ? (covByCat.get(cat) ?? null) : null
    };
  });

  // Page-level splits. Deliberately labelled page_counts: these describe THIS PAGE, never
  // the corpus. total_matching describes the filtered set as loaded, not reality.
  const page_counts = {
    rows: results.length,
    origin_mapped_code: results.filter(r => r.origin_resolution === "mapped_code").length,
    origin_text_only: results.filter(r => r.origin_resolution === "text_only").length,
    origin_unknown: results.filter(r => r.origin_resolution === "unknown").length,
    class_mapped: results.filter(r => !r.class_unmapped).length,
    class_unmapped: results.filter(r => r.class_unmapped).length,
    match_exact: results.filter(r => r.match_method === "exact").length,
    match_stripped_class_word: results.filter(r => r.match_method === "stripped_class_word").length,
    match_unmatched: results.filter(r => r.match_method === "unmatched").length
  };

  console.log(JSON.stringify({
    evt: "cola_search", capability: CAPABILITY, version: VERSION,
    user_id: user.id, account_id: accountId,
    rows: results.length, total_matching: count ?? null,
    coverage_status: responseCoverage, categories_in_scope: categories.length,
    latency_ms, wrote_to_database: false
  }));

  return out({
    status: "ok",
    capability: CAPABILITY,
    version: VERSION,
    read_only: true,
    wrote_to_database: false,
    coverage_status: responseCoverage,
    coverage_rule: "Read from phg.cola_category_coverage via public.phg_cola_coverage_lookup. Weakest status across categories in scope. Never derived from row counts or date ranges.",
    categories_in_scope: categories,
    total_matching: count ?? null,
    page: { limit, offset, sort: sortKey, returned: results.length },
    page_counts,
    page_counts_note: "Counts describe THIS PAGE of loaded records only. total_matching describes the filtered set as currently loaded. Neither describes the COLA corpus or current market reality.",
    evidence: {
      source_code: SOURCE_CODE,
      source_table: EVIDENCE_TABLE,
      evidence_class: "primary",
      evidence_kind: "ttb_label_approval",
      retrieved_at: new Date().toISOString(),
      boundary: "TTB label approval evidence only. Does NOT prove current distribution, shelf availability, price, producer/site, size, ABV, UPC, or current commercial activity. Absence of a COLA record is not evidence that a product does not exist."
    },
    semantics: {
      origin_resolution: "mapped_code | text_only | unknown. text_only has NO verified TTB numeric origin code.",
      origin_code_note: "origin_code = '81' indicates Mexico origin only. It does NOT imply tequila or any class.",
      mapped_code_note: "mapped_code is DESCRIPTIVE, not evaluative. It is not a quality score, confidence input, relevance boost, ranking signal, ordering default or emphasis signal.",
      class_unmapped: "true when class_type_code IS NULL. class_type_desc is preserved verbatim including source misspellings. No code is guessed and no row is omitted.",
      match_method: "exact (strong) > stripped_class_word (weak) > unmatched (none). unmatched is NOT canonical brand identity.",
      category_filter: "category = that category's own batches (any load date) plus full-registry labels whose class is listed for it in public.cola_category_class_rules."
    },
    results
  });
});
