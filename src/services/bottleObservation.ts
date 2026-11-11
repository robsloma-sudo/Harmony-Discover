/**
 * End-to-end evidence join for one tracked physical bottle.
 *
 * This is a policy/orchestration layer only. It accepts outputs from future
 * bottle segmentation and liquid-line models; it does not inspect pixels,
 * assign a product identity, or prove that an incoming profile matches a SKU.
 */
import { estimateBottleFill, type BottleVolumeProfile, type BottleFillEstimate } from './bottleInventory';
import { assessContainerClassification, type ContainerClassificationObservation } from './containerEvidence';
import { assessLiquidInterface, type LiquidLineObservation } from './liquidInterface';

export type BottleMaskObservation = {
  frameId: string;
  /** Model confidence that the supplied mask is a bottle instance mask. */
  confidence: number;
  /** Normalized visible bottle-body bounds, after perspective/orientation correction. */
  bodyTop: number;
  bodyBottom: number;
  /** Segmentation model's mask quality metric, e.g. calibrated mask confidence. */
  maskQuality: number;
};

export type BottleObservationInput = {
  classification: ContainerClassificationObservation[];
  masks: BottleMaskObservation[];
  liquidLines: LiquidLineObservation[];
  profile: BottleVolumeProfile;
  nominalCapacityMl: number;
  /** Explicitly verified package/SKU identity; absent means identity is unresolved. */
  verifiedSkuId?: string;
};

export type BottleObservationResult =
  | { status: 'not_a_bottle'; reason: string }
  | { status: 'needs_review'; reason: string; identityStatus: 'unverified' | 'verified'; liquidStatus: string }
  | {
      status: 'estimated';
      identityStatus: 'verified' | 'unverified';
      skuId?: string;
      fill: BottleFillEstimate;
      evidence: { classificationFrameIds: string[]; maskFrameIds: string[]; liquidFrameIds: string[]; maskConfidence: number };
      warning: string;
    };

export function assessBottleObservation(input: BottleObservationInput): BottleObservationResult {
  const identityStatus = input.verifiedSkuId?.trim() ? 'verified' : 'unverified';
  const classification = assessContainerClassification(input.classification);
  if (classification.status === 'rejected_bottle') {
    return { status: 'not_a_bottle', reason: 'Repeated classifier evidence indicates this is not a bottle.' };
  }
  if (classification.status !== 'confirmed_bottle') {
    return { status: 'needs_review', reason: 'Bottle class is not confirmed across distinct frames.', identityStatus, liquidStatus: 'not_assessed' };
  }

  const uniqueMasks = new Map<string, BottleMaskObservation>();
  for (const mask of input.masks ?? []) {
    if (!mask || typeof mask.frameId !== 'string' || !mask.frameId.trim() ||
        !Number.isFinite(mask.confidence) || mask.confidence < 0.8 || mask.confidence > 1 ||
        !Number.isFinite(mask.maskQuality) || mask.maskQuality < 0.8 || mask.maskQuality > 1 ||
        !Number.isFinite(mask.bodyTop) || !Number.isFinite(mask.bodyBottom) ||
        mask.bodyTop < 0 || mask.bodyBottom > 1 || mask.bodyBottom <= mask.bodyTop) continue;
    const old = uniqueMasks.get(mask.frameId);
    if (!old || mask.confidence * mask.maskQuality > old.confidence * old.maskQuality) uniqueMasks.set(mask.frameId, mask);
  }
  const masks = [...uniqueMasks.values()];
  if (masks.length < 3) {
    return { status: 'needs_review', reason: 'A high-confidence bottle instance mask is required in at least three distinct frames.', identityStatus, liquidStatus: 'not_assessed' };
  }

  const liquid = assessLiquidInterface(input.liquidLines);
  if (liquid.status !== 'visible') {
    return { status: 'needs_review', reason: liquid.status === 'occluded'
      ? 'The liquid boundary is occluded.'
      : liquid.status === 'ambiguous'
        ? 'The liquid boundary is unstable across frames.'
        : 'There is not enough reliable liquid-boundary evidence.',
      identityStatus, liquidStatus: liquid.status };
  }

  // The liquid detector's normalized height must be defined bottom-up within
  // the bottle's calibrated internal body. Use the median body height from
  // segmented frames; this mapping is a geometric approximation until the
  // bottle profile is registered to the instance mask in camera coordinates.
  const heights = masks.map(mask => mask.bodyBottom - mask.bodyTop).sort((a, b) => a - b);
  const medianBodyHeightFraction = heights[Math.floor(heights.length / 2)];
  const profileHeightMm = input.profile.samples[input.profile.samples.length - 1]?.heightMm;
  if (!Number.isFinite(profileHeightMm) || profileHeightMm <= 0 || medianBodyHeightFraction <= 0) {
    return { status: 'needs_review', reason: 'Bottle geometry profile cannot be mapped to the segmented body.', identityStatus, liquidStatus: liquid.status };
  }
  const liquidHeightMm = liquid.normalizedHeight * profileHeightMm;
  let fill: BottleFillEstimate;
  try {
    fill = estimateBottleFill({ profile: input.profile, liquidHeightMm, nominalCapacityMl: input.nominalCapacityMl });
  } catch {
    return { status: 'needs_review', reason: 'Calibrated bottle profile rejected the measured liquid height.', identityStatus, liquidStatus: liquid.status };
  }
  const maskConfidence = masks.reduce((sum, mask) => sum + mask.confidence * mask.maskQuality, 0) / masks.length;
  return {
    status: 'estimated',
    identityStatus,
    ...(identityStatus === 'verified' ? { skuId: input.verifiedSkuId!.trim() } : {}),
    fill,
    evidence: {
      classificationFrameIds: classification.frameIds,
      maskFrameIds: masks.map(mask => mask.frameId),
      liquidFrameIds: liquid.frameIds,
      maskConfidence,
    },
    warning: identityStatus === 'verified'
      ? 'Volume is an estimate. Validate profile-to-instance registration and package calibration before operational use.'
      : 'Bottle detected, but product/SKU and capacity are unverified. Do not group this estimate into a confirmed SKU inventory.',
  };
}
