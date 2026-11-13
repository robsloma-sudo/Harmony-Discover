import type { BottleRead } from "./discoverLiveApi";

export type BottleCandidateGeometry = {
  trackId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bottle?: BottleRead;
};

type NormalizedBox = { x0: number; y0: number; x1: number; y1: number };

function candidateBox(candidate: BottleCandidateGeometry): NormalizedBox {
  return {
    x0: candidate.x,
    y0: candidate.y,
    x1: candidate.x + candidate.width,
    y1: candidate.y + candidate.height,
  };
}

export function normalizedBoxIoU(a: NormalizedBox, b: NormalizedBox): number {
  const left = Math.max(a.x0, b.x0);
  const top = Math.max(a.y0, b.y0);
  const right = Math.min(a.x1, b.x1);
  const bottom = Math.min(a.y1, b.y1);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const areaA = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const areaB = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Associates recognition reads to visual tracks using normalized image-space
 * overlap. Assignment is one-to-one: one OCR result cannot identify two
 * different tracked objects in the same update.
 *
 * A track-provided bottle is authoritative and is never replaced by a
 * geometrically nearby read.
 */
export function attachBottleReadsToCandidates<T extends BottleCandidateGeometry>(
  candidates: T[],
  bottles: BottleRead[],
  minimumIoU = 0.25,
): Array<T & { bottle?: BottleRead }> {
  const result = candidates.map(candidate => ({ ...candidate }));
  const usedBottleIndexes = new Set<number>();

  result.forEach(candidate => {
    if (!candidate.bottle) return;
    let bestIndex = -1;
    let bestScore = 0;
    bottles.forEach((bottle, index) => {
      if (usedBottleIndexes.has(index)) return;
      const score = normalizedBoxIoU(candidateBox(candidate), bottle.box);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestScore >= minimumIoU) usedBottleIndexes.add(bestIndex);
  });

  const pairs: Array<{ candidateIndex: number; bottleIndex: number; score: number }> = [];
  result.forEach((candidate, candidateIndex) => {
    if (candidate.bottle) return;
    bottles.forEach((bottle, bottleIndex) => {
      if (usedBottleIndexes.has(bottleIndex)) return;
      const score = normalizedBoxIoU(candidateBox(candidate), bottle.box);
      if (score >= minimumIoU) pairs.push({ candidateIndex, bottleIndex, score });
    });
  });

  pairs.sort((a, b) => b.score - a.score);
  const usedCandidateIndexes = new Set<number>();
  for (const pair of pairs) {
    if (usedCandidateIndexes.has(pair.candidateIndex) || usedBottleIndexes.has(pair.bottleIndex)) continue;
    result[pair.candidateIndex].bottle = bottles[pair.bottleIndex];
    usedCandidateIndexes.add(pair.candidateIndex);
    usedBottleIndexes.add(pair.bottleIndex);
  }

  return result;
}
