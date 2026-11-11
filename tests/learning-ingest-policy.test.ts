import { describe, expect, it } from "vitest";
import { decideLearningIngest, validateLearningEvent } from "../packages/learning-engine/ingest-policy";
import type { LearningEvent } from "../packages/shared-types/learning-events";
const base:LearningEvent={eventId:"8fda8e88-33bb-4a20-bdf8-9d45f41b1f03",eventName:"remix_adjustment_made",schemaVersion:1,occurredAt:"2026-11-09T18:00:00.000Z",subjectId:"purpose-scoped-pseudo-id",appVersion:"0.1.0",platform:"ios",consent:{personalization:false,aggregateResearch:false,conversationAnalysis:false,policyVersion:"v1"},context:{beverageCategory:"cocktail",sourceType:"remix"},properties:{adjustment:"less_sweet"}};
describe("learning ingest policy",()=>{
 it("rejects direct identifiers",()=>expect(validateLearningEvent({...base,properties:{email:"a@b.com"}})).toContain("property 'email' is not permitted"));
 it("rejects learning without purpose consent",()=>expect(decideLearningIngest(base,base.consent).accepted).toBe(false));
 it("allows aggregate learning only with aggregate consent",()=>{const r=decideLearningIngest(base,{...base.consent,aggregateResearch:true});expect(r.eligibleForAggregate).toBe(true);expect(r.eligibleForPersonalization).toBe(false)});
 it("uses authoritative consent for free-text questions, not the device snapshot",()=>{const q={...base,eventName:"question_submitted" as const};const current={...base.consent,conversationAnalysis:true};const r=decideLearningIngest(q,current);expect(r.accepted).toBe(true);expect(r.storeQuestionSeparately).toBe(true)});
});
