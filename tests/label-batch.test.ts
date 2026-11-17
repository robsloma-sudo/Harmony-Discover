import { describe, expect, it } from 'vitest';
import { selectLabelBatchCandidates, type LabelBatchCandidate } from '../src/live/labelBatch';
import { looksLikeNoDrink } from '../src/live/labelBatch';

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
      candidate(1, 0.9, { brand: 'Known Brand', product: 'Known Expression', confidence: 0.92 }),
      candidate(2, 0.9),
      candidate(3, 0.7),
    ], lastRead, 20_000);
    expect(selected.map(item => item.trackId)).toEqual([3]);
  });

  it('accepts negative local spatial-track IDs as valid bottle identities', () => {
    const selected = selectLabelBatchCandidates([candidate(-1, 0.88)], new Map(), 20_000);
    expect(selected.map(item => item.trackId)).toEqual([-1]);
  });

  it('rejects malformed geometry and invalid track identifiers', () => {
    const selected = selectLabelBatchCandidates([
      candidate(0), candidate(Number.NaN), { ...candidate(4), width: 0 },
    ], new Map(), 20_000);
    expect(selected).toEqual([]);
  });
  it('re-reads a confident brand that still has no product', () => {
    const selected = selectLabelBatchCandidates([
      candidate(1, 0.9, { brand: 'Colonel E.H. Taylor', confidence: 0.95 }),
    ], new Map(), 20_000);
    expect(selected.map(item => item.trackId)).toEqual([1]);
  });
});

import { selectSecondLookCrops } from '../src/live/labelBatch';
describe('selectSecondLookCrops (Haiku first, Sonnet second look)', () => {
  const crops = [1, 2, 3, 4, 5, 6].map(trackId => ({ trackId, image: 'x' }));
  it('sends only unsure/guessed or missing reads, at most 4', () => {
    const reads = [
      { trackId: 1, needsSecondLook: false },
      { trackId: 2, needsSecondLook: true },
      { trackId: 3, needsSecondLook: true },
      // 4 missing from the reply
      { trackId: 5, needsSecondLook: true },
      { trackId: 6, needsSecondLook: true },
    ];
    expect(selectSecondLookCrops(crops, reads, new Map(), 10_000).map(c => c.trackId)).toEqual([2, 3, 4, 5]);
  });
  it('sends nothing when every first read is confident', () => {
    const reads = crops.map(c => ({ trackId: c.trackId, needsSecondLook: false }));
    expect(selectSecondLookCrops(crops, reads, new Map(), 10_000)).toEqual([]);
  });
  it('gives each bottle at most one second look per cooldown', () => {
    const reads = [{ trackId: 2, needsSecondLook: true }, { trackId: 3, needsSecondLook: true }];
    const last = new Map([[2, 5_000]]);
    expect(selectSecondLookCrops(crops.slice(1, 3), reads, last, 10_000).map(c => c.trackId)).toEqual([3]);
    expect(selectSecondLookCrops(crops.slice(1, 3), reads, last, 13_000).map(c => c.trackId)).toEqual([2, 3]);
  });
});

describe('boxes around things that are not drinks', () => {
  it('a read with no label and no words looks like no drink', () => {
    expect(looksLikeNoDrink({ brand: '', words: [], unreadableReason: 'no_label' })).toBe(true);
    expect(looksLikeNoDrink({ brand: '', words: [], unreadableReason: 'not_a_drink' })).toBe(true);
  });
  it('an unreadable drink is kept', () => {
    expect(looksLikeNoDrink({ brand: '', words: [], unreadableReason: 'blurry' })).toBe(false);
    expect(looksLikeNoDrink({ brand: '', words: [], unreadableReason: 'turned_away' })).toBe(false);
    expect(looksLikeNoDrink({ brand: '', words: ['RESERVE', 'KENTUCKY'], unreadableReason: 'no_label' })).toBe(false);
    expect(looksLikeNoDrink({ brand: 'Jameson', words: [], unreadableReason: 'no_label' })).toBe(false);
  });
});
