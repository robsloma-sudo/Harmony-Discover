import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError, type Identify } from './http.ts';

// The subject comes only from a token Supabase Auth verifies. Uploads and learning need sign-in (Rob, 9 Nov 2026);
// the first scan works on the device without an account.
export function makeIdentify(db: SupabaseClient): Identify {
  return async header => {
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required for this endpoint');
    const { data, error } = await db.auth.getUser(header.slice(7));
    if (error || !data.user) throw new HttpError(401, 'Invalid access token');
    return data.user.id;
  };
}
