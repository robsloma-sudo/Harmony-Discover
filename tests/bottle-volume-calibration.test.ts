import { describe, expect, it } from 'vitest';
import { createBottleVolumeProfile, estimateCalibratedBottleVolume, validateBottleVolumeProfile, type BottleVolumeProfile } from '../src/services/bottleVolumeCalibration';

const profile: BottleVolumeProfile = {
  id: 'test-750ml-shaped-bottle',
  capacityMl: 750,
  points: [
    { heightFraction: 0, volumeFraction: 0 },
    { heightFraction: 0.25, volumeFraction: 0.18 },
    { heightFraction: 0.6, volumeFraction: 0.55 },
    { heightFraction: 0.82, volumeFraction: 1 },
  ],
};

describe('bottle volume calibration', () => {
  it('builds a bottle profile from empty, partial, and full measured samples', () => {
    const result = createBottleVolumeProfile('measured-750', 750, [
      { heightFraction: 0.82, measuredMilliliters: 750 },
      { heightFraction: 0.5, measuredMilliliters: 360 },
      { heightFraction: 0, measuredMilliliters: 0 },
    ]);
    expect(result.status).toBe('created');
    if (result.status === 'created') expect(result.profile.points[1].volumeFraction).toBeCloseTo(0.48, 4);
  });
  it('requires at least one measured partial fill point', () => {
    expect(createBottleVolumeProfile('endpoints-only', 750, [
      { heightFraction: 0, measuredMilliliters: 0 },
      { heightFraction: 0.82, measuredMilliliters: 750 },
    ]).status).toBe('invalid');
  });
  it('requires real empty and full calibration endpoints', () => {
    expect(createBottleVolumeProfile('incomplete', 750, [
      { heightFraction: 0.2, measuredMilliliters: 100 },
      { heightFraction: 1, measuredMilliliters: 750 },
    ]).status).toBe('invalid');
  });
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
    expect(estimateCalibratedBottleVolume(0.9, profile).status).toBe('unavailable');
  });
  it('rejects calibration curves with a flat volume segment', () => {
    expect(validateBottleVolumeProfile({
      id: 'flat-segment', capacityMl: 750,
      points: [
        { heightFraction: 0, volumeFraction: 0 },
        { heightFraction: 0.3, volumeFraction: 0.4 },
        { heightFraction: 0.6, volumeFraction: 0.4 },
        { heightFraction: 0.82, volumeFraction: 1 },
      ],
    })).toBe(false);
  });
  it('rejects non-monotonic or incomplete calibration curves', () => {
    expect(validateBottleVolumeProfile({ ...profile, points: [...profile.points].reverse() })).toBe(false);
    expect(validateBottleVolumeProfile({ ...profile, points: profile.points.slice(1) })).toBe(false);
  });
});
