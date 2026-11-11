/**
 * Temporal container-classification evidence gate.
 * Consumes predictions from a future on-device vision model; it does not
 * classify pixels itself. Generic rectangle candidates are never bottles
 * unless an actual classifier supplies repeated bottle evidence.
 */
export type ContainerClass = 'bottle' | 'non_bottle' | 'unknown';
export type ContainerClassificationObservation = {
  frameId: string;
  classification: ContainerClass;
  confidence: number;
};
export type ContainerClassificationResult =
  | { status: 'confirmed_bottle'; classification: 'bottle'; confidence: number; frameIds: string[] }
  | { status: 'rejected_bottle'; classification: 'non_bottle'; confidence: number; frameIds: string[] }
  | { status: 'unresolved'; classification: 'unknown'; reason: string; frameIds: string[] };

export function assessContainerClassification(
  observations: ContainerClassificationObservation[],
  options: { minFrames?: number; minConfidence?: number; minAgreement?: number } = {},
): ContainerClassificationResult {
  const minFrames = options.minFrames ?? 3;
  const minConfidence = options.minConfidence ?? 0.75;
  const minAgreement = options.minAgreement ?? 0.67;
  if (!Number.isInteger(minFrames) || minFrames < 1 ||
      !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1 ||
      !Number.isFinite(minAgreement) || minAgreement <= 0.5 || minAgreement > 1) {
    throw new Error('Invalid container consensus thresholds.');
  }
  if (!Array.isArray(observations) || observations.length === 0) {
    return { status: 'unresolved', classification: 'unknown', reason: 'No classifier observations.', frameIds: [] };
  }
  const byFrame = new Map<string, ContainerClassificationObservation>();
  for (const item of observations) {
    if (!item || typeof item.frameId !== 'string' || !item.frameId.trim() ||
        !['bottle', 'non_bottle', 'unknown'].includes(item.classification) ||
        !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) continue;
    const previous = byFrame.get(item.frameId);
    if (!previous || item.confidence > previous.confidence) byFrame.set(item.frameId, item);
  }
  const valid = [...byFrame.values()].filter(item => item.confidence >= minConfidence && item.classification !== 'unknown');
  const frameIds = valid.map(item => item.frameId);
  if (valid.length < minFrames) {
    return { status: 'unresolved', classification: 'unknown', reason: 'Insufficient distinct high-confidence classifier frames.', frameIds };
  }
  const bottles = valid.filter(item => item.classification === 'bottle');
  const nonBottles = valid.filter(item => item.classification === 'non_bottle');
  const winner = bottles.length >= nonBottles.length ? bottles : nonBottles;
  const agreement = winner.length / valid.length;
  if (agreement < minAgreement || bottles.length === nonBottles.length) {
    return { status: 'unresolved', classification: 'unknown', reason: 'Classifier evidence does not agree across frames.', frameIds };
  }
  const confidence = winner.reduce((sum, item) => sum + item.confidence, 0) / winner.length;
  return winner === bottles
    ? { status: 'confirmed_bottle', classification: 'bottle', confidence, frameIds: bottles.map(item => item.frameId) }
    : { status: 'rejected_bottle', classification: 'non_bottle', confidence, frameIds: nonBottles.map(item => item.frameId) };
}
