import { describe, expect, it } from "vitest";
import { evaluateTrend, type TrendSignal } from "../packages/learning-engine/trend-evaluator";

function makeSignals(count: number, start: string, topic = "less_sweet", consent = true): TrendSignal[] {
  return Array.from({ length: count }, (_, i) => ({
    subjectKey: `person-${i % 40}`,
    sessionKey: `session-${i}`,
    occurredAt: new Date(Date.parse(start) + (i % 14) * 86_400_000).toISOString(),
    signalType: "recipe_adjustment" as const,
    topicKey: topic,
    category: "cocktail" as const,
    aggregateConsent: consent,
  }));
}

describe("trend evaluator", () => {
  it("does not label a small sample as a trend", () => {
    const result = evaluateTrend(makeSignals(12, "2026-10-20T12:00:00Z"), "less_sweet", "cocktail", "2026-11-09T12:00:00Z");
    expect(result.status).toBe("insufficient_evidence");
    expect(result.reasons).toContain("distinct_subject_threshold_not_met");
  });

  it("ignores signals without aggregate research consent", () => {
    const result = evaluateTrend(makeSignals(100, "2026-10-20T12:00:00Z", "less_sweet", false), "less_sweet", "cocktail", "2026-11-09T12:00:00Z");
    expect(result.distinctSubjects).toBe(0);
    expect(result.status).toBe("insufficient_evidence");
  });

  it("reports a growing internal signal only after sample and baseline checks", () => {
    const baseline = makeSignals(30, "2026-09-15T12:00:00Z");
    const current = makeSignals(60, "2026-10-20T12:00:00Z").map((s, i) => ({
      ...s, subjectKey: `current-${i}`, sessionKey: `current-session-${i}`
    }));
    const result = evaluateTrend([...baseline, ...current], "less_sweet", "cocktail", "2026-11-09T12:00:00Z");
    expect(result.status).toBe("emerging_signal");
    expect(result.relativeChange).toBe(1);
  });
});
