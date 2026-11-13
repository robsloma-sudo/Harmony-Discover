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
 * label recognition. IDs occupy a separate range from cloud-created tracks.
 * Candidates are exposed only after two observations to suppress single-frame
 * false positives; their identity remains explicitly unknown until OCR matches.
 */
export class LocalBottleTracker {
  private tracks: Track[] = [];
  private nextId = 1_000_000;

  update(proposals: LocalBottleProposal[], now = Date.now()): LocalBottleCandidate[] {
    const detections = proposals
      .filter(p => Number.isFinite(p.confidence) && p.confidence >= 0.58 && validBounds(p.bounds))
      .slice(0, 12);
    const used = new Set<number>();
    const next: Track[] = [];

    for (const detection of detections) {
      let bestIndex = -1;
      let bestScore = 0;
      this.tracks.forEach((track, index) => {
        if (used.has(index)) return;
        const overlap = iou(track.bounds, detection.bounds);
        const dx = track.bounds.x + track.bounds.width / 2 - (detection.bounds.x + detection.bounds.width / 2);
        const dy = track.bounds.y + track.bounds.height / 2 - (detection.bounds.y + detection.bounds.height / 2);
        const distance = Math.hypot(dx, dy);
        const score = overlap >= 0.08 ? overlap : distance <= 0.12 ? 0.08 * (1 - distance / 0.12) : 0;
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      });

      const previous = bestIndex >= 0 ? this.tracks[bestIndex] : undefined;
      if (bestIndex >= 0) used.add(bestIndex);
      const blend = previous ? 0.45 : 1;
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
      if (!used.has(index) && now - track.lastSeenAt <= 8_000) {
        next.push({ ...track, misses: track.misses + 1 });
      }
    });
    this.tracks = next;

    return next
      .filter(track => track.hits >= 2 && track.misses <= 1 && now - track.lastSeenAt <= 8_000)
      .map(({ trackId, bounds, confidence, contour, hits }) => ({ trackId, bounds, confidence, contour, hits }));
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1_000_000;
  }
}
