/**
 * Fix kit S2-B2-004: on iPhones, keep bottle boxes moving between cloud reads.
 *
 * The cloud read finds bottles every 2.5 s or so. Between reads the iPhone's own
 * Vision object tracker (VNTrackObjectRequest in DiscoverARKitModule.swift) follows
 * each box at up to 10 times a second. This file holds the two small rules that join
 * the two together, kept free of React and native code so they can be tested:
 *
 * 1. Which cloud boxes the phone should follow (buildTrackingSeeds). Boxes from a
 *    frame with LiDAR metric depth are skipped: those become 3D world anchors that
 *    already follow the camera 30 times a second, and a second, flat copy of the box
 *    would sit on top of the 3D one.
 * 2. How a phone-tracker update moves the last cloud boxes (applyLocalTrackerBoxes).
 *    Only the position changes. The bottle's name, read, liquid level and confidence
 *    stay exactly what the cloud read said.
 */

export type TrackingSeed = {
  trackId: number;
  /** ARFrame timestamp (seconds) of the camera frame the cloud read was made from. */
  sourceTimestamp: number;
  x: number; y: number; width: number; height: number;
  confidence: number;
};

export type LocalTrackerBox = {
  trackId: number;
  /** The seed this box was tracked from; boxes from an older seed set are ignored. */
  sourceTimestamp: number;
  /** ARFrame timestamp (seconds) of the camera frame the tracker looked at. */
  timestamp: number;
  x: number; y: number; width: number; height: number;
  /** Tracker confidence (how sure Vision is it still has the same patch), not identity. */
  confidence: number;
};

type Geometry = {
  trackId: number; x: number; y: number; width: number; height: number;
  confidence: number; timestamp?: number; source?: 'cloud' | 'local';
};

/** Cloud boxes below this confidence are not worth following. */
export const MIN_SEED_CONFIDENCE = 0.55;
/** At most this many bottles are followed at once, to keep the phone cool. */
export const MAX_TRACKED_BOTTLES = 6;
/** The phone tracker must be at least this sure before a box is moved. */
export const MIN_TRACKER_CONFIDENCE = 0.3;
/** A tracked box that jumps or changes size more than this in one step is treated as lost. */
const MAX_SIZE_CHANGE = 1.8;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function validBox(box: { x: number; y: number; width: number; height: number }): boolean {
  return finite(box.x) && finite(box.y) && finite(box.width) && finite(box.height)
    && box.width > 0.02 && box.height > 0.02
    && box.x >= -0.001 && box.y >= -0.001
    && box.x + box.width <= 1.001 && box.y + box.height <= 1.001;
}

export function buildTrackingSeeds(
  candidates: Geometry[],
  sourceTimestamp: number,
  hasMetricDepth: boolean,
): TrackingSeed[] {
  if (hasMetricDepth || !finite(sourceTimestamp)) return [];
  return candidates
    .filter(candidate => finite(candidate.trackId) && candidate.trackId > 0
      && finite(candidate.confidence) && candidate.confidence >= MIN_SEED_CONFIDENCE
      && validBox(candidate))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TRACKED_BOTTLES)
    .map(candidate => ({
      trackId: candidate.trackId,
      sourceTimestamp,
      x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height,
      confidence: candidate.confidence,
    }));
}

/**
 * Moves each cloud box to where the phone tracker last saw it.
 * - Only boxes from the current seed set (same sourceTimestamp) are used.
 * - A moved box is marked source 'local' with `receivedAtMs` (this device's clock) so the
 *   home screen's short local expiry applies: if the tracker stops updating it, it fades
 *   out within 1.5 s instead of staying pinned in the wrong place.
 * - Boxes the tracker is not following are returned unchanged.
 * Always pass the cloud read's own candidates (not an earlier result of this function).
 */
export function applyLocalTrackerBoxes<T extends Geometry>(
  candidates: T[],
  boxes: LocalTrackerBox[],
  seedTimestamp: number,
  receivedAtMs: number,
): { candidates: Array<T & { source?: 'cloud' | 'local' }>; moved: number } {
  const latest = new Map<number, LocalTrackerBox>();
  for (const box of boxes) {
    if (!box || box.sourceTimestamp !== seedTimestamp) continue;
    if (!finite(box.confidence) || box.confidence < MIN_TRACKER_CONFIDENCE || !validBox(box)) continue;
    const previous = latest.get(box.trackId);
    if (!previous || box.timestamp > previous.timestamp) latest.set(box.trackId, box);
  }
  let moved = 0;
  const next = candidates.map((candidate): T & { source?: 'cloud' | 'local' } => {
    const box = latest.get(candidate.trackId);
    if (!box) return candidate;
    // A tracker frame older than the cloud read's own frame cannot improve on it.
    if (!finite(box.timestamp) || box.timestamp < seedTimestamp) return candidate;
    const areaRatio = (box.width * box.height) / Math.max(1e-6, candidate.width * candidate.height);
    if (areaRatio > MAX_SIZE_CHANGE * MAX_SIZE_CHANGE || areaRatio < 1 / (MAX_SIZE_CHANGE * MAX_SIZE_CHANGE)) return candidate;
    moved += 1;
    return {
      ...candidate,
      x: Math.max(0, box.x), y: Math.max(0, box.y),
      width: Math.min(box.width, 1 - Math.max(0, box.x)),
      height: Math.min(box.height, 1 - Math.max(0, box.y)),
      timestamp: receivedAtMs,
      source: 'local' as const,
    };
  });
  return { candidates: next, moved };
}
