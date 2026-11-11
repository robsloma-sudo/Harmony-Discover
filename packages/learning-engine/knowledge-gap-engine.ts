export type LearningDomain =
  | "cocktail_intelligence"
  | "flavor_intelligence"
  | "wine_intelligence"
  | "menu_intelligence"
  | "journeys"
  | "harmony_reason"
  | "discover_ux";

export type GapSignalKind =
  | "unanswered_question"
  | "low_answer_satisfaction"
  | "entity_match_rejected"
  | "search_no_result"
  | "repeated_remix_adjustment"
  | "journey_dropoff"
  | "knowledge_conflict"
  | "source_coverage_gap";

export interface GapSignal {
  signalId: string;
  domain: LearningDomain;
  kind: GapSignalKind;
  topicKey: string;
  occurredAt: string;
  consentingSubjectKey: string;
  eligibleForAggregate: boolean;
  severity?: number; // 1..5, server-derived
  repeatCount?: number;
  answerWasAvailable?: boolean;
  satisfaction?: number; // 1..5, explicit feedback only
  sourceCoverage?: number; // 0..1, internal source audit only
}

export interface GapCandidate {
  key: string;
  domain: LearningDomain;
  topicKey: string;
  score: number;
  priority: "low" | "normal" | "high" | "urgent";
  reasons: string[];
  evidence: {
    distinctSubjects: number;
    signalCount: number;
    daysObserved: number;
    unansweredRate: number | null;
    lowSatisfactionRate: number | null;
    sourceCoverage: number | null;
  };
  nextAction: "observe_more" | "audit_existing_knowledge" | "commission_research" | "review_experience";
  caution: string;
}

export interface GapPolicy {
  minimumDistinctSubjects: number;
  minimumDaysObserved: number;
  highPriorityScore: number;
  urgentPriorityScore: number;
}

const DAY = 86_400_000;

/**
 * Ranks internal Harmony knowledge/experience gaps from aggregate-consented signals.
 * This is prioritization logic, not a factual assertion about a topic.
 */
export function detectKnowledgeGaps(
  signals: GapSignal[],
  nowIso: string,
  policy: GapPolicy = {
    minimumDistinctSubjects: 10,
    minimumDaysObserved: 3,
    highPriorityScore: 65,
    urgentPriorityScore: 85,
  },
): GapCandidate[] {
  const now = Date.parse(nowIso);
  const cutoff = now - 30 * DAY;
  const eligible = signals.filter(s =>
    s.eligibleForAggregate &&
    Number.isFinite(Date.parse(s.occurredAt)) &&
    Date.parse(s.occurredAt) >= cutoff &&
    Date.parse(s.occurredAt) <= now
  );

  const groups = new Map<string, GapSignal[]>();
  for (const signal of eligible) {
    const key = `${signal.domain}:${signal.topicKey}`;
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }

  const candidates: GapCandidate[] = [];
  for (const [key, group] of groups) {
    const subjects = new Set(group.map(x => x.consentingSubjectKey));
    const days = new Set(group.map(x => new Date(x.occurredAt).toISOString().slice(0, 10)));
    const unanswered = group.filter(x => x.kind === "unanswered_question" || x.kind === "search_no_result").length;
    const lowSatisfaction = group.filter(x => x.satisfaction !== undefined && x.satisfaction <= 2).length;
    const rated = group.filter(x => x.satisfaction !== undefined).length;
    const coverageValues = group.map(x => x.sourceCoverage).filter((x): x is number => x !== undefined);
    const sourceCoverage = coverageValues.length
      ? coverageValues.reduce((a,b)=>a+b,0)/coverageValues.length : null;
    const unansweredRate = group.length ? unanswered/group.length : null;
    const lowSatisfactionRate = rated ? lowSatisfaction/rated : null;
    const reasons: string[] = [];

    if (subjects.size < policy.minimumDistinctSubjects) reasons.push("distinct_subject_threshold_not_met");
    if (days.size < policy.minimumDaysObserved) reasons.push("observation_span_too_short");

    let score = 0;
    if (unansweredRate !== null) score += Math.min(35, unansweredRate * 70);
    if (lowSatisfactionRate !== null) score += Math.min(25, lowSatisfactionRate * 50);
    if (sourceCoverage !== null) score += Math.min(20, (1-sourceCoverage) * 20);
    const severity = group.reduce((sum,x)=>sum+(x.severity ?? 1),0)/group.length;
    score += Math.min(10, severity * 2);
    score += Math.min(10, Math.log2(1+subjects.size) * 2);
    score = Math.round(Math.min(100, score));

    const sufficientlySupported = subjects.size >= policy.minimumDistinctSubjects &&
      days.size >= policy.minimumDaysObserved;
    if (!sufficientlySupported) reasons.push("not_eligible_for_priority_claim");

    let priority: GapCandidate["priority"] = "low";
    if (sufficientlySupported && score >= policy.urgentPriorityScore) priority = "urgent";
    else if (sufficientlySupported && score >= policy.highPriorityScore) priority = "high";
    else if (sufficientlySupported && score >= 35) priority = "normal";

    const domain = group[0].domain;
    let nextAction: GapCandidate["nextAction"] = "observe_more";
    if (sufficientlySupported) {
      if (sourceCoverage !== null && sourceCoverage < 0.6) nextAction = "commission_research";
      else if ((unansweredRate ?? 0) >= 0.25) nextAction = "audit_existing_knowledge";
      else nextAction = "review_experience";
    }

    candidates.push({
      key, domain, topicKey: group[0].topicKey, score, priority, reasons,
      evidence: {
        distinctSubjects: subjects.size,
        signalCount: group.length,
        daysObserved: days.size,
        unansweredRate,
        lowSatisfactionRate,
        sourceCoverage,
      },
      nextAction,
      caution: "Internal, self-selected Discover signal. Review sampling bias and source evidence before action.",
    });
  }

  return candidates.sort((a,b)=>b.score-a.score);
}
