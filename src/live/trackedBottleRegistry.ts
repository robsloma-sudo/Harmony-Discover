export type BottleTrackCandidate<T> = {
  trackId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  bottle?: T;
};

export type TrackedBottleRecord<T> = BottleTrackCandidate<T> & { bottle: T };

/**
 * Carries the last confirmed bottle read forward while a physical track is
 * locally propagated through frames without a fresh cloud read.
 * Only candidates still present in the tracker survive each update.
 */
export function mergeTrackedBottleCandidates<T>(
  previous: TrackedBottleRecord<T>[],
  candidates: BottleTrackCandidate<T>[],
): TrackedBottleRecord<T>[] {
  const previousById = new Map(previous.map(record => [record.trackId, record.bottle]));
  const next: TrackedBottleRecord<T>[] = [];
  for (const candidate of candidates) {
    const bottle = candidate.bottle ?? previousById.get(candidate.trackId);
    if (!bottle) continue;
    next.push({ ...candidate, bottle });
  }
  return next;
}
