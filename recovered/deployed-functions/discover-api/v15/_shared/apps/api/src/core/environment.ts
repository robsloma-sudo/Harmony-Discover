// Fail-closed environment guard (handoff §10.6). Runs before any Supabase client exists.
// The service starts only when it is explicitly a Discover non-production environment AND the
// Supabase URL resolves to an allow-listed Discover project ref (or a local Supabase stack).
export const PROHIBITED_PROJECT_REFS = ['lqjtwabzmgjcufftuqvu'] as const; // Harmony production: read-only, never a Discover target

export type DiscoverEnvironment = { env: 'local' | 'development'; supabaseUrl: string; projectRef: string | null };

export class EnvironmentGuardError extends Error {}

export function assertDiscoverEnvironment(vars: Record<string, string | undefined>): DiscoverEnvironment {
  const fail = (m: string): never => { throw new EnvironmentGuardError(`Discover environment guard: ${m}`); };
  // 1. No variable may mention a prohibited project, whatever its name.
  for (const [k, v] of Object.entries(vars)) {
    if (v && PROHIBITED_PROJECT_REFS.some(ref => v.includes(ref))) fail(`${k} references the Harmony production project`);
  }
  // 2. The environment must be declared explicitly; anything else (including "production") is refused.
  const env = vars.DISCOVER_ENV;
  if (env !== 'local' && env !== 'development') return fail(`DISCOVER_ENV must be "local" or "development" (got ${env ? JSON.stringify(env) : 'nothing'})`);
  const raw = vars.SUPABASE_URL ?? fail('SUPABASE_URL is missing');
  let url: URL;
  try { url = new URL(raw); } catch { return fail('SUPABASE_URL is not a valid URL'); }
  if (env === 'local') {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return fail('DISCOVER_ENV=local only allows a local Supabase stack');
    return { env, supabaseUrl: url.origin, projectRef: null };
  }
  // 3. development: hosted project must be on the explicit allow-list, matched exactly by hostname.
  const allow = (vars.DISCOVER_ALLOWED_PROJECT_REFS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allow.length) fail('DISCOVER_ALLOWED_PROJECT_REFS is empty');
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (url.protocol !== 'https:' || !m) return fail('SUPABASE_URL must be https://<project-ref>.supabase.co');
  const ref = m[1];
  if (!allow.includes(ref)) fail(`project ${ref} is not in DISCOVER_ALLOWED_PROJECT_REFS`);
  return { env, supabaseUrl: url.origin, projectRef: ref };
}
