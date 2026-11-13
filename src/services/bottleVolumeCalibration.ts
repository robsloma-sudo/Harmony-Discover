export type BottleCalibrationPoint = {
  /** Liquid height from the bottle's calibrated base, normalized 0..1. */
  heightFraction: number;
  /** Fraction of the bottle's rated capacity at that height, normalized 0..1. */
  volumeFraction: number;
};

export type BottleVolumeProfile = {
  id: string;
  capacityMl: number;
  /** Ordered calibration points must include both (0,0) and (1,1). */
  points: BottleCalibrationPoint[];
};

export type CalibratedVolume =
  | { status: 'calibrated'; profileId: string; heightFraction: number; volumeFraction: number; milliliters: number; fluidOunces: number }
  | { status: 'unavailable'; reason: string };

export function validateBottleVolumeProfile(profile: BottleVolumeProfile): boolean {
  if (!profile || typeof profile.id !== 'string' || !profile.id.trim() ||
      !Number.isFinite(profile.capacityMl) || profile.capacityMl <= 0 ||
      !Array.isArray(profile.points) || profile.points.length < 2) return false;
  const points = profile.points;
  if (points[0].heightFraction !== 0 || points[0].volumeFraction !== 0 ||
      points[points.length - 1].heightFraction !== 1 || points[points.length - 1].volumeFraction !== 1) return false;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point.heightFraction) || !Number.isFinite(point.volumeFraction) ||
        point.heightFraction < 0 || point.heightFraction > 1 || point.volumeFraction < 0 || point.volumeFraction > 1) return false;
    if (index > 0 && (point.heightFraction <= points[index - 1].heightFraction || point.volumeFraction < points[index - 1].volumeFraction)) return false;
  }
  return true;
}

/**
 * Converts a measured body-height fraction to volume only when a validated,
 * bottle-specific calibration profile is supplied. No generic cylinder
 * assumption is made for shoulders, punt, taper, or nonuniform bottle bodies.
 */
export function estimateCalibratedBottleVolume(
  heightFraction: number,
  profile?: BottleVolumeProfile | null,
): CalibratedVolume {
  if (!Number.isFinite(heightFraction) || heightFraction < 0 || heightFraction > 1) {
    return { status: 'unavailable', reason: 'invalid_height_fraction' };
  }
  if (!profile || !validateBottleVolumeProfile(profile)) {
    return { status: 'unavailable', reason: 'missing_or_invalid_bottle_calibration' };
  }
  const points = profile.points;
  let lower = points[0];
  let upper = points[points.length - 1];
  for (let index = 1; index < points.length; index += 1) {
    if (heightFraction <= points[index].heightFraction) {
      lower = points[index - 1];
      upper = points[index];
      break;
    }
  }
  const span = upper.heightFraction - lower.heightFraction;
  const ratio = span > 0 ? (heightFraction - lower.heightFraction) / span : 0;
  const volumeFraction = lower.volumeFraction + ratio * (upper.volumeFraction - lower.volumeFraction);
  const milliliters = volumeFraction * profile.capacityMl;
  return {
    status: 'calibrated',
    profileId: profile.id,
    heightFraction,
    volumeFraction,
    milliliters,
    fluidOunces: milliliters / 29.5735295625,
  };
}

export type BottleCalibrationSample = {
  heightFraction: number;
  measuredMilliliters: number;
};

export type BottleProfileBuildResult =
  | { status: 'created'; profile: BottleVolumeProfile }
  | { status: 'invalid'; reason: string };

/** Builds a normalized shape curve from measured bottle fill samples. */
export function createBottleVolumeProfile(
  id: string,
  capacityMl: number,
  samples: BottleCalibrationSample[],
): BottleProfileBuildResult {
  if (typeof id !== 'string' || !id.trim() || !Number.isFinite(capacityMl) || capacityMl <= 0 ||
      !Array.isArray(samples) || samples.length < 2) {
    return { status: 'invalid', reason: 'missing_profile_identity_capacity_or_samples' };
  }
  const ordered = [...samples].sort((a, b) => a.heightFraction - b.heightFraction);
  if (ordered.some(sample => !Number.isFinite(sample.heightFraction) || !Number.isFinite(sample.measuredMilliliters) ||
      sample.heightFraction < 0 || sample.heightFraction > 1 || sample.measuredMilliliters < 0 || sample.measuredMilliliters > capacityMl)) {
    return { status: 'invalid', reason: 'sample_outside_physical_range' };
  }
  if (ordered[0].heightFraction !== 0 || ordered[0].measuredMilliliters !== 0 ||
      ordered[ordered.length - 1].heightFraction !== 1 || ordered[ordered.length - 1].measuredMilliliters !== capacityMl) {
    return { status: 'invalid', reason: 'calibration_requires_empty_and_full_endpoints' };
  }
  const points: BottleCalibrationPoint[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const sample = ordered[index];
    if (index > 0 && (sample.heightFraction <= ordered[index - 1].heightFraction ||
        sample.measuredMilliliters < ordered[index - 1].measuredMilliliters)) {
      return { status: 'invalid', reason: 'samples_must_be_strictly_ordered_by_height_and_monotonic_by_volume' };
    }
    points.push({
      heightFraction: sample.heightFraction,
      volumeFraction: sample.measuredMilliliters / capacityMl,
    });
  }
  const profile: BottleVolumeProfile = { id: id.trim(), capacityMl, points };
  return validateBottleVolumeProfile(profile)
    ? { status: 'created', profile }
    : { status: 'invalid', reason: 'generated_profile_failed_validation' };
}
