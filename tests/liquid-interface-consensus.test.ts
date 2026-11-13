import { describe, expect, it } from 'vitest';
import { assessLiquidInterface } from '../src/services/liquidInterface';

describe('liquid interface temporal consensus', () => {
  it('requires three distinct high-confidence observations', () => {
    const one = { frameId:'f1', normalizedHeight:0.52, confidence:0.9 };
    expect(assessLiquidInterface([one,one,one]).status).toBe('insufficient_evidence');
    expect(assessLiquidInterface([
      one,
      {frameId:'f2',normalizedHeight:0.521,confidence:0.88},
      {frameId:'f3',normalizedHeight:0.519,confidence:0.91},
    ]).status).toBe('visible');
  });

  it('rejects unstable lines rather than averaging across motion', () => {
    const result = assessLiquidInterface([
      {frameId:'f1',normalizedHeight:0.40,confidence:0.9},
      {frameId:'f2',normalizedHeight:0.47,confidence:0.9},
      {frameId:'f3',normalizedHeight:0.53,confidence:0.9},
    ]);
    expect(result.status).toBe('ambiguous');
  });

  it('rejects observations explicitly marked as occluded', () => {
    const result = assessLiquidInterface([
      {frameId:'f1',normalizedHeight:0.52,confidence:0.95,occluded:true},
      {frameId:'f2',normalizedHeight:0.52,confidence:0.92,occluded:true},
      {frameId:'f3',normalizedHeight:0.52,confidence:0.94,occluded:true},
    ]);
    expect(result.status).toBe('occluded');
  });
});
