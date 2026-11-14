export type WebBottleTrackState = {
  hits: number;
  misses: number;
  confidence: number;
};

/**
 * Cloud detections are visible after two observations, except for a strong
 * first-frame geometry detection. This keeps provisional boxes responsive on
 * mobile browsers when camera movement prevents the same bottle from being
 * observed twice within the sparse cloud-read cadence.
 *
 * Confidence here is detection_confidence (physical bottle + box geometry),
 * not label/OCR confidence or catalogue-match confidence. Identity can remain
 * unresolved while the user still gets immediate visual feedback.
 */
export function isConfirmedWebBottleTrack(track: WebBottleTrackState): boolean {
  if (!Number.isFinite(track.hits) || !Number.isFinite(track.misses) ||
      !Number.isFinite(track.confidence) || track.hits < 1 ||
      track.misses < 0 || track.misses > 1 || track.confidence < 0.45) return false;

  return track.hits >= 2 || (track.hits === 1 && track.confidence >= 0.78);
}

/** Prevent a nearby but different bottle from inheriting a prior track identity. */
export function shouldAssociateWebBottleTrack(overlap: number, centerDistance: number, areaRatio: number): boolean {
  if (![overlap, centerDistance, areaRatio].every(Number.isFinite)) return false;
  return overlap >= 0.08 || (centerDistance <= 0.08 && areaRatio <= 3);
}
