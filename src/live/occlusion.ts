/**
 * Partial evidence, step 3 (Rob, 17 Nov 2026): which boxes show only part of a label.
 *
 * A bottle standing behind a nearer one, or cut off by the edge of the picture, shows part of its label. Its
 * label reads are clues: they are pooled for "Probably …", they cannot confirm a name on their own, and the box
 * keeps being re-read as the phone moves and more of the label comes into view.
 *
 * The detector draws a box around the part of a bottle it can see, so a bottle behind another often has a box
 * that only touches the nearer one; touching counts as well as overlapping. "Nearer" means its base sits lower
 * in the picture (it stands in front), or, at the same height, it is clearly bigger.
 */
import { labelRect } from './boxDepth';

export type OcclusionBox = { trackId: number; x: number; y: number; width: number; height: number };
export type Occlusion = {
  partial: boolean;
  /** Share of the label area covered by nearer boxes (0-1). */
  covered: number;
  /** The bottle runs into the left, right or bottom edge of the picture. */
  edgeCut: boolean;
  /** The nearer bottle hiding most of this one, if any. */
  occluderId: number | null;
};

export const OCCLUSION_RULES = Object.freeze({
  /** A bottle box within this of the picture's left, right or bottom edge is cut off. */
  edge: 0.006,
  /** A base this much lower in the picture stands in front. */
  nearerBase: 0.02,
  /** At about the same base, a box this much bigger is the nearer one. */
  nearerArea: 1.3,
  /** Share of the label hidden before reads count only as clues. */
  minCovered: 0.15,
  /** A nearer box this close beside it (and level with it) hides part of it. */
  touchGap: 0.012,
  touchOverlap: 0.5,
});

const area = (b: { width: number; height: number }) => Math.max(0, b.width) * Math.max(0, b.height);
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** True when `front` stands in front of `back`. */
export function isNearer(front: OcclusionBox, back: OcclusionBox, rules = OCCLUSION_RULES): boolean {
  const frontBase = front.y + front.height, backBase = back.y + back.height;
  if (frontBase > backBase + rules.nearerBase) return true;
  return Math.abs(frontBase - backBase) <= rules.nearerBase && area(front) > rules.nearerArea * area(back);
}

export function occlusionOf(target: OcclusionBox, others: OcclusionBox[], rules = OCCLUSION_RULES): Occlusion {
  const label = labelRect(target);
  const labelArea = Math.max(1e-6, area(label));
  // A box flush with the picture's side or bottom: the bottle carries on outside the picture.
  const edgeCut = target.x <= rules.edge || target.x + target.width >= 1 - rules.edge || target.y + target.height >= 1 - rules.edge;
  let covered = 0, occluderId: number | null = null, best = 0;
  for (const other of others) {
    if (other.trackId === target.trackId || !isNearer(other, target, rules)) continue;
    let share = overlap(label, other) / labelArea;
    // Right beside a bottle standing clearly in front (its base lower): this one carries on behind it.
    // (Two bottles side by side on one shelf have level bases and do not count.)
    const gap = Math.max(other.x - (target.x + target.width), target.x - (other.x + other.width));
    const levelWith = Math.max(0, Math.min(target.y + target.height, other.y + other.height) - Math.max(target.y, other.y)) / Math.max(1e-6, target.height);
    const inFront = other.y + other.height > target.y + target.height + rules.nearerBase;
    if (share < rules.minCovered && inFront && gap <= rules.touchGap && levelWith >= rules.touchOverlap) share = rules.minCovered;
    covered = Math.min(1, covered + share);
    if (share > best) { best = share; occluderId = other.trackId; }
  }
  return { partial: edgeCut || covered >= rules.minCovered, covered, edgeCut, occluderId };
}

/** Occlusion for every box against all the others. */
export function occlusionForAll(boxes: OcclusionBox[], rules = OCCLUSION_RULES): Map<number, Occlusion> {
  return new Map(boxes.map(box => [box.trackId, occlusionOf(box, boxes, rules)]));
}
