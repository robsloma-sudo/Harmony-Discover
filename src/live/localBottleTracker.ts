import type { NormalizedPoint, NormalizedBounds } from './maskContour';
import { appearanceSimilarity, blendAppearance, type AppearanceSignature } from './appearanceSignature';
import { applyMotionToBox, applyMotionToPoint, clipBoxToFrame, visibleFraction, type CameraMotion } from './cameraMotion';

export type LocalBottleProposal = {
  bounds: NormalizedBounds;
  confidence: number;
  contour?: NormalizedPoint[];
  /** Colour fingerprint of the label area, used to re-find remembered bottles. */
  appearance?: AppearanceSignature | null;
};

export type LocalBottleCandidate = {
  trackId: number;
  bounds: NormalizedBounds;
  confidence: number;
  contour?: NormalizedPoint[];
  hits: number;
  /** Shown from memory: the camera came back and the detector has not re-found it yet. */
  remembered?: boolean;
};

type Track = {
  trackId: number;
  bounds: NormalizedBounds;
  confidence: number;
  contour?: NormalizedPoint[];
  hits: number;
  misses: number;
  lastSeenAt: number;
  appearance?: AppearanceSignature;
  /** The bottle left the visible frame after it was last detected. */
  leftView: boolean;
  /** When a remembered bottle came back into view; cleared when it leaves again. */
  returnedAt?: number;
};

/** How long a bottle that left the view is remembered. */
export const REMEMBERED_BOTTLE_RETENTION_MS = 10 * 60_000;
/** How long a remembered bottle is shown on return before the detector must confirm it. */
const RETURN_GRACE_MS = 1_500;
const MAX_TRACKS = 160;

const validBounds = (b: NormalizedBounds) =>
  [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
  b.x >= 0 && b.y >= 0 && b.width >= 0.015 && b.height >= 0.025 &&
  b.x + b.width <= 1.001 && b.y + b.height <= 1.001;

const area = (b: NormalizedBounds) => b.width * b.height;
const centerOf = (b: NormalizedBounds) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

function intersectionArea(a: NormalizedBounds, b: NormalizedBounds): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
}

function iou(a: NormalizedBounds, b: NormalizedBounds): number {
  const intersection = intersectionArea(a, b);
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * True when `child` is a part of the bottle `parent` rather than a separate
 * bottle: a neck, cork, capsule or shoulder box in the upper bottle, or a
 * label/body box lying inside the bottle silhouette.
 */
export function isNestedBottlePart(parent: NormalizedBounds, child: NormalizedBounds): boolean {
  const parentArea = area(parent), childArea = area(child);
  if (!(parentArea > 0) || !(childArea > 0) || childArea > parentArea * 0.6) return false;
  if (child.width > parent.width * 1.05) return false;
  const coverage = intersectionArea(parent, child) / childArea;
  const centerOffset = Math.abs(centerOf(child).x - centerOf(parent).x);
  const upperPart = coverage >= 0.6
    && centerOffset <= parent.width * 0.4
    && centerOf(child).y <= parent.y + parent.height * 0.62;
  const innerPart = coverage >= 0.85
    && centerOffset <= parent.width * 0.25
    && childArea <= parentArea * 0.5;
  return upperPart || innerPart;
}

/** Two boxes of similar size describing the same whole bottle. */
function isSameWholeBottle(a: NormalizedBounds, b: NormalizedBounds): boolean {
  const smaller = Math.min(area(a), area(b));
  if (!(smaller > 0)) return false;
  const coverage = intersectionArea(a, b) / smaller;
  const ca = centerOf(a), cb = centerOf(b);
  return coverage >= 0.68
    && Math.abs(ca.x - cb.x) <= Math.max(a.width, b.width) * 0.28
    && Math.abs(ca.y - cb.y) <= Math.max(a.height, b.height) * 0.24;
}

/** True when two boxes describe one physical bottle (whole, or a part of it). */
export function isSameBottle(a: NormalizedBounds, b: NormalizedBounds): boolean {
  if (iou(a, b) > 0.25 || isSameWholeBottle(a, b)) return true;
  return area(a) >= area(b) ? isNestedBottlePart(a, b) : isNestedBottlePart(b, a);
}

/**
 * Removes partial detections nested inside a larger bottle silhouette and
 * repeated proposals for one bottle. Keeps the larger physical-object box.
 */
export function removeNestedBottleProposals<T extends LocalBottleProposal>(proposals: T[]): T[] {
  const ordered = proposals
    .filter(p => validBounds(p.bounds))
    .slice()
    .sort((a, b) => (area(b.bounds) - area(a.bounds)) || (b.confidence - a.confidence));
  const kept: T[] = [];
  for (const candidate of ordered) {
    const nested = kept.some(parent => isNestedBottlePart(parent.bounds, candidate.bounds) || isSameWholeBottle(parent.bounds, candidate.bounds));
    if (!nested) kept.push(candidate);
  }
  return kept;
}

function associationScore(track: NormalizedBounds, detection: NormalizedBounds): number {
  const overlap = iou(track, detection);
  if (overlap >= 0.08) return overlap;
  const a = centerOf(track), b = centerOf(detection);
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  return distance <= 0.18 ? 0.08 * (1 - distance / 0.18) : 0;
}

const sizeCompatible = (a: NormalizedBounds, b: NormalizedBounds) => {
  const w = a.width / b.width, h = a.height / b.height;
  return w >= 0.55 && w <= 1.8 && h >= 0.55 && h <= 1.8;
};

/**
 * Tracks bottle proposals produced locally by D-FINE, independently of cloud
 * label recognition. Strong first-frame detections are shown immediately;
 * weaker ones must repeat.
 *
 * Bottles are remembered in camera space: every camera motion moves every
 * track, including bottles that have left the screen. When the camera comes
 * back, a remembered bottle reappears where it was and keeps its ID (and so
 * its name). Bottles that stay in view but stop being detected are dropped,
 * so a removed bottle never donates its ID to a different one.
 */
export class LocalBottleTracker {
  private tracks: Track[] = [];
  private nextId = 1_000_000;
  private merged: Array<{ from: number; to: number }> = [];
  private reacquired: number[] = [];

  update(proposals: LocalBottleProposal[], now = Date.now(), options: { countMisses?: boolean } = {}): LocalBottleCandidate[] {
    const countMisses = options.countMisses ?? true;
    const detections = removeNestedBottleProposals(proposals)
      .filter(p => Number.isFinite(p.confidence) && p.confidence >= 0.58)
      .slice(0, 24);
    const usedDetections = new Set<number>();
    const touched = new Set<Track>();

    const observe = (track: Track, detection: LocalBottleProposal, blend: number) => {
      track.bounds = {
        x: track.bounds.x * (1 - blend) + detection.bounds.x * blend,
        y: track.bounds.y * (1 - blend) + detection.bounds.y * blend,
        width: track.bounds.width * (1 - blend) + detection.bounds.width * blend,
        height: track.bounds.height * (1 - blend) + detection.bounds.height * blend,
      };
      track.confidence = detection.confidence;
      track.contour = detection.contour;
      track.hits += 1;
      track.misses = 0;
      track.lastSeenAt = now;
      track.leftView = false;
      track.returnedAt = undefined;
      track.appearance = blendAppearance(track.appearance, detection.appearance);
      touched.add(track);
    };

    // 1. Bottles followed continuously in view: best-overlap-first assignment.
    const pairs: Array<{ track: Track; index: number; score: number }> = [];
    for (const track of this.tracks) {
      if (track.leftView) continue;
      detections.forEach((detection, index) => {
        const score = associationScore(track.bounds, detection.bounds);
        if (score > 0) pairs.push({ track, index, score });
      });
    }
    pairs.sort((a, b) => b.score - a.score);
    for (const pair of pairs) {
      if (touched.has(pair.track) || usedDetections.has(pair.index)) continue;
      usedDetections.add(pair.index);
      // Light smoothing; detections are already moved to the current view.
      observe(pair.track, detections[pair.index]!, 0.6);
    }

    // 2. A neck/cork/label box inside a bottle already on screen is part of
    // that bottle: it confirms the bottle but never becomes a second box.
    detections.forEach((detection, index) => {
      if (usedDetections.has(index)) return;
      const parent = this.tracks.find(track => !track.leftView
        && visibleFraction(track.bounds) >= 0.5
        && isNestedBottlePart(track.bounds, detection.bounds));
      if (!parent) return;
      usedDetections.add(index);
      if (!touched.has(parent)) {
        parent.lastSeenAt = now;
        parent.misses = 0;
        touched.add(parent);
      }
    });

    // 3. Re-find remembered bottles that left the view and are back.
    this.reacquire(detections, usedDetections, touched, observe);

    // 4. New bottles.
    detections.forEach((detection, index) => {
      if (usedDetections.has(index)) return;
      const track: Track = {
        trackId: this.nextId++,
        bounds: detection.bounds,
        confidence: detection.confidence,
        contour: detection.contour,
        hits: 1,
        misses: 0,
        lastSeenAt: now,
        leftView: false,
        appearance: detection.appearance ?? undefined,
      };
      this.tracks.push(track);
      touched.add(track);
    });

    // 5. Misses only count where the detector could have seen the bottle.
    for (const track of this.tracks) {
      if (touched.has(track)) continue;
      if (countMisses && visibleFraction(track.bounds) >= 0.5) track.misses += 1;
    }
    const seenNow = this.tracks.filter(track => touched.has(track));
    this.tracks = this.tracks.filter(track => {
      const age = now - track.lastSeenAt;
      if (track.leftView) {
        // A different bottle now stands where this remembered one was.
        if (track.returnedAt !== undefined && seenNow.some(other => isSameBottle(other.bounds, track.bounds))) return false;
        // A remembered bottle the detector repeatedly cannot find where it
        // should be has gone (or was never real): forget it.
        if (track.returnedAt !== undefined && track.misses >= 4) return false;
        return age <= REMEMBERED_BOTTLE_RETENTION_MS;
      }
      const weak = track.hits === 1 && track.confidence < 0.72;
      if (weak && track.misses >= 1 && age > 1_500) return false;
      return !(track.misses >= 2 && age > 4_000) && age <= 20_000;
    });
    this.mergeDuplicateTracks();
    if (this.tracks.length > MAX_TRACKS) {
      const remembered = this.tracks.filter(track => track.leftView).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      const drop = new Set(remembered.slice(0, this.tracks.length - MAX_TRACKS));
      this.tracks = this.tracks.filter(track => !drop.has(track));
    }
    return this.visible(now);
  }

  /**
   * Remembered positions drift a little while the camera is away. Find the one
   * shift that lines up the most remembered bottles with new detections (a
   * shelf moves as a whole), then re-attach those bottles to their old IDs.
   */
  private reacquire(
    detections: LocalBottleProposal[],
    usedDetections: Set<number>,
    touched: Set<Track>,
    observe: (track: Track, detection: LocalBottleProposal, blend: number) => void,
  ): void {
    const remembered = this.tracks.filter(track => {
      if (!track.leftView || touched.has(track)) return false;
      const c = centerOf(track.bounds);
      return c.x >= -0.35 && c.x <= 1.35 && c.y >= -0.35 && c.y <= 1.35;
    });
    const open = detections.map((_, index) => index).filter(index => !usedDetections.has(index));
    if (!remembered.length || !open.length) return;

    type Pair = { track: Track; index: number; dx: number; dy: number; similarity: number | null };
    const candidates: Pair[] = [];
    for (const track of remembered) {
      const tc = centerOf(track.bounds);
      for (const index of open) {
        const detection = detections[index]!;
        if (!sizeCompatible(track.bounds, detection.bounds)) continue;
        const similarity = appearanceSimilarity(track.appearance, detection.appearance);
        if (similarity !== null && similarity < 0.55) continue;
        const dc = centerOf(detection.bounds);
        const dx = dc.x - tc.x, dy = dc.y - tc.y;
        if (Math.hypot(dx, dy) > 0.35) continue;
        candidates.push({ track, index, dx, dy, similarity });
      }
    }
    if (!candidates.length) return;

    const tolerance = 0.05;
    const consistentWith = (shift: Pair) => {
      const chosen: Pair[] = [];
      const tracks = new Set<Track>(), indexes = new Set<number>();
      candidates
        .map(pair => ({ pair, residual: Math.hypot(pair.dx - shift.dx, pair.dy - shift.dy) }))
        .filter(item => item.residual <= tolerance)
        .sort((a, b) => a.residual - b.residual)
        .forEach(({ pair }) => {
          if (tracks.has(pair.track) || indexes.has(pair.index)) return;
          tracks.add(pair.track); indexes.add(pair.index); chosen.push(pair);
        });
      return chosen;
    };
    let best: { shift: Pair; chosen: Pair[]; score: number } | null = null;
    for (const shift of candidates) {
      const chosen = consistentWith(shift);
      const known = chosen.map(pair => pair.similarity).filter((value): value is number => value !== null);
      const meanSimilarity = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : 0.6;
      const score = chosen.length * 10 + meanSimilarity * 2 - Math.hypot(shift.dx, shift.dy) * 3;
      if (!best || score > best.score) best = { shift, chosen, score };
    }
    if (!best) return;
    const single = best.chosen.length === 1 ? best.chosen[0]! : null;
    if (single) {
      const offset = Math.hypot(single.dx, single.dy);
      const strongLook = single.similarity !== null && single.similarity >= 0.7;
      // One bottle alone: accept only when it is where we expected it, or
      // clearly looks like the remembered bottle.
      if (!(offset <= 0.08 || (strongLook && offset <= 0.2) || (single.similarity === null && offset <= 0.12))) return;
    }
    for (const pair of best.chosen) {
      usedDetections.add(pair.index);
      observe(pair.track, detections[pair.index]!, 1);
      this.reacquired.push(pair.track.trackId);
    }
    if (best.chosen.length >= 2) {
      // The same drift applies to the rest of the remembered shelf.
      const dx = best.chosen.reduce((sum, pair) => sum + pair.dx, 0) / best.chosen.length;
      const dy = best.chosen.reduce((sum, pair) => sum + pair.dy, 0) / best.chosen.length;
      for (const track of remembered) {
        if (touched.has(track)) continue;
        track.bounds = { ...track.bounds, x: track.bounds.x + dx, y: track.bounds.y + dy };
        track.contour = track.contour?.map(point => ({ x: point.x + dx, y: point.y + dy }));
      }
    }
  }

  /** A neck box tracked on its own before the whole bottle was seen merges into the bottle. */
  private mergeDuplicateTracks(): void {
    const ordered = this.tracks
      .filter(track => !track.leftView && visibleFraction(track.bounds) >= 0.5)
      .sort((a, b) => area(b.bounds) - area(a.bounds));
    const removed = new Set<Track>();
    for (let i = 0; i < ordered.length; i++) {
      const parent = ordered[i]!;
      if (removed.has(parent)) continue;
      for (let j = i + 1; j < ordered.length; j++) {
        const child = ordered[j]!;
        if (removed.has(child)) continue;
        if (!isNestedBottlePart(parent.bounds, child.bounds) && !isSameWholeBottle(parent.bounds, child.bounds)) continue;
        // Keep the older identity (it is the one a name may be attached to)
        // on the whole-bottle geometry.
        const keepChildId = child.trackId < parent.trackId && child.hits >= 2;
        if (keepChildId) {
          this.merged.push({ from: parent.trackId, to: child.trackId });
          parent.trackId = child.trackId;
        } else {
          this.merged.push({ from: child.trackId, to: parent.trackId });
        }
        parent.hits = Math.max(parent.hits, child.hits);
        parent.lastSeenAt = Math.max(parent.lastSeenAt, child.lastSeenAt);
        removed.add(child);
      }
    }
    if (removed.size) this.tracks = this.tracks.filter(track => !removed.has(track));
  }

  /** Bottles to draw now: in view, confirmed, and either recently detected or just back from memory. */
  visible(now = Date.now()): LocalBottleCandidate[] {
    return this.tracks
      .filter(track => {
        if (visibleFraction(track.bounds) < 0.5) return false;
        const confirmed = track.hits >= 2 || (track.hits === 1 && track.confidence >= 0.72);
        if (!confirmed) return false;
        if (!track.leftView) {
          return now - track.lastSeenAt <= 8_000 && !(track.misses >= 2 && now - track.lastSeenAt > 1_200);
        }
        return track.returnedAt !== undefined && now - track.returnedAt <= RETURN_GRACE_MS && track.misses <= 2;
      })
      .map(track => {
        const candidate: LocalBottleCandidate = {
          trackId: track.trackId,
          bounds: clipBoxToFrame(track.bounds),
          confidence: track.confidence,
          contour: track.contour,
          hits: track.hits,
        };
        if (track.leftView) candidate.remembered = true;
        return candidate;
      });
  }

  /** Moves every bottle, on screen or remembered off screen, with the camera. */
  applyCameraMotion(motion: CameraMotion, now = Date.now()): void {
    if (![motion.tx, motion.ty, motion.scale].every(Number.isFinite) || motion.scale <= 0) return;
    for (const track of this.tracks) {
      track.bounds = applyMotionToBox(track.bounds, motion);
      track.contour = track.contour?.map(point => applyMotionToPoint(point, motion));
      const fraction = visibleFraction(track.bounds);
      if (fraction < 0.3) {
        track.leftView = true;
        track.returnedAt = undefined;
      } else if (track.leftView && fraction >= 0.5 && track.returnedAt === undefined) {
        track.returnedAt = now;
        track.misses = 0;
      }
    }
  }

  /** Per-bottle refinement on top of camera motion (parallax of near bottles). */
  applyOpticalFlow(updates: Array<{ trackId: number; bounds: NormalizedBounds }>): void {
    const byId = new Map(updates.map(update => [update.trackId, update.bounds]));
    for (const track of this.tracks) {
      const bounds = byId.get(track.trackId);
      if (!bounds) continue;
      const dx = bounds.x - track.bounds.x;
      const dy = bounds.y - track.bounds.y;
      track.bounds = bounds;
      track.contour = track.contour?.map(point => ({ x: point.x + dx, y: point.y + dy }));
    }
  }

  /** Small per-bottle shifts on top of camera motion (normalized units). */
  nudgeTracks(nudges: Array<{ trackId: number; dx: number; dy: number }>): void {
    const byId = new Map(nudges.map(nudge => [nudge.trackId, nudge]));
    for (const track of this.tracks) {
      const nudge = byId.get(track.trackId);
      if (!nudge || !Number.isFinite(nudge.dx) || !Number.isFinite(nudge.dy)) continue;
      track.bounds = { ...track.bounds, x: track.bounds.x + nudge.dx, y: track.bounds.y + nudge.dy };
      track.contour = track.contour?.map(point => ({ x: point.x + nudge.dx, y: point.y + nudge.dy }));
    }
  }

  /** IDs merged since the last call ({ from } now lives on as { to }). */
  takeMergedTrackIds(): Array<{ from: number; to: number }> {
    const merged = this.merged;
    this.merged = [];
    return merged;
  }

  /** IDs re-attached from memory since the last call; their names should be re-checked once. */
  takeReacquiredTrackIds(): number[] {
    const reacquired = this.reacquired;
    this.reacquired = [];
    return reacquired;
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1_000_000;
    this.merged = [];
    this.reacquired = [];
  }
}
