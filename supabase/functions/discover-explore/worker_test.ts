import { assertEquals } from "jsr:@std/assert@1";
import type { CountRow } from "./contract.ts";
import { dryRunSummary, WORKER_CHECK_RPC, workerAllowed } from "./worker.ts";

const VAULT = "a".repeat(64);
// Fake database: answers like discover_check_explore_worker_secret would.
const calls: string[] = [];
const db = (fn: string, args: Record<string, unknown>) => {
  calls.push(fn);
  return Promise.resolve({ data: fn === WORKER_CHECK_RPC && args.p_given === VAULT, error: null });
};

Deno.test("worker gate: accepts the vault value, refuses a wrong one", async () => {
  assertEquals(await workerAllowed(VAULT, db), true);
  assertEquals(await workerAllowed("b".repeat(64), db), false);
  assertEquals(calls.every((c) => c === WORKER_CHECK_RPC), true);
});

Deno.test("worker gate: missing, short or huge values never reach the database", async () => {
  calls.length = 0;
  assertEquals(await workerAllowed(null, db), false);
  assertEquals(await workerAllowed("", db), false);
  assertEquals(await workerAllowed("short", db), false);
  assertEquals(await workerAllowed("a".repeat(600), db), false);
  assertEquals(calls.length, 0);
});

Deno.test("worker gate: fails closed on database error, odd reply or throw", async () => {
  assertEquals(await workerAllowed(VAULT, () => Promise.resolve({ data: true, error: { message: "x" } })), false);
  assertEquals(await workerAllowed(VAULT, () => Promise.resolve({ data: "true", error: null })), false);
  assertEquals(await workerAllowed(VAULT, () => Promise.reject(new Error("down"))), false);
});

Deno.test("dry run: sizes and checks only, no rows", () => {
  const rows: CountRow[] = [
    { venue_id: null, week_start: "2026-11-16", item_kind: "cocktail", item_ref: "c1", event: "tap", change_type: null, count: 9, guests: 5 },
    { venue_id: null, week_start: "2026-11-16", item_kind: "cocktail", item_ref: "c2", event: "change", change_type: "smokier", count: 7, guests: 6 },
  ];
  const s = dryRunSummary(["2026-11-16"], rows, 5);
  assertEquals(s.rows_would_send, 2);
  assertEquals(s.smallest_group, 5);
  assertEquals(s.all_groups_at_least_min, true);
  assertEquals(s.row_keys, ["change_type", "count", "event", "guests", "item_kind", "item_ref", "venue_id", "week_start"]);
  assertEquals("rows" in s, false);
  assertEquals(dryRunSummary([], [], 5).smallest_group, null);
});
