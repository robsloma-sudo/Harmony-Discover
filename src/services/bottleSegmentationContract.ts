/**
 * Typed contract for a future on-device bottle instance-segmentation model.
 *
 * This validates structured model output only. It does not run inference,
 * generate masks, or turn generic rectangles into bottle instances.
 */
export type NormalizedPoint = { x: number; y: number };
export type BottleSegmentationCandidate = {
  /** Stable only for the current live scan session; not a product/SKU ID. */
  trackId: string;
  frameId: string;
  classLabel: 'bottle';
  classConfidence: number;
  /** Polygon contour in normalized, orientation-corrected image coordinates. */
  mask: NormalizedPoint[];
  /** Model-provided mask quality/confidence, distinct from class confidence. */
  maskConfidence: number;
  /** Optional detector/model version for reproducibility. */
  modelVersion: string;
};
export type BottleSegmentationValidation =
  | { status: 'valid'; candidate: BottleSegmentationCandidate; maskArea: number }
  | { status: 'invalid'; reason: string };

export function validateBottleSegmentationCandidate(
  candidate: BottleSegmentationCandidate,
  options: { minClassConfidence?: number; minMaskConfidence?: number; minVertices?: number; maxVertices?: number } = {},
): BottleSegmentationValidation {
  const minClassConfidence = options.minClassConfidence ?? 0.75;
  const minMaskConfidence = options.minMaskConfidence ?? 0.75;
  const minVertices = options.minVertices ?? 8;
  const maxVertices = options.maxVertices ?? 512;
  if (!Number.isFinite(minClassConfidence) || minClassConfidence < 0 || minClassConfidence > 1 ||
      !Number.isFinite(minMaskConfidence) || minMaskConfidence < 0 || minMaskConfidence > 1 ||
      !Number.isInteger(minVertices) || minVertices < 3 ||
      !Number.isInteger(maxVertices) || maxVertices < minVertices) {
    throw new Error('Invalid segmentation validation thresholds.');
  }
  if (!candidate || candidate.classLabel !== 'bottle') return { status: 'invalid', reason: 'Candidate is not explicitly classified as a bottle.' };
  if (!candidate.trackId?.trim() || !candidate.frameId?.trim() || !candidate.modelVersion?.trim()) {
    return { status: 'invalid', reason: 'Track ID, frame ID and model version are required.' };
  }
  if (!Number.isFinite(candidate.classConfidence) || candidate.classConfidence < minClassConfidence || candidate.classConfidence > 1) {
    return { status: 'invalid', reason: 'Bottle-class confidence is below threshold or malformed.' };
  }
  if (!Number.isFinite(candidate.maskConfidence) || candidate.maskConfidence < minMaskConfidence || candidate.maskConfidence > 1) {
    return { status: 'invalid', reason: 'Instance-mask confidence is below threshold or malformed.' };
  }
  if (!Array.isArray(candidate.mask) || candidate.mask.length < minVertices || candidate.mask.length > maxVertices) {
    return { status: 'invalid', reason: 'Instance mask has an invalid vertex count.' };
  }
  if (candidate.mask.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
    return { status: 'invalid', reason: 'Mask coordinates must be finite normalized image coordinates.' };
  }
  let twiceArea = 0;
  for (let i = 0; i < candidate.mask.length; i += 1) {
    const current = candidate.mask[i];
    const next = candidate.mask[(i + 1) % candidate.mask.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  const maskArea = Math.abs(twiceArea) / 2;
  if (maskArea < 0.0005 || maskArea > 0.98) {
    return { status: 'invalid', reason: 'Mask area is implausible for a visible bottle instance.' };
  }
  return { status: 'valid', candidate, maskArea };
}
