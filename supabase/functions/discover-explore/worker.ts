// Worker gate + dry-run summary for the weekly push_counts job (P-20261123-0711 part 3b). Pure, no network.
// The worker password lives ONLY in the Discover dev vault ('discover_explore_worker_secret'); nobody types or sees it.
// The program asks the database (discover_check_explore_worker_secret, server role only) whether the given value matches.
import type { CountRow } from "./contract.ts";

export const WORKER_HEADER = "x-worker-secret";
export const WORKER_CHECK_RPC = "discover_check_explore_worker_secret";
export const MIN_WORKER_SECRET_LENGTH = 32;

export type CheckRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

// true only when the database says the value matches. Any error, odd reply or short value = refused (fails closed).
export async function workerAllowed(given: string | null | undefined, rpc: CheckRpc): Promise<boolean> {
  const g = typeof given === "string" ? given : "";
  if (g.length < MIN_WORKER_SECRET_LENGTH || g.length > 512) return false;
  try {
    const { data, error } = await rpc(WORKER_CHECK_RPC, { p_given: g });
    return !error && data === true;
  } catch {
    return false;
  }
}

// What a dry run reports: sizes and checks only, never the rows themselves.
export function dryRunSummary(weeks: string[], rows: CountRow[], minGuests: number) {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  return {
    ok: true,
    dry_run: true,
    weeks: weeks.length,
    rows_would_send: rows.length,
    min_guests_rule: minGuests,
    smallest_group: rows.length ? Math.min(...rows.map((r) => r.guests)) : null,
    all_groups_at_least_min: rows.every((r) => r.guests >= minGuests),
    row_keys: [...keys].sort(),
  };
}
