import type { SupabaseClient } from '@supabase/supabase-js';
import type { SubjectLimiter } from './http.ts';

// Shared per-subject limit kept in the database (migration 0009), so it holds across stateless Edge Function
// instances. If the limiter itself is unavailable the request is refused (fail closed).
export function dbLimiter(db: SupabaseClient, bucket: string, max: number, windowSeconds: number): SubjectLimiter {
  return {
    async allow(subjectId) {
      const { data, error } = await db.rpc('discover_rate_limit', { p_subject: subjectId, p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
      return !error && data === true;
    },
  };
}
