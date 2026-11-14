import { describe, expect, it } from 'vitest';
import { mergeFound, type FoundItem } from '../src/live/foundTray';
import type { BottleRead } from '../src/services/discoverLiveApi';

const read = (brand: string, product: string): BottleRead => ({
  box: { x0: 0, y0: 0, x1: 0, y1: 0 }, words: [], brand, product, category: 'whiskey', proof: '', size: '', origin: '',
  confidence: 0.9, detectionConfidence: 0.9, fieldConfidence: {}, researchSources: [], details: {}, match: null, state: 'reported',
} as BottleRead);
const cand = (trackId: number, bottle?: BottleRead) => ({ trackId, x: 0.1, y: 0.4, width: 0.1, height: 0.3, bottle });

describe('found strip', () => {
  it('adds only fully recognised bottles, newest first', () => {
    const first = mergeFound([], [cand(1, read('E.H. Taylor', 'Single Barrel')), cand(2)], 1);
    expect(first.list.map(i => i.name)).toEqual(['E.H. Taylor Single Barrel']);
    expect(first.added).toHaveLength(1);
    const second = mergeFound(first.list, [cand(3, read('E.H. Taylor', 'Cured Oak'))], 2);
    expect(second.list.map(i => i.name)).toEqual(['E.H. Taylor Cured Oak', 'E.H. Taylor Single Barrel']);
  });
  it('never duplicates a product seen again or on another bottle', () => {
    const a = mergeFound([], [cand(1, read('E.H. Taylor', 'Single Barrel'))], 1);
    const b = mergeFound(a.list, [cand(1, read('E.H. Taylor', 'Single Barrel')), cand(7, read('e.h. taylor', 'single barrel'))], 2);
    expect(b.list).toHaveLength(1);
    expect(b.added).toHaveLength(0);
    expect(b.list[0].trackIds).toEqual([1, 7]);
  });
  it('returns the same list when nothing changed (no re-render)', () => {
    const bottle = read('Blanton\'s', 'Original');
    const a = mergeFound([], [cand(4, bottle)], 1);
    expect(mergeFound(a.list, [cand(4, bottle)], 2).list).toBe(a.list as FoundItem[]);
  });
});

describe('found strip new-data version', () => {
  it('goes up only when a later read adds facts', () => {
    const a = mergeFound([], [cand(1, read('E.H. Taylor', 'Barrel Proof'))], 1);
    expect(a.list[0].version).toBe(1);
    const same = mergeFound(a.list, [cand(2, read('E.H. Taylor', 'Barrel Proof'))], 2);
    expect(same.list[0].version).toBe(1);
    const richer = { ...read('E.H. Taylor', 'Barrel Proof'), proof: '127.3 Proof', details: { batch: 'Batch 16' } } as BottleRead;
    const more = mergeFound(same.list, [cand(2, richer)], 3);
    expect(more.list[0].version).toBe(2);
  });
});
