import { describe, expect, it } from 'vitest';
import { validateBottleSegmentationCandidate } from '../src/services/bottleSegmentationContract';

const candidate = {
  trackId: 'session-track-1', frameId: 'frame-1', classLabel: 'bottle' as const,
  classConfidence: 0.94, maskConfidence: 0.91, modelVersion: 'bar-bottle-seg-v0',
  mask: [
    { x: 0.42, y: 0.12 }, { x: 0.58, y: 0.12 }, { x: 0.61, y: 0.2 },
    { x: 0.6, y: 0.35 }, { x: 0.64, y: 0.9 }, { x: 0.36, y: 0.9 },
    { x: 0.4, y: 0.35 }, { x: 0.39, y: 0.2 },
  ],
};

describe('validateBottleSegmentationCandidate', () => {
  it('accepts a high-confidence bottle instance polygon', () => {
    const result = validateBottleSegmentationCandidate(candidate);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') expect(result.maskArea).toBeGreaterThan(0);
  });

  it('rejects generic or non-bottle proposals', () => {
    expect(validateBottleSegmentationCandidate({ ...candidate, classLabel: 'glass' as never }).status).toBe('invalid');
  });

  it('keeps class confidence and mask confidence as separate gates', () => {
    expect(validateBottleSegmentationCandidate({ ...candidate, classConfidence: 0.99, maskConfidence: 0.2 }).status).toBe('invalid');
    expect(validateBottleSegmentationCandidate({ ...candidate, classConfidence: 0.2, maskConfidence: 0.99 }).status).toBe('invalid');
  });

  it('rejects malformed/out-of-frame polygon points', () => {
    expect(validateBottleSegmentationCandidate({ ...candidate, mask: [...candidate.mask.slice(0, 7), { x: 1.2, y: 0.5 }] }).status).toBe('invalid');
  });

  it('rejects degenerate masks and invalid thresholds', () => {
    expect(validateBottleSegmentationCandidate({ ...candidate, mask: Array(8).fill({ x: 0.5, y: 0.5 }) }).status).toBe('invalid');
    expect(() => validateBottleSegmentationCandidate(candidate, { minClassConfidence: 2 })).toThrow(/thresholds/);
  });
});
