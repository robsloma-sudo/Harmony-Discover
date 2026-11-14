import type { NormalizedBounds, MaskContour } from './maskContour';
import { extractMaskContour } from './maskContour';

export type SegmentationSeed = {
  trackId: number;
  bounds: NormalizedBounds;
  detectionConfidence: number;
  sourceTimestampMs: number;
};

export type SegmentationInstance = {
  width: number;
  height: number;
  data: Uint8Array | Float32Array;
  bounds: NormalizedBounds;
  detectionConfidence: number;
  sourceTimestampMs: number;
  modelId: string;
};

export type SegmentedTrack = {
  trackId: number;
  contour: MaskContour;
  detectionConfidence: number;
  modelId: string;
  sourceTimestampMs: number;
  maskBounds: NormalizedBounds;
};

export type SegmentationProvider = {
  readonly modelId: string;
  infer(frame: ImageData, sourceTimestampMs: number): Promise<SegmentationInstance[]>;
  dispose?(): Promise<void> | void;
};

export type SegmentationPolicy = {
  minimumDetectionConfidence?: number;
  minimumIoU?: number;
  ambiguityMargin?: number;
  maximumTimestampDeltaMs?: number;
  minimumMaskPixels?: number;
  minimumMaskArea?: number;
  maxContourPoints?: number;
};

const finite = (value: number) => Number.isFinite(value);
const validBounds = (b: NormalizedBounds) =>
  finite(b.x) && finite(b.y) && finite(b.width) && finite(b.height) &&
  b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 &&
  b.x + b.width <= 1.001 && b.y + b.height <= 1.001;

export function normalizedIoU(a: NormalizedBounds, b: NormalizedBounds): number {
  if (!validBounds(a) || !validBounds(b)) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Associates model masks to persistent visual bottle tracks conservatively.
 * Ambiguous, stale, malformed, and low-confidence masks are rejected. Each
 * mask and track can be consumed at most once per frame.
 */
export function associateInstanceMasks(
  seeds: SegmentationSeed[],
  instances: SegmentationInstance[],
  policy: SegmentationPolicy = {},
): SegmentedTrack[] {
  const minimumDetectionConfidence = policy.minimumDetectionConfidence ?? 0.55;
  const minimumIoU = policy.minimumIoU ?? 0.35;
  const ambiguityMargin = policy.ambiguityMargin ?? 0.08;
  const maximumTimestampDeltaMs = policy.maximumTimestampDeltaMs ?? 200;
  const usedTracks = new Set<number>();
  const usedInstances = new Set<number>();
  const output: SegmentedTrack[] = [];

  const eligibleSeeds = seeds.filter(seed =>
    Number.isInteger(seed.trackId) && seed.trackId > 0 &&
    seed.detectionConfidence >= minimumDetectionConfidence &&
    finite(seed.sourceTimestampMs) && validBounds(seed.bounds),
  );

  const candidates: Array<{ seedIndex: number; instanceIndex: number; score: number }> = [];
  eligibleSeeds.forEach((seed, seedIndex) => {
    instances.forEach((instance, instanceIndex) => {
      if (instance.detectionConfidence < minimumDetectionConfidence ||
          !finite(instance.sourceTimestampMs) ||
          Math.abs(instance.sourceTimestampMs - seed.sourceTimestampMs) > maximumTimestampDeltaMs ||
          !validBounds(instance.bounds) ||
          !Number.isInteger(instance.width) || !Number.isInteger(instance.height) ||
          instance.width < 2 || instance.height < 2 ||
          instance.data.length !== instance.width * instance.height) return;
      const score = normalizedIoU(seed.bounds, instance.bounds);
      if (score >= minimumIoU) candidates.push({ seedIndex, instanceIndex, score });
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (usedTracks.has(candidate.seedIndex) || usedInstances.has(candidate.instanceIndex)) continue;
    const seed = eligibleSeeds[candidate.seedIndex]!;
    const instance = instances[candidate.instanceIndex]!;
    const competingForTrack = candidates.find(other =>
      other.seedIndex === candidate.seedIndex && other.instanceIndex !== candidate.instanceIndex &&
      !usedInstances.has(other.instanceIndex),
    );
    const competingForMask = candidates.find(other =>
      other.instanceIndex === candidate.instanceIndex && other.seedIndex !== candidate.seedIndex &&
      !usedTracks.has(other.seedIndex),
    );
    if ((competingForTrack && candidate.score - competingForTrack.score < ambiguityMargin) ||
        (competingForMask && candidate.score - competingForMask.score < ambiguityMargin)) continue;

    const contour = extractMaskContour(instance.data, instance.width, instance.height, {
      bounds: instance.bounds,
      minimumPixels: policy.minimumMaskPixels ?? 12,
      minimumArea: policy.minimumMaskArea ?? 0.001,
      maxPoints: policy.maxContourPoints ?? 96,
    });
    if (!contour) continue;
    output.push({
      trackId: seed.trackId,
      contour,
      detectionConfidence: instance.detectionConfidence,
      modelId: instance.modelId,
      sourceTimestampMs: instance.sourceTimestampMs,
      maskBounds: instance.bounds,
    });
    usedTracks.add(candidate.seedIndex);
    usedInstances.add(candidate.instanceIndex);
  }
  return output;
}

export type SegmentationRunnerOptions = {
  minimumIntervalMs?: number;
  maximumFrameAgeMs?: number;
  maximumTracksPerFrame?: number;
  now?: () => number;
};

/**
 * Single-flight, bounded-cadence inference runner. Inference is independent
 * from bottle detections so it can run in parallel with the cloud recognition
 * request for the same captured frame. The caller associates returned masks
 * to persistent track IDs once the bottle detections arrive.
 */
export class SegmentationRunner {
  private busy = false;
  private disposed = false;
  private generation = 0;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly minimumIntervalMs: number;
  private readonly maximumFrameAgeMs: number;
  private readonly maximumTracksPerFrame: number;

  constructor(private readonly provider: SegmentationProvider, options: SegmentationRunnerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    // Fast devices (WebGPU) may run every ~100ms; single-flight inference
    // still prevents overlapping model runs on slower devices.
    this.minimumIntervalMs = Math.max(80, options.minimumIntervalMs ?? 1000);
    this.maximumFrameAgeMs = Math.max(50, options.maximumFrameAgeMs ?? 400);
    this.maximumTracksPerFrame = Math.max(1, Math.min(8, options.maximumTracksPerFrame ?? 8));
  }

  async runInference(frame: ImageData, frameTimestampMs: number): Promise<SegmentationInstance[]> {
    const result = await this.runInferenceDetailed(frame, frameTimestampMs);
    return result.status === 'ran' ? result.instances : [];
  }

  /**
   * Like runInference, but says whether the model actually looked at the
   * frame. 'skipped' (busy, too soon, stale, reset) is not evidence that no
   * bottles are present and must not count as a detector miss.
   */
  async runInferenceDetailed(frame: ImageData, frameTimestampMs: number): Promise<{ status: 'ran'; instances: SegmentationInstance[] } | { status: 'skipped' }> {
    if (this.disposed || this.busy || !finite(frameTimestampMs) ||
        this.now() - this.lastStartedAt < this.minimumIntervalMs ||
        this.now() - frameTimestampMs > this.maximumFrameAgeMs) return { status: 'skipped' };
    if (!frame || frame.width < 2 || frame.height < 2 || frame.data.length !== frame.width * frame.height * 4) return { status: 'skipped' };

    this.busy = true;
    this.lastStartedAt = this.now();
    const generation = this.generation;
    try {
      const instances = await this.provider.infer(frame, frameTimestampMs);
      if (this.disposed || generation !== this.generation ||
          this.now() - frameTimestampMs > this.maximumFrameAgeMs) return { status: 'skipped' };
      return {
        status: 'ran',
        instances: instances.filter(instance =>
          finite(instance.sourceTimestampMs) &&
          Math.abs(instance.sourceTimestampMs - frameTimestampMs) <= 200,
        ),
      };
    } finally {
      this.busy = false;
    }
  }

  /** True when the provider reports it can no longer run (e.g. its worker died). */
  get providerFailed(): boolean {
    return !!(this.provider as SegmentationProvider & { failed?: boolean }).failed;
  }

  /** Milliseconds until the cadence limit allows the next inference. */
  msUntilReady(): number {
    if (this.busy) return this.minimumIntervalMs;
    return Math.max(0, this.minimumIntervalMs - (this.now() - this.lastStartedAt));
  }

  async runFrame(frame: ImageData, frameTimestampMs: number, seeds: SegmentationSeed[]): Promise<SegmentedTrack[]> {
    if (seeds.length === 0) return [];
    const eligible = seeds
      .filter(seed => seed.detectionConfidence >= 0.55 && Math.abs(seed.sourceTimestampMs - frameTimestampMs) <= 200)
      .slice(0, this.maximumTracksPerFrame);
    if (!eligible.length) return [];
    const instances = await this.runInference(frame, frameTimestampMs);
    return associateInstanceMasks(eligible, instances);
  }

  reset(): void {
    this.generation += 1;
    this.lastStartedAt = Number.NEGATIVE_INFINITY;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    await this.provider.dispose?.();
  }
}
