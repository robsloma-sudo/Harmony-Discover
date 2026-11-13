import { describe, expect, it } from 'vitest';
import { estimateCalibratedBottleVolume, validateBottleVolumeProfile, type BottleVolumeProfile } from '../src/services/bottleVolumeCalibration';

const profile: BottleVolumeProfile = {
  id: 'test-750ml-shaped-bottle',
  capacityMl: 750,
  points: [
    { heightFraction: 0, volumeFraction: 0 },
    { heightFraction: 0.25, volumeFraction: 0.18 },
    { heightFraction: 0.6, volumeFraction: 0.55 },
    { heightFraction: 1, volumeFraction: 1 },
  ],
};

describe('bottle volume calibration', () => {
  it('validates a monotonic bottle-specific calibration curve', () => {
    expect(validateBottleVolumeProfile(profile)).toBe(true);
  });
  it('interpolates volume from a calibrated non-linear shape curve', () => {
    const result = estimateCalibratedBottleVolume(0.425, profile);
    expect(result.status).toBe('calibrated');
    if (result.status === 'calibrated') {
      expect(result.volumeFraction).toBeCloseTo(0.365, 6);
      expect(result.milliliters).toBeCloseTo(273.75, 2);
      expect(result.fluidOunces).toBeCloseTo(9.25, 1);
    }
  });
  it('refuses to estimate volume without a profile', () => {
    expect(estimateCalibratedBottleVolume(0.5).status).toBe('unavailable');
  });
  it('rejects non-monotonic or incomplete calibration curves', () => {
    expect(validateBottleVolumeProfile({ ...profile, points: [...profile.points].reverse() })).toBe(false);
    expect(validateBottleVolumeProfile({ ...profile, points: profile.points.slice(1) })).toBe(false);
  });
});
