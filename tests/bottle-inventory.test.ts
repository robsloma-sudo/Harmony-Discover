import { describe, expect, it } from 'vitest';
import {
  estimateBottleFill,
  integrateBottleVolumeMl,
  ML_PER_US_FL_OZ,
} from '../src/services/bottleInventory';
import type { BottleVolumeProfile } from '../src/services/bottleInventory';

const cylinder: BottleVolumeProfile = {
  profileId: 'test-cylinder',
  calibrationSource: 'synthetic unit-test geometry',
  samples: [
    { heightMm: 0, internalRadiusMm: 10 },
    { heightMm: 50, internalRadiusMm: 10 },
    { heightMm: 100, internalRadiusMm: 10 },
  ],
};

describe('integrateBottleVolumeMl', () => {
  it('integrates a cylindrical internal profile', () => {
    expect(integrateBottleVolumeMl(cylinder, 100)).toBeCloseTo(Math.PI * 10 ** 2 * 100 / 1000, 6);
  });

  it('returns zero at an empty liquid height', () => {
    expect(integrateBottleVolumeMl(cylinder, 0)).toBe(0);
  });

  it('interpolates the profile at a liquid height between samples', () => {
    expect(integrateBottleVolumeMl(cylinder, 25)).toBeCloseTo(Math.PI * 10 ** 2 * 25 / 1000, 6);
  });

  it('rejects non-monotonic or invalid profiles', () => {
    expect(() => integrateBottleVolumeMl({
      ...cylinder,
      samples: [{ heightMm: 0, internalRadiusMm: 10 }, { heightMm: 0, internalRadiusMm: 9 }],
    }, 10)).toThrow(/strictly increasing/);
    expect(() => integrateBottleVolumeMl(cylinder, 101)).toThrow(/exceeds/);
    expect(() => integrateBottleVolumeMl(cylinder, Number.NaN)).toThrow(/finite/);
  });
});

describe('estimateBottleFill', () => {
  it('returns mL, US fluid ounces, and percent of nominal package capacity', () => {
    const result = estimateBottleFill({
      profile: cylinder,
      liquidHeightMm: 50,
      nominalCapacityMl: 750,
    });
    expect(result.remainingMl).toBeCloseTo(Math.PI * 10 ** 2 * 50 / 1000, 6);
    expect(result.remainingUsFluidOunces).toBeCloseTo(result.remainingMl / ML_PER_US_FL_OZ, 8);
    expect(result.remainingPercent).toBeCloseTo((result.remainingMl / 750) * 100, 8);
    expect(result.nominalCapacityMl).toBe(750);
    expect(result.modeledInternalCapacityMl).toBeCloseTo(Math.PI * 10 ** 2 * 100 / 1000, 6);
    expect(result.status).toBe('estimated');
    expect(result.method).toBe('profile_integration');
  });

  it('rejects missing profile metadata and malformed samples', () => {
    expect(() => integrateBottleVolumeMl({
      profileId: '',
      calibrationSource: 'test',
      samples: [{ heightMm: 0, internalRadiusMm: 1 }, { heightMm: 2, internalRadiusMm: 1 }],
    }, 1)).toThrow(/profile ID/);
    expect(() => integrateBottleVolumeMl({
      ...cylinder,
      samples: [{ heightMm: 0, internalRadiusMm: 10 }, null as never],
    }, 1)).toThrow(/finite and non-negative/);
  });

  it('keeps nominal package capacity separate from modeled internal capacity', () => {
    const result = estimateBottleFill({
      profile: cylinder,
      liquidHeightMm: 100,
      nominalCapacityMl: 1,
    });
    expect(result.modeledInternalCapacityMl).toBeGreaterThan(result.nominalCapacityMl);
    expect(result.remainingPercent).toBeGreaterThan(100);
  });

  it('rejects invalid nominal package capacity', () => {
    expect(() => estimateBottleFill({
      profile: cylinder,
      liquidHeightMm: 50,
      nominalCapacityMl: 0,
    })).toThrow(/greater than zero/);
  });
});
