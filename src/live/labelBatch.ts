export type LabelBatchCandidate = {
  trackId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  bottle?: { brand?: string; confidence?: number };
};

/** Select unresolved, cooldown-eligible tracks fairly, preferring stronger local detections. */
export function selectLabelBatchCandidates(
  candidates: LabelBatchCandidate[],
  lastReadAt: ReadonlyMap<number, number>,
  now: number,
  maximum = 8,
  retryAfterMs = 15_000,
): LabelBatchCandidate[] {
  const limit = Math.max(1, Math.min(8, Math.floor(maximum)));
  return candidates
    .filter(candidate =>
      Number.isSafeInteger(candidate.trackId) &&
      candidate.trackId !== 0 &&
      [candidate.x, candidate.y, candidate.width, candidate.height, candidate.confidence].every(Number.isFinite) &&
      candidate.width > 0 && candidate.height > 0 &&
      (!candidate.bottle?.brand || (candidate.bottle.confidence ?? 0) < 0.85) &&
      now - (lastReadAt.get(candidate.trackId) ?? 0) >= retryAfterMs,
    )
    .sort((a, b) =>
      (lastReadAt.get(a.trackId) ?? 0) - (lastReadAt.get(b.trackId) ?? 0) ||
      b.confidence - a.confidence,
    )
    .slice(0, limit);
}
