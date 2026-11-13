export function isEligibleWorldAnchorCandidate(
  source: "cloud" | "local" | undefined,
  candidateTimestamp: number | undefined,
  observationTimestamp: number,
  maximumDeltaSeconds = 0.001,
): boolean {
  return source !== "local"
    && candidateTimestamp !== undefined
    && Number.isFinite(candidateTimestamp)
    && Number.isFinite(observationTimestamp)
    && Number.isFinite(maximumDeltaSeconds)
    && maximumDeltaSeconds >= 0
    && Math.abs(candidateTimestamp - observationTimestamp) <= maximumDeltaSeconds;
}
