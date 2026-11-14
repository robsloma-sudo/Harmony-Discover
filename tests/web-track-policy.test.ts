import { describe, expect, it } from 'vitest';
import { hasBottleIdentityConflict, isConfirmedWebBottleTrack } from '../src/live/webTrackPolicy';

describe('web bottle track visibility policy', () => {
  it('does not promote a one-frame cloud detection', () => {
    expect(isConfirmedWebBottleTrack({ hits: 1, misses: 0, confidence: 0.95 })).toBe(false);
  });
  it('promotes a track after its second consistent observation', () => {
    expect(isConfirmedWebBottleTrack({ hits: 2, misses: 0, confidence: 0.72 })).toBe(true);
  });
  it('keeps a confirmed track through one missed cloud read', () => {
    expect(isConfirmedWebBottleTrack({ hits: 4, misses: 1, confidence: 0.91 })).toBe(true);
  });
  it('hides a track after more than one missed cloud read', () => {
    expect(isConfirmedWebBottleTrack({ hits: 4, misses: 2, confidence: 0.91 })).toBe(false);
  });
  it('rejects low-confidence and invalid values', () => {
    expect(isConfirmedWebBottleTrack({ hits: 3, misses: 0, confidence: 0.2 })).toBe(false);
    expect(isConfirmedWebBottleTrack({ hits: Number.NaN, misses: 0, confidence: 0.9 })).toBe(false);
  });
});

describe('web bottle identity correction policy', () => {
  it('detects a conflicting product identity for the same spatial track', () => {
    expect(hasBottleIdentityConflict(
      { brand: 'Michter’s', product: 'Barrel Strength' },
      { brand: 'Michter’s', product: 'Toasted Barrel Finish' },
    )).toBe(true);
  });
  it('does not call an incomplete identity a conflict', () => {
    expect(hasBottleIdentityConflict(
      { brand: 'Michter’s', product: 'Barrel Strength' },
      { brand: 'Michter’s' },
    )).toBe(false);
  });
  it('treats normalized equivalent identities as the same product', () => {
    expect(hasBottleIdentityConflict(
      { brand: 'Michter’s', product: 'Barrel Strength' },
      { brand: "Michter's", product: 'Barrel-Strength' },
    )).toBe(false);
  });
});
