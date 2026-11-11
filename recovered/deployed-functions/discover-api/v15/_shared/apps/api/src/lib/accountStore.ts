import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountStore } from '../core/account.ts';

// Supabase-backed store: export and deletion run in the 0007 database functions.
export function supabaseAccountStore(db: SupabaseClient): AccountStore {
  const call = async <T>(fn: string, args: Record<string, unknown>, err: string): Promise<T> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(err);
    return data as T;
  };
  return {
    exportSubject: s => call('discover_export_subject', { p_subject: s }, 'export_failed'),
    storagePaths: async s => (await call<string[] | null>('discover_subject_storage_paths', { p_subject: s }, 'storage_paths_failed')) ?? [],
    startDeletion: s => call<string>('discover_start_deletion', { p_subject: s }, 'deletion_start_failed'),
    updateDeletion: async (id, status, d = {}) => {
      await call('discover_update_deletion', { p_request: id, p_status: status, p_storage_removed: d.storageRemoved ?? null,
        p_rows: d.rows ?? null, p_error: d.error ?? null }, 'deletion_update_failed');
    },
    deleteSubjectData: s => call<Record<string, number>>('discover_delete_subject_data', { p_subject: s }, 'deletion_data_failed'),
  };
}
