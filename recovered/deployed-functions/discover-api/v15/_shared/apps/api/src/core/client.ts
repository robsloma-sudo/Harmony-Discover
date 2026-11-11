import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertDiscoverEnvironment } from './environment.ts';

// Fail closed before a client exists. `env` is process.env (Node) or Deno.env.toObject() (Edge Functions).
export function createDiscoverClient(env: Record<string, string | undefined>): SupabaseClient {
  const environment = assertDiscoverEnvironment(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Missing development Supabase server configuration');
  return createClient(environment.supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
