import { describe, expect, it } from 'vitest';
import { isConfirmedWebBottleTrack, shouldAssociateWebBottleTrack } from '../src/live/webTrackPolicy';

describe('web bottle track visibility policy', () => {
  it('promotes a strong first-frame geometry detection immediately', () => {
    expect(isConfirmedWebBottleTrack({ hits: 1, misses: 0, confidence: 0.82 })).toBe(true);
  });
  it('keeps a weaker first-frame detection provisional', () => {
    expect(isConfirmedWebBottleTrack({ hits: 1, misses: 0, confidence: 0.77 })).toBe(false);
  });
  it('promotes a track after its second consistent observation', () => {
    expect(isConfirmedWebBottleTrack({ hits: 2, misses: 0, confidence: 0.55 })).toBe(true);
  });
  it('keeps a confirmed track through one missed cloud read', () => {
    expect(isConfirmedWebBottleTrack({ hits: 4, misses: 1, confidence: 0.91 })).toBe(true);
  });
  it('hides a track after more than one missed cloud read', () => {
    expect(isConfirmedWebBottleTrack({ hits: 4, misses: 2, confidence: 0.91 })).toBe(false);
  });
  it('rejects low-confidence and invalid values', () => {
    expect(isConfirmedWebBottleTrack({ hits: 3, misses: 0, confidence: 0.44 })).toBe(false);
    expect(isConfirmedWebBottleTrack({ hits: Number.NaN, misses: 0, confidence: 0.9 })).toBe(false);
  });
});


describe('web bottle track association policy', () => {
  it('associates boxes with meaningful overlap', () => {
    expect(shouldAssociateWebBottleTrack(0.12, 0.18, 5)).toBe(true);
  });
  it('associates close boxes only when their sizes are reasonably similar', () => {
    expect(shouldAssociateWebBottleTrack(0, 0.05, 2)).toBe(true);
    expect(shouldAssociateWebBottleTrack(0, 0.05, 4)).toBe(false);
  });
  it('does not attach a nearby different bottle across a wide camera shift', () => {
    expect(shouldAssociateWebBottleTrack(0, 0.16, 1)).toBe(false);
  });
  it('rejects invalid geometry metrics', () => {
    expect(shouldAssociateWebBottleTrack(Number.NaN, 0, 1)).toBe(false);
  });
});
