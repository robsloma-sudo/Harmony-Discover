import { describe, expect, it } from 'vitest';
import { assessContainerClassification } from '../src/services/containerEvidence';

describe('assessContainerClassification', () => {
  it('confirms a bottle only after repeated high-confidence predictions', () => {
    const result = assessContainerClassification([
      { frameId: '1', classification: 'bottle', confidence: 0.91 },
      { frameId: '2', classification: 'bottle', confidence: 0.88 },
      { frameId: '3', classification: 'bottle', confidence: 0.93 },
    ]);
    expect(result.status).toBe('confirmed_bottle');
  });

  it('rejects glasses and other non-bottle objects when evidence agrees', () => {
    const result = assessContainerClassification([
      { frameId: '1', classification: 'non_bottle', confidence: 0.9 },
      { frameId: '2', classification: 'non_bottle', confidence: 0.86 },
      { frameId: '3', classification: 'non_bottle', confidence: 0.92 },
    ]);
    expect(result.status).toBe('rejected_bottle');
  });

  it('does not let repeated predictions from one frame count as multiple views', () => {
    const result = assessContainerClassification([
      { frameId: '1', classification: 'bottle', confidence: 0.91 },
      { frameId: '1', classification: 'bottle', confidence: 0.95 },
      { frameId: '1', classification: 'bottle', confidence: 0.93 },
    ]);
    expect(result.status).toBe('unresolved');
  });

  it('keeps disagreement unresolved', () => {
    const result = assessContainerClassification([
      { frameId: '1', classification: 'bottle', confidence: 0.9 },
      { frameId: '2', classification: 'non_bottle', confidence: 0.9 },
      { frameId: '3', classification: 'bottle', confidence: 0.8 },
      { frameId: '4', classification: 'non_bottle', confidence: 0.8 },
    ]);
    expect(result.status).toBe('unresolved');
  });

  it('rejects invalid consensus thresholds', () => {
    expect(() => assessContainerClassification([], { minAgreement: 0.5 })).toThrow(/thresholds/);
  });
});
