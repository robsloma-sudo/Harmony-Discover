import { HttpError, type Identify, type Result, type SubjectLimiter } from '../api/src/core/http.ts';
import { getConsent, putConsent, postEvent, LEARNING_BODY_LIMIT, type LearningStore } from '../api/src/core/learning.ts';
import { exportData, requestDeletion, type AccountStore } from '../api/src/core/account.ts';
import {
  addAsset, completeObservation, createObservation, getObservation, correctObservationItem,
  discardIncompleteObservation, getObservationContribution, grantObservationContribution,
  withdrawObservationContribution, confirmObservationVenue, listObservationContributions, MAX_UPLOAD_BYTES,
} from '../api/src/core/observations.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EdgeDeps {
  identify: Identify;
  learning: { store: LearningStore; limiter: SubjectLimiter };
  account: {
    store: AccountStore;
    removeObjects(paths: string[]): Promise<void>;
    deleteAuthUser(id: string): Promise<void>;
    limiter: SubjectLimiter;
  };
  observations: { db: SupabaseClient; limiter: SubjectLimiter } | null;
  readMenu(observationId: string, authorization: string): Promise<Result>;
  allowedOrigins: Set<string>;
  log?: (message: string, error: unknown) => void;
}

async function readJson(
  req: Request,
  limit: number,
  fail: (status: number, error: string) => Response,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > limit) return { ok: false, response: fail(413, 'payload_too_large') };
  const bodyText = await req.text();
  if (new TextEncoder().encode(bodyText).byteLength > limit) return { ok: false, response: fail(413, 'payload_too_large') };
  if (!bodyText) return { ok: true, body: undefined };
  try { return { ok: true, body: JSON.parse(bodyText) }; }
  catch { return { ok: false, response: fail(400, 'invalid_json') }; }
}

export function routePath(url: string): string {
  const pathname = new URL(url).pathname;
  const marker = pathname.indexOf('/discover-api');
  const rest = marker >= 0 ? pathname.slice(marker + '/discover-api'.length) : pathname;
  return (rest || '/').replace(/\/+$/,'') || '/';
}

export async function handle(req: Request, deps: EdgeDeps): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && !deps.allowedOrigins.has(origin)) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
      status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const responseHeaders = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'pragma': 'no-cache',
    'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  });
  if (origin) responseHeaders.set('access-control-allow-origin', origin);

  const respond = (result: Result) => new Response(JSON.stringify(result.body), {
    status: result.status, headers: new Headers([...responseHeaders.entries(), ...Object.entries(result.headers ?? {})]),
  });
  const fail = (status: number, error: string) => respond({ status, body: { error } });
  const path = routePath(req.url);
  const method = req.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders });
  try {
    if (path === '/health' && method === 'GET') {
      return respond({ status: 200, body: { ok: true, service: 'harmony-discover-api', runtime: 'supabase-edge' } });
    }

    const learning = path.startsWith('/v1/learning/');
    const account = path === '/v1/me' || path.startsWith('/v1/me/');
    const observation = path === '/v1/observations' || path.startsWith('/v1/observations/');
    if (!learning && !account && !observation) return fail(404, 'not_found');

    const subject = await deps.identify(req.headers.get('authorization') ?? undefined);
    const limiter = learning ? deps.learning.limiter : account ? deps.account.limiter : deps.observations?.limiter;
    if (!limiter || !(await limiter.allow(subject))) return fail(limiter ? 429 : 503, limiter ? 'rate_limited' : 'unavailable');

    if (learning) {
      const services = { identify: deps.identify, ...deps.learning };
      if (path === '/v1/learning/consent' && method === 'GET') return respond(await getConsent(services, subject));
      if (path === '/v1/learning/consent' && method === 'PUT') {
        const body = await readJson(req, LEARNING_BODY_LIMIT, fail);
        return body.ok ? respond(await putConsent(services, subject, body.body, deps.log)) : body.response;
      }
      if (path === '/v1/learning/events' && method === 'POST') {
        const body = await readJson(req, LEARNING_BODY_LIMIT, fail);
        return body.ok ? respond(await postEvent(services, subject, body.body, deps.log)) : body.response;
      }
      return fail(405, 'method_not_allowed');
    }

    if (account) {
      const services = { identify: deps.identify, ...deps.account };
      if (path === '/v1/me/export' && method === 'GET') return respond(await exportData(services, subject, deps.log));
      if (path === '/v1/me/contributions' && method === 'GET') return respond(await listObservationContributions(deps.observations!.db, subject, deps.log));
      if (path === '/v1/me' && method === 'DELETE') {
        const body = await readJson(req, 1024, fail);
        return body.ok ? respond(await requestDeletion(services, subject, body.body, deps.log)) : body.response;
      }
      return fail(405, 'method_not_allowed');
    }

    const db = deps.observations!.db;
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 2 && method === 'POST') {
      const body = await readJson(req, 4096, fail);
      return body.ok ? respond(await createObservation(db, subject, body.body, deps.log)) : body.response;
    }
    if (parts.length === 4 && parts[3] === 'assets' && method === 'POST') {
      if (Number(req.headers.get('content-length') ?? '0') > MAX_UPLOAD_BYTES + 64 * 1024) return fail(413, 'payload_too_large');
      let file: { bytes: Uint8Array; mimetype: string } | null = null;
      try {
        const formFile = (await req.formData()).get('file');
        if (formFile && typeof formFile !== 'string') file = { bytes: new Uint8Array(await formFile.arrayBuffer()), mimetype: formFile.type };
      } catch { return fail(400, 'invalid_multipart'); }
      return respond(await addAsset(db, subject, parts[2], file, deps.log));
    }
    if (parts.length === 3 && method === 'DELETE') return respond(await discardIncompleteObservation(db, subject, parts[2], deps.log));
    if (parts.length === 4 && parts[3] === 'complete' && method === 'POST') return respond(await completeObservation(db, subject, parts[2], deps.log));
    if (parts.length === 4 && parts[3] === 'read' && method === 'POST') return respond(await deps.readMenu(parts[2], req.headers.get('authorization') ?? ''));
    if (parts.length === 4 && parts[3] === 'venue-confirmation' && method === 'POST') {
      const body = await readJson(req, 1024, fail);
      return body.ok ? respond(await confirmObservationVenue(db, subject, parts[2], body.body, deps.log)) : body.response;
    }
    if (parts.length === 4 && parts[3] === 'contribution' && method === 'GET') return respond(await getObservationContribution(db, subject, parts[2], deps.log));
    if (parts.length === 4 && parts[3] === 'contribution' && method === 'POST') {
      const body = await readJson(req, 1024, fail);
      return body.ok ? respond(await grantObservationContribution(db, subject, parts[2], body.body, deps.log)) : body.response;
    }
    if (parts.length === 4 && parts[3] === 'contribution' && method === 'DELETE') return respond(await withdrawObservationContribution(db, subject, parts[2], deps.log));
    if (parts.length === 5 && parts[3] === 'items' && method === 'PUT') {
      const body = await readJson(req, 4096, fail);
      return body.ok ? respond(await correctObservationItem(db, subject, parts[2], parts[4], body.body, deps.log)) : body.response;
    }
    if (parts.length === 3 && method === 'GET') return respond(await getObservation(db, subject, parts[2], deps.log));
    return fail(405, 'method_not_allowed');
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.status === 401 ? 'unauthorized' : 'error');
    deps.log?.('unhandled', error);
    return fail(500, 'internal_error');
  }
}
