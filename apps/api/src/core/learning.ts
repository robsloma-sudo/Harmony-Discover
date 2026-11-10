import { z } from 'zod';
import { ok, type Identify, type Result, type SubjectLimiter } from './http.ts';
import { validateLearningEvent } from '../../../../packages/learning-engine/ingest-policy.ts';
import type { ConsentSnapshot, LearningEvent } from '../../../../packages/shared-types/learning-events.ts';

// Framework-neutral learning handlers (Phase 1). The route validates shape and privacy rules; consent is decided by the store, which for the
// real service is the database (migration 0004) under a per-subject lock. The client never supplies consent.

export type IngestStatus = 'accepted' | 'duplicate' | 'consent_required' | 'conversation_consent_required' | 'event_id_conflict';
export interface ConsentInput { policyVersion: string; personalization: boolean; aggregateResearch: boolean; conversationAnalysis: boolean }
export interface EventRow {
  event_id: string; event_name: string; schema_version: number; occurred_at: string; session_id: string | null;
  app_version: string; platform: string; beverage_category: string | null; feature: string | null;
  venue_region: string | null; source_type: string | null; properties: Record<string, unknown>;
}
export interface LearningStore {
  currentConsent(subjectId: string): Promise<ConsentSnapshot>;
  setConsent(subjectId: string, input: ConsentInput): Promise<ConsentSnapshot>;
  ingestEvent(subjectId: string, row: EventRow): Promise<{ status: IngestStatus; aggregateEligible: boolean; personalizationEligible: boolean }>;
}
export interface LearningDeps {
  identify: Identify;       // subject from a verified token only
  store: LearningStore;
  limiter: SubjectLimiter;
}

export const MAX_PROPERTIES = 20;
export const LEARNING_BODY_LIMIT = 8 * 1024;

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
  properties: z.record(z.union([z.string().max(120), z.number().finite(), z.boolean(), z.array(z.string().max(60)).max(20)]))
    .refine(p => Object.keys(p).length <= MAX_PROPERTIES, { message: `at most ${MAX_PROPERTIES} properties` })
    .default({}),
}).strict();

export async function getConsent(deps: LearningDeps, subjectId: string): Promise<Result> {
  return ok(await deps.store.currentConsent(subjectId));
}

export async function putConsent(deps: LearningDeps, subjectId: string, body: unknown, log?: (m: string, e: unknown) => void): Promise<Result> {
  const parsed = consentSchema.safeParse(body);
  if (!parsed.success) return ok({ error: 'invalid_consent_request', details: parsed.error.flatten() }, 400);
  try {
    return ok({ status: 'recorded', consent: await deps.store.setConsent(subjectId, parsed.data) });
  } catch (error) {
    log?.('learning consent write failed', error);
    return ok({ error: 'consent_record_failed' }, 500);   // all-or-nothing: nothing was recorded
  }
}

// Only structured, minimised events. Question text is never accepted here.
export async function postEvent(deps: LearningDeps, subjectId: string, body: unknown, log?: (m: string, e: unknown) => void): Promise<Result> {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return ok({ error: 'invalid_learning_event', details: parsed.error.flatten() }, 400);
  const e = parsed.data;
  const placeholder: ConsentSnapshot = { personalization: false, aggregateResearch: false, conversationAnalysis: false, policyVersion: 'server' };
  const problems = validateLearningEvent({ ...e, subjectId, consent: placeholder } as LearningEvent);
  if (problems.length) return ok({ error: 'invalid_learning_event', details: problems }, 400);
  let result;
  try {
    result = await deps.store.ingestEvent(subjectId, {
      event_id: e.eventId, event_name: e.eventName, schema_version: e.schemaVersion, occurred_at: e.occurredAt,
      session_id: e.sessionId ?? null, app_version: e.appVersion, platform: e.platform,
      beverage_category: e.context?.beverageCategory ?? null, feature: e.context?.feature ?? null,
      venue_region: e.context?.venueRegion ?? null, source_type: e.context?.sourceType ?? null, properties: e.properties,
    });
  } catch (error) {
    log?.('learning event write failed', error);
    return ok({ error: 'learning_event_write_failed' }, 500);
  }
  switch (result.status) {
    case 'accepted':
      return ok({ accepted: true, eligibleForAggregate: result.aggregateEligible,
        eligibleForPersonalization: result.personalizationEligible, questionTextAccepted: false }, 202);
    case 'duplicate': return ok({ accepted: true, duplicate: true });
    case 'event_id_conflict': return ok({ error: 'event_id_conflict' }, 409);
    default: return ok({ accepted: false, reason: result.status }, 202);
  }
}
