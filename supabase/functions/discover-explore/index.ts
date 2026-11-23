// Harmony Discover DEV — discover-explore v0.1.0 (23 Nov 2026) · P-20261123-0711 part 3.
// Tap-to-explore from a scanned menu. One server program, actions:
//   link_menu       link every drink line of a scanned menu to the real cocktail / spirit / wine / beer (cached per menu)
//   change_cocktail apply guest changes (swap base, smokier, lower proof...) to a cocktail
//   journey         fast cached Journey; builds and saves one once when none exists (guests: capped builds)
//   tap             record a tap (no AI)
//   save_version / list_versions / delete_version   "my version" saved on the person's account
//   push_counts     server-only weekly job (worker secret, not a user token): sends combined counts to PHG main
// Guards: signed-in Discover user (anonymous guests included) except push_counts, exact-origin allow-list, DEV project only,
// per-minute limits per person, daily guest limits for the AI-cost actions (menu_link, cocktail_change, journey_build).
// Privacy: raw tap/change events are stored ONLY when the person has aggregate_research consent (learning_current_consent);
// PHG main only ever receives combined rows with >= DISCOVER_EXPLORE_MIN_GUESTS distinct people (default 5, never below 3).
// Guests: saved versions live on the guest account (same id carries over when they sign up through account linking).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { ChangeType, CocktailChange, CountRow, ItemKind, LinkedLine, Recipe } from "./contract.ts";
import { loadPhgConfig, menuLinesFromItems, phgChangeCocktail, phgJourney, phgLinkLines, phgSendCounts } from "./phg.ts";

const VERSION = "0.1.0";
const PROJECT = "lqqmwqrffelgnbngrkep";
const MAX_BODY_BYTES = 100_000;
const SITE_ORIGIN = /^https:\/\/([a-z0-9-]+--)?harmony-discover\.netlify\.app$/;

const intFromEnv = (name: string, fallback: number) => { const n = Number(Deno.env.get(name)); return Number.isInteger(n) && n > 0 ? n : fallback; };
// Guest daily limits (account / network / all guests). Override with DISCOVER_GUEST_<KIND>_PER_ACCOUNT / _PER_NETWORK / _ALL_GUESTS.
// The per-network limit is extra friction only (callers can fake their address); per-account and all-guests are the real guard.
type GuestKind = "menu_link" | "cocktail_change" | "journey_build";
const GUEST_CAPS: Record<GuestKind, [number, number, number]> = {
  menu_link: [intFromEnv("DISCOVER_GUEST_MENU_LINK_PER_ACCOUNT", 20), intFromEnv("DISCOVER_GUEST_MENU_LINK_PER_NETWORK", 40), intFromEnv("DISCOVER_GUEST_MENU_LINK_ALL_GUESTS", 400)],
  cocktail_change: [intFromEnv("DISCOVER_GUEST_COCKTAIL_CHANGE_PER_ACCOUNT", 20), intFromEnv("DISCOVER_GUEST_COCKTAIL_CHANGE_PER_NETWORK", 40), intFromEnv("DISCOVER_GUEST_COCKTAIL_CHANGE_ALL_GUESTS", 400)],
  journey_build: [intFromEnv("DISCOVER_GUEST_JOURNEY_BUILD_PER_ACCOUNT", 5), intFromEnv("DISCOVER_GUEST_JOURNEY_BUILD_PER_NETWORK", 10), intFromEnv("DISCOVER_GUEST_JOURNEY_BUILD_ALL_GUESTS", 150)],
};
const GUEST_LIMIT_MESSAGE = "You've reached today's free guest limit. Sign in (it's free) to keep going, or try again tomorrow.";
const JOURNEY_CACHE_HOURS = intFromEnv("DISCOVER_JOURNEY_CACHE_HOURS", 168);
const MAX_VERSIONS_GUEST = intFromEnv("DISCOVER_EXPLORE_MAX_VERSIONS_GUEST", 25);
const MAX_VERSIONS_MEMBER = intFromEnv("DISCOVER_EXPLORE_MAX_VERSIONS_MEMBER", 200);
const MIN_GUESTS = Math.max(3, intFromEnv("DISCOVER_EXPLORE_MIN_GUESTS", 5)); // privacy cut-off, never below 3
// Per-minute limits per person (existing discover_rate_limit RPC).
const MINUTE: Record<string, number> = { explore_link: 6, explore_change: 20, explore_journey: 30, explore_tap: 120, explore_save: 20 };

const KINDS: ItemKind[] = ["cocktail", "spirit", "wine", "beer", "other"];
const CHANGE_TYPES: ChangeType[] = ["swap_base", "smokier", "lower_proof", "stronger", "sweeter", "drier", "more_citrus", "less_ice", "no_alcohol", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  if (SITE_ORIGIN.test(origin)) return true;
  return (Deno.env.get("DISCOVER_ALLOWED_ORIGINS") ?? "").split(",").map((v) => v.trim()).includes(origin);
}
function headers(origin: string | null): Headers {
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "Origin" });
  if (origin && originAllowed(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("access-control-allow-headers", "authorization,apikey,content-type");
    h.set("access-control-allow-methods", "POST,OPTIONS");
    h.set("access-control-max-age", "600");
  }
  return h;
}
const reply = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: headers(origin) });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const cleanBlock = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const itemKind = (v: unknown): ItemKind | null => KINDS.includes(v as ItemKind) ? v as ItemKind : null;
const uuidOrNull = (v: unknown) => typeof v === "string" && UUID.test(v) ? v : null;

// Same network key as discover-live-read: daily keyed hash of the caller address, never the address itself.
async function guestNetworkKey(req: Request, secret: string): Promise<string | null> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || (req.headers.get("x-real-ip") || "").trim();
  if (!ip || !secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("discover-guest-net:" + new Date().toISOString().slice(0, 10) + ":" + ip))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// null = go ahead (members always). Otherwise the refusal to send. Reserves the unit before the paid call.
async function guestRefusal(
  // deno-lint-ignore no-explicit-any
  db: any, user: { id: string; is_anonymous?: boolean }, req: Request, secret: string, kind: GuestKind, units: number,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (user.is_anonymous !== true) return null;
  const [perAccount, perNetwork, allGuests] = GUEST_CAPS[kind];
  const network = await guestNetworkKey(req, secret).catch(() => null);
  const { data, error } = await db.rpc("discover_guest_allow", {
    p_account: user.id, p_network: network, p_kind: kind, p_units: units,
    p_account_max: perAccount, p_network_max: perNetwork, p_all_guests_max: allGuests,
  });
  if (error) return { status: 503, body: { error: "daily_limit_unavailable" } };
  if (data !== true) return { status: 429, body: { error: "daily_limit_reached", limit: "guest", message: GUEST_LIMIT_MESSAGE } };
  return null;
}

function timingSafeEqual(a: string, b: string): Promise<boolean> {
  // Compare SHA-256 digests byte by byte without early exit: length and content leak nothing.
  const enc = new TextEncoder();
  return Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]).then(([x, y]) => {
    const p = new Uint8Array(x), q = new Uint8Array(y);
    let diff = 0;
    for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
    return diff === 0;
  });
}

function phgFailure(e: unknown, origin: string | null) {
  const m = String((e as Error)?.message || "");
  if (m === "phg_timeout") return reply({ error: "phg_timeout", message: "That is taking longer than usual. Please try again." }, 504, origin);
  console.log(JSON.stringify({ evt: "explore_phg_error", msg: clean(m, 120) }));
  return reply({ error: "phg_unavailable", message: "Explore is not available right now. Please try again soon." }, 503, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!originAllowed(origin)) return reply({ error: "origin_not_allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL") || "";
  try { if (new URL(url).hostname !== PROJECT + ".supabase.co") return reply({ error: "environment_refused" }, 503, origin); }
  catch { return reply({ error: "environment_refused" }, 503, origin); }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return reply({ error: "discover_explore_configuration_missing" }, 503, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413, origin);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413, origin);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); if (!isObj(body)) throw new Error(); }
  catch { return reply({ error: "invalid_json" }, 400, origin); }
  const action = String(body.action || "");

  // ---- push_counts: server-only. Worker secret (constant-time compare), never a user token. ----
  if (action === "push_counts") {
    const secret = Deno.env.get("DISCOVER_EXPLORE_WORKER_SECRET") || "";
    const given = req.headers.get("x-worker-secret") || "";
    if (secret.length < 24 || !given || !(await timingSafeEqual(given, secret))) return reply({ error: "unauthorized" }, 401, origin);
    return await pushCounts(db, origin);
  }

  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return reply({ error: "unauthorized" }, 401, origin);
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth?.user) return reply({ error: "unauthorized" }, 401, origin);
  const user = auth.user as { id: string; is_anonymous?: boolean };
  const subject = user.id;
  if (action === "health") return reply({ ok: true, version: VERSION, min_guests: MIN_GUESTS, journey_cache_hours: JOURNEY_CACHE_HOURS }, 200, origin);

  const minuteStop = async (bucket: string) => {
    const { data, error } = await db.rpc("discover_rate_limit", { p_subject: subject, p_bucket: bucket, p_max: MINUTE[bucket], p_window_seconds: 60 });
    if (error) return reply({ error: "rate_limit_unavailable" }, 503, origin);
    if (data !== true) return reply({ error: "rate_limited" }, 429, origin);
    return null;
  };
  // The menu must belong to the caller. Returns the row (venue_id) or null.
  const ownObservation = async (id: unknown): Promise<{ id: string; venue_id: string | null } | null> => {
    const oid = uuidOrNull(id);
    if (!oid) return null;
    const { data } = await db.from("menu_observations").select("id, venue_id").eq("id", oid).eq("consumer_id", subject).maybeSingle();
    return data ? { id: data.id, venue_id: data.venue_id ?? null } : null;
  };
  // Raw events only with aggregate_research consent (granted, not withdrawn). Never fails the request.
  const record = async (venueId: string | null, rows: Array<{ kind: ItemKind; ref: string; event: string; change?: ChangeType | null }>) => {
    try {
      if (!rows.length) return;
      const { data } = await db.rpc("learning_current_consent", { p_subject: subject });
      const c = Array.isArray(data) ? data[0] : data;
      if (!c || c.aggregate_research !== true) return;
      await db.from("discover_explore_events").insert(rows.slice(0, 20).map((r) => ({
        subject_id: subject, venue_id: venueId, item_kind: r.kind, item_ref: clean(r.ref, 120), event: r.event, change_type: r.change ?? null,
      })));
    } catch { /* recording is best effort */ }
  };

  if (action === "link_menu") {
    const obs = await ownObservation(body.observation_id);
    if (!obs) return reply({ error: "menu_not_found" }, 404, origin);
    const cached = await db.from("discover_explore_menu_links").select("lines").eq("observation_id", obs.id).maybeSingle();
    if (cached.data?.lines) return reply({ ok: true, observation_id: obs.id, lines: cached.data.lines, from_cache: true }, 200, origin);
    const stop = await minuteStop("explore_link"); if (stop) return stop;
    const { data: items, error: itemsErr } = await db.from("observation_items")
      .select("id, section, name, description, price_text, beverage_category, listed_ingredients, page_index, position")
      .eq("observation_id", obs.id).eq("consumer_id", subject).order("page_index").order("position").limit(150);
    if (itemsErr) return reply({ error: "menu_lookup_failed" }, 503, origin);
    const lines = menuLinesFromItems(items || []);
    if (!lines.length) return reply({ ok: true, observation_id: obs.id, lines: [], from_cache: false }, 200, origin);
    const g = await guestRefusal(db, user, req, serviceKey, "menu_link", 1);
    if (g) return reply(g.body, g.status, origin);
    let linked: LinkedLine[];
    try {
      const cfg = await loadPhgConfig(db);
      let venue: { name: string | null } | undefined;
      if (obs.venue_id) { const v = await db.from("discover_venues").select("name").eq("id", obs.venue_id).maybeSingle(); venue = { name: v.data?.name ?? null }; }
      linked = await phgLinkLines(cfg, lines, venue);
    } catch (e) { return phgFailure(e, origin); }
    await db.from("discover_explore_menu_links").upsert({ observation_id: obs.id, consumer_id: subject, lines: linked }, { onConflict: "observation_id", ignoreDuplicates: true });
    return reply({ ok: true, observation_id: obs.id, lines: linked, from_cache: false }, 200, origin);
  }

  if (action === "change_cocktail") {
    const cocktailId = body.cocktail_id == null ? null : clean(body.cocktail_id, 120) || null;
    const recipe = isObj(body.recipe) && JSON.stringify(body.recipe).length <= 20_000 ? body.recipe as unknown as Recipe : null;
    if (!cocktailId && !recipe) return reply({ error: "cocktail_required" }, 400, origin);
    const rawChanges = Array.isArray(body.changes) ? body.changes : [];
    if (!rawChanges.length || rawChanges.length > 5) return reply({ error: "changes_1_to_5_required" }, 400, origin);
    const changes: CocktailChange[] = [];
    for (const c of rawChanges) {
      if (!isObj(c) || !CHANGE_TYPES.includes(c.type as ChangeType)) return reply({ error: "invalid_change" }, 400, origin);
      changes.push({ type: c.type as ChangeType, value: c.value == null ? null : clean(c.value, 80) });
    }
    const stop = await minuteStop("explore_change"); if (stop) return stop;
    const g = await guestRefusal(db, user, req, serviceKey, "cocktail_change", 1);
    if (g) return reply(g.body, g.status, origin);
    let result;
    try { result = await phgChangeCocktail(await loadPhgConfig(db), { cocktail_id: cocktailId, recipe, changes }); }
    catch (e) { return phgFailure(e, origin); }
    const obs = body.observation_id ? await ownObservation(body.observation_id) : null;
    const ref = cocktailId || result.recipe?.base_cocktail_id || recipe?.base_cocktail_id || null;
    if (ref) await record(obs?.venue_id ?? null, changes.map((c) => ({ kind: "cocktail" as ItemKind, ref, event: "change", change: c.type })));
    return reply({ ok: true, ...result }, 200, origin);
  }

  if (action === "journey") {
    const kind = itemKind(body.item_kind), ref = clean(body.item_ref, 120);
    if (!kind || !ref) return reply({ error: "item_required" }, 400, origin);
    const stop = await minuteStop("explore_journey"); if (stop) return stop;
    const obs = body.observation_id ? await ownObservation(body.observation_id) : null;
    const opened = () => record(obs?.venue_id ?? null, [{ kind, ref, event: "journey_open" }]);
    // Fast path: fresh ready copy on the Discover side, no PHG call.
    const hit = await db.from("discover_explore_journeys").select("status, journey, fetched_at").eq("item_kind", kind).eq("item_ref", ref).maybeSingle();
    if (hit.data && Date.now() - new Date(hit.data.fetched_at).getTime() < JOURNEY_CACHE_HOURS * 3_600_000) {
      await opened();
      return reply({ ok: true, status: "ready", built_now: false, from_cache: true, journey: hit.data.journey }, 200, origin);
    }
    // Build only when the guest still has a build left (reserved before the call); otherwise fetch-only.
    const g = await guestRefusal(db, user, req, serviceKey, "journey_build", 1);
    const canBuild = g === null;
    if (g && g.status !== 429) return reply(g.body, g.status, origin);
    let res;
    try { res = await phgJourney(await loadPhgConfig(db), { item_kind: kind, item_ref: ref, build: canBuild }); }
    catch (e) { return phgFailure(e, origin); }
    if ((res.status === "ready" || res.status === "built") && res.journey) {
      await db.from("discover_explore_journeys").upsert({ item_kind: kind, item_ref: ref, status: res.status, journey: res.journey, fetched_at: new Date().toISOString() }, { onConflict: "item_kind,item_ref" });
      await opened();
      return reply({ ok: true, status: res.status, built_now: res.built_now, from_cache: false, journey: res.journey }, 200, origin);
    }
    if (!canBuild && res.status === "none") return reply({ ok: true, status: "limit", built_now: false, from_cache: false, journey: null, message: GUEST_LIMIT_MESSAGE }, 200, origin);
    return reply({ ok: true, status: res.status, built_now: false, from_cache: false, journey: null }, 200, origin);
  }

  if (action === "tap") {
    const obs = await ownObservation(body.observation_id);
    if (!obs) return reply({ error: "menu_not_found" }, 404, origin);
    const kind = itemKind(body.item_kind), ref = clean(body.item_ref, 120);
    if (!kind || !ref || !uuidOrNull(body.line_id)) return reply({ error: "item_required" }, 400, origin);
    const stop = await minuteStop("explore_tap"); if (stop) return stop;
    await record(obs.venue_id, [{ kind, ref, event: "tap" }]);
    return reply({ ok: true }, 200, origin);
  }

  if (action === "save_version") {
    const name = clean(body.name, 80);
    if (!name || !isObj(body.recipe) || JSON.stringify(body.recipe).length > 20_000) return reply({ error: "version_invalid" }, 400, origin);
    const changeTypes = (Array.isArray(body.change_types) ? body.change_types : []).filter((c): c is ChangeType => CHANGE_TYPES.includes(c as ChangeType)).slice(0, 10);
    const baseId = body.base_cocktail_id == null ? null : clean(body.base_cocktail_id, 120) || null;
    const obs = body.observation_id ? await ownObservation(body.observation_id) : null;
    const stop = await minuteStop("explore_save"); if (stop) return stop;
    const cap = user.is_anonymous === true ? MAX_VERSIONS_GUEST : MAX_VERSIONS_MEMBER;
    const { data: id, error } = await db.rpc("discover_explore_save_version", {
      p_subject: subject, p_max: cap, p_name: name, p_recipe: body.recipe, p_card: cleanBlock(body.bartender_card, 2000),
      p_home: cleanBlock(body.home_recipe, 4000), p_base: baseId, p_changes: changeTypes, p_observation: obs?.id ?? null,
    });
    if (error) return reply({ error: "save_unavailable" }, 503, origin);
    if (!id) return reply({ error: "versions_full", limit: cap, message: user.is_anonymous === true ? "Your saved versions are full. Sign in (it's free) to save more, or delete one." : "Your saved versions are full. Delete one to save another." }, 409, origin);
    const ref = baseId || (isObj(body.recipe) ? clean((body.recipe as Record<string, unknown>).base_cocktail_id, 120) : "");
    if (ref) await record(obs?.venue_id ?? null, [{ kind: "cocktail", ref, event: "save_my_version" }]);
    return reply({ ok: true, id, limit: cap }, 200, origin);
  }

  if (action === "list_versions") {
    const { data, error } = await db.from("discover_explore_versions")
      .select("id, name, recipe, bartender_card, home_recipe, base_cocktail_id, change_types, created_at")
      .eq("subject_id", subject).order("created_at", { ascending: false }).limit(MAX_VERSIONS_MEMBER);
    if (error) return reply({ error: "list_unavailable" }, 503, origin);
    return reply({ ok: true, versions: data || [], limit: user.is_anonymous === true ? MAX_VERSIONS_GUEST : MAX_VERSIONS_MEMBER }, 200, origin);
  }

  if (action === "delete_version") {
    const id = uuidOrNull(body.id);
    if (!id) return reply({ error: "id_required" }, 400, origin);
    const { error } = await db.from("discover_explore_versions").delete().eq("id", id).eq("subject_id", subject);
    if (error) return reply({ error: "delete_unavailable" }, 503, origin);
    return reply({ ok: true }, 200, origin);
  }

  return reply({ error: "unknown_action" }, 400, origin);
});

// Weekly job: finished weeks not yet sent -> combined rows (>= MIN_GUESTS distinct people) -> PHG main -> mark week sent.
// A week is marked sent only after PHG accepted its rows; a failure leaves it for the next run.
// deno-lint-ignore no-explicit-any
async function pushCounts(db: any, origin: string | null) {
  const weeksRes = await db.rpc("discover_explore_pending_weeks");
  if (weeksRes.error) return reply({ error: "weeks_unavailable" }, 503, origin);
  const weeks: string[] = (weeksRes.data || []).map((w: { week_start: string }) => w.week_start);
  if (!weeks.length) { const cleanup = await db.rpc("discover_explore_cleanup"); return reply({ ok: true, weeks: 0, sent: 0, cleanup: cleanup.data ?? null }, 200, origin); }
  const exp = await db.rpc("discover_explore_weekly_export", { p_min_guests: MIN_GUESTS });
  if (exp.error) return reply({ error: "export_unavailable" }, 503, origin);
  const all: CountRow[] = (exp.data || []).map((r: Record<string, unknown>) => ({
    venue_id: (r.venue_id as string | null) ?? null, week_start: String(r.week_start), item_kind: r.item_kind as ItemKind, item_ref: String(r.item_ref),
    event: r.event as CountRow["event"], change_type: (r.change_type as ChangeType | null) ?? null, count: Number(r.count), guests: Number(r.guests),
  })).filter((r: CountRow) => r.guests >= MIN_GUESTS); // second check on top of the database cut-off
  let cfg;
  try { cfg = await loadPhgConfig(db); } catch (e) { return phgFailure(e, origin); }
  let sentWeeks = 0, sentRows = 0;
  for (const w of weeks) {
    const rows = all.filter((r) => r.week_start === w);
    try {
      for (let i = 0; i < rows.length; i += 500) await phgSendCounts(cfg, rows.slice(i, i + 500));
    } catch (e) {
      console.log(JSON.stringify({ evt: "explore_counts_send_failed", week: w, msg: clean((e as Error)?.message, 80) }));
      break;
    }
    const m = await db.rpc("discover_explore_mark_week_sent", { p_week: w, p_rows_sent: rows.length, p_min_guests: MIN_GUESTS });
    if (m.error) break;
    sentWeeks++; sentRows += rows.length;
  }
  const cleanup = await db.rpc("discover_explore_cleanup");
  return reply({ ok: sentWeeks === weeks.length, weeks: weeks.length, sent_weeks: sentWeeks, rows_sent: sentRows, cleanup: cleanup.data ?? null }, 200, origin);
}
