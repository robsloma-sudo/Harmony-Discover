import { describe, expect, it } from 'vitest';
import fixture from './fixtures/partial-evidence-candidates.json';
import {
  anchorsFor, checkNames, familyKey, guessLabel, nameWords, partialGuess, pieceFit, piecesFromWords, productWithoutBrand, rankNames, sameMaker,
  sceneFromVenueFeed, scoreName, tidyName, type NameCandidate, type PriorName,
} from '../src/live/partialEvidence';

const lookups = fixture.lookups as Record<string, NameCandidate[]>;
const expected = fixture.expected as Record<string, { plain: string | null; scene: string | null }>;
const SCENE: PriorName[] = [{ brand: 'Colonel E.H. Taylor', product: 'Small Batch', source: 'session' }];

/** The decision for words a label read saw, against the recorded catalogue answer for them. */
function decide(text: string, priors: PriorName[] = []) {
  const pieces = piecesFromWords(text.split(' '));
  const anchors = anchorsFor(pieces);
  const guess = partialGuess(pieces, rankNames(pieces, anchors.length ? lookups[anchors.join(',')] ?? [] : [], priors));
  return guess ? guess.brand + (guess.product ? ' | ' + guess.product : '') : null;
}

describe('partial evidence: words from a partly hidden label', () => {
  it('names E.H. Taylor Cured Oak from TAYLO + CURED (the canister behind the Knob Creek 21)', () => {
    expect(decide('TAYLO CURED')).toBe('Colonel E.H. Taylor | Cured Oak');
    expect(decide('THE LABEL COLONEL E.H. TAYLOR, JR. 1ST AND ONLY CURED')).toBe('Colonel E.H. Taylor | Cured Oak');
  });

  it('says nothing for a word many makers share, or a made-up name', () => {
    for (const text of ['TAYLOR', 'TAYLO', 'COLONEL', 'JACK', 'CREEK', 'MOONBRIAR RESERVE BOURBON', 'HALF HARD ICED TEA']) {
      expect(decide(text), text).toBeNull();
    }
  });

  it('says nothing when one crop shows two labels', () => {
    expect(decide('KNOB CREEK TAYLO CURED')).toBeNull();
    expect(decide("MAKER'S MARK BUFFALO TRACE")).toBeNull();
  });

  it('what this session already confirmed tips close calls, but not mixed labels', () => {
    expect(decide('CURED OAK', SCENE)).toBe('Colonel E.H. Taylor | Cured Oak');
    expect(decide('URED OAK TAYLOR', SCENE)).toBe('Colonel E.H. Taylor | Cured Oak');
    expect(decide('BARREL PROOF TAYLOR', SCENE)).toBe('Colonel E.H. Taylor');
    expect(decide('KNOB CREEK TAYLO CURED', SCENE)).toBeNull();
  });

  it('matches every recorded decision (live catalogue answers, 17 Nov 2026)', () => {
    for (const [text, want] of Object.entries(expected)) {
      expect(decide(text), text).toBe(want.plain);
      expect(decide(text, SCENE), text + ' (scene)').toBe(want.scene);
    }
  });

  it('a scene name cannot overturn what the words clearly show', () => {
    // Confirmed this session: a different maker. TAYLO + CURED still points to E.H. Taylor.
    expect(decide('TAYLO CURED', [{ brand: 'Duncan Taylor', product: 'Octave', source: 'session' }])).toBe('Colonel E.H. Taylor | Cured Oak');
  });
});

describe('pieces of a label', () => {
  it('cut descriptors stay descriptors; names are looked up longest first', () => {
    const pieces = piecesFromWords(['HISKEY', 'PROO', 'TAYLO', 'CURED', 'E.H.', 'URBON']);
    const kinds = Object.fromEntries(pieces.map(p => [p.text, p.kind]));
    expect(kinds).toMatchObject({ hiskey: 'category', proo: 'category', urbon: 'category', taylo: 'name', cured: 'name', eh: 'name' });
    expect(pieces.find(p => p.text === 'urbon')?.full).toBe('bourbon');
    expect(anchorsFor(pieces)).toEqual(['cured', 'taylo']);
  });

  it('a word cut at either edge still fits; possessives match', () => {
    expect(pieceFit('taylo', 'taylor')).toBeGreaterThan(0.9);
    expect(pieceFit('ured', 'cured')).toBeGreaterThan(0.85);
    expect(pieceFit('makers', 'maker')).toBeGreaterThan(0.95);
    expect(pieceFit('trace', 'race')).toBe(0);
  });

  it('spellings of one maker agree; different makers stay apart', () => {
    expect(nameWords('E. H. Taylor')).toEqual(['eh', 'taylor']);
    expect(familyKey('COLONEL E.H. TAYLOR')).toBe(familyKey('Colonel E.H.Taylor'));
    const maker = (brand: string) => scoreName([], { brand, product: '', labels: 0, source: 'label' });
    expect(sameMaker(maker("Tito's"), maker("Tito's Handmade"))).toBe(true);
    expect(sameMaker(maker("Jack Daniel's Country Cocktails"), maker("Jack Daniel's Tennessee Whiskey"))).toBe(true);
    expect(sameMaker(maker('Taylor'), maker('Duncan Taylor'))).toBe(false);
    expect(sameMaker(maker('Wild Turkey'), maker('Wild Parallel'))).toBe(false);
  });
});

describe('what is shown', () => {
  it('drops the brand repeated in a product name and tidies capitals', () => {
    expect(productWithoutBrand('Colonel E.H. Taylor', 'Colonel E.H. Taylor Barrel Proof Rye')).toBe('Barrel Proof Rye');
    expect(productWithoutBrand('Remy Martin', 'Rémy Martin XO')).toBe('XO');
    expect(tidyName('COLONEL E.H. TAYLOR')).toBe('Colonel E.H. Taylor');
    expect(tidyName("MAKER'S MARK")).toBe("Maker's Mark");
    expect(guessLabel({ brand: 'Colonel E.H. Taylor', product: 'Cured Oak' })).toBe('Colonel E.H. Taylor Cured Oak');
  });

  it('turns a venue feed into scene names (menus only tip, never become names)', () => {
    const scene = sceneFromVenueFeed({ bottles: [{ brand: 'Knob Creek', product: '21 Year' }], menus: [{ items: [{ name: 'E.H. Taylor Small Batch pour' }] }] });
    expect(scene).toEqual([
      { brand: 'Knob Creek', product: '21 Year', source: 'venue' },
      { brand: 'E.H. Taylor Small Batch pour', product: '', source: 'menu' },
    ]);
    expect(sceneFromVenueFeed(null)).toEqual([]);
  });
});

describe('what the targeted check is asked', () => {
  it('products when one is clear; makers when only the brand is', () => {
    const run = (text: string, priors: PriorName[] = []) => {
      const pieces = piecesFromWords(text.split(' '));
      return partialGuess(pieces, rankNames(pieces, lookups[anchorsFor(pieces).join(',')] ?? [], priors));
    };
    const product = run('TAYLO CURED')!;
    expect(checkNames(product)[0]).toEqual({ brand: 'Colonel E.H. Taylor', product: 'Cured Oak' });
    const brand = run('BARREL PROOF TAYLOR', SCENE)!;
    const names = checkNames(brand);
    expect(names[0]).toEqual({ brand: 'Colonel E.H. Taylor', product: '' });
    expect(names.every(name => name.product === '')).toBe(true);
    expect(new Set(names.map(name => name.brand)).size).toBe(names.length);
  });
});
