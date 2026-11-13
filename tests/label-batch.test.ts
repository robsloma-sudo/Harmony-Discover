import { describe, expect, it } from 'vitest';
import { selectLabelBatchCandidates, type LabelBatchCandidate } from '../src/live/labelBatch';

const candidate = (trackId: number, confidence = 0.8, bottle?: LabelBatchCandidate['bottle']): LabelBatchCandidate => ({
  trackId, x: 0.1, y: 0.1, width: 0.2, height: 0.5, confidence, bottle,
});

describe('independent label batch scheduling', () => {
  it('prioritizes unread tracks and caps each provider batch at eight crops', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => candidate(index + 1, 0.6 + index * 0.01));
    const selected = selectLabelBatchCandidates(candidates, new Map(), 20_000);
    expect(selected).toHaveLength(8);
    expect(selected.map(item => item.trackId)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
  });

  it('skips confidently identified bottles and respects retry cooldowns', () => {
    const lastRead = new Map([[2, 15_000]]);
    const selected = selectLabelBatchCandidates([
      candidate(1, 0.9, { brand: 'Known Brand', confidence: 0.92 }),
      candidate(2, 0.9),
      candidate(3, 0.7),
    ], lastRead, 20_000);
    expect(selected.map(item => item.trackId)).toEqual([3]);
  });

  it('rejects malformed geometry and invalid track identifiers', () => {
    const selected = selectLabelBatchCandidates([
      candidate(0), candidate(Number.NaN), { ...candidate(4), width: 0 },
    ], new Map(), 20_000);
    expect(selected).toEqual([]);
  });
});
