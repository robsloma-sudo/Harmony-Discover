import { assertEquals } from "jsr:@std/assert@1";
import type { ItemKind, JourneyResult } from "./contract.ts";
import { type JourneyDeps, runJourney } from "./journey.ts";

const J = { name: "Negroni" };
function world(opts: { phg?: () => JourneyResult | Promise<JourneyResult>; refuse?: { status: number; body: Record<string, unknown> } | null } = {}) {
  const markers = new Set<string>();
  const cache = new Map<string, Record<string, unknown>>();
  const c = { reserve: 0, build: 0, fetch: 0, record: 0, release: 0, put: 0 };
  let phg: () => JourneyResult | Promise<JourneyResult> = opts.phg ?? (() => ({ status: "building", built_now: false, journey: null }));
  const k = (kind: string, ref: string) => `${kind}:${ref}`;
  const deps = (refuse: { status: number; body: Record<string, unknown> } | null = opts.refuse ?? null): JourneyDeps => ({
    cacheGet: (kind, ref) => Promise.resolve(cache.get(k(kind, ref)) ?? null),
    cachePut: (kind, ref, _s, j) => { c.put++; cache.set(k(kind, ref), j); return Promise.resolve(); },
    buildRunning: (kind, ref) => Promise.resolve(markers.has(k(kind, ref))),
    claim: (kind, ref) => { if (markers.has(k(kind, ref))) return Promise.resolve(false); markers.add(k(kind, ref)); return Promise.resolve(true); },
    release: (kind, ref) => { c.release++; markers.delete(k(kind, ref)); return Promise.resolve(); },
    reserve: () => { c.reserve++; return Promise.resolve(refuse); },
    phgFetch: async (_kind: ItemKind, _ref, build) => { if (build) c.build++; else c.fetch++; return await phg(); },
    record: () => { c.record++; return Promise.resolve(); },
  });
  return { markers, cache, c, deps, setPhg: (f: typeof phg) => { phg = f; } };
}
const a = { kind: "cocktail" as ItemKind, ref: "negroni", peek: false };

Deno.test("a: one tap + 10 polls while PHG says building -> reserve once, build once", async () => {
  const w = world();
  const first = await runJourney(w.deps(), a);
  assertEquals(first.body.status, "building");
  for (let i = 0; i < 10; i++) {
    const r = await runJourney(w.deps(), a);
    assertEquals(r.status, 200);
    assertEquals(r.body.status, "building");
  }
  assertEquals(w.c.reserve, 1);
  assertEquals(w.c.build, 1);
  assertEquals(w.c.fetch, 10);
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
  assertEquals(w.c.reserve, 1);
  assertEquals(w.c.build, 1);
  // next call is a pure cache hit
  const again = await runJourney(w.deps(), a);
  assertEquals(again.body.from_cache, true);
  assertEquals(w.c.fetch, 1);
});

Deno.test("b2: build finishes in the same call -> built, cached, released, opened once", async () => {
  const w = world({ phg: () => ({ status: "built", built_now: true, journey: J }) });
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "built");
  assertEquals(r.body.built_now, true);
  assertEquals(w.markers.size, 0);
  assertEquals(w.c.record, 1);
});

Deno.test("c: peek never reserves, builds, records or claims", async () => {
  const w = world();
  const p = { ...a, peek: true };
  // miss, PHG none
  w.setPhg(() => ({ status: "none", built_now: false, journey: null }));
  assertEquals((await runJourney(w.deps(), p)).body, { ok: true, peek: true, status: "none", from_cache: false, journey: null });
  // PHG building
  w.setPhg(() => ({ status: "building", built_now: false, journey: null }));
  assertEquals((await runJourney(w.deps(), p)).body.status, "building");
  // PHG ready -> cached
  w.setPhg(() => ({ status: "built", built_now: false, journey: J }));
  const r = await runJourney(w.deps(), p);
  assertEquals(r.body.status, "ready");
  assertEquals(r.body.peek, true);
  assertEquals(w.cache.get("cocktail:negroni"), J);
  // cache hit
  assertEquals((await runJourney(w.deps(), p)).body.from_cache, true);
  // marker present -> building without calling PHG
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
  await runJourney(w.deps(null), a); // guest A starts the build
  const b = await runJourney(w.deps(refuse), a); // guest B has no builds left
  assertEquals(b.body.status, "building");
  assertEquals(w.c.reserve, 1); // B never reserved
  assertEquals(w.c.build, 1);
});

Deno.test("d2: no build running + 0 builds left + PHG none -> limit; marker released", async () => {
  const refuse = { status: 429, body: { error: "daily_limit_reached" } };
  const w = world({ phg: () => ({ status: "none", built_now: false, journey: null }) });
  const r = await runJourney(w.deps(refuse), { ...a, limitMessage: "m" });
  assertEquals(r.body.status, "limit");
  assertEquals(w.markers.size, 0);
  assertEquals(w.c.build, 0);
  // other refusal: error passes through, marker released
  const r2 = await runJourney(w.deps({ status: 503, body: { error: "daily_limit_unavailable" } }), a);
  assertEquals(r2.status, 503);
  assertEquals(w.markers.size, 0);
});

Deno.test("e: marker released when the build call throws", async () => {
  const w = world({ phg: () => { throw new Error("phg_unavailable"); } });
  let msg = "";
  try { await runJourney(w.deps(), a); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "phg_unavailable");
  assertEquals(w.markers.size, 0);
  assertEquals(w.c.release, 1);
});

Deno.test("build returning none releases the marker", async () => {
  const w = world({ phg: () => ({ status: "none", built_now: false, journey: null }) });
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "none");
  assertEquals(w.markers.size, 0);
});

Deno.test("f: build call times out -> building, marker kept, next polls do not reserve again", async () => {
  const w = world({ phg: () => { throw new Error("phg_timeout"); } });
  const r = await runJourney(w.deps(), a);
  assertEquals(r.body.status, "building");
  assertEquals(w.markers.size, 1);
  w.setPhg(() => ({ status: "building", built_now: false, journey: null }));
  for (let i = 0; i < 5; i++) assertEquals((await runJourney(w.deps(), a)).body.status, "building");
  assertEquals(w.c.reserve, 1);
  assertEquals(w.c.build, 1);
});
