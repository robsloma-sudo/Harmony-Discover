import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/supabase.js';
import { requireConsumerId } from '../lib/identity.js';
import { randomUUID } from 'node:crypto';

const createSchema = z.object({
  consentToProcessing: z.literal(true),
  venueName: z.string().trim().max(180).optional(),
  capturedAt: z.string().datetime().optional(),
  source: z.enum(['camera','gallery']).default('camera')
});

export const observationRoutes: FastifyPluginAsync = async app => {
  app.post('/', async (request, reply) => {
    const consumerId = await requireConsumerId(request);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });

    const id = randomUUID();
    const { error } = await db.from('menu_observations').insert({
      id, consumer_id: consumerId, status: 'created',
      consent_to_processing: parsed.data.consentToProcessing,
      venue_name_submitted: parsed.data.venueName ?? null,
      capture_source: parsed.data.source,
      captured_at: parsed.data.capturedAt ?? new Date().toISOString()
    });
    if (error) {
      request.log.error({ error }, 'observation insert failed');
      return reply.code(500).send({ error: 'observation_create_failed' });
    }
    return reply.code(201).send({ id, status: 'created' });
  });

  app.post('/:id/assets', async (request, reply) => {
    const consumerId = await requireConsumerId(request);
    const { id } = request.params as { id: string };
    const { data: observation, error: lookupError } = await db.from('menu_observations')
      .select('id,status').eq('id', id).eq('consumer_id', consumerId).maybeSingle();
    if (lookupError || !observation) return reply.code(404).send({ error: 'observation_not_found' });

    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'asset_required' });
    const allowed = new Set(['image/jpeg','image/png','image/webp','image/heic']);
    if (!allowed.has(part.mimetype)) return reply.code(415).send({ error: 'unsupported_media_type' });

    const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic'} as Record<string,string>)[part.mimetype];
    const objectPath = `${consumerId}/${id}/${randomUUID()}.${ext}`;
    const bytes = await part.toBuffer();
    const { error: uploadError } = await db.storage.from('observation-assets').upload(objectPath, bytes, {
      contentType: part.mimetype, upsert: false
    });
    if (uploadError) {
      request.log.error({ uploadError }, 'asset upload failed');
      return reply.code(500).send({ error: 'asset_upload_failed' });
    }
    const { error: rowError } = await db.from('observation_assets').insert({
      observation_id: id, consumer_id: consumerId, object_path: objectPath,
      mime_type: part.mimetype, byte_size: bytes.byteLength, processing_status: 'received'
    });
    if (rowError) {
      request.log.error({ rowError }, 'asset metadata insert failed');
      return reply.code(500).send({ error: 'asset_metadata_failed' });
    }
    return reply.code(201).send({ status: 'received' });
  });

  app.post('/:id/complete', async (request, reply) => {
    const consumerId = await requireConsumerId(request);
    const { id } = request.params as { id: string };
    const { data, error } = await db.from('menu_observations').update({ status: 'received' })
      .eq('id', id).eq('consumer_id', consumerId).eq('status', 'created')
      .select('id,status').maybeSingle();
    if (error || !data) return reply.code(409).send({ error: 'observation_not_completable' });
    const { error: queueError } = await db.from('observation_jobs').upsert({
      observation_id: id, job_type: 'validate_assets', status: 'queued',
      available_at: new Date().toISOString()
    }, { onConflict: 'observation_id,job_type', ignoreDuplicates: true });
    if (queueError) {
      request.log.error({ queueError }, 'job enqueue failed');
      return reply.code(500).send({ error: 'processing_enqueue_failed' });
    }
    return reply.code(202).send({ id, status: 'received', processing: 'queued' });
  });
};
