import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert";
import { LOOKUP_TIMEOUTS_MS, loadPhgConfig, parseLookupArgs, runLookup } from "./_shared/lookups.ts";
import type { LookupDeps } from "./_shared/lookups.ts";
import { MAX_RESULT_CHARS, PHG_LOOKUP_COMMANDS } from "./_shared/lookupContract.ts";
import type { LookupArgs } from "./_shared/lookupContract.ts";

// ---------- fixtures ----------
const NEGRONI_ID = "9adcad62-52c5-421d-aae0-967693446e08";
const FIND_NEGRONI = [
  { id: NEGRONI_ID, name: "Negroni", match: "exact" },
  { id: "3c66efe0-622b-4323-94d8-401e81db5009", name: "Mezcal Negroni", match: "close" },
];
const RECIPE_NEGRONI = {
  recipe: {
    name: "Negroni", glass: "cocktail or double rocks",
    lines: [
      { amount: "1 oz (30 ml)", ingredient: "gin", phg_product_id: null },
      { amount: "1 oz (30 ml)", ingredient: "Campari", phg_product_id: null },
      { amount: "1 oz (30 ml)", ingredient: "sweet vermouth", phg_product_id: null },
    ],
    method: "Stir all ingredients with ice. Strain into a rocks glass over ice (or up); orange twist/peel.",
    est_abv: 21.9, garnish: "orange twist", base_cocktail_id: NEGRONI_ID,
  },
  home_recipe: "Make it at home: Negroni ...", bartender_card: "Negroni ...",
};
const CAMPARI_PRODUCT = {
  phg_product_id: "e50a148f-1421-4200-8e59-f9ee8a784c1c", phg_brand_id: "b-campari", brand: "Campari", name: "Campari",
  category: "Red bitter aperitivo", abv: "24", size_ml: "750", country: "Italy", producer: "CAMPARI AMERICA LLC",
};
const CAMPARI_PROFILE = {
  phg_brand_id: "b-campari", brand: "Campari",
  ten_second: "Campari is an Italian red aperitivo, mildly bitter with a hint of sweetness, classically served with soda and a citrus twist.",
  thirty_second: null,
  history: [
    "Gaspare Campari formulated the product known today as Campari in 1860, according to the producer's history page.",
    "The Negroni story is dated by the producer to Florence in 1919.",
  ],
  producer: "CAMPARI AMERICA LLC", production: null, style: null, pronunciation: null,
};
// SYNTHETIC content in the real compact shape PHG returns (name, duration_s, nodes[].title, nodes[].claims[].text); no Negroni Journey exists on PHG yet.
const JOURNEY_SYNTHETIC = {
  status: "ready", built_now: false,
  journey: {
    duration_s: 270,
    nodes: [
      { title: "Origins", claims: [{ text: "Synthetic claim one." }, { text: "Synthetic claim two." }, { text: "Synthetic claim three." }] },
      { title: "Make it", claims: [{ text: "Synthetic stir note." }] },
    ],
  },
};
// SYNTHETIC: the pairing command is pending, so this reply shape is invented.
const PAIRING_SYNTHETIC = { ideas: [{ pairing: "Salted almonds", why: "Salt softens bitterness." }, { pairing: "Aged cheddar", why: "Fat rounds it." }] };
// SYNTHETIC saved rows.
const SAVED_VERSIONS = [
  { name: "Smoky Negroni", base_cocktail_id: NEGRONI_ID, change_types: ["smokier"], created_at: "2026-11-20T10:00:00Z" },
  { name: "Lighter Negroni", base_cocktail_id: NEGRONI_ID, change_types: ["lower_proof", "drier"], created_at: "2026-11-19T10:00:00Z" },
];
const SAVED_SIGHTINGS = [
  { read_brand: "Campari", read_product: "Campari", discover_product_id: "p1", seen_at: "2026-11-21" },
  { read_brand: "campari", read_product: "campari", discover_product_id: "p1", seen_at: "2026-11-18" },
  { read_brand: "Aperol", read_product: null, discover_product_id: "p2", seen_at: "2026-11-17" },
];

// ---------- fakes ----------
interface DbCall { table: string; ops: Array<[string, unknown[]]> }
interface Tables { [t: string]: { data?: unknown[]; error?: unknown; count?: number } }

function fakeDb(tables: Tables) {
  const calls: DbCall[] = [];
  const writes: string[] = [];
  const db = {
    from(table: string) {
      const call: DbCall = { table, ops: [] };
      calls.push(call);
      const t = tables[table] ?? { data: [] };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "ilike", "eq", "not", "order", "limit", "in"]) {
        chain[m] = (...a: unknown[]) => { call.ops.push([m, a]); return chain; };
      }
      for (const m of ["insert", "update", "upsert", "delete", "rpc"]) {
        chain[m] = () => { writes.push(`${table}.${m}`); throw new Error("write attempted: " + m); };
      }
      chain.then = (res: (v: unknown) => unknown) =>
        res(t.error ? { data: null, error: t.error } : { data: t.data ?? [], error: null, count: t.count ?? (t.data ?? []).length });
      return chain;
    },
    rpc() { writes.push("db.rpc"); throw new Error("write attempted: rpc"); },
  };
  return { db, calls, writes };
}

interface Sent { fn: string; body: Record<string, unknown> }
function fakeFetch(replies: Record<string, unknown | (() => Response | Promise<Response>)>) {
  const sent: Sent[] = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const fn = url.split("/rpc/")[1];
    sent.push({ fn, body: JSON.parse(String(init?.body)) });
    const r = replies[fn];
    if (typeof r === "function") return Promise.resolve((r as () => Response | Promise<Response>)());
    if (r === undefined) return Promise.resolve(new Response("SECRET-BODY not found", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(r), { status: 200 }));
  }) as typeof fetch;
  return { f, sent };
}

const PHG = () => Promise.resolve({ url: "https://phg.example", anonKey: "anon", token: "tok" });
function mk(tables: Tables, replies: Record<string, unknown | (() => Response | Promise<Response>)> = {}) {
  const d = fakeDb(tables);
  const ff = fakeFetch(replies);
  const deps: LookupDeps = { db: d.db, phg: PHG, fetch: ff.f };
  return { deps, ...d, sent: ff.sent };
}
const A = (tool: string, args: unknown = {}) => {
  const p = parseLookupArgs(tool, args);
  assert(p, "args should parse");
  return p as LookupArgs;
};
const SUBJECT = "subject-123";
const C = PHG_LOOKUP_COMMANDS;

// ---------- lookup_cocktail ----------
Deno.test("lookup_cocktail: Negroni returns real Harmony recipe", async () => {
  const m = mk({}, { [C.cocktailFind]: FIND_NEGRONI, [C.recipe]: RECIPE_NEGRONI });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_cocktail", { name: "negroni" }));
  assertEquals(r.status, "found");
  assertEquals(r.source, "harmony");
  assertStringIncludes(r.say, "Harmony data");
  const d = r.data as Record<string, unknown>;
  assertEquals(d.name, "Negroni");
  assertEquals(d.ingredients, [
    { ingredient: "gin", amount: "1 oz (30 ml)" }, { ingredient: "Campari", amount: "1 oz (30 ml)" },
    { ingredient: "sweet vermouth", amount: "1 oz (30 ml)" },
  ]);
  assertEquals(d.glass, "cocktail or double rocks");
  assertEquals(d.garnish, "orange twist");
  assertEquals(d.est_abv, 21.9);
  assertEquals(d.also_known_close, ["Mezcal Negroni"]);
  assertEquals(m.sent.map((s) => s.fn), [C.cocktailFind, C.recipe]);
  assertEquals(m.sent[0].body, { p_token: "tok", p_name: "negroni", p_limit: 3 });
  assertEquals(m.sent[1].body, { p_token: "tok", p_cocktail_id: NEGRONI_ID });
});

Deno.test("lookup_cocktail: close-only match is used; Zorblax Fizz is not_sure", async () => {
  const m = mk({}, {
    [C.cocktailFind]: [{ id: "c1", name: "Close One", match: "close" }, { id: "c2", name: "Other", match: "close" }],
    [C.recipe]: { recipe: { name: "Close One", lines: [] } },
  });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_cocktail", { name: "x" }));
  assertEquals(r.status, "found");
  assertEquals((r.data as Record<string, unknown>).also_known_close, ["Other"]);
  const z = mk({}, { [C.cocktailFind]: [] });
  const rz = await runLookup(z.deps, SUBJECT, A("lookup_cocktail", { name: "Zorblax Fizz" }));
  assertEquals(rz.status, "not_sure");
  assertEquals(rz.data, null);
  assertStringIncludes(rz.say, "not sure");
  assertEquals(z.sent.length, 1); // no recipe call when nothing matched
});

Deno.test("lookup_cocktail: cocktailFind missing (404) -> unavailable, no body leaked", async () => {
  const m = mk({}, {}); // every command 404s with a secret-looking body
  const r = await runLookup(m.deps, SUBJECT, A("lookup_cocktail", { name: "Negroni" }));
  assertEquals(r.status, "unavailable");
  assertFalse(JSON.stringify(r).includes("SECRET-BODY"));
  assertStringIncludes(r.say, "not sure");
});

Deno.test("lookup_cocktail: fetch throws -> unavailable; phg() throws -> unavailable", async () => {
  const m = mk({});
  m.deps.fetch = (() => Promise.reject(new TypeError("boom with SECRET"))) as typeof fetch;
  const r = await runLookup(m.deps, SUBJECT, A("lookup_cocktail", { name: "Negroni" }));
  assertEquals(r.status, "unavailable");
  assertFalse(JSON.stringify(r).includes("SECRET"));
  m.deps.phg = () => Promise.reject(new Error("config SECRET"));
  assertEquals((await runLookup(m.deps, SUBJECT, A("lookup_cocktail", { name: "Negroni" }))).status, "unavailable");
});

Deno.test("PHG timeout -> unavailable (short timeout)", async () => {
  const old = LOOKUP_TIMEOUTS_MS.phg;
  LOOKUP_TIMEOUTS_MS.phg = 30;
  try {
    const m = mk({});
    m.deps.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
    const t0 = Date.now();
    const r = await runLookup(m.deps, SUBJECT, A("lookup_cocktail", { name: "Negroni" }));
    assertEquals(r.status, "unavailable");
    assert(Date.now() - t0 < 2000);
  } finally { LOOKUP_TIMEOUTS_MS.phg = old; }
});

// ---------- lookup_bottle ----------
Deno.test("lookup_bottle: Campari returns product plus brand story", async () => {
  const m = mk({
    discover_phg_products: { data: [{ ...CAMPARI_PRODUCT, name: "Campari Cask", phg_product_id: "z" }, CAMPARI_PRODUCT] },
    discover_phg_brand_profiles: { data: [CAMPARI_PROFILE] },
  });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_bottle", { name: "campari", brand: "Campari" }));
  assertEquals(r.status, "found");
  const d = r.data as Record<string, unknown>;
  assertEquals(d.brand, "Campari");
  assertEquals(d.name, "Campari"); // exact beats the longer name
  assertEquals(d.category, "Red bitter aperitivo");
  assertEquals(d.abv_percent, 24);
  assertEquals(d.size_ml, "750");
  assertEquals(d.country, "Italy");
  assertEquals(d.producer, "CAMPARI AMERICA LLC");
  assertEquals(d.story, CAMPARI_PROFILE.ten_second);
  assertEquals(d.history, CAMPARI_PROFILE.history);
  assertEquals(d.style, []);
  assertEquals(d.pronunciation, null);
  assertEquals(d.other_sizes_or_versions, 1);
  assertFalse("phg_product_id" in d);
  assertEquals(m.calls[0].ops, [
    ["select", [
      "phg_product_id,phg_brand_id,brand,name,category,abv,size_ml,origin,country,producer,status",
    ]],
    ["ilike", ["name", "%campari%"]], ["ilike", ["brand", "%Campari%"]], ["limit", [5]],
  ]);
  assertEquals(m.sent.length, 0); // bottle look-up does not call PHG at all
});

Deno.test("lookup_bottle: escapes % and _ ; shortest name wins; unknown is not_sure", async () => {
  const m = mk({ discover_phg_products: { data: [{ ...CAMPARI_PRODUCT, name: "Campari Long Name" }, { ...CAMPARI_PRODUCT, name: "Camp" }] } });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_bottle", { name: "50%_off\\" }));
  assertEquals((r.data as Record<string, unknown>).name, "Camp");
  assertEquals(m.calls[0].ops[1], ["ilike", ["name", "%50\\%\\_off\\\\%"]]);
  const z = mk({ discover_phg_products: { data: [] } });
  assertEquals((await runLookup(z.deps, SUBJECT, A("lookup_bottle", { name: "Zorblax Fizz" }))).status, "not_sure");
});

Deno.test("lookup_bottle: db error -> unavailable", async () => {
  const m = mk({ discover_phg_products: { error: { message: "SECRET db" } } });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_bottle", { name: "Campari" }));
  assertEquals(r.status, "unavailable");
  assertFalse(JSON.stringify(r).includes("SECRET"));
});

// ---------- lookup_brand ----------
Deno.test("lookup_brand: Campari profile with product count", async () => {
  const m = mk({ discover_phg_brand_profiles: { data: [{ ...CAMPARI_PROFILE, brand: "Campari Group" }, CAMPARI_PROFILE] }, discover_phg_products: { data: [], count: 7 } });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_brand", { brand: "campari" }));
  assertEquals(r.status, "found");
  const d = r.data as Record<string, unknown>;
  assertEquals(d.brand, "Campari");
  assertEquals(d.story, CAMPARI_PROFILE.ten_second);
  assertEquals(d.history, CAMPARI_PROFILE.history);
  assertEquals(d.product_count, 7);
  assertEquals(m.calls[0].ops.map((o) => o[0]), ["select", "ilike", "limit"]);
  assertEquals(m.calls[0].ops[2], ["limit", [3]]);
  assertEquals(m.calls[1].ops[0], ["select", ["phg_product_id", { count: "exact", head: true }]]);
  const z = mk({ discover_phg_brand_profiles: { data: [] } });
  assertEquals((await runLookup(z.deps, SUBJECT, A("lookup_brand", { brand: "Zorblax" }))).status, "not_sure");
});

// ---------- lookup_journey ----------
Deno.test("lookup_journey: cocktail ready (synthetic journey), p_build always false", async () => {
  const m = mk({}, { [C.cocktailFind]: FIND_NEGRONI, [C.journey]: JOURNEY_SYNTHETIC });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_journey", { name: "Negroni", kind: "cocktail" }));
  assertEquals(r.status, "found");
  assertEquals(r.data, {
    name: "Negroni", minutes: 5,
    stops: [{ title: "Origins", notes: ["Synthetic claim one.", "Synthetic claim two."] }, { title: "Make it", notes: ["Synthetic stir note."] }],
  });
  const j = m.sent.find((s) => s.fn === C.journey)!;
  assertEquals(j.body, { p_token: "tok", p_item_kind: "cocktail", p_item_ref: NEGRONI_ID, p_build: false });
  assert(j.body.p_build === false);
});

Deno.test("lookup_journey: bottle resolves via products; none/building/unknown -> not_sure", async () => {
  const tables = { discover_phg_products: { data: [CAMPARI_PRODUCT] } };
  const m = mk(tables, { [C.journey]: JOURNEY_SYNTHETIC });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_journey", { name: "Campari", kind: "spirit" }));
  assertEquals(r.status, "found");
  assertEquals(m.sent[0].body, { p_token: "tok", p_item_kind: "spirit", p_item_ref: CAMPARI_PRODUCT.phg_product_id, p_build: false });
  for (const st of ["none", "building"]) {
    const x = mk(tables, { [C.journey]: { status: st, journey: null } });
    const rr = await runLookup(x.deps, SUBJECT, A("lookup_journey", { name: "Campari", kind: "spirit" }));
    assertEquals(rr.status, "not_sure");
    assertStringIncludes(rr.say, "No Journey ready for this yet.");
    assert(x.sent.every((s) => s.body.p_build === false));
  }
  const z = mk({ discover_phg_products: { data: [] } }, { [C.journey]: JOURNEY_SYNTHETIC });
  const rz = await runLookup(z.deps, SUBJECT, A("lookup_journey", { name: "Zorblax Fizz", kind: "wine" }));
  assertEquals(rz.status, "not_sure");
  assertEquals(z.sent.length, 0);
});

Deno.test("lookup_journey: caps at 6 stops", async () => {
  const stops = Array.from({ length: 9 }, (_, i) => ({ title: "S" + i, claims: [{ text: "c" }] }));
  const m = mk({}, { [C.cocktailFind]: FIND_NEGRONI, [C.journey]: { status: "ready", journey: { duration_s: 90, nodes: stops } } });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_journey", { name: "Negroni" })); // kind defaults to cocktail
  assertEquals(((r.data as Record<string, unknown>).stops as unknown[]).length, 6);
  assertEquals((r.data as Record<string, unknown>).minutes, 2); // 1.5 rounds up
});

// ---------- pairing_ideas ----------
Deno.test("pairing_ideas: synthetic ideas, exact param keys", async () => {
  const m = mk({}, { [C.cocktailFind]: FIND_NEGRONI, [C.pairing]: PAIRING_SYNTHETIC });
  const r = await runLookup(m.deps, SUBJECT, A("pairing_ideas", { name: "Negroni", kind: "cocktail" }));
  assertEquals(r.status, "found");
  assertEquals((r.data as Record<string, unknown>).ideas, PAIRING_SYNTHETIC.ideas);
  const p = m.sent.find((s) => s.fn === C.pairing)!;
  assertEquals(Object.keys(p.body).sort(), ["p_item_kind", "p_item_ref", "p_name", "p_token"]);
  assertEquals(p.body.p_item_ref, NEGRONI_ID);
});

Deno.test("pairing_ideas: failed resolution still sends null ref + name; cap 5; empty -> not_sure; missing -> unavailable", async () => {
  const many = { ideas: Array.from({ length: 8 }, (_, i) => ({ pairing: "P" + i, why: "w" })) };
  const m = mk({}, { [C.cocktailFind]: [], [C.pairing]: many });
  const r = await runLookup(m.deps, SUBJECT, A("pairing_ideas", { name: "Zorblax Fizz" }));
  assertEquals(r.status, "found");
  assertEquals(((r.data as Record<string, unknown>).ideas as unknown[]).length, 5);
  const p = m.sent.find((s) => s.fn === C.pairing)!;
  assertEquals(p.body, { p_token: "tok", p_item_kind: "cocktail", p_item_ref: null, p_name: "Zorblax Fizz" });
  const e = mk({}, { [C.cocktailFind]: [], [C.pairing]: { ideas: [] } });
  assertEquals((await runLookup(e.deps, SUBJECT, A("pairing_ideas", { name: "Zorblax Fizz" }))).status, "not_sure");
  const u = mk({}, { [C.cocktailFind]: FIND_NEGRONI }); // pairing command 404s
  assertEquals((await runLookup(u.deps, SUBJECT, A("pairing_ideas", { name: "Negroni" }))).status, "unavailable");
});

// ---------- my_saved_drinks ----------
Deno.test("my_saved_drinks: filtered by subject, de-duplicated, no ids or dates", async () => {
  const m = mk({ discover_explore_versions: { data: SAVED_VERSIONS }, bottle_sightings: { data: SAVED_SIGHTINGS } });
  const r = await runLookup(m.deps, SUBJECT, A("my_saved_drinks"));
  assertEquals(r.status, "found");
  assertEquals(r.source, "your_saved");
  const d = r.data as Record<string, unknown>;
  assertEquals(d.versions, [{ name: "Smoky Negroni", changes: ["smokier"] }, { name: "Lighter Negroni", changes: ["lower_proof", "drier"] }]);
  assertEquals(d.bottles, [{ brand: "Campari", product: "Campari" }, { brand: "Aperol", product: null }]);
  assertStringIncludes(String(d.note), "not stored on the server yet");
  const s = JSON.stringify(r);
  for (const bad of [NEGRONI_ID, "created_at", "2026-11", "p1", SUBJECT]) assertFalse(s.includes(bad), bad);
  assertEquals(m.calls[0].table, "discover_explore_versions");
  assertEquals(m.calls[0].ops, [
    ["select", ["name,base_cocktail_id,change_types,created_at"]], ["eq", ["subject_id", SUBJECT]],
    ["order", ["created_at", { ascending: false }]], ["limit", [10]],
  ]);
  assertEquals(m.calls[1].ops, [
    ["select", ["read_brand,read_product,discover_product_id,seen_at"]], ["eq", ["consumer_id", SUBJECT]],
    ["not", ["discover_product_id", "is", null]], ["order", ["seen_at", { ascending: false }]], ["limit", [10]],
  ]);
  assertEquals(m.sent.length, 0);
});

Deno.test("my_saved_drinks: nothing saved -> not_sure; db error or empty subject -> unavailable", async () => {
  const m = mk({});
  const r = await runLookup(m.deps, SUBJECT, A("my_saved_drinks"));
  assertEquals(r.status, "not_sure");
  assertEquals(r.say, "The guest has nothing saved yet.");
  const e = mk({ bottle_sightings: { error: "SECRET" } });
  assertEquals((await runLookup(e.deps, SUBJECT, A("my_saved_drinks"))).status, "unavailable");
  assertEquals((await runLookup(m.deps, "", A("my_saved_drinks"))).status, "unavailable");
});

// ---------- privacy ----------
Deno.test("privacy: every PHG body has only p_token + listed params; no person ids; zero db writes", async () => {
  const allowed: Record<string, string[]> = {
    [C.cocktailFind]: ["p_name", "p_limit"], [C.recipe]: ["p_cocktail_id"],
    [C.journey]: ["p_item_kind", "p_item_ref", "p_build"], [C.pairing]: ["p_item_kind", "p_item_ref", "p_name"],
  };
  const tables = {
    discover_phg_products: { data: [CAMPARI_PRODUCT] }, discover_phg_brand_profiles: { data: [CAMPARI_PROFILE] },
    discover_explore_versions: { data: SAVED_VERSIONS }, bottle_sightings: { data: SAVED_SIGHTINGS },
  };
  const replies = { [C.cocktailFind]: FIND_NEGRONI, [C.recipe]: RECIPE_NEGRONI, [C.journey]: JOURNEY_SYNTHETIC, [C.pairing]: PAIRING_SYNTHETIC };
  const calls: Array<[string, unknown]> = [
    ["lookup_cocktail", { name: "Negroni" }], ["lookup_bottle", { name: "Campari" }], ["lookup_brand", { brand: "Campari" }],
    ["lookup_journey", { name: "Negroni", kind: "cocktail" }], ["lookup_journey", { name: "Campari", kind: "beer" }],
    ["pairing_ideas", { name: "Negroni", kind: "cocktail" }], ["pairing_ideas", { name: "Campari", kind: "wine" }],
    ["my_saved_drinks", {}],
  ];
  let total = 0;
  for (const [tool, args] of calls) {
    const m = mk(tables, replies);
    await runLookup(m.deps, SUBJECT, A(tool, args));
    assertEquals(m.writes, [], tool);
    for (const s of m.sent) {
      total++;
      assertEquals(Object.keys(s.body).sort(), [...allowed[s.fn], "p_token"].sort(), tool + " " + s.fn);
      assertFalse(JSON.stringify(s.body).includes(SUBJECT));
    }
    // the subject id appears only in .eq filters
    for (const c of m.calls) for (const [op, a] of c.ops) {
      if (JSON.stringify(a).includes(SUBJECT)) assertEquals(op, "eq");
    }
  }
  assert(total >= 8);
});

Deno.test("privacy: guard refuses person-ish keys before any fetch (unknown tool path stays unavailable)", async () => {
  const m = mk({}, { [C.cocktailFind]: FIND_NEGRONI });
  // A tool from the contract with a hacked arg object cannot add keys: args are rebuilt by the parser.
  const p = parseLookupArgs("lookup_cocktail", { name: "Negroni", subject_id: SUBJECT, p_user_id: "u" });
  assertEquals(p, { tool: "lookup_cocktail", name: "Negroni" });
  await runLookup(m.deps, SUBJECT, p!);
  assertFalse(JSON.stringify(m.sent).includes(SUBJECT));
  // an unknown tool at runtime never touches fetch or db
  const u = await runLookup(m.deps, SUBJECT, { tool: "drop_table" } as unknown as LookupArgs);
  assertEquals(u.status, "unavailable");
});

Deno.test("loadPhgConfig reads three keys with select only", async () => {
  const d = fakeDb({ discover_bridge_config: { data: [
    { key: "phg_url", value: "https://x.example/" }, { key: "phg_anon_key", value: "a" }, { key: "phg_bridge_token", value: "t" },
  ] } });
  assertEquals(await loadPhgConfig(d.db), { url: "https://x.example", anonKey: "a", token: "t" });
  assertEquals(d.writes, []);
  const bad = fakeDb({ discover_bridge_config: { data: [] } });
  let threw = false;
  try { await loadPhgConfig(bad.db); } catch (e) { threw = (e as Error).message === "phg_unavailable"; }
  assert(threw);
});

// ---------- arg parsing ----------
Deno.test("parseLookupArgs: JSON string, objects, trimming, control chars, cap", () => {
  assertEquals(parseLookupArgs("lookup_cocktail", '{"name":"  Negroni  "}'), { tool: "lookup_cocktail", name: "Negroni" });
  assertEquals(parseLookupArgs("lookup_cocktail", { name: "Neg\u0000ro\u0007ni\n" }), { tool: "lookup_cocktail", name: "Neg ro ni" });
  const long = parseLookupArgs("lookup_cocktail", { name: "a".repeat(500) }) as { name: string };
  assertEquals(long.name.length, 120);
  assertEquals(parseLookupArgs("lookup_bottle", { name: "Campari", brand: "  " }), { tool: "lookup_bottle", name: "Campari", brand: null });
  assertEquals(parseLookupArgs("lookup_bottle", { name: "Campari", brand: "Campari", extra: 1 }), { tool: "lookup_bottle", name: "Campari", brand: "Campari" });
  assertEquals(parseLookupArgs("lookup_brand", '{"brand":"Campari"}'), { tool: "lookup_brand", brand: "Campari" });
  assertEquals(parseLookupArgs("lookup_journey", { name: "Negroni" }), { tool: "lookup_journey", name: "Negroni", kind: "cocktail" });
  assertEquals(parseLookupArgs("pairing_ideas", { name: "Pinot", kind: "wine" }), { tool: "pairing_ideas", name: "Pinot", kind: "wine" });
  assertEquals(parseLookupArgs("my_saved_drinks", ""), { tool: "my_saved_drinks" });
  assertEquals(parseLookupArgs("my_saved_drinks", undefined), { tool: "my_saved_drinks" });
  assertEquals(parseLookupArgs("my_saved_drinks", { junk: true }), { tool: "my_saved_drinks" });
});

Deno.test("parseLookupArgs: rejects bad input", () => {
  assertEquals(parseLookupArgs("nope", { name: "x" }), null);
  assertEquals(parseLookupArgs(undefined, {}), null);
  assertEquals(parseLookupArgs("lookup_cocktail", "{not json"), null);
  assertEquals(parseLookupArgs("lookup_cocktail", "[]"), null);
  assertEquals(parseLookupArgs("lookup_cocktail", {}), null);
  assertEquals(parseLookupArgs("lookup_cocktail", { name: "   " }), null);
  assertEquals(parseLookupArgs("lookup_cocktail", { name: 42 }), null);
  assertEquals(parseLookupArgs("lookup_cocktail", { name: "\u0001\u0002" }), null);
  assertEquals(parseLookupArgs("lookup_brand", { name: "Campari" }), null);
  assertEquals(parseLookupArgs("lookup_journey", { name: "x", kind: "soda" }), null);
  assertEquals(parseLookupArgs("pairing_ideas", { name: "x", kind: 5 }), null);
  assertEquals(parseLookupArgs("lookup_cocktail", null), null);
});

// ---------- size cap ----------
Deno.test("result size cap: oversized data is trimmed to MAX_RESULT_CHARS", async () => {
  const lines = Array.from({ length: 30 }, (_, i) => ({ ingredient: "ingredient " + i + "x".repeat(100), amount: "1 oz " + "y".repeat(100) }));
  const recipe = { recipe: { name: "Big", lines, method: "m".repeat(5000), glass: "g".repeat(500), garnish: "n".repeat(500), est_abv: 10 } };
  const m = mk({}, { [C.cocktailFind]: FIND_NEGRONI, [C.recipe]: recipe });
  const r = await runLookup(m.deps, SUBJECT, A("lookup_cocktail", { name: "Big" }));
  assertEquals(r.status, "found");
  assert(JSON.stringify(r).length <= MAX_RESULT_CHARS, "len " + JSON.stringify(r).length);
  const hist = Array.from({ length: 50 }, () => "h".repeat(3000));
  const b = mk({ discover_phg_products: { data: [CAMPARI_PRODUCT] }, discover_phg_brand_profiles: { data: [{ ...CAMPARI_PROFILE, history: hist, ten_second: "t".repeat(9000) }] } });
  const rb = await runLookup(b.deps, SUBJECT, A("lookup_bottle", { name: "Campari" }));
  assert(JSON.stringify(rb).length <= MAX_RESULT_CHARS);
  assertEquals(rb.status, "found");
});
