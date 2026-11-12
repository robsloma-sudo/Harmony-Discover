import type { SegmentationInstance } from './segmentationEngine';

export type DfineSegOutput = {
  labels: ArrayLike<number | bigint>;
  boxes: ArrayLike<number>;
  scores: ArrayLike<number>;
  masks: Uint8Array | Float32Array;
  maskWidth: number;
  maskHeight: number;
};

export type DfineSegAdapterOptions = {
  bottleClassIds?: number[];
  maskThreshold?: number;
  minimumScore?: number;
  modelId?: string;
};

/**
 * Converts the documented D-FINE-seg wrapper output contract into the
 * provider-neutral mask instances used by segmentationEngine.
 *
 * D-FINE-seg returns boxes as absolute xyxy coordinates and masks as
 * [N,H,W] at original-image resolution. We crop each mask to its matching
 * box so extractMaskContour can map crop pixels back through that normalized
 * box. This function does not run model inference or decode raw ONNX heads.
 */
export function adaptDfineSegOutput(
  output: DfineSegOutput,
  imageWidth: number,
  imageHeight: number,
  sourceTimestampMs: number,
  options: DfineSegAdapterOptions = {},
): SegmentationInstance[] {
  const bottleClassIds = new Set(options.bottleClassIds ?? [39]);
  const minimumScore = options.minimumScore ?? 0.45;
  const maskThreshold = options.maskThreshold ?? 0.5;
  const modelId = options.modelId ?? 'dfine-seg-coco-instance';
  const count = output.labels.length;

  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) ||
      imageWidth < 2 || imageHeight < 2 ||
      !Number.isInteger(output.maskWidth) || !Number.isInteger(output.maskHeight) ||
      output.maskWidth !== imageWidth || output.maskHeight !== imageHeight ||
      output.boxes.length !== count * 4 || output.scores.length !== count ||
      output.masks.length !== count * imageWidth * imageHeight ||
      !Number.isFinite(sourceTimestampMs)) return [];

  const instances: SegmentationInstance[] = [];
  for (let index = 0; index < count; index++) {
    const label = Number(output.labels[index]);
    const score = Number(output.scores[index]);
    if (!bottleClassIds.has(label) || !Number.isFinite(score) || score < minimumScore) continue;

    const x1 = Number(output.boxes[index * 4]);
    const y1 = Number(output.boxes[index * 4 + 1]);
    const x2 = Number(output.boxes[index * 4 + 2]);
    const y2 = Number(output.boxes[index * 4 + 3]);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

    const left = Math.max(0, Math.floor(Math.min(x1, x2)));
    const top = Math.max(0, Math.floor(Math.min(y1, y2)));
    const right = Math.min(imageWidth, Math.ceil(Math.max(x1, x2)));
    const bottom = Math.min(imageHeight, Math.ceil(Math.max(y1, y2)));
    const width = right - left;
    const height = bottom - top;
    if (width < 2 || height < 2) continue;

    const crop = new Float32Array(width * height);
    let foregroundPixels = 0;
    const sourceOffset = index * imageWidth * imageHeight;
    for (let y = 0; y < height; y++) {
      const sourceRow = sourceOffset + (top + y) * imageWidth + left;
      const targetRow = y * width;
      for (let x = 0; x < width; x++) {
        const value = Number(output.masks[sourceRow + x]);
        if (!Number.isFinite(value)) continue;
        crop[targetRow + x] = value;
        if (value >= maskThreshold) foregroundPixels++;
      }
    }
    if (foregroundPixels < 4) continue;

    instances.push({
      width,
      height,
      data: crop,
      bounds: {
        x: left / imageWidth,
        y: top / imageHeight,
        width: width / imageWidth,
        height: height / imageHeight,
      },
      confidence: score,
      sourceTimestampMs,
      modelId,
    });
  }
  return instances;
}
