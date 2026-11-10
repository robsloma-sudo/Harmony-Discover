import type { SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  getObservationContribution,
  grantObservationContribution,
  withdrawObservationContribution,
} from "../apps/api/src/core/observations.ts";

const OBSERVATION_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "22222222-2222-4222-8222-222222222222";

function ownedObservationDb(status = "ready_for_review", activeGrant: unknown = null) {
  let lookupCount = 0;
  const maybeSingle = async () => {
    lookupCount += 1;
    return lookupCount === 1
      ? { data: { id: OBSERVATION_ID, status }, error: null }
      : { data: activeGrant, error: null };
  };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.maybeSingle = maybeSingle;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    from: () => chain,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: name === "discover_grant_observation_contribution" ? "33333333-3333-4333-8333-333333333333" : true, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

Deno.test("contribution permission returns inactive for an owned observation", async () => {
  const { db } = ownedObservationDb();
  const result = await getObservationContribution(db, SUBJECT_ID, OBSERVATION_ID);
  if (result.status !== 200 || JSON.stringify(result.body) !== JSON.stringify({ granted: false, policyVersion: null, grantedAt: null })) {
    throw new Error("Expected no active contribution grant");
  }
});

Deno.test("unsupported contribution policy versions are rejected before database writes", async () => {
  const { db, calls } = ownedObservationDb();
  const result = await grantObservationContribution(db, SUBJECT_ID, OBSERVATION_ID, { policyVersion: "other" });
  if (result.status !== 400 || calls.length !== 0) throw new Error("Invalid policy version was not rejected");
});

Deno.test("grant uses the authenticated subject and exact versioned policy", async () => {
  const { db, calls } = ownedObservationDb();
  const result = await grantObservationContribution(db, SUBJECT_ID, OBSERVATION_ID, { policyVersion: "discover-harmony-contribution-v1" });
  if (result.status !== 201) throw new Error("Expected grant creation");
  if (calls[0]?.name !== "discover_grant_observation_contribution" ||
      calls[0]?.args.p_subject !== SUBJECT_ID ||
      calls[0]?.args.p_observation !== OBSERVATION_ID ||
      calls[0]?.args.p_policy_version !== "discover-harmony-contribution-v1") {
    throw new Error("Grant RPC arguments were not correctly scoped");
  }
});

Deno.test("withdraw uses the authenticated subject and observation ID", async () => {
  const { db, calls } = ownedObservationDb();
  const result = await withdrawObservationContribution(db, SUBJECT_ID, OBSERVATION_ID);
  if (result.status !== 200 || calls[0]?.name !== "discover_withdraw_observation_contribution" ||
      calls[0]?.args.p_subject !== SUBJECT_ID || calls[0]?.args.p_observation !== OBSERVATION_ID) {
    throw new Error("Withdrawal was not correctly scoped");
  }
});
