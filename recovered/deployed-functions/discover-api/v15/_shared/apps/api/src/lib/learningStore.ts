import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsentSnapshot } from '../../../../packages/shared-types/learning-events.ts';
import type { LearningStore } from '../core/learning.ts';

// Supabase-backed store: every decision runs inside the database functions from migration 0004.
type ConsentRow = { personalization: boolean; aggregate_research: boolean; conversation_analysis: boolean; policy_version: string };
const toSnapshot = (r: ConsentRow | undefined): ConsentSnapshot => ({
  personalization: Boolean(r?.personalization), aggregateResearch: Boolean(r?.aggregate_research),
  conversationAnalysis: Boolean(r?.conversation_analysis), policyVersion: r?.policy_version ?? 'none',
});
const one = <T>(data: unknown): T | undefined => (Array.isArray(data) ? data[0] : data) as T | undefined;

export function supabaseLearningStore(db: SupabaseClient): LearningStore {
  return {
    async currentConsent(subjectId) {
      const { data, error } = await db.rpc('learning_current_consent', { p_subject: subjectId });
      if (error) throw new Error('consent_lookup_failed');
      return toSnapshot(one<ConsentRow>(data));
    },
    async setConsent(subjectId, c) {
      const { data, error } = await db.rpc('learning_set_consent', {
        p_subject: subjectId, p_policy_version: c.policyVersion, p_personalization: c.personalization,
        p_aggregate_research: c.aggregateResearch, p_conversation_analysis: c.conversationAnalysis, p_capture_source: 'discover_app' });
      if (error) throw new Error('consent_record_failed');
      return toSnapshot(one<ConsentRow>(data));
    },
    async ingestEvent(subjectId, row) {
      const { data, error } = await db.rpc('learning_ingest_event', { p_subject: subjectId, p_event: row });
      if (error) throw new Error('learning_event_write_failed');
      const r = one<{ status: string; aggregate_eligible: boolean; personalization_eligible: boolean }>(data);
      if (!r) throw new Error('learning_event_write_failed');
      return { status: r.status as never, aggregateEligible: r.aggregate_eligible, personalizationEligible: r.personalization_eligible };
    },
  };
}
