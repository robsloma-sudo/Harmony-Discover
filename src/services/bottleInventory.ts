/**
 * Calibration-aware bottle volume math.
 * This module does not detect bottles or liquid lines. Dimensions are mm.
 */
export type BottleProfileSample = { heightMm: number; internalRadiusMm: number };
export type BottleVolumeProfile = {
  profileId: string;
  calibrationSource: string;
  samples: BottleProfileSample[];
};
export type BottleFillEstimate = {
  remainingMl: number;
  remainingUsFluidOunces: number;
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
  if (!profile || typeof profile.profileId !== 'string' || !profile.profileId.trim() ||
      typeof profile.calibrationSource !== 'string' || !profile.calibrationSource.trim()) {
    throw new Error('A profile ID and calibration source are required.');
  }
  if (!Array.isArray(profile.samples) || profile.samples.length < 2) {
    throw new Error('At least two internal-radius samples are required.');
  }
  profile.samples.forEach((sample, index) => {
    if (!sample || !Number.isFinite(sample.heightMm) ||
        !Number.isFinite(sample.internalRadiusMm) ||
        sample.heightMm < 0 || sample.internalRadiusMm < 0) {
      throw new Error('Profile dimensions must be finite and non-negative.');
    }
    if (index > 0 && sample.heightMm <= profile.samples[index - 1].heightMm) {
      throw new Error('Profile heights must be strictly increasing.');
    }
  });
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

/** Integrates pi*r(z)^2. Assumes a horizontal surface and axisymmetric vessel. */
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
    // Radius is linearly interpolated between samples. Integrate r(z)^2
    // analytically over that segment instead of approximating the area curve.
    cubicMm += (Math.PI * (z1 - z0) / 3) * (r0 * r0 + r0 * r1 + r1 * r1);
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
  if (remainingMl > modeledInternalCapacityMl) {
    throw new Error('Remaining volume exceeds modeled internal capacity.');
  }
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
