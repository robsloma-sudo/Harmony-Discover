import { describe, expect, it } from 'vitest';
import { assessLiquidInterface } from '../src/services/liquidInterface';

const stable = [
  { frameId: 'f1', normalizedHeight: 0.42, confidence: 0.9 },
  { frameId: 'f2', normalizedHeight: 0.425, confidence: 0.88 },
  { frameId: 'f3', normalizedHeight: 0.418, confidence: 0.92 },
];

describe('assessLiquidInterface', () => {
  it('accepts a stable line observed in distinct frames', () => {
    const result = assessLiquidInterface(stable);
    expect(result.status).toBe('visible');
    if (result.status === 'visible') {
      expect(result.normalizedHeight).toBeCloseTo(0.42, 2);
      expect(result.frameIds).toHaveLength(3);
    }
  });

  it('rejects duplicate frame evidence', () => {
    const result = assessLiquidInterface([
      stable[0], { ...stable[0], normalizedHeight: 0.421 }, { ...stable[0], normalizedHeight: 0.419 },
    ]);
    expect(result.status).toBe('insufficient_evidence');
  });

  it('reports fully occluded lines as occluded', () => {
    const result = assessLiquidInterface(stable.map(item => ({ ...item, occluded: true })));
    expect(result.status).toBe('occluded');
  });

  it('rejects unstable liquid-line positions', () => {
    const result = assessLiquidInterface([
      stable[0], { frameId: 'f2', normalizedHeight: 0.5, confidence: 0.9 },
      { frameId: 'f3', normalizedHeight: 0.6, confidence: 0.9 },
    ]);
    expect(result.status).toBe('ambiguous');
  });


  it('uses the midpoint median for an even number of observations', () => {
    const result = assessLiquidInterface([
      { frameId: 'f1', normalizedHeight: 0.4, confidence: 0.9 },
      { frameId: 'f2', normalizedHeight: 0.42, confidence: 0.9 },
      { frameId: 'f3', normalizedHeight: 0.41, confidence: 0.9 },
      { frameId: 'f4', normalizedHeight: 0.43, confidence: 0.9 },
    ], { maxSpread: 0.04 });
    expect(result.status).toBe('visible');
    if (result.status === 'visible') expect(result.normalizedHeight).toBeCloseTo(0.415, 5);
  });

  it('rejects invalid consensus thresholds', () => {
    expect(() => assessLiquidInterface(stable, { minFrames: 0 })).toThrow(/thresholds/);
    expect(() => assessLiquidInterface(stable, { minConfidence: 1.5 })).toThrow(/thresholds/);
    expect(() => assessLiquidInterface(stable, { maxSpread: -1 })).toThrow(/thresholds/);
  });

  it('rejects weak confidence and malformed coordinates', () => {
    expect(assessLiquidInterface([
      { frameId: 'a', normalizedHeight: 0.2, confidence: 0.4 },
      { frameId: 'b', normalizedHeight: 0.2, confidence: 0.5 },
      { frameId: 'c', normalizedHeight: 0.2, confidence: 0.6 },
    ]).status).toBe('insufficient_evidence');
    expect(assessLiquidInterface([
      { frameId: 'a', normalizedHeight: 2, confidence: 0.9 },
      { frameId: 'b', normalizedHeight: 0.2, confidence: 0.9 },
      { frameId: 'c', normalizedHeight: 0.2, confidence: 0.9 },
    ]).status).toBe('insufficient_evidence');
  });
});
