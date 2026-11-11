export interface TrendSignal {
  subjectKey: string;
  sessionKey: string;
  occurredAt: string;
  signalType: "question_intent" | "flavor_interest" | "recipe_adjustment" | "save" | "search_gap";
  topicKey: string;
  category: "cocktail" | "wine" | "beer" | "spirits" | "other";
  regionKey?: string; // coarse, pre-bucketed region only
  aggregateConsent: boolean;
}

export interface TrendEvaluation {
  topicKey: string;
  category: TrendSignal["category"];
  distinctSubjects: number;
  distinctSessions: number;
  currentCount: number;
  baselineCount: number;
  relativeChange: number | null;
  windowDays: number;
  status: "insufficient_evidence" | "emerging_signal" | "stable" | "declining";
  reasons: string[];
}

export interface TrendPolicy {
  minimumDistinctSubjects: number;
  minimumDistinctSessions: number;
  minimumWindowDays: number;
  minimumBaselineCount: number;
  minimumRelativeChange: number;
}

const DAY_MS = 86_400_000;

/**
 * Evaluates an internal product-learning signal, not a market trend.
 * Input must already be filtered to the user's current aggregate-research consent.
 * It intentionally refuses to label small samples as trends.
 */
export function evaluateTrend(
  signals: TrendSignal[],
  topicKey: string,
  category: TrendSignal["category"],
  windowEndIso: string,
  policy: TrendPolicy = {
    minimumDistinctSubjects: 25,
    minimumDistinctSessions: 30,
    minimumWindowDays: 7,
    minimumBaselineCount: 10,
    minimumRelativeChange: 0.2,
  },
): TrendEvaluation {
  const end = Date.parse(windowEndIso);
  const windowStart = end - 28 * DAY_MS;
  const baselineStart = windowStart - 28 * DAY_MS;
  const relevant = signals.filter(s =>
    s.topicKey === topicKey &&
    s.category === category &&
    s.aggregateConsent &&
    Number.isFinite(Date.parse(s.occurredAt)) &&
    Date.parse(s.occurredAt) >= baselineStart &&
    Date.parse(s.occurredAt) < end
  );

  const current = relevant.filter(s => Date.parse(s.occurredAt) >= windowStart);
  const baseline = relevant.filter(s => Date.parse(s.occurredAt) < windowStart);
  const subjects = new Set(current.map(s => s.subjectKey));
  const sessions = new Set(current.map(s => s.sessionKey));
  const distinctDays = new Set(current.map(s => new Date(s.occurredAt).toISOString().slice(0, 10)));
  const reasons: string[] = [];

  if (subjects.size < policy.minimumDistinctSubjects) reasons.push("distinct_subject_threshold_not_met");
  if (sessions.size < policy.minimumDistinctSessions) reasons.push("distinct_session_threshold_not_met");
  if (distinctDays.size < policy.minimumWindowDays) reasons.push("observation_window_too_narrow");
  if (baseline.length < policy.minimumBaselineCount) reasons.push("baseline_too_small");

  const relativeChange = baseline.length >= policy.minimumBaselineCount
    ? (current.length - baseline.length) / baseline.length
    : null;

  let status: TrendEvaluation["status"] = "insufficient_evidence";
  if (reasons.length === 0 && relativeChange !== null) {
    if (relativeChange >= policy.minimumRelativeChange) status = "emerging_signal";
    else if (relativeChange <= -policy.minimumRelativeChange) status = "declining";
    else status = "stable";
  }

  return {
    topicKey, category,
    distinctSubjects: subjects.size,
    distinctSessions: sessions.size,
    currentCount: current.length,
    baselineCount: baseline.length,
    relativeChange,
    windowDays: distinctDays.size,
    status,
    reasons,
  };
}
