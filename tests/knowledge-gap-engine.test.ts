import { describe, expect, it } from "vitest";
import { detectKnowledgeGaps, type GapSignal } from "../packages/learning-engine/knowledge-gap-engine";

function sampleSignals(count: number, overrides: Partial<GapSignal> = {}): GapSignal[] {
  return Array.from({length: count}, (_,i)=>({
    signalId:`sig-${i}`,
    domain:"cocktail_intelligence",
    kind:"unanswered_question",
    topicKey:"aperitif-balance",
    occurredAt:new Date(Date.parse("2026-10-15T12:00:00Z")+(i%10)*86400000).toISOString(),
    consentingSubjectKey:`subject-${i}`,
    eligibleForAggregate:true,
    severity:3,
    sourceCoverage:0.4,
    ...overrides,
  }));
}

describe("knowledge gap engine",()=>{
  it("does not prioritize small cohorts",()=>{
    const result=detectKnowledgeGaps(sampleSignals(5),"2026-11-09T12:00:00Z");
    expect(result[0].priority).toBe("low");
    expect(result[0].reasons).toContain("distinct_subject_threshold_not_met");
    expect(result[0].nextAction).toBe("observe_more");
  });

  it("excludes signals without aggregate consent",()=>{
    const result=detectKnowledgeGaps(sampleSignals(30,{eligibleForAggregate:false}),"2026-11-09T12:00:00Z");
    expect(result).toHaveLength(0);
  });

  it("ranks sufficiently supported low-coverage knowledge gaps for research",()=>{
    const result=detectKnowledgeGaps(sampleSignals(30),"2026-11-09T12:00:00Z");
    expect(result[0].evidence.distinctSubjects).toBe(30);
    expect(result[0].nextAction).toBe("commission_research");
    expect(result[0].priority).not.toBe("low");
  });

  it("separates domains and topic keys",()=>{
    const mixed=[...sampleSignals(20),...sampleSignals(20,{domain:"wine_intelligence",topicKey:"rioja-classification"})];
    const result=detectKnowledgeGaps(mixed,"2026-11-09T12:00:00Z");
    expect(result).toHaveLength(2);
  });
});
