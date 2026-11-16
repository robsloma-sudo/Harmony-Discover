// phg-cola-ingest v0.3 — COLA Cloud -> Supabase full-record ingest (staging + catalogue only).
// v0.3: one shared COLA budget. Every detail view and every list page first takes units from the consumer's monthly
//       allocation (public.phg_cola_quota_take; table public.cola_quota_allocations). detail {queue:"scans"} fetches
//       label details other apps asked for (public.cola_detail_requests) and marks them done / not_found.
// v0.2: backfill_tick (resumable month windows, auto-split at the 100-page offset limit, free /usage pre-check),
//       detail {priority:n} (PHG-menu brands > distilled spirits > newest). Shared list runner.
// Auth: x-ingest-token (pg_cron / pg_net). Key: COLA_CLOUD_API_KEY, MY_API_KEY, or any custom secret whose value
//       starts with "cola_". Key values are never returned or logged.
// Writes ONLY via phg_cola_* RPCs (plus request status in cola_detail_requests). Never touches cola_label_approvals.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "0.3";
const BASE = "https://app.colacloud.us/api/v1";
const TIME_BUDGET_MS = 110_000;
const LIST_RESERVE = 5_000;
const DETAIL_RESERVE = 200;
const MAX_PAGES = 200;
const MAX_DETAIL_PER_CALL = 100;
const DETAIL_CONSUMERS = new Set(["scans", "top_sellers", "tools"]);
const KEY_NAMES = ["COLA_CLOUD_API_KEY", "COLACLOUD_API_KEY", "COLA_API_KEY", "COLA_CLOUD_KEY", "MY_API_KEY"];
const SYSTEM_PREFIX = /^(SUPABASE_|SB_|DENO_|DENO|PATH$|HOME$|HOSTNAME$|PWD$|LANG$|TZ$|EDGE_|EF_|AWS_|OTEL_|NODE_|RUST_|VERBOSE|DEBUG)/;
const ALLOWED_FILTERS = new Set(["q","product_type","category","derived_subcategory","origin","domestic_or_imported",
  "status","brand_name","permit_number","barcode_value","approval_date_from","approval_date_to","abv_min","abv_max",
  "volume_unit","volume_min","volume_max","container_type"]);

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function eq(a: string | null, b: string) {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a.trim()), y = new TextEncoder().encode(b.trim());
  if (x.length !== y.length) return false;
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findKey(): { name: string | null; key: string } {
  for (const n of KEY_NAMES) { const v = (Deno.env.get(n) ?? "").trim(); if (v) return { name: n, key: v }; }
  for (const [n, v] of Object.entries(Deno.env.toObject())) {
    if (SYSTEM_PREFIX.test(n)) continue;
    if (/^cola_[A-Za-z0-9_-]{8,}$/.test((v ?? "").trim())) return { name: n, key: v.trim() };
  }
  return { name: null, key: "" };
}

// Shared monthly budget: returns how many units were granted (0 when the consumer's allocation is used up).
async function take(sb: SupabaseClient, consumer: string, kind: "detail" | "list", n: number): Promise<number> {
  const { data, error } = await sb.rpc("phg_cola_quota_take", { p_consumer: consumer, p_kind: kind, p_n: n });
  if (error) return 0;
  return Number(data) || 0;
}
async function giveBack(sb: SupabaseClient, consumer: string, kind: "detail" | "list", n: number) {
  if (n > 0) await sb.rpc("phg_cola_quota_give_back", { p_consumer: consumer, p_kind: kind, p_n: n });
}

type Quota = { list_remaining: number | null; detail_remaining: number | null; reset: number | null };
function quotaFrom(h: Headers): Quota {
  const n = (k: string) => { const v = h.get(k); return v == null ? null : Number(v); };
  return { list_remaining: n("x-list-records-remaining"), detail_remaining: n("x-detail-views-remaining"), reset: n("x-quota-reset") };
}

async function cola(path: string, key: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(BASE + path, { headers: { "X-API-Key": key, "Accept": "application/json", "User-Agent": "PHG-cola-ingest/" + VERSION } });
    const q = quotaFrom(r.headers);
    if (r.status === 429) {
      const body = await r.json().catch(() => ({}));
      const code = body?.error?.code ?? "rate_limited";
      if (code === "quota_exceeded") return { ok: false, status: 429, code, quota: q };
      const wait = Math.min(Number(r.headers.get("retry-after") ?? 5), 30) * 1000;
      await sleep(wait); continue;
    }
    if (!r.ok) { await r.body?.cancel(); return { ok: false, status: r.status, code: r.status === 401 ? "cola_auth_failed" : r.status === 404 ? "not_found" : "upstream_error", quota: q }; }
    return { ok: true, status: 200, body: await r.json(), quota: q };
  }
  return { ok: false, status: 429, code: "burst_limit", quota: null };
}

type ListResult = { stop: string; reason: string | null; pages: number; records: number; hasMore: boolean;
  nextPage: number; nextCursor: string | null; dmin: string | null; dmax: string | null; quota: Quota | null;
  tot: Record<string, number> };

async function runList(sb: SupabaseClient, key: string, f: Record<string, unknown>, runId: string, startPage: number,
  startCursor: string | null, maxPages: number, started: number, consumer: string): Promise<ListResult> {
  let page = startPage, cursor = startCursor, pages = 0, recs = 0, hasMore = true, stop = "cap_reached";
  let reason: string | null = null, dmin: string | null = null, dmax: string | null = null, lastQ: Quota | null = null;
  const tot: Record<string, number> = { new_raw_versions: 0, records_inserted: 0, records_changed: 0, records_unchanged: 0 };
  while (pages < maxPages) {
    if (Date.now() - started > TIME_BUDGET_MS) { stop = "interrupted"; reason = "time_budget"; break; }
    if (lastQ?.list_remaining != null && lastQ.list_remaining < LIST_RESERVE) { stop = "quota_exhausted"; reason = `list reserve ${LIST_RESERVE} reached`; break; }
    if (!cursor && page > 100) { stop = "boundary_reached"; reason = "offset page limit 100"; break; }
    const granted = await take(sb, consumer, "list", 100);
    if (granted < 100) { await giveBack(sb, consumer, "list", granted); stop = "quota_exhausted"; reason = `monthly ${consumer} list allocation used up`; break; }
    const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) p.set(k, String(v));
    p.set("per_page", "100"); if (cursor) p.set("cursor", cursor); else p.set("page", String(page));
    const r: any = await cola("/colas?" + p.toString(), key);
    lastQ = r.quota ?? lastQ;
    if (!r.ok) { await giveBack(sb, consumer, "list", 100); stop = r.code === "quota_exceeded" ? "quota_exhausted" : "error"; reason = r.code; break; }
    const items = r.body?.data ?? [];
    const pg = r.body?.pagination ?? {};
    if (items.length < 100) await giveBack(sb, consumer, "list", 100 - items.length);
    if (items.length) {
      const { data: res, error } = await sb.rpc("phg_cola_ingest_page", { p_run_id: runId, p_endpoint: "list", p_items: items });
      if (error) { stop = "error"; reason = "ingest_rpc_failed"; break; }
      for (const k of Object.keys(tot)) tot[k] += res?.[k] ?? 0;
      for (const it of items) { const d = it.approval_date; if (d) { if (!dmin || d < dmin) dmin = d; if (!dmax || d > dmax) dmax = d; } }
    }
    pages++; recs += items.length;
    hasMore = !!pg.has_more;
    if (!hasMore) { stop = "source_exhausted"; break; }
    if (pg.next_cursor) cursor = String(pg.next_cursor); else { cursor = null; page++; }
  }
  return { stop, reason, pages, records: recs, hasMore, nextPage: page, nextCursor: cursor, dmin, dmax, quota: lastQ, tot };
}

async function audit(sb: SupabaseClient, label: string, runId: string, f: Record<string, unknown>, maxPages: number) {
  return (await sb.rpc("phg_cola_audit_write", { p: { category_slug: label, derived_subcategory: (f as any).derived_subcategory ?? null,
    import_batch: runId, configured_cap: maxPages * 100, ordering_mode: "approval_date_desc",
    configured_historical_boundary: (f as any).approval_date_from ?? null, notes: `filters=${JSON.stringify(f)}` } })).data;
}
async function auditFinish(sb: SupabaseClient, id: string, r: ListResult) {
  const exhausted = r.stop === "source_exhausted";
  await sb.rpc("phg_cola_audit_write", { p: { id, pull_completed: exhausted || r.stop === "cap_reached", pages_received: r.pages,
    records_received: r.records, approval_date_min: r.dmin, approval_date_max: r.dmax, has_more_observed: r.hasMore,
    source_exhausted: exhausted, exhaustion_evidence: exhausted ? "pagination.has_more=false on final page" : null,
    stop_reason: r.stop, quota_or_cap_reason: r.reason } });
}

async function detailRun(sb: SupabaseClient, key: string, ids: string[], started: number, consumer: string) {
  ids = ids.filter((x) => /^[0-9A-Za-z]{6,20}$/.test(x)).slice(0, MAX_DETAIL_PER_CALL);
  const runId = `colacloud_detail_${new Date().toISOString().slice(0, 19)}`;
  let done = 0, missing = 0, stop = "completed", lastQ: Quota | null = null;
  const fetchedIds: string[] = [], missingIds: string[] = [];
  const tot: Record<string, number> = { new_raw_versions: 0, records_inserted: 0, records_changed: 0, records_unchanged: 0 };
  for (const id of ids) {
    if (Date.now() - started > TIME_BUDGET_MS) { stop = "time_budget"; break; }
    if (lastQ?.detail_remaining != null && lastQ.detail_remaining < DETAIL_RESERVE) { stop = "detail_reserve_reached"; break; }
    if ((await take(sb, consumer, "detail", 1)) !== 1) { stop = "budget_exhausted"; break; }
    const r: any = await cola("/colas/" + encodeURIComponent(id), key);
    lastQ = r.quota ?? lastQ;
    if (!r.ok) {
      if (r.code === "not_found") { missing++; missingIds.push(id); continue; }
      await giveBack(sb, consumer, "detail", 1); stop = r.code; break;
    }
    const { data: res, error } = await sb.rpc("phg_cola_ingest_page", { p_run_id: runId, p_endpoint: "detail", p_items: [r.body?.data] });
    if (error) { stop = "ingest_rpc_failed"; break; }
    for (const k of Object.keys(tot)) tot[k] += res?.[k] ?? 0;
    done++; fetchedIds.push(id);
    await sleep(450);
  }
  return { run_id: runId, consumer, requested: ids.length, fetched: done, not_found: missing, stop, ...tot, quota: lastQ, fetchedIds, missingIds };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: tok } = await sb.from("internal_secrets").select("value").eq("key", "ingest_token").single();
  if (!eq(req.headers.get("x-ingest-token"), tok?.value ?? "")) return json({ error: "unauthorized" }, 401);

  const { name: keyName, key } = findKey();
  if (!key) {
    const names = Object.keys(Deno.env.toObject()).filter((n) => !SYSTEM_PREFIX.test(n)).sort();
    return json({ ok: false, code: "cola_key_missing", expected: "COLA_CLOUD_API_KEY", custom_secret_names: names }, 500);
  }

  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const action = String(b.action ?? "");
  const started = Date.now();

  if (action === "usage") {
    const r = await cola("/usage", key);
    const { data: budget } = await sb.rpc("phg_cola_quota_status");
    return json({ ok: r.ok, version: VERSION, key_secret_name: keyName, code: (r as any).code ?? null, usage: (r as any).body?.data ?? null, budget: budget ?? null });
  }

  if (action === "list") {
    const f = b.filters ?? {};
    for (const k of Object.keys(f)) if (!ALLOWED_FILTERS.has(k)) return json({ ok: false, code: "unsupported_filter", field: k }, 400);
    const maxPages = Math.min(Math.max(1, Number(b.max_pages ?? 1)), MAX_PAGES);
    const label = String(b.label ?? "adhoc").replace(/[^a-z0-9_]/gi, "_").slice(0, 60);
    const runId = `colacloud_${label}_${new Date().toISOString().slice(0, 19)}`;
    const auditId = await audit(sb, label, runId, f, maxPages);
    const r = await runList(sb, key, f, runId, 1, null, maxPages, started, "adhoc");
    await auditFinish(sb, auditId, r);
    console.log(JSON.stringify({ evt: "cola_list", version: VERSION, label, pages: r.pages, recs: r.records, stop: r.stop, ...r.tot }));
    return json({ ok: r.stop !== "error", version: VERSION, run_id: runId, audit_id: auditId, pages: r.pages, records: r.records,
      stop_reason: r.stop, detail: r.reason, has_more: r.hasMore, approval_date_min: r.dmin, approval_date_max: r.dmax, ...r.tot, quota: r.quota });
  }

  if (action === "backfill_tick") {
    // Free pre-check so an exhausted month costs nothing.
    const u: any = await cola("/usage", key);
    const rem = u.body?.data?.list_records?.remaining;
    if (u.ok && typeof rem === "number" && rem < LIST_RESERVE) return json({ ok: true, version: VERSION, skipped: "list_quota_reserve", list_remaining: rem });
    const { data: w, error: ce } = await sb.rpc("phg_cola_backfill_claim");
    if (ce) return json({ ok: false, code: "claim_failed" }, 500);
    if (!w || !w.id) return json({ ok: true, version: VERSION, skipped: "no_pending_windows" });
    const f = { product_type: w.product_type, approval_date_from: w.date_from, approval_date_to: w.date_to };
    const label = `backfill_${String(w.product_type).replace(/\s+/g, "_")}`;
    const runId = `colacloud_${label}_${w.date_from}_${new Date().toISOString().slice(0, 19)}`;
    const auditId = await audit(sb, label, runId, f, MAX_PAGES);
    const r = await runList(sb, key, f, runId, w.next_page ?? 1, w.next_cursor ?? null, MAX_PAGES, started, "backfill");
    await auditFinish(sb, auditId, r);
    const status = r.stop === "source_exhausted" ? "done" : r.stop === "boundary_reached" ? "split" : "pending";
    const saved = (await sb.rpc("phg_cola_backfill_save", { p: { id: w.id, status, next_page: r.nextPage, next_cursor: r.nextCursor,
      pages_added: r.pages, records_added: r.records, run_id: runId,
      last_error: ["error", "quota_exhausted"].includes(r.stop) ? r.reason : null } })).data;
    console.log(JSON.stringify({ evt: "cola_backfill", version: VERSION, window: w.id, pt: w.product_type, from: w.date_from,
      pages: r.pages, recs: r.records, stop: r.stop, saved_status: saved?.status, ...r.tot }));
    return json({ ok: r.stop !== "error", version: VERSION, window_id: w.id, product_type: w.product_type, date_from: w.date_from,
      date_to: w.date_to, pages: r.pages, records: r.records, stop_reason: r.stop, window_status: saved?.status, ...r.tot, quota: r.quota });
  }

  if (action === "detail") {
    const queue = typeof b.queue === "string" && DETAIL_CONSUMERS.has(b.queue) ? b.queue : null;
    const consumer = queue ?? (typeof b.consumer === "string" && DETAIL_CONSUMERS.has(b.consumer) ? b.consumer : "top_sellers");
    let ids: string[] = Array.isArray(b.ttb_ids) ? b.ttb_ids.map(String) : [];
    if (!ids.length && queue) {
      const { data } = await sb.from("cola_detail_requests").select("ttb_id").eq("status", "pending").eq("consumer", queue)
        .order("requested_at", { ascending: true }).limit(Math.min(Math.max(1, Number(b.max) || 50), MAX_DETAIL_PER_CALL));
      ids = (data ?? []).map((x: any) => String(x.ttb_id));
    } else if (!ids.length && b.priority) {
      const { data } = await sb.rpc("phg_cola_detail_next", { p_n: Math.min(Number(b.priority) || 0, MAX_DETAIL_PER_CALL) });
      ids = ((data as any[]) ?? []).map((x: any) => typeof x === "string" ? x : x?.phg_cola_detail_next ?? x?.ttb_id).filter(Boolean);
    } else if (!ids.length && b.auto) {
      const { data } = await sb.from("cola_records").select("ttb_id").is("detail_fetched_at", null).order("approval_date", { ascending: false }).limit(Math.min(Number(b.auto) || 0, MAX_DETAIL_PER_CALL));
      ids = (data ?? []).map((x: any) => x.ttb_id);
    }
    const { fetchedIds, missingIds, ...out } = await detailRun(sb, key, ids, started, consumer);
    if (queue) {
      const now = new Date().toISOString();
      if (fetchedIds.length) await sb.from("cola_detail_requests").update({ status: "done", done_at: now }).in("ttb_id", fetchedIds);
      if (missingIds.length) await sb.from("cola_detail_requests").update({ status: "not_found", done_at: now }).in("ttb_id", missingIds);
    }
    console.log(JSON.stringify({ evt: "cola_detail", version: VERSION, consumer, queue, requested: out.requested, done: out.fetched, stop: out.stop }));
    return json({ ok: true, version: VERSION, ...out });
  }

  return json({ ok: false, code: "unknown_action", allowed: ["usage", "list", "backfill_tick", "detail"] }, 400);
});
