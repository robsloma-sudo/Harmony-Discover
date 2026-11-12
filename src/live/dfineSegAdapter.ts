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
  nmsIoUThreshold?: number;
  modelId?: string;
};

export type DfineSegOnnxOutput = {
  labels: ArrayLike<number | bigint>;
  boxes: ArrayLike<number>;
  scores: ArrayLike<number>;
  masks: Float32Array | Uint8Array;
  maskWidth: number;
  maskHeight: number;
};

function isFiniteArray(values: number[]): boolean {
  return values.every(Number.isFinite);
}

function cropMask(
  mask: Float32Array | Uint8Array,
  maskWidth: number,
  maskHeight: number,
  imageWidth: number,
  imageHeight: number,
  bounds: { x: number; y: number; width: number; height: number },
  threshold: number,
): { data: Uint8Array; width: number; height: number } | null {
  const left = Math.max(0, Math.floor(bounds.x * imageWidth));
  const top = Math.max(0, Math.floor(bounds.y * imageHeight));
  const right = Math.min(imageWidth, Math.ceil((bounds.x + bounds.width) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil((bounds.y + bounds.height) * imageHeight));
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) return null;

  // Match the upstream ONNX wrapper's bilinear resize to original-image size
  // (align_corners=False), but allocate only the detection crop, not N full
  // frame masks. Thresholding then matches its default mask_threshold=0.5.
  const data = new Uint8Array(width * height);
  let foreground = 0;
  for (let y = 0; y < height; y++) {
    const sourceY = Math.max(0, Math.min(maskHeight - 1, (top + y + 0.5) * maskHeight / imageHeight - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(maskHeight - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < width; x++) {
      const sourceX = Math.max(0, Math.min(maskWidth - 1, (left + x + 0.5) * maskWidth / imageWidth - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(maskWidth - 1, x0 + 1);
      const fx = sourceX - x0;
      const p00 = Number(mask[y0 * maskWidth + x0]);
      const p01 = Number(mask[y0 * maskWidth + x1]);
      const p10 = Number(mask[y1 * maskWidth + x0]);
      const p11 = Number(mask[y1 * maskWidth + x1]);
      const topValue = p00 * (1 - fx) + p01 * fx;
      const bottomValue = p10 * (1 - fx) + p11 * fx;
      const value = topValue * (1 - fy) + bottomValue * fy;
      if (Number.isFinite(value) && value >= threshold) {
        data[y * width + x] = 1;
        foreground++;
      }
    }
  }
  return foreground >= 4 ? { data, width, height } : null;
}

/**
 * Converts D-FINE-seg ONNX outputs (labels [B,K], boxes [B,K,4], scores [B,K],
 * masks [B,K,Hm,Wm]) into cropped, normalized mask instances. This mirrors
 * the upstream wrapper's confidence filtering, bottle-class filtering,
 * xyxy rescaling, and NMS, while avoiding full-frame mask upsampling.
 *
 * Input preprocessing must be a direct resize to the ONNX input dimensions
 * (no letterbox). The source image's aspect ratio is restored by scaling x
 * and y independently into normalized camera coordinates.
 */
export function adaptDfineSegOnnxOutput(
  output: DfineSegOnnxOutput,
  imageWidth: number,
  imageHeight: number,
  inputWidth: number,
  inputHeight: number,
  sourceTimestampMs: number,
  options: DfineSegAdapterOptions = {},
): SegmentationInstance[] {
  const bottleClassIds = new Set(options.bottleClassIds ?? [39]);
  const minimumScore = options.minimumScore ?? 0.45;
  const maskThreshold = options.maskThreshold ?? 0.5;
  const nmsThreshold = options.nmsIoUThreshold ?? 0.7;
  const modelId = options.modelId ?? 'dfine-seg-coco-instance-onnx';
  const count = output.labels.length;
  if (![imageWidth, imageHeight, inputWidth, inputHeight, output.maskWidth, output.maskHeight].every(Number.isInteger) ||
      imageWidth < 2 || imageHeight < 2 || inputWidth < 2 || inputHeight < 2 ||
      output.maskWidth < 2 || output.maskHeight < 2 ||
      output.boxes.length !== count * 4 || output.scores.length !== count ||
      output.masks.length !== count * output.maskWidth * output.maskHeight ||
      !Number.isFinite(sourceTimestampMs)) return [];

  const candidates: Array<{
    index: number;
    label: number;
    score: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    bounds: { x: number; y: number; width: number; height: number };
  }> = [];

  for (let index = 0; index < count; index++) {
    const label = Number(output.labels[index]);
    const score = Number(output.scores[index]);
    if (!bottleClassIds.has(label) || !Number.isFinite(score) || score < minimumScore) continue;
    const raw = Array.from({ length: 4 }, (_, i) => Number(output.boxes[index * 4 + i]));
    if (!isFiniteArray(raw)) continue;
    const x1 = Math.max(0, Math.min(1, Math.min(raw[0]!, raw[2]!) / inputWidth));
    const y1 = Math.max(0, Math.min(1, Math.min(raw[1]!, raw[3]!) / inputHeight));
    const x2 = Math.max(0, Math.min(1, Math.max(raw[0]!, raw[2]!) / inputWidth));
    const y2 = Math.max(0, Math.min(1, Math.max(raw[1]!, raw[3]!) / inputHeight));
    if (x2 - x1 < 0.01 || y2 - y1 < 0.01) continue;
    candidates.push({ index, label, score, x1, y1, x2, y2, bounds: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
  }

  candidates.sort((a, b) => b.score - a.score);
  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const suppressed = kept.some(other => {
      if (candidate.label !== other.label) return false;
      const left = Math.max(candidate.x1, other.x1);
      const top = Math.max(candidate.y1, other.y1);
      const right = Math.min(candidate.x2, other.x2);
      const bottom = Math.min(candidate.y2, other.y2);
      const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
      const areaA = (candidate.x2 - candidate.x1) * (candidate.y2 - candidate.y1);
      const areaB = (other.x2 - other.x1) * (other.y2 - other.y1);
      const union = areaA + areaB - intersection;
      return union > 0 && intersection / union > nmsThreshold;
    });
    if (!suppressed) kept.push(candidate);
  }

  const instances: SegmentationInstance[] = [];
  for (const candidate of kept) {
    const maskStart = candidate.index * output.maskWidth * output.maskHeight;
    const mask = output.masks.subarray(maskStart, maskStart + output.maskWidth * output.maskHeight);
    const cropped = cropMask(mask, output.maskWidth, output.maskHeight, imageWidth, imageHeight, candidate.bounds, maskThreshold);
    if (!cropped) continue;
    instances.push({
      width: cropped.width,
      height: cropped.height,
      data: cropped.data,
      bounds: candidate.bounds,
      confidence: candidate.score,
      sourceTimestampMs,
      modelId,
    });
  }
  return instances;
}

/**
 * Converts the documented D-FINE-seg wrapper output contract into provider-
 * neutral instances. Wrapper outputs are already rescaled to original image
 * size and masks are [N,H,W]. Prefer adaptDfineSegOnnxOutput for raw browser
 * ONNX tensors.
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

    const crop = new Uint8Array(width * height);
    let foregroundPixels = 0;
    const sourceOffset = index * imageWidth * imageHeight;
    for (let y = 0; y < height; y++) {
      const sourceRow = sourceOffset + (top + y) * imageWidth + left;
      const targetRow = y * width;
      for (let x = 0; x < width; x++) {
        const value = Number(output.masks[sourceRow + x]);
        if (Number.isFinite(value) && value >= maskThreshold) {
          crop[targetRow + x] = 1;
          foregroundPixels++;
        }
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
