// GENERATED from apps/api/src/retention.ts by scripts/build-edge.mjs. Do not edit; deploy to the Discover DEV project only.
// Menu photo retention sweep (owner rule, 9 Nov 2026; SQL rule in migration 0005).
// Order matters: storage objects are removed first, the row is marked deleted second. If removal fails the row stays
// due and the next sweep retries; a photo is never marked deleted while its file may still exist.
export interface DuePhoto { asset_id: string; object_path: string; derived_paths: string[]; reason: 'superseded' | 'cap_reached' }
export interface RetentionDeps {
  listDue(capDays: number, limit: number): Promise<DuePhoto[]>;
  removeObjects(paths: string[]): Promise<void>;      // must succeed for already-missing objects
  markDeleted(assetId: string, reason: DuePhoto['reason']): Promise<void>;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
}
export interface SweepResult { examined: number; deleted: number; failed: number }

export async function retentionSweep(deps: RetentionDeps, capDays: number, limit = 200): Promise<SweepResult> {
  if (!Number.isInteger(capDays) || capDays < 1) throw new Error('retention cap must be a positive whole number of days');
  const due = await deps.listDue(capDays, limit);
  let deleted = 0, failed = 0;
  for (const p of due) {
    try {
      await deps.removeObjects([p.object_path, ...p.derived_paths]);
      await deps.markDeleted(p.asset_id, p.reason);
      deleted++;
    } catch (error) {
      failed++;
      deps.log?.('photo retention: will retry next sweep', { asset_id: p.asset_id, error: String(error) });
    }
  }
  return { examined: due.length, deleted, failed };
}
