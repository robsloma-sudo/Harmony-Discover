// discover-catalog-sync v0.3 — copies data between Harmony (PHG) and Discover DEV through PHG's token-guarded bridge.
//   labels        : US label approvals since 2016 (name, style, origin, producer) -> discover_label_catalog
//   research_pull : PHG products that still need web research -> discover_phg_enrich_queue (batch 'full')
//   research_push : finished research results -> PHG product_web_facts (review table, no product writes)
//   products      : Harmony's product catalogue (codes, barcodes, category, label facts) -> discover_phg_products
//   brand_profiles: Harmony's approved brand profiles -> discover_phg_brand_profiles
//   link          : link Discover products to Harmony products, copy Harmony facts into empty card fields, then match
//                   unmatched bottles to a US label approval and copy its facts (empty fields only)
//   facts_push    : facts Discover found for linked products -> PHG product_discover_facts (review table)
//   cola_details  : asks Harmony for the US label detail of newly scanned bottles (within Harmony's monthly "scans"
//                   COLA allocation), pulls finished details back and copies them into empty card fields
//   daily         : products + brand_profiles + link + facts_push
// Auth: x-discover-cron-secret. Bridge token + PHG publishable key live in discover_bridge_config (server only).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "0.3";
const PROJECT = "lqqmwqrffelgnbngrkep";
const BUDGET_MS = 100_000;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "", serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  try { if (new URL(url).hostname !== PROJECT + ".supabase.co") return json({ error: "environment_refused" }, 503); } catch { return json({ error: "environment_refused" }, 503); }
  const supplied = req.headers.get("x-discover-cron-secret") ?? "";
  if (supplied.length < 32 || supplied.length > 512) return json({ error: "unauthorized" }, 401);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok } = await db.rpc("discover_check_cron_secret", { p_given: supplied });
  if (ok !== true) return json({ error: "unauthorized" }, 401);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const action = String(body.action ?? "labels");

  const { data: cfgRows } = await db.from("discover_bridge_config").select("key,value");
  const cfg: Record<string, string> = Object.fromEntries((cfgRows ?? []).map((r: any) => [r.key, r.value]));
  if (!cfg.phg_bridge_token || !cfg.phg_url || !cfg.phg_anon_key) return json({ error: "bridge_not_configured" }, 503);
  const setCfg = (key: string, value: string) => db.from("discover_bridge_config").upsert({ key, value, updated_at: new Date().toISOString() });
  const phg = async (fn: string, args: Record<string, unknown>) => {
    const r = await fetch(cfg.phg_url + "/rest/v1/rpc/" + fn, { method: "POST",
      headers: { apikey: cfg.phg_anon_key, "content-type": "application/json" },
      body: JSON.stringify({ p_token: cfg.phg_bridge_token, ...args }) });
    const p = await r.json().catch(() => null);
    if (!r.ok) throw new Error("phg_" + r.status + "_" + String(p?.message ?? "").slice(0, 60));
    return p;
  };
  const started = Date.now();

  try {
    if (action === "labels") {
      if (cfg.labels_done === "1") return json({ ok: true, done: true });
      let cursor = cfg.labels_cursor ?? "", pages = 0, rows = 0, done = false;
      while (Date.now() - started < BUDGET_MS) {
        const page: any[] = await phg("discover_catalog_bridge", { p_dataset: "labels", p_after: cursor, p_limit: 5000 });
        if (!Array.isArray(page) || !page.length) { done = true; break; }
        for (let i = 0; i < page.length; i += 1000) {
          const { error } = await db.rpc("discover_label_catalog_upsert", { p_rows: page.slice(i, i + 1000) });
          if (error) throw new Error("upsert_failed " + error.message.slice(0, 80));
        }
        cursor = String(page[page.length - 1][0]); rows += page.length; pages++;
        await setCfg("labels_cursor", cursor);
        if (page.length < 5000) { done = true; break; }
      }
      if (done) await setCfg("labels_done", "1");
      return json({ ok: true, version: VERSION, pages, rows, cursor, done });
    }

    if (action === "research_pull") {
      let cursor = "", rows = 0;
      while (Date.now() - started < BUDGET_MS) {
        const page: any[] = await phg("discover_catalog_bridge", { p_dataset: "research", p_after: cursor, p_limit: 2000 });
        if (!Array.isArray(page) || !page.length) break;
        const recs = page.map((r) => ({ phg_code: r[0], brand: r[1], product_name: r[2], product_class: r[3],
          known_size_ml: r[4], known_abv: r[5], url: r[6], tier: r[7], batch: "full" }));
        const { error } = await db.from("discover_phg_enrich_queue").upsert(recs, { onConflict: "phg_code", ignoreDuplicates: true });
        if (error) throw new Error("queue_failed " + error.message.slice(0, 80));
        rows += page.length; cursor = String(page[page.length - 1][0]);
        if (page.length < 2000) break;
      }
      return json({ ok: true, version: VERSION, rows });
    }

    if (action === "research_push") {
      let pushed = 0;
      while (Date.now() - started < BUDGET_MS) {
        const { data: done } = await db.from("discover_phg_enrich_queue").select("phg_code,result,cost_usd")
          .eq("status", "done").is("pushed_at", null).limit(150);
        if (!done?.length) break;
        const rowsOut = done.map((d: any) => ({ code: d.phg_code, matched: d.result?.matched_exact_product === true,
          facts: d.result?.fields ?? {}, sources: d.result?.sources ?? [], cost: d.cost_usd }));
        await phg("discover_enrich_submit", { p_rows: rowsOut });
        await db.from("discover_phg_enrich_queue").update({ pushed_at: new Date().toISOString() }).in("phg_code", done.map((d: any) => d.phg_code));
        pushed += done.length;
      }
      return json({ ok: true, version: VERSION, pushed });
    }
    const syncProducts = async () => {
      const startedIso = new Date().toISOString();
      let cursor = "", rows = 0;
      while (Date.now() - started < BUDGET_MS) {
        const page: any[] = await phg("discover_catalog_bridge", { p_dataset: "products", p_after: cursor, p_limit: 1000 });
        if (!Array.isArray(page) || !page.length) break;
        const { error } = await db.rpc("discover_phg_products_load", { p_rows: page, p_replace: false });
        if (error) throw new Error("products_load_failed " + error.message.slice(0, 80));
        rows += page.length; cursor = String(page[page.length - 1].code);
        if (page.length < 1000) {   // full pass finished: drop products Harmony no longer has
          const { count } = await db.from("discover_phg_products").delete({ count: "exact" }).lt("synced_at", startedIso);
          return { rows, removed: count ?? 0, complete: true };
        }
      }
      return { rows, complete: false };
    };
    const syncProfiles = async () => {
      const page: any[] = await phg("discover_catalog_bridge", { p_dataset: "brand_profiles", p_after: "", p_limit: 5000 });
      if (!Array.isArray(page)) throw new Error("profiles_bad_reply");
      if (!page.length) return { rows: 0, kept_previous: true };
      const { data, error } = await db.rpc("discover_phg_profiles_load", { p_rows: page });
      if (error) throw new Error("profiles_load_failed " + error.message.slice(0, 80));
      return { rows: data };
    };
    const linkAndPrefill = async () => {
      const { data: link, error: e1 } = await db.rpc("discover_link_phg", {});
      if (e1) throw new Error("link_failed " + e1.message.slice(0, 80));
      const { data: prefill, error: e2 } = await db.rpc("discover_prefill_from_phg", {});
      if (e2) throw new Error("prefill_failed " + e2.message.slice(0, 80));
      const { data: labels, error: e3 } = await db.rpc("discover_label_match_all", { p_limit: 200 });
      if (e3) throw new Error("labels_failed " + e3.message.slice(0, 80));
      return { link, prefill, labels };
    };
    const pushFacts = async () => {
      let after = cfg.facts_push_after || "-infinity", pushed = 0;
      while (Date.now() - started < BUDGET_MS) {
        const { data: rowsOut, error } = await db.rpc("discover_facts_for_phg", { p_after: after, p_limit: 2000 });
        if (error) throw new Error("facts_read_failed " + error.message.slice(0, 80));
        const list = Array.isArray(rowsOut) ? rowsOut : [];
        if (!list.length) break;
        for (let i = 0; i < list.length; i += 500) {
          await phg("discover_facts_submit", { p_rows: list.slice(i, i + 500).map(({ updated_at: _u, ...r }: any) => r) });
        }
        after = String(list[list.length - 1].updated_at); pushed += list.length;
        await setCfg("facts_push_after", after);
        if (list.length < 2000) break;
      }
      return { pushed };
    };

    const colaDetails = async () => {
      let asked = 0, queued = 0, pulled = 0, reply: any = null;
      const { data: wanted } = await db.from("discover_cola_detail_wanted").select("ttb_id").is("sent_at", null).order("wanted_at").limit(100);
      const ids = (wanted ?? []).map((w: any) => String(w.ttb_id));
      for (let i = 0; i < ids.length && Date.now() - started < BUDGET_MS; i += 20) {
        const chunk = ids.slice(i, i + 20);
        reply = await phg("discover_cola_detail_request", { p_ttb_ids: chunk });
        await db.from("discover_cola_detail_wanted").update({ sent_at: new Date().toISOString(), reply }).in("ttb_id", chunk);
        asked += chunk.length; queued += Number(reply?.queued ?? 0);
        if (Number(reply?.scans_left ?? 1) <= 0) break;   // this month's scan allocation is used up
      }
      let after = cfg.cola_details_after || "";
      while (Date.now() - started < BUDGET_MS) {
        const page: any[] = await phg("discover_catalog_bridge", { p_dataset: "cola_details", p_after: after, p_limit: 500 });
        if (!Array.isArray(page) || !page.length) break;
        const { error } = await db.rpc("discover_cola_details_load", { p_rows: page });
        if (error) throw new Error("details_load_failed " + error.message.slice(0, 80));
        pulled += page.length; after = String(page[page.length - 1].done_at);
        await setCfg("cola_details_after", after);
        if (page.length < 500) break;
      }
      const { data: prefill } = pulled ? await db.rpc("discover_prefill_from_labels", {}) : { data: null };
      return { asked, queued, pulled, scans_left: reply?.scans_left ?? null, prefill };
    };

    if (action === "cola_details") return json({ ok: true, version: VERSION, cola_details: await colaDetails() });
    if (action === "products") return json({ ok: true, version: VERSION, products: await syncProducts() });
    if (action === "brand_profiles") return json({ ok: true, version: VERSION, brand_profiles: await syncProfiles() });
    if (action === "link") return json({ ok: true, version: VERSION, ...(await linkAndPrefill()) });
    if (action === "facts_push") return json({ ok: true, version: VERSION, facts: await pushFacts() });
    if (action === "daily") {
      const products = await syncProducts();
      const brand_profiles = await syncProfiles();
      const linked = await linkAndPrefill();
      const facts = await pushFacts();
      console.log(JSON.stringify({ evt: "catalog_daily", products, brand_profiles, ...linked, facts }));
      return json({ ok: true, version: VERSION, products, brand_profiles, ...linked, facts });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 160) }, 502);
  }
});
