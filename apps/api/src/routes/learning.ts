import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/supabase.js';
import { requireConsumerId } from '../lib/identity.js';
import { decideLearningIngest } from '../../../../packages/learning-engine/ingest-policy.js';
import type { ConsentSnapshot, LearningEvent } from '../../../../packages/shared-types/learning-events.js';

const consentSchema = z.object({
  policyVersion: z.string().trim().min(1).max(40),
  personalization: z.boolean(),
  aggregateResearch: z.boolean(),
  conversationAnalysis: z.boolean(),
}).strict();

const eventSchema = z.object({
  eventId: z.string().uuid(),
  eventName: z.enum([
    'scan_started','scan_completed','extraction_corrected','menu_item_opened',
    'journey_started','journey_feedback_submitted','question_intent_selected',
    'question_submitted','item_saved','remix_created','remix_adjustment_made',
    'recommendation_feedback','search_no_result','entity_match_rejected','content_reported'
  ]),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  sessionId: z.string().uuid().optional(),
  appVersion: z.string().trim().min(1).max(40),
  platform: z.enum(['ios','android']),
  context: z.object({
    beverageCategory: z.enum(['cocktail','wine','beer','spirits','other']).optional(),
    feature: z.string().trim().max(60).optional(),
    venueRegion: z.string().trim().max(40).optional(),
    sourceType: z.enum(['menu_scan','search','journey','collection','remix']).optional(),
  }).strict().optional(),
  properties: z.record(z.union([z.string().max(120),z.number().finite(),z.boolean(),z.array(z.string().max(60)).max(20)])).default({}),
}).strict();

async function currentConsent(subjectId: string): Promise<ConsentSnapshot> {
  const purposes = ['personalization','aggregate_research','conversation_analysis'] as const;
  const { data, error } = await db.from('learning_consent_records')
    .select('purpose,granted,policy_version,recorded_at,withdrawn_at')
    .eq('subject_id', subjectId)
    .order('recorded_at', { ascending: false })
    .limit(30);
  if (error) throw new Error('consent_lookup_failed');
  const latest = new Map<string, { granted: boolean; policy_version: string; withdrawn_at: string | null }>();
  for (const row of data ?? []) {
    if (!latest.has(row.purpose)) latest.set(row.purpose, row);
  }
  const granted = (purpose: typeof purposes[number]) => {
    const row = latest.get(purpose);
    return Boolean(row?.granted && !row.withdrawn_at);
  };
  return {
    personalization: granted('personalization'),
    aggregateResearch: granted('aggregate_research'),
    conversationAnalysis: granted('conversation_analysis'),
    policyVersion: purposes.map(p => latest.get(p)?.policy_version).filter(Boolean).join('|') || 'none',
  };
}

export const learningRoutes: FastifyPluginAsync = async app => {
  // Consumer can inspect their current purpose-specific permissions.
  app.get('/consent', async request => {
    const subjectId = await requireConsumerId(request);
    return await currentConsent(subjectId);
  });

  // Records a new consent decision for each purpose; revocation is explicit and timestamped.
  app.put('/consent', async (request, reply) => {
    const subjectId = await requireConsumerId(request);
    const parsed = consentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'invalid_consent_request', details:parsed.error.flatten() });
    const now = new Date().toISOString();
    const records = [
      ['personalization', parsed.data.personalization],
      ['aggregate_research', parsed.data.aggregateResearch],
      ['conversation_analysis', parsed.data.conversationAnalysis],
    ].map(([purpose, granted]) => ({
      subject_id: subjectId, purpose, granted, policy_version: parsed.data.policyVersion,
      capture_source: 'discover_app', recorded_at: now, withdrawn_at: granted ? null : now,
    }));
    const { error } = await db.from('learning_consent_records').insert(records);
    if (error) {
      request.log.error({ error }, 'learning consent write failed');
      return reply.code(500).send({ error:'consent_record_failed' });
    }
    return reply.code(200).send({ status:'recorded', consent: await currentConsent(subjectId) });
  });

  // Only structured, minimized events are accepted. Question bodies are deliberately not accepted here.
  app.post('/events', async (request, reply) => {
    const subjectId = await requireConsumerId(request);
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:'invalid_learning_event', details:parsed.error.flatten() });
    const consent = await currentConsent(subjectId);
    const event: LearningEvent = {
      ...parsed.data,
      subjectId,
      consent,
    };
    const decision = decideLearningIngest(event, consent);
    if (!decision.accepted) return reply.code(202).send({ accepted:false, reason:decision.reason });
    const row = {
      event_id: event.eventId,
      subject_id: subjectId,
      session_id: event.sessionId ?? null,
      event_name: event.eventName,
      schema_version: event.schemaVersion,
      occurred_at: event.occurredAt,
      app_version: event.appVersion,
      platform: event.platform,
      consent_policy_version: consent.policyVersion,
      personalization_allowed: decision.eligibleForPersonalization,
      aggregate_research_allowed: decision.eligibleForAggregate,
      conversation_analysis_allowed: consent.conversationAnalysis,
      beverage_category: event.context?.beverageCategory ?? null,
      feature: event.context?.feature ?? null,
      venue_region: event.context?.venueRegion ?? null,
      source_type: event.context?.sourceType ?? null,
      properties: event.properties ?? {},
    };
    const { error } = await db.from('learning_events').insert(row);
    if (error) {
      if (error.code === '23505') return reply.code(200).send({ accepted:true, duplicate:true });
      request.log.error({ error }, 'learning event insert failed');
      return reply.code(500).send({ error:'learning_event_write_failed' });
    }
    return reply.code(202).send({
      accepted:true,
      eligibleForAggregate:decision.eligibleForAggregate,
      eligibleForPersonalization:decision.eligibleForPersonalization,
      questionTextAccepted:false,
    });
  });
};
