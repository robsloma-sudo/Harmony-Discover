export type BottleTrackCandidate<T> = {
  trackId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  bottle?: T;
  contour?: Array<{ x: number; y: number }>;
  sourceWidth?: number;
  sourceHeight?: number;
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
  const previousById = new Map(previous.map(record => [record.trackId, record]));
  const next: TrackedBottleRecord<T>[] = [];
  for (const candidate of candidates) {
    const previousRecord = previousById.get(candidate.trackId);
    const bottle = candidate.bottle ?? previousRecord?.bottle;
    if (!bottle) continue;
    let contour = candidate.contour;
    if (!contour && previousRecord?.contour && previousRecord.width > 0 && previousRecord.height > 0) {
      // Carry the existing mask outline with the locally propagated box. This
      // only warps a previously measured mask; it does not invent a new mask.
      contour = previousRecord.contour.map(point => ({
        x: Number((candidate.x + ((point.x - previousRecord.x) / previousRecord.width) * candidate.width).toFixed(6)),
        y: Number((candidate.y + ((point.y - previousRecord.y) / previousRecord.height) * candidate.height).toFixed(6)),
      }));
    }
    next.push({ ...candidate, bottle, ...(contour ? { contour } : {}) });
  }
  return next;
}
