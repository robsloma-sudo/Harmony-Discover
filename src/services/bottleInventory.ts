/**
 * Pure, calibration-aware bottle inventory calculations.
 *
 * This module does not detect bottles or liquid lines. It converts an already
 * validated liquid-interface height into volume only when supplied with a
 * measured internal-radius profile. All dimensions are millimetres.
 */

export type BottleProfileSample = {
  /** Height above the inside bottom of the bottle, in millimetres. */
  heightMm: number;
  /** Internal radius at this height, in millimetres. */
  internalRadiusMm: number;
};

export type BottleVolumeProfile = {
  profileId: string;
  /** Source describing how the profile was measured or validated. */
  calibrationSource: string;
  /** At least two ordered internal-radius samples. */
  samples: BottleProfileSample[];
};

export type BottleFillEstimate = {
  remainingMl: number;
  remainingUsFluidOunces: number;
  /** Percent of nominal package capacity, not brimful vessel capacity. */
  remainingPercent: number;
  nominalCapacityMl: number;
  modeledInternalCapacityMl: number;
  method: 'profile_integration';
  profileId: string;
  calibrationSource: string;
  status: 'estimated';
};

export const ML_PER_US_FL_OZ = 29.5735295625;

function validateProfile(profile: BottleVolumeProfile): void {
  if (!profile.profileId.trim() || !profile.calibrationSource.trim()) {
    throw new Error('A profile ID and calibration source are required.');
  }
  if (profile.samples.length < 2) {
    throw new Error('At least two internal-radius samples are required.');
  }
  for (let i = 0; i < profile.samples.length; i += 1) {
    const sample = profile.samples[i];
    if (!Number.isFinite(sample.heightMm) || !Number.isFinite(sample.internalRadiusMm) ||
        sample.heightMm < 0 || sample.internalRadiusMm < 0) {
      throw new Error('Profile dimensions must be finite and non-negative.');
    }
    if (i > 0 && sample.heightMm <= profile.samples[i - 1].heightMm) {
      throw new Error('Profile heights must be strictly increasing.');
    }
  }
  if (profile.samples[0].heightMm !== 0) {
    throw new Error('Profile must start at the inside bottom (0 mm).');
  }
}

function radiusAt(profile: BottleVolumeProfile, heightMm: number): number {
  const samples = profile.samples;
  if (heightMm <= 0) return samples[0].internalRadiusMm;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (heightMm <= b.heightMm) {
      const ratio = (heightMm - a.heightMm) / (b.heightMm - a.heightMm);
      return a.internalRadiusMm + ratio * (b.internalRadiusMm - a.internalRadiusMm);
    }
  }
  return samples[samples.length - 1].internalRadiusMm;
}

/**
 * Integrates pi*r(z)^2 using the trapezoidal rule over the supplied measured
 * profile. The liquid surface is assumed horizontal and the vessel axisymmetric.
 */
export function integrateBottleVolumeMl(
  profile: BottleVolumeProfile,
  liquidHeightMm: number,
): number {
  validateProfile(profile);
  if (!Number.isFinite(liquidHeightMm) || liquidHeightMm < 0) {
    throw new Error('Liquid height must be finite and non-negative.');
  }
  const maxHeight = profile.samples[profile.samples.length - 1].heightMm;
  if (liquidHeightMm > maxHeight) {
    throw new Error('Liquid height exceeds the calibrated profile.');
  }
  if (liquidHeightMm === 0) return 0;

  const boundaries = [
    ...profile.samples.filter(sample => sample.heightMm < liquidHeightMm).map(sample => sample.heightMm),
    liquidHeightMm,
  ];
  let cubicMm = 0;
  for (let i = 1; i < boundaries.length; i += 1) {
    const z0 = boundaries[i - 1];
    const z1 = boundaries[i];
    const r0 = radiusAt(profile, z0);
    const r1 = radiusAt(profile, z1);
    const area0 = Math.PI * r0 * r0;
    const area1 = Math.PI * r1 * r1;
    cubicMm += ((area0 + area1) / 2) * (z1 - z0);
  }
  return cubicMm / 1000;
}

export function estimateBottleFill(input: {
  profile: BottleVolumeProfile;
  liquidHeightMm: number;
  nominalCapacityMl: number;
}): BottleFillEstimate {
  const { profile, liquidHeightMm, nominalCapacityMl } = input;
  if (!Number.isFinite(nominalCapacityMl) || nominalCapacityMl <= 0) {
    throw new Error('Nominal package capacity must be greater than zero.');
  }
  const modeledInternalCapacityMl = integrateBottleVolumeMl(
    profile,
    profile.samples[profile.samples.length - 1].heightMm,
  );
  const remainingMl = integrateBottleVolumeMl(profile, liquidHeightMm);
  return {
    remainingMl,
    remainingUsFluidOunces: remainingMl / ML_PER_US_FL_OZ,
    remainingPercent: (remainingMl / nominalCapacityMl) * 100,
    nominalCapacityMl,
    modeledInternalCapacityMl,
    method: 'profile_integration',
    profileId: profile.profileId,
    calibrationSource: profile.calibrationSource,
    status: 'estimated',
  };
}
