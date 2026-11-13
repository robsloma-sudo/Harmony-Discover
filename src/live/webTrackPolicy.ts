export type WebBottleTrackState = {
  hits: number;
  misses: number;
  confidence: number;
};

/**
 * A cloud-derived box is only promoted to the visible stream after a second
 * observation. Fast local D-FINE tracks already provide the immediate
 * provisional box, so this gate prevents one-frame cloud flashes without
 * delaying the first visible local detection.
 */
export function isConfirmedWebBottleTrack(track: WebBottleTrackState): boolean {
  return Number.isFinite(track.hits)
    && track.hits >= 2
    && track.misses >= 0
    && track.misses <= 1
    && Number.isFinite(track.confidence)
    && track.confidence >= 0.45;
}
