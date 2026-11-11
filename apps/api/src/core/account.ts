import { z } from 'zod';
import { ok, type Identify, type Result, type SubjectLimiter } from './http.ts';

// Phase 2 (handoff §10.8): a signed-in user can download everything Discover holds about them, and delete it all.
// Deletion order: receipt → storage objects → database rows → auth user → receipt closed. Every step is idempotent,
// so a failure leaves the receipt 'failed' and the user (or support) simply repeats the request.

export interface AccountStore {
  exportSubject(subjectId: string): Promise<unknown>;
  storagePaths(subjectId: string): Promise<string[]>;
  startDeletion(subjectId: string): Promise<string>;
  updateDeletion(requestId: string, status: 'storage_removed' | 'data_deleted' | 'completed' | 'failed',
                 detail?: { storageRemoved?: number; rows?: Record<string, number>; error?: string }): Promise<void>;
  deleteSubjectData(subjectId: string): Promise<Record<string, number>>;
}
export interface AccountDeps {
  identify: Identify;
  store: AccountStore;
  removeObjects: (paths: string[]) => Promise<void>;     // must succeed for already-missing objects
  deleteAuthUser: (subjectId: string) => Promise<void>;  // must succeed for an already-deleted user
  limiter: SubjectLimiter;
}
export const DELETE_CONFIRMATION = 'delete my Discover data';
const deleteSchema = z.object({ confirm: z.literal(DELETE_CONFIRMATION) }).strict();

export async function deleteAccount(deps: AccountDeps, subjectId: string) {
  const requestId = await deps.store.startDeletion(subjectId);
  try {
    const paths = await deps.store.storagePaths(subjectId);
    if (paths.length) await deps.removeObjects(paths);
    await deps.store.updateDeletion(requestId, 'storage_removed', { storageRemoved: paths.length });
    const rows = await deps.store.deleteSubjectData(subjectId);
    await deps.store.updateDeletion(requestId, 'data_deleted', { rows });
    await deps.deleteAuthUser(subjectId);
    await deps.store.updateDeletion(requestId, 'completed');
    return { requestId, storageRemoved: paths.length, rows };
  } catch (error) {
    await deps.store.updateDeletion(requestId, 'failed', { error: String((error as Error).message ?? error).slice(0, 200) }).catch(() => {});
    throw Object.assign(new Error('account_deletion_incomplete'), { requestId });
  }
}

export async function exportData(deps: AccountDeps, subjectId: string, log?: (m: string, e: unknown) => void): Promise<Result> {
  try {
    return ok(await deps.store.exportSubject(subjectId), 200, { 'content-disposition': 'attachment; filename="harmony-discover-export.json"' });
  } catch (error) {
    log?.('export failed', error);
    return ok({ error: 'export_failed' }, 500);
  }
}

export async function requestDeletion(deps: AccountDeps, subjectId: string, body: unknown, log?: (m: string, e: unknown) => void): Promise<Result> {
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return ok({ error: 'confirmation_required', confirm: DELETE_CONFIRMATION }, 400);
  try {
    const r = await deleteAccount(deps, subjectId);
    return ok({ status: 'deleted', requestId: r.requestId, photosRemoved: r.storageRemoved, rowsDeleted: r.rows });
  } catch (error) {
    log?.('account deletion incomplete', error);
    return ok({ error: 'account_deletion_incomplete', requestId: (error as { requestId?: string }).requestId, retry: true }, 500);
  }
}
