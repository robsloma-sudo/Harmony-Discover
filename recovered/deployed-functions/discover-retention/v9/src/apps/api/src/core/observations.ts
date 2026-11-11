// GENERATED from apps/api/src/core/observations.ts by scripts/build-edge.mjs. Do not edit; deploy to the Discover DEV project only.
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, type Result } from './http.ts';

// Framework-neutral observation handlers. Reading the photo the user just sent is the service they asked for
// (operational processing), recorded as the notice version shown. Aggregate learning is governed only by
// /v1/learning/consent (migration 0004).
export const BUCKET = 'observation-assets';
export const ALLOWED_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const createSchema = z.object({
  processingNoticeVersion: z.string().trim().min(1).max(40),
  venueName: z.string().trim().max(180).optional(),
  capturedAt: z.string().datetime().optional(),
  source: z.enum(['camera', 'gallery']).default('camera'),
}).strict();
type Log = (m: string, e: unknown) => void;

export async function createObservation(db: SupabaseClient, subjectId: string, body: unknown, log?: Log): Promise<Result> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return ok({ error: 'invalid_request', details: parsed.error.flatten() }, 400);
  const id = crypto.randomUUID();
  const { error } = await db.from('menu_observations').insert({
    id, consumer_id: subjectId, status: 'created', processing_notice_version: parsed.data.processingNoticeVersion,
    venue_name_submitted: parsed.data.venueName ?? null, capture_source: parsed.data.source,
    captured_at: parsed.data.capturedAt ?? new Date().toISOString() });
  if (error) { log?.('observation insert failed', error); return ok({ error: 'observation_create_failed' }, 500); }
  return ok({ id, status: 'created' }, 201);
}

export async function addAsset(db: SupabaseClient, subjectId: string, observationId: string,
                               file: { bytes: Uint8Array; mimetype: string } | null, log?: Log): Promise<Result> {
  if (!z.string().uuid().safeParse(observationId).success) return ok({ error: 'observation_not_found' }, 404);
  const { data: observation, error: lookupError } = await db.from('menu_observations')
    .select('id,status').eq('id', observationId).eq('consumer_id', subjectId).maybeSingle();
  if (lookupError || !observation) return ok({ error: 'observation_not_found' }, 404);
  if (!file) return ok({ error: 'asset_required' }, 400);
  const ext = ALLOWED_MIME[file.mimetype];
  if (!ext) return ok({ error: 'unsupported_media_type' }, 415);
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_UPLOAD_BYTES) return ok({ error: 'asset_size_invalid' }, 413);
  const objectPath = `${subjectId}/${observationId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await db.storage.from(BUCKET).upload(objectPath, file.bytes, { contentType: file.mimetype, upsert: false });
  if (uploadError) { log?.('asset upload failed', uploadError); return ok({ error: 'asset_upload_failed' }, 500); }
  const { error: rowError } = await db.from('observation_assets').insert({
    observation_id: observationId, consumer_id: subjectId, object_path: objectPath,
    mime_type: file.mimetype, byte_size: file.bytes.byteLength, processing_status: 'received' });
  if (rowError) {
    log?.('asset metadata insert failed', rowError);
    // Do not leave an untracked photo in storage (handoff §10.11).
    const { error: cleanupError } = await db.storage.from(BUCKET).remove([objectPath]);
    if (cleanupError) log?.('orphaned asset cleanup failed', { cleanupError, objectPath });
    return ok({ error: 'asset_metadata_failed' }, 500);
  }
  return ok({ status: 'received' }, 201);
}

export async function completeObservation(db: SupabaseClient, subjectId: string, observationId: string, log?: Log): Promise<Result> {
  if (!z.string().uuid().safeParse(observationId).success) return ok({ error: 'observation_not_completable' }, 409);
  const { data, error } = await db.from('menu_observations').update({ status: 'received' })
    .eq('id', observationId).eq('consumer_id', subjectId).eq('status', 'created').select('id,status').maybeSingle();
  if (error || !data) return ok({ error: 'observation_not_completable' }, 409);
  const { error: queueError } = await db.from('observation_jobs').upsert({
    observation_id: observationId, job_type: 'validate_assets', status: 'queued', available_at: new Date().toISOString() },
    { onConflict: 'observation_id,job_type', ignoreDuplicates: true });
  if (queueError) { log?.('job enqueue failed', queueError); return ok({ error: 'processing_enqueue_failed' }, 500); }
  return ok({ id: observationId, status: 'received', processing: 'queued' }, 202);
}
