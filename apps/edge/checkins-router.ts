// HTTP routing for the discover-checkins Edge Function (Discover DEV only). Kept separate from discover-api so check-ins
// can ship without redeploying the larger API bundle.
//   POST   /v1/checkins            confirm a check-in (device fix used only to verify distance, never stored)
//   DELETE /v1/checkins/:id        undo a check-in (its scans leave the public feed)
//   GET    /v1/venues/feed?ref=…   public crowd feed for one Harmony Atlas venue
import { HttpError, type Identify } from '../api/src/core/http.ts';
import { recordCheckin, venueFeed, withdrawCheckin, type CheckinDeps } from '../api/src/core/checkins.ts';

export interface CheckinsEdgeDeps {
  identify: Identify;
  checkins: CheckinDeps;
  allowedOrigins: Set<string>;
  log?: (message: string, error: unknown) => void;
}

export function checkinsPath(url: string): string {
  const pathname = new URL(url).pathname;
  const marker = pathname.indexOf('/discover-checkins');
  const rest = marker >= 0 ? pathname.slice(marker + '/discover-checkins'.length) : pathname;
  return (rest || '/').replace(/\/+$/, '') || '/';
}

export async function handleCheckins(req: Request, deps: CheckinsEdgeDeps): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private',
    'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-max-age': '600', vary: 'Origin',
  });
  if (origin && !deps.allowedOrigins.has(origin)) return new Response(JSON.stringify({ error: 'origin_not_allowed' }), { status: 403, headers });
  if (origin) headers.set('access-control-allow-origin', origin);
  const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const path = checkinsPath(req.url);
  try {
    if (path === '/health' && req.method === 'GET') return send(200, { ok: true, service: 'discover-checkins' });
    const isFeed = path === '/v1/venues/feed';
    const isCheckin = path === '/v1/checkins' || path.startsWith('/v1/checkins/');
    if (!isFeed && !isCheckin) return send(404, { error: 'not_found' });
    const subject = await deps.identify(req.headers.get('authorization') ?? undefined);
    if (!(await deps.checkins.limiter.allow(subject))) return send(429, { error: 'rate_limited' });

    if (isFeed && req.method === 'GET') {
      const url = new URL(req.url);
      const r = await venueFeed(deps.checkins.db, url.searchParams.get('ref'), url.searchParams.get('days'), deps.log);
      return send(r.status, r.body);
    }
    if (path === '/v1/checkins' && req.method === 'POST') {
      const declared = Number(req.headers.get('content-length') ?? '0');
      const text = await req.text();
      if (declared > 2048 || new TextEncoder().encode(text).byteLength > 2048) return send(413, { error: 'payload_too_large' });
      let body: unknown;
      try { body = text ? JSON.parse(text) : undefined; } catch { return send(400, { error: 'invalid_json' }); }
      const r = await recordCheckin(deps.checkins, subject, body, deps.log);
      return send(r.status, r.body);
    }
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 3 && parts[1] === 'checkins' && req.method === 'DELETE') {
      const r = await withdrawCheckin(deps.checkins.db, subject, parts[2], deps.log);
      return send(r.status, r.body);
    }
    return send(405, { error: 'method_not_allowed' });
  } catch (error) {
    if (error instanceof HttpError) return send(error.status, { error: error.status === 401 ? 'unauthorized' : 'error' });
    deps.log?.('unhandled', error instanceof Error ? error.message : 'unknown');
    return send(500, { error: 'internal_error' });
  }
}
