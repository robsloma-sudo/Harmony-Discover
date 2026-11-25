import { describe, expect, it } from 'vitest';
import { expressionShown, keepBackedMatch, shownByWords } from '../src/live/identityBacking';
import { confirmChoices } from '../src/live/confirmChoices';
import { TrackEvidence } from '../src/live/trackEvidence';

describe('a name is only as known as the label words show (Knob Creek, 17 Nov 2026)', () => {
  it('a brand-only read gains no expression from the catalogue', () => {
    const read = { brand: 'Knob Creek', product: '', words: ['KNOB CREEK'], state: 'matched', match: { id: 'p1', brand: 'Knob Creek', product: 'Single Barrel Reserve', score: 0.8 } };
    const kept = keepBackedMatch(read);
    expect(kept.match).toBeNull();
    expect(kept.state).toBe('reported');
  });
  it('numbers must match: 21 is not 9', () => {
    expect(shownByWords('21 Year Old', ['KNOB CREEK', '21', 'YEAR'])).toBe(true);
    expect(shownByWords('Rye 9 Year', ['KNOB CREEK', '21', 'YEAR', 'RYE'])).toBe(false);
  });
  it('keeps a match the words show', () => {
    const read = { brand: 'Eagle Rare', product: '17 Years Old', words: ['Eagle Rare', '17 Years Old'], state: 'matched', match: { id: 'p2', brand: 'Eagle Rare', product: '17 Year', score: 0.9 } };
    expect(keepBackedMatch(read).match?.id).toBe('p2');
    expect(expressionShown(read)).toBe(true);
    expect(expressionShown({ brand: 'Knob Creek', product: '', words: ['KNOB CREEK'] })).toBe(false);
  });
});

describe('which one is it?', () => {
  const catalogue = [
    { brand: 'Knob Creek', product: 'Knob Creek 9 Year', labels: 40, source: 'label' as const },
    { brand: 'Knob Creek', product: 'Knob Creek 21 Year Old', labels: 3, source: 'label' as const },
    { brand: 'Knob Creek', product: 'Knob Creek Rye', labels: 20, source: 'label' as const },
    { brand: 'Wild Turkey', product: 'Wild Turkey 101', labels: 30, source: 'label' as const },
  ];
  it('offers the maker\'s bottles, the one whose number was read first, never another maker', () => {
    const choices = confirmChoices({ brand: 'Knob Creek', product: 'Rye 9 Year', words: ['KNOB CREEK', '21', 'YEARS OLD'] }, catalogue);
    expect(choices[0]).toEqual({ brand: 'Knob Creek', product: '21 Year Old' });
    expect(choices.some(choice => choice.brand === 'Wild Turkey')).toBe(false);
    expect(choices.some(choice => choice.product === 'Rye 9 Year')).toBe(true);   // what the reader said is still a choice
  });
  it('a pick by the person scanning replaces every read and stays', () => {
    const evidence = new TrackEvidence<{ brand: string; product: string; confidence: number; state: string; match: null }>();
    evidence.observeIdentity(-1, { brand: 'Knob Creek', product: 'Rye 9 Year', confidence: 0.9, state: 'reported', match: null }, 'a');
    evidence.confirm(-1, { brand: 'Knob Creek', product: '21 Year Old', confidence: 1, state: 'reported', match: null });
    evidence.observeIdentity(-1, { brand: 'Knob Creek', product: 'Rye 9 Year', confidence: 0.9, state: 'reported', match: null }, 'b');
    evidence.observeIdentity(-1, { brand: 'Knob Creek', product: 'Rye 9 Year', confidence: 0.9, state: 'reported', match: null }, 'c');
    const identity = evidence.identity(-1)!;
    expect(identity.read.product).toBe('21 Year Old');
    expect(identity.confirmed).toBe(true);
    expect(identity.reliable).toBe(true);
  });
});
