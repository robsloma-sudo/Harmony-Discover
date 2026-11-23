import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { menuLinesFromItems, phgLinkLines, phgSendCounts, TIMEOUTS_MS } from "./phg.ts";
import type { PhgConfig } from "./contract.ts";

const cfg: PhgConfig = { url: "https://phg.example", anonKey: "anon", token: "tok" };
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, observation_id: "OBS-SECRET", consumer_id: "CONS-SECRET", page_index: 0, position: 0, section: null, name,
  description: null, price_text: "12", beverage_category: null, listed_ingredients: [], evidence_state: "x", text_verified: true, ...extra,
});

async function withFetch(stub: typeof fetch, fn: () => Promise<void>) {
  const orig = globalThis.fetch; globalThis.fetch = stub;
  try { await fn(); } finally { globalThis.fetch = orig; }
}

Deno.test("drink lines kept, food dropped, ids never copied", () => {
  const out = menuLinesFromItems([
    row("1", "Old Fashioned", { section: "Cocktails" }),
    row("2", "Cheeseburger", { section: "Mains" }),
    row("3", "Pinot Noir", { beverage_category: "wine" }),
    row("4", "Fries", { beverage_category: "food" }),
    row("5", "Margarita"),
  ]);
  assertEquals(out.map((l) => l.line_id), ["1", "3", "5"]);
  const s = JSON.stringify(out);
  assert(!s.includes("CONS-SECRET") && !s.includes("OBS-SECRET"));
});

Deno.test("caps at 200 lines", () => {
  const rows = Array.from({ length: 300 }, (_, i) => row("x" + i, "Beer " + i, { beverage_category: "beer" }));
  assertEquals(menuLinesFromItems(rows).length, 200);
});

Deno.test("bad line becomes not_linked, others link; no ids in body", async () => {
  const lines = menuLinesFromItems([row("a", "Negroni", { section: "Cocktails" }), row("b", "Mystery", { beverage_category: "cocktail" }), row("c", "Lager", { beverage_category: "beer" })]);
  const bodies: string[] = [];
  await withFetch((_u, init) => {
    bodies.push(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify([
      { line_id: "a", status: "linked", kind: "cocktail", cocktail: { id: "c1", name: "Negroni" }, items: [{ kind: "spirit", name: "Gin", phg_product_id: "p1", role: "base" }], confidence: 0.9 },
      { line_id: "b", status: "linked", items: "garbage", kind: 5 },
    ]), { status: 200 }));
  }, async () => {
    const r = await phgLinkLines(cfg, lines, { name: "Bar" });
    assertEquals(r.map((x) => x.status), ["linked", "not_linked", "not_linked"]);
    assertEquals(r[1].kind, "cocktail");
    assertEquals(r[2].kind, "beer");
    assertEquals(r[0].cocktail?.id, "c1");
  });
  assert(!bodies.join().includes("consumer_id") && !bodies.join().includes("observation_id"));
});

Deno.test("batches at 50", async () => {
  const lines = menuLinesFromItems(Array.from({ length: 120 }, (_, i) => row("l" + i, "Gin " + i, { beverage_category: "spirits" })));
  const sizes: number[] = [];
  await withFetch((_u, init) => {
    sizes.push(JSON.parse(String(init?.body)).p_lines.length);
    return Promise.resolve(new Response("[]", { status: 200 }));
  }, async () => {
    const r = await phgLinkLines(cfg, lines);
    assertEquals(r.length, 120);
  });
  assertEquals(sizes, [50, 50, 20]);
});

Deno.test("timeout -> phg_timeout", async () => {
  const old = TIMEOUTS_MS.link; TIMEOUTS_MS.link = 30;
  try {
    await withFetch((_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }), async () => {
      const e = await assertRejects(() => phgLinkLines(cfg, menuLinesFromItems([row("a", "Gin", { beverage_category: "spirits" })])));
      assertEquals((e as Error).message, "phg_timeout");
    });
  } finally { TIMEOUTS_MS.link = old; }
});

Deno.test("http error -> phg_unavailable without body", async () => {
  await withFetch(() => Promise.resolve(new Response("secret detail", { status: 500 })), async () => {
    const e = await assertRejects(() => phgLinkLines(cfg, menuLinesFromItems([row("a", "Gin", { beverage_category: "spirits" })])));
    assertEquals((e as Error).message, "phg_unavailable");
  });
});

Deno.test("counts with extra key refused before fetch", async () => {
  let called = 0;
  await withFetch(() => { called++; return Promise.resolve(new Response("{}")); }, async () => {
    const good = { venue_id: null, week_start: "2026-11-23", item_kind: "cocktail", item_ref: "c1", event: "tap", change_type: null, count: 5, guests: 5 };
    const e = await assertRejects(() => phgSendCounts(cfg, [good as never, { ...good, consumer_id: "u" } as never]));
    assertEquals((e as Error).message, "counts_contain_ids");
    assertEquals(called, 0);
    const ok = await (async () => { const r = await withOk(good); return r; })();
    assertEquals(ok.accepted, 1);
  });
});
async function withOk(good: Record<string, unknown>) {
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ accepted: 1 })));
  return await phgSendCounts(cfg, [good as never]);
}
