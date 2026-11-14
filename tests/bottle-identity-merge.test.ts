import { describe, expect, it } from 'vitest';
import { hasBottleIdentityConflict, mergeBottleRead, type MergeableBottleRead } from '../src/live/webTrackPolicy';

const read = (overrides: Partial<MergeableBottleRead> = {}): MergeableBottleRead => ({
  brand: '', product: '', category: 'whiskey', proof: '', size: '', origin: '',
  words: [], confidence: 0, fieldConfidence: {}, details: {}, match: null, state: 'unsure',
  ...overrides,
});

describe('bottle identity conflicts', () => {
  it('treats a different brand as a conflict even when no product was read', () => {
    expect(hasBottleIdentityConflict({ brand: 'Bacardi', product: 'Superior' }, { brand: "Tito's" })).toBe(true);
  });
  it('does not treat a brand-less read as a conflict', () => {
    expect(hasBottleIdentityConflict({ brand: 'Bacardi', product: 'Superior' }, { brand: '' })).toBe(false);
  });
  it('flags a different expression of the same brand', () => {
    expect(hasBottleIdentityConflict(
      { brand: 'Colonel E.H. Taylor', product: 'Small Batch' },
      { brand: 'Colonel E.H. Taylor', product: 'Barrel Proof' },
    )).toBe(true);
  });
});

describe('merging a label read into a tracked bottle', () => {
  const smallBatch = read({
    brand: 'Colonel E.H. Taylor', product: 'Small Batch', proof: '100 Proof', size: '750 ml',
    confidence: 0.5, details: { age_statement: '4 Years' }, state: 'reported',
  });

  it('replaces the whole identity on a correction (the PR #104 Small Batch → Barrel Proof case)', () => {
    const merged = mergeBottleRead(smallBatch, read({
      brand: 'Colonel E.H. Taylor', product: 'Barrel Proof', proof: '', confidence: 0.8, state: 'reported',
    }));
    expect(merged.product).toBe('Barrel Proof');
    // Facts read from the previous identity must not survive the correction.
    expect(merged.proof).toBe('');
    expect(merged.size).toBe('');
    expect(merged.details).toEqual({});
    expect(merged.confidence).toBe(0.8);
  });

  it('never builds a composite brand + product from two different bottles', () => {
    const bacardi = read({ brand: 'Bacardi', product: 'Superior', proof: '40%', confidence: 0.9, state: 'reported' });
    const merged = mergeBottleRead(bacardi, read({ brand: "Tito's", product: '', confidence: 0.92, state: 'reported' }));
    expect(merged.brand).toBe("Tito's");
    expect(merged.product).toBe('');
    expect(merged.proof).toBe('');
  });

  it('fills missing fields from a compatible read of the same bottle', () => {
    const brandOnly = read({ brand: 'Colonel E.H. Taylor', confidence: 0.9, state: 'reported' });
    const merged = mergeBottleRead(brandOnly, read({
      brand: 'Colonel E.H. Taylor', product: 'Single Barrel', proof: '100 Proof', confidence: 0.75, state: 'reported',
    }));
    expect(merged.product).toBe('Single Barrel');
    expect(merged.proof).toBe('100 Proof');
    expect(merged.confidence).toBe(0.9);
  });

  it('keeps identity when the new read has no brand, only filling empty facts', () => {
    const merged = mergeBottleRead(smallBatch, read({ brand: '', size: '1 L', origin: 'Kentucky' }));
    expect(merged.brand).toBe('Colonel E.H. Taylor');
    expect(merged.product).toBe('Small Batch');
    expect(merged.size).toBe('750 ml');
    expect(merged.origin).toBe('Kentucky');
  });

  it('drops a previous catalogue match when the identity changes and the new read is unmatched', () => {
    const matched = read({ brand: 'Bacardi', product: 'Superior', confidence: 0.95, state: 'matched', match: { brand: 'Bacardi', product: 'Superior' } });
    const merged = mergeBottleRead(matched, read({ brand: 'Havana Club', product: 'Añejo 3', confidence: 0.9, state: 'reported' }));
    expect(merged.match).toBeNull();
    expect(merged.state).toBe('reported');
  });
});
