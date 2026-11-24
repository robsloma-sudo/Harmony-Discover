import { assertEquals } from "jsr:@std/assert@1";
import type { ItemKind, JourneyResult } from "./contract.ts";
import { type JourneyDeps, runJourney } from "./journey.ts";

const J = { name: "Negroni" };
type Phg = (build: boolean) => JourneyResult | Promise<JourneyResult>;
const NONE: JourneyResult = { status: "none", built_now: false, journey: null };
const BUILDING: JourneyResult = { status: "building", built_now: false, journey: null };
// Default PHG: nothing saved yet (look-only says none); a build call starts a build that keeps running.
const defaultPhg: Phg = (build) => (build ? BUILDING : NONE);

function world(opts: { phg?: Phg; refuse?: { status: number; body: Record<string, unknown> } | null } = {}) {
  const markers = new Set<string>();
  const cache = new Map<string, Record<string, unknown>>();
  const c = { reserve: 0, refund: 0, build: 0, fetch: 0, record: 0, release: 0, put: 0 };
  let phg: Phg = opts.phg ?? defaultPhg;
  const k = (kind: string, ref: string) => `${kind}:${ref}`;
  const deps = (refuse: { status: number; body: Record<string, unknown> } | null = opts.refuse ?? null): JourneyDeps => ({
    cacheGet: (kind, ref) => Promise.resolve(cache.get(k(kind, ref)) ?? null),
    cachePut: (kind, ref, _s, j) => { c.put++; cache.set(k(kind, ref), j); return Promise.resolve(); },
    buildRunning: (kind, ref) => Promise.resolve(markers.has(k(kind, ref))),
    claim: (kind, ref) => { if (markers.has(k(kind, ref))) return Promise.resolve(false); markers.add(k(kind, ref)); return Promise.resolve(true); },
    release: (kind, ref) => { c.release++; markers.delete(k(kind, ref)); return Promise.resolve(); },
    reserve: () => { c.reserve++; return Promise.resolve(refuse); },
    refund: () => { c.refund++; return Promise.resolve(); },
    phgFetch: async (_kind: ItemKind, _ref, build) => { if (build) c.build++; else c.fetch++; return await phg(build); },
    record: () => { c.record++; return Promise.resolve(); },
  });
  // builds actually spent = reservations not given back
  const spent = () => c.reserve - c.refund;
  return { markers, cache, c, deps, spent, setPhg: (f: Phg) => { phg = f; } };
}
const a = { kind: "cocktail" as ItemKind, ref: "negroni", peek: false };

Deno.test("a: one tap + 10 polls while PHG builds -> 1 build spent, 1 build call", async () => {
  const w = world();
  const first = await runJourney(w.deps(), a);
  assertEquals(first.body.status, "building");
  for (let i = 0; i < 10; i++) {
    const r = await runJourney(w.deps(), a);
    assertEquals(r.status, 200);
    assertEquals(r.body.status, "building");
  }
  assertEquals(w.c.reserve, 1);
  assertEquals(w.spent(), 1);
  assertEquals(w.c.build, 1);
  assertEquals(w.c.fetch, 11); // 1 free look before the build + 10 polls
  assertEquals(w.markers.size, 1); // marker kept while building
  assertEquals(w.c.record, 0);
});

Deno.test("b: PHG turns ready -> poll returns ready, caches, releases marker", async () => {
  const w = world();
  await runJourney(w.deps(), a);
  w.setPhg(() => ({ status: "ready", built_now: false, journey: J }));
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "ready");
  assertEquals(r.body.journey, J);
  assertEquals(w.cache.get("cocktail:negroni"), J);
  assertEquals(w.markers.size, 0);
  assertEquals(w.spent(), 1);
  assertEquals(w.c.build, 1);
  const fetches = w.c.fetch;
  const again = await runJourney(w.deps(), a);
  assertEquals(again.body.from_cache, true);
  assertEquals(w.c.fetch, fetches); // pure cache hit
});

Deno.test("b2: build finishes in the same call -> built, cached, released, opened once, 1 build spent", async () => {
  const w = world({ phg: (build) => (build ? { status: "built", built_now: true, journey: J } : NONE) });
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "built");
  assertEquals(r.body.built_now, true);
  assertEquals(w.markers.size, 0);
  assertEquals(w.c.record, 1);
  assertEquals(w.spent(), 1);
});

Deno.test("c: peek never reserves, builds, records or claims", async () => {
  const w = world();
  const p = { ...a, peek: true };
  w.setPhg(() => NONE);
  assertEquals((await runJourney(w.deps(), p)).body, { ok: true, peek: true, status: "none", from_cache: false, journey: null });
  w.setPhg(() => BUILDING);
  assertEquals((await runJourney(w.deps(), p)).body.status, "building");
  w.setPhg(() => ({ status: "built", built_now: false, journey: J }));
  const r = await runJourney(w.deps(), p);
  assertEquals(r.body.status, "ready");
  assertEquals(r.body.peek, true);
  assertEquals(w.cache.get("cocktail:negroni"), J);
  assertEquals((await runJourney(w.deps(), p)).body.from_cache, true);
  const w2 = world();
  w2.markers.add("cocktail:negroni");
  const b = await runJourney(w2.deps(), p);
  assertEquals(b.body.status, "building");
  assertEquals(w2.c.fetch, 0);
  for (const x of [w, w2]) { assertEquals(x.c.reserve, 0); assertEquals(x.c.build, 0); assertEquals(x.c.record, 0); }
  assertEquals(w.markers.size, 0);
});

Deno.test("d: guest with 0 builds left sees building (not limit) while another guest's build runs", async () => {
  const refuse = { status: 429, body: { error: "daily_limit_reached" } };
  const w = world();
  await runJourney(w.deps(null), a);
  const b = await runJourney(w.deps(refuse), a);
  assertEquals(b.body.status, "building");
  assertEquals(w.c.reserve, 1); // B never reserved
  assertEquals(w.c.build, 1);
});

Deno.test("d2: no build running + 0 builds left + PHG none -> limit; marker released; other refusals pass through", async () => {
  const refuse = { status: 429, body: { error: "daily_limit_reached" } };
  const w = world({ phg: () => NONE });
  const r = await runJourney(w.deps(refuse), { ...a, limitMessage: "m" });
  assertEquals(r.body.status, "limit");
  assertEquals(r.body.message, "m");
  assertEquals(w.markers.size, 0);
  assertEquals(w.c.build, 0);
  const r2 = await runJourney(w.deps({ status: 503, body: { error: "daily_limit_unavailable" } }), a);
  assertEquals(r2.status, 503);
  assertEquals(w.markers.size, 0);
});

Deno.test("e: build call throws -> marker released, build given back", async () => {
  const w = world({ phg: (build) => { if (build) throw new Error("phg_unavailable"); return NONE; } });
  let msg = "";
  try { await runJourney(w.deps(), a); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "phg_unavailable");
  assertEquals(w.markers.size, 0);
  assertEquals(w.c.release, 1);
  assertEquals(w.c.reserve, 1);
  assertEquals(w.c.refund, 1);
  assertEquals(w.spent(), 0);
});

Deno.test("g: build answers none (nothing to build / no builder) -> none, marker released, build given back", async () => {
  const w = world({ phg: () => NONE });
  for (let i = 0; i < 6; i++) assertEquals((await runJourney(w.deps(), a)).body.status, "none");
  assertEquals(w.markers.size, 0);
  assertEquals(w.spent(), 0); // 6 taps on an item with no Journey cost nothing
});

Deno.test("h: no Journey builder live on PHG (command missing) -> error before any reservation", async () => {
  const w = world({ phg: () => { throw new Error("phg_unavailable"); } });
  for (let i = 0; i < 3; i++) {
    let msg = "";
    try { await runJourney(w.deps(), a); } catch (e) { msg = (e as Error).message; }
    assertEquals(msg, "phg_unavailable");
  }
  assertEquals(w.c.reserve, 0);
  assertEquals(w.c.build, 0);
  assertEquals(w.markers.size, 0);
});

Deno.test("i: PHG already has the Journey -> ready from the free look, nothing reserved or built", async () => {
  const w = world({ phg: () => ({ status: "ready", built_now: false, journey: J }) });
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "ready");
  assertEquals(w.c.reserve, 0);
  assertEquals(w.c.build, 0);
  assertEquals(w.markers.size, 0);
  assertEquals(w.c.record, 1);
});

Deno.test("i2: build call answers ready without building (saved meanwhile) -> build given back", async () => {
  const w = world({ phg: (build) => (build ? { status: "ready", built_now: false, journey: J } : NONE) });
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "ready");
  assertEquals(r.body.built_now, false);
  assertEquals(w.spent(), 0);
});

Deno.test("i3: build already running on PHG (look says building) -> building, nothing reserved", async () => {
  const w = world({ phg: () => BUILDING });
  assertEquals((await runJourney(w.deps(), a)).body.status, "building");
  assertEquals(w.c.reserve, 0);
  assertEquals(w.c.build, 0);
});

Deno.test("f: build call times out -> building, marker and reservation kept, next polls do not reserve again", async () => {
  const w = world({ phg: (build) => { if (build) throw new Error("phg_timeout"); return NONE; } });
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "building");
  assertEquals(w.markers.size, 1);
  w.setPhg(() => BUILDING);
  for (let i = 0; i < 5; i++) assertEquals((await runJourney(w.deps(), a)).body.status, "building");
  assertEquals(w.c.reserve, 1);
  assertEquals(w.c.refund, 0);
  assertEquals(w.c.build, 1);
});
