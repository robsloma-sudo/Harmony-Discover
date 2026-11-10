import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/supabase.js';
import { requireConsumerId } from '../lib/identity.js';
import { randomUUID } from 'node:crypto';

const createSchema = z.object({
  processingNoticeVersion: z.literal('discover-menu-processing-v1'),
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
      consent_to_processing: true,
      processing_notice_version: parsed.data.processingNoticeVersion,
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

  app.post('/:id/venue-confirmation', async (request, reply) => {
    const consumerId = await requireConsumerId(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ venueName: z.string().trim().min(1).max(180) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_venue_confirmation' });
    const { data, error } = await db.from('menu_observations').update({
      venue_name_submitted: parsed.data.venueName, venue_confirmed: true
    }).eq('id', id).eq('consumer_id', consumerId).eq('status', 'ready_for_review')
      .select('id,venue_name_submitted').maybeSingle();
    if (error) return reply.code(500).send({ error: 'venue_confirmation_failed' });
    if (!data) return reply.code(409).send({ error: 'observation_not_eligible' });
    return reply.send({ confirmed: true, venueName: data.venue_name_submitted });
  });

  app.get('/:id/contribution', async (request, reply) => {
    const consumerId = await requireConsumerId(request);
    const { id } = request.params as { id: string };
    const { data: observation, error: lookupError } = await db.from('menu_observations')
      .select('id').eq('id', id).eq('consumer_id', consumerId).maybeSingle();
    if (lookupError || !observation) return reply.code(404).send({ error: 'observation_not_found' });
    const { data, error } = await db.from('observation_contribution_grants')
      .select('policy_version,granted_at').eq('observation_id', id).eq('consumer_id', consumerId)
      .is('withdrawn_at', null).maybeSingle();
    if (error) return reply.code(500).send({ error: 'contribution_permission_unavailable' });
    return reply.send({ granted: !!data, policyVersion: data?.policy_version ?? null, grantedAt: data?.granted_at ?? null });
  });

  app.post('/:id/contribution', async (request, reply) => {
    const consumerId = await requireConsumerId(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ policyVersion: z.literal('discover-harmony-contribution-v1') }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_contribution_permission' });
    const { data, error } = await db.rpc('discover_grant_observation_contribution', {
      p_subject: consumerId, p_observation: id, p_policy_version: parsed.data.policyVersion
    });
    if (error) {
      if (error.code === '42501') return reply.code(409).send({ error: 'observation_not_eligible' });
      if (error.code === '23505') return reply.code(409).send({ error: 'contribution_permission_already_active' });
      request.log.error({ error }, 'contribution permission grant failed');
      return reply.code(500).send({ error: 'contribution_permission_failed' });
    }
    return reply.code(201).send({ granted: true, grantId: data, policyVersion: parsed.data.policyVersion });
  });

  app.delete('/:id/contribution', async (request, reply) => {
    const consumerId = await requireConsumerId(request);
    const { id } = request.params as { id: string };
    const { data, error } = await db.rpc('discover_withdraw_observation_contribution', {
      p_subject: consumerId, p_observation: id
    });
    if (error) {
      request.log.error({ error }, 'contribution permission withdrawal failed');
      return reply.code(500).send({ error: 'contribution_withdrawal_failed' });
    }
    return reply.send({ withdrawn: data === true, alreadyInactive: data !== true });
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
