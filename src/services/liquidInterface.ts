/**
 * Liquid-interface evidence contract and temporal consensus gate.
 *
 * This module does not find liquid lines in images. It filters detections
 * supplied by a future vision model and refuses to emit a usable height when
 * evidence is weak, occluded, duplicated, or temporally unstable.
 */
export type LiquidLineObservation = {
  frameId: string;
  /** Vertical liquid boundary in normalized bottle-body coordinates, 0..1. */
  normalizedHeight: number;
  /** Detector confidence, not bottle/product identity confidence. */
  confidence: number;
  /** True when label, hand, glare, or another obstruction masks the boundary. */
  occluded?: boolean;
};

export type LiquidInterfaceConsensus =
  | { status: 'visible'; normalizedHeight: number; confidence: number; frameIds: string[]; method: 'median_temporal_consensus' }
  | { status: 'insufficient_evidence' | 'occluded' | 'ambiguous'; reason: string; frameIds: string[] };

export function assessLiquidInterface(
  observations: LiquidLineObservation[],
  options: { minFrames?: number; minConfidence?: number; maxSpread?: number } = {},
): LiquidInterfaceConsensus {
  const minFrames = options.minFrames ?? 3;
  const minConfidence = options.minConfidence ?? 0.7;
  const maxSpread = options.maxSpread ?? 0.035;
  if (!Number.isInteger(minFrames) || minFrames < 1 ||
      !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1 ||
      !Number.isFinite(maxSpread) || maxSpread < 0 || maxSpread > 1) {
    throw new Error('Invalid liquid-interface consensus thresholds.');
  }
  if (!Array.isArray(observations) || observations.length === 0) {
    return { status: 'insufficient_evidence', reason: 'No liquid-interface observations.', frameIds: [] };
  }
  const unique = new Map<string, LiquidLineObservation>();
  for (const item of observations) {
    if (!item || typeof item.frameId !== 'string' || !item.frameId.trim() ||
        !Number.isFinite(item.normalizedHeight) || item.normalizedHeight < 0 || item.normalizedHeight > 1 ||
        !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      continue;
    }
    if (!unique.has(item.frameId) || unique.get(item.frameId)!.confidence < item.confidence) {
      unique.set(item.frameId, item);
    }
  }
  const valid = [...unique.values()];
  const frameIds = valid.map(item => item.frameId);
  if (valid.length < minFrames) {
    return { status: 'insufficient_evidence', reason: 'Not enough distinct, valid frames.', frameIds };
  }
  const visible = valid.filter(item => !item.occluded && item.confidence >= minConfidence);
  if (visible.length < minFrames) {
    const allOccluded = valid.every(item => item.occluded);
    return {
      status: allOccluded ? 'occluded' : 'insufficient_evidence',
      reason: allOccluded ? 'Liquid boundary is occluded.' : 'Too few high-confidence visible observations.',
      frameIds,
    };
  }
  const heights = visible.map(item => item.normalizedHeight).sort((a, b) => a - b);
  const middle = Math.floor(heights.length / 2);
  const median = heights.length % 2 === 0
    ? (heights[middle - 1] + heights[middle]) / 2
    : heights[middle];
  const spread = heights[heights.length - 1] - heights[0];
  if (spread > maxSpread) {
    return { status: 'ambiguous', reason: 'Liquid boundary is unstable across frames.', frameIds: visible.map(item => item.frameId) };
  }
  const confidence = visible.reduce((sum, item) => sum + item.confidence, 0) / visible.length;
  return {
    status: 'visible',
    normalizedHeight: median,
    confidence,
    frameIds: visible.map(item => item.frameId),
    method: 'median_temporal_consensus',
  };
}
