import type { NormalizedPoint, NormalizedBounds } from './maskContour';

export type LocalBottleProposal = {
  bounds: NormalizedBounds;
  confidence: number;
  contour?: NormalizedPoint[];
};

export type LocalBottleCandidate = LocalBottleProposal & {
  trackId: number;
  hits: number;
};

type Track = LocalBottleCandidate & { lastSeenAt: number; misses: number };

const validBounds = (b: NormalizedBounds) =>
  [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
  b.x >= 0 && b.y >= 0 && b.width >= 0.015 && b.height >= 0.025 &&
  b.x + b.width <= 1.001 && b.y + b.height <= 1.001;

/**
 * Removes partial detections nested inside a larger bottle silhouette.
 * Cork/neck masks are usually much smaller and sit inside the upper half of
 * the full bottle bounds; keep the larger physical-object proposal.
 */
export function removeNestedBottleProposals(proposals: LocalBottleProposal[]): LocalBottleProposal[] {
  const ordered = proposals
    .filter(p => validBounds(p.bounds))
    .slice()
    .sort((a, b) => ((b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height)) || (b.confidence - a.confidence));
  const kept: LocalBottleProposal[] = [];
  for (const candidate of ordered) {
    const nested = kept.some(parent => {
      const a = parent.bounds;
      const b = candidate.bounds;
      const intersectionWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const intersectionHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const smallerArea = b.width * b.height;
      const coverage = smallerArea > 0 ? (intersectionWidth * intersectionHeight) / smallerArea : 0;
      const parentArea = a.width * a.height;
      const relativeArea = parentArea > 0 ? smallerArea / parentArea : 1;
      const centerOffset = Math.abs((b.x + b.width / 2) - (a.x + a.width / 2));
      const centered = centerOffset <= a.width * 0.32;
      const inUpperBottle = b.y + b.height <= a.y + a.height * 0.55;
      const nestedFragment = relativeArea <= 0.42 && coverage >= 0.72 && centered && inUpperBottle;
      const verticalCenterOffset = Math.abs((b.y + b.height / 2) - (a.y + a.height / 2));
      const sameFullBottle = coverage >= 0.68 && centerOffset <= Math.max(a.width, b.width) * 0.28
        && verticalCenterOffset <= Math.max(a.height, b.height) * 0.24;
      return nestedFragment || sameFullBottle;
    });
    if (!nested) kept.push(candidate);
  }
  return kept;
}

function iou(a: NormalizedBounds, b: NormalizedBounds): number {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Tracks bottle proposals produced locally by D-FINE, independently of cloud
 * label recognition. Strong first-frame detections are exposed immediately as
 * provisional boxes; weaker detections must repeat before becoming visible.
 * IDs remain stable across observations and brief detector misses.
 */
export class LocalBottleTracker {
  private tracks: Track[] = [];
  private nextId = 1_000_000;

  update(proposals: LocalBottleProposal[], now = Date.now()): LocalBottleCandidate[] {
    const detections = removeNestedBottleProposals(proposals)
      .filter(p => Number.isFinite(p.confidence) && p.confidence >= 0.58)
      .slice(0, 24);
    const used = new Set<number>();
    const next: Track[] = [];

    for (const detection of detections) {
      let bestIndex = -1;
      let bestScore = 0;
      this.tracks.forEach((track, index) => {
        // Retain brief occlusion recovery, but never let an old object donate
        // its ID to a different bottle entering the same position later.
        if (used.has(index) || now - track.lastSeenAt > 3_000) return;
        const overlap = iou(track.bounds, detection.bounds);
        const dx = track.bounds.x + track.bounds.width / 2 - (detection.bounds.x + detection.bounds.width / 2);
        const dy = track.bounds.y + track.bounds.height / 2 - (detection.bounds.y + detection.bounds.height / 2);
        const distance = Math.hypot(dx, dy);
        const score = overlap >= 0.08 ? overlap : distance <= 0.18 ? 0.08 * (1 - distance / 0.18) : 0;
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      });

      const previous = bestIndex >= 0 ? this.tracks[bestIndex] : undefined;
      if (bestIndex >= 0) used.add(bestIndex);
      // Keep a little temporal smoothing while responding quickly to camera motion.
      const blend = previous ? 0.60 : 1;
      const bounds = previous ? {
        x: previous.bounds.x * (1 - blend) + detection.bounds.x * blend,
        y: previous.bounds.y * (1 - blend) + detection.bounds.y * blend,
        width: previous.bounds.width * (1 - blend) + detection.bounds.width * blend,
        height: previous.bounds.height * (1 - blend) + detection.bounds.height * blend,
      } : detection.bounds;
      next.push({
        trackId: previous?.trackId ?? this.nextId++,
        bounds,
        confidence: detection.confidence,
        contour: detection.contour,
        hits: (previous?.hits ?? 0) + 1,
        misses: 0,
        lastSeenAt: now,
      });
    }

    this.tracks.forEach((track, index) => {
      if (!used.has(index) && now - track.lastSeenAt <= 30_000) {
        next.push({ ...track, misses: track.misses + 1 });
      }
    });
    this.tracks = next;

    return next
      .filter(track =>
        now - track.lastSeenAt <= 8_000 &&
        (track.hits >= 2 || (track.hits === 1 && track.confidence >= 0.72)) &&
        track.misses <= 1,
      )
      .map(({ trackId, bounds, confidence, contour, hits }) => ({ trackId, bounds, confidence, contour, hits }));
  }

  applyOpticalFlow(updates: Array<{ trackId: number; bounds: NormalizedBounds }>): void {
    const byId = new Map(updates.map(update => [update.trackId, update.bounds]));
    this.tracks = this.tracks.map(track => {
      const bounds = byId.get(track.trackId);
      if (!bounds) return track;
      const dx = bounds.x - track.bounds.x;
      const dy = bounds.y - track.bounds.y;
      return {
        ...track,
        bounds,
        contour: track.contour?.map(point => ({ x: point.x + dx, y: point.y + dy })),
      };
    });
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1_000_000;
  }
}
