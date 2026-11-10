import type { SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import { listObservationContributions } from "../src/core/observations.ts";

const SUBJECT_ID = "22222222-2222-4222-8222-222222222222";

Deno.test("contribution list is scoped to the signed-in subject and maps venue details", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rows = [{
    id: "33333333-3333-4333-8333-333333333333",
    observation_id: "11111111-1111-4111-8111-111111111111",
    policy_version: "discover-harmony-contribution-v1",
    granted_at: "2026-11-10T20:00:00.000Z",
    menu_observations: {
      venue_name_submitted: "Confirmed Tavern",
      venue_name_read: "Tavern",
      captured_at: "2026-11-10T19:00:00.000Z",
      status: "ready_for_review",
    },
  }];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  const db = { from: (table: string) => {
    calls.push({ method: "from", args: [table] });
    return builder;
  }} as unknown as SupabaseClient;

  const result = await listObservationContributions(db, SUBJECT_ID);
  if (result.status !== 200) throw new Error("Expected contribution list success");
  const body = result.body as { contributions: Array<Record<string, unknown>> };
  const item = body.contributions[0];
  if (body.contributions.length !== 1 ||
      item?.grantId !== rows[0].id ||
      item?.observationId !== rows[0].observation_id ||
      item?.venueName !== "Confirmed Tavern" ||
      item?.status !== "ready_for_review") {
    throw new Error("Contribution row was not mapped to the expected public response");
  }
  if (!calls.some(call => call.method === "eq" && call.args[0] === "consumer_id" && call.args[1] === SUBJECT_ID) ||
      !calls.some(call => call.method === "is" && call.args[0] === "withdrawn_at" && call.args[1] === null) ||
      !calls.some(call => call.method === "limit" && call.args[0] === 100)) {
    throw new Error("Contribution list is missing subject, active-grant, or result-limit constraints");
  }
});
