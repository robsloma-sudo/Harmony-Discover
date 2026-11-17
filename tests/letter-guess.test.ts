import { describe, expect, it } from 'vitest';
import { biggestWords, brandWords, chooseGuess, fragmentWords, isDescriptorBrand, orderedSimilarity, probableBrand, probableFromFragments, sameBrand, type FragmentMatch, type LetterMatch } from '../src/live/letterGuess';

const m = (brand: string, score: number, exact_hits: number, labels: number, matched_words = 1): LetterMatch => ({ brand, score, exact_hits, labels, matched_words });

// Real phone-reader words and letter-catalogue answers from 80 bottle photos (17 Nov 2026).
const cases: Array<{ photo: string; words: string[]; matches: LetterMatch[]; expected: string | null }> = [
  { photo: 'Jameson, clean', words: ['jameson', 'jameson'], matches: [m('Jameson', 3.493, 4, 105), m('Mom Jeans', 2.079, 0, 6), m('Mae Son', 2.072, 0, 4)], expected: 'Jameson' },
  { photo: 'Jameson, clipped J', words: ['jameson', 'ast', 'jameso'], matches: [m('Jameson', 1.573, 1, 105), m('Mae Son', 0.992, 0, 4), m('Saint James', 0.856, 0, 32)], expected: 'Jameson' },
  { photo: "Jack Daniel's, one misread", words: ['jack daniiels'], matches: [m("Jack Daniel's", 1.302, 0, 160), m('Jack Daniel"S', 1.214, 0, 1)], expected: "Jack Daniel's" },
  { photo: 'Smirnoff, unreadable', words: ['bomile', 'louor'], matches: [m('Mobile Pub', 0.732, 1, 4), m('Murk Mobile', 0.714, 1, 1)], expected: null },
  { photo: 'Bacardi, half read', words: ['card', 'icardi'], matches: [m('Card Shark', 0.736, 1, 5), m('Green Card', 0.732, 1, 4), m('Rookie Card', 0.722, 1, 2)], expected: null },
  { photo: 'Johnnie Walker Gold Label', words: ['goldlabel', 'seuteuary', 'johnnie walke'], matches: [m('Gold Label', 1.022, 1, 2), m('Golden Ball', 0.614, 0, 1), m('Johnnie Walker', 0.576, 0, 119)], expected: null },
  { photo: "Maker's Mark", words: ['mark', 'makers'], matches: [m("Maker's Mark", 2.364, 3, 182), m("Marker's Mark", 1.574, 1, 1), m('Maker', 1.152, 0, 35)], expected: "Maker's Mark" },
  { photo: 'Tanqueray', words: ['tanqueray', 'nory'], matches: [m('Tanqueray', 1.067, 1, 28), m('Ryno', 0.859, 1, 18), m('Tanqueray Sevilla Orange', 0.552, 1, 1)], expected: 'Tanqueray' },
  { photo: 'Bombay Sapphire', words: ['sapphre', 'bombay'], matches: [m('Bombay Sapphire', 1.566, 1, 8, 3), m('Bombay', 0.846, 1, 9), m('Sapphire', 0.628, 0, 3)], expected: 'Bombay Sapphire' },
  { photo: 'Grey Goose, clipped', words: ['rey gc'], matches: [m('Grey', 1.232, 0, 4), m('Grace', 0.932, 0, 4)], expected: null },
  { photo: 'Bulleit (sister spelling close behind)', words: ['bulleit', 'frontier'], matches: [m('Bulleit', 1.086, 1, 74), m('Bulliet', 1.022, 1, 2), m('Frontier', 0.836, 1, 5)], expected: 'Bulleit' },
  { photo: 'Shelf of other bottles', words: ['ricobay', 'bacarde', 'gordons'], matches: [m('Rico Bay', 1.022, 1, 2), m("Gordon's", 0.844, 1, 8)], expected: null },
  { photo: 'Baileys Birthday Cake', words: ['birthday', 'cake', 'baileys'], matches: [m('Birthday Cake', 2.282, 3, 2), m('Frothsty - Birthday Cake', 0.99, 2, 1)], expected: null },
  { photo: 'Jagermeister, misread', words: ['jagermeiter'], matches: [m('Jagermeister', 1.231, 0, 60), m('Das Jägermeister Beer', 0.667, 0, 3)], expected: 'Jagermeister' },
  { photo: "Tito's (anagram Tosti)", words: ['titos'], matches: [m('Tosti', 2.051, 2, 12), m('Sotit', 2.014, 2, 1), m('Titos', 2.014, 2, 1)], expected: null },
  { photo: 'Ketel One, unreadable', words: ['nots'], matches: [m('Stone', 1.151, 0, 48), m('Santo', 1.13, 0, 16), m('Notes', 1.109, 0, 5)], expected: null },
  { photo: 'Campari, unreadable', words: ['pamper', 'vide', 'ampan'], matches: [m('Vide', 0.871, 1, 33), m('Pan Am', 0.822, 1, 2), m('Dive', 0.814, 1, 1)], expected: null },
  { photo: 'Cointreau', words: ['cointreau', 'ngers'], matches: [m('Cointreau', 1.067, 1, 27), m('Cointreau Noir', 0.722, 1, 2)], expected: 'Cointreau' },
  { photo: 'Laphroaig, weak', words: ['manufactum', 'bottleo for', 'laphroalg'], matches: [m('Laphroaig', 0.449, 0, 85)], expected: null },
  { photo: 'Talisker', words: ['talisker', 'talisker'], matches: [m('Talisker', 1.873, 2, 37), m('Kistler', 1.102, 0, 2), m('Triskel', 1.102, 0, 2)], expected: 'Talisker' },
];

describe('probable brand from the biggest label words', () => {
  for (const c of cases) {
    it(c.photo, () => expect(probableBrand(c.matches, c.words)).toBe(c.expected));
  }

  it('never shows a descriptor as a brand', () => {
    expect(isDescriptorBrand('Single Barrel')).toBe(true);
    expect(isDescriptorBrand('Original Rum')).toBe(true);
    expect(isDescriptorBrand('Four Roses')).toBe(false);
    expect(probableBrand([m('Single Barrel', 2, 2, 28), m("Jack Daniel's", 0.7, 0, 160)], ['single barrel'])).toBeNull();
  });

  it('keeps brand words and drops descriptors, scraps and apostrophes', () => {
    expect(brandWords(["JACK DANIEL'S", 'SINGLE BARREL'])).toEqual(['jack daniels']);
    expect(brandWords(['LONDON DRY GIN', 'Tanqueray'])).toEqual(['tanqueray']);
    expect(brandWords(['DRY Gin', 'GORDON', '& Cos', 'DISTILLERY,'])).toEqual(['gordon']);
    expect(brandWords(["Tito's.", 'Handmade', 'VODKA'])).toEqual(['titos', 'handmade']);
    expect(brandWords(['40% ALC/VOL', '750 ML'])).toEqual([]);
  });

  it('uses spelling order to break letter-order ties', () => {
    expect(orderedSimilarity(['titos'], 'Titos')).toBe(1);
    expect(orderedSimilarity(['titos'], 'Tosti')).toBeLessThan(0.7);
    expect(orderedSimilarity(['makers', 'mark'], "Maker's Mark")).toBe(1);
  });

  it('compares a guess with the cloud name by brand family', () => {
    expect(sameBrand('Jameson', 'Jameson Irish Whiskey')).toBe(true);
    expect(sameBrand("Jack Daniel's", 'Jack Daniels')).toBe(true);
    expect(sameBrand('Patrón', 'Patron')).toBe(true);
    expect(sameBrand('Jim Beam', 'Jameson')).toBe(false);
  });

  it('takes the biggest words first', () => {
    expect(biggestWords([{ text: 'VODKA', confidence: 0.9, height: 20 }, { text: 'ABSOLUT', confidence: 0.9, height: 60 }], 1)).toEqual(['ABSOLUT']);
  });
});

const fm = (brand: string, score: number, labels: number, coverage: number, fragments_matched = 1): FragmentMatch => ({ brand, score, labels, coverage, fragments_matched });

// Real part-word answers (17 Nov 2026): what a curved bottle lets the phone read.
describe('probable brand from part-words (round bottles)', () => {
  it('AMESON -> Jameson', () => expect(probableFromFragments([fm('Jameson', 1.1, 105, 0.857), fm('Parmeson', 0.656, 5, 0.563)])).toBe('Jameson'));
  it('WILD + URKEY -> Wild Turkey', () => expect(probableFromFragments([fm('Wild Turkey', 1.143, 104, 0.9, 2), fm('Wilde', 0.908, 7, 0.8), fm('Wilds', 0.872, 3, 0.8)])).toBe('Wild Turkey'));
  it('IMBEAM -> Jim Beam', () => expect(probableFromFragments([fm('Jim Beam', 0.869, 175, 0.857), fm('Mimbeau', 0.507, 2, 0.643)])).toBe('Jim Beam'));
  it('CARDI fits Bacardi and Zuccardi: no guess', () => expect(probableFromFragments([fm('Ricard', 1.51, 5, 1, 2), fm('Bacardi', 1.304, 149, 1, 2), fm('Cardiff', 1.287, 3, 1, 2), fm('Zuccardi', 1.146, 87, 1, 2)])).toBeNull());
  it('junk pieces only fit rare names: no guess', () => expect(probableFromFragments([fm('Pampero', 0.941, 4, 0.857), fm('Sampan', 0.935, 6, 0.833)])).toBeNull());
  it('a weak fit is not enough', () => expect(probableFromFragments([fm('Walker\'s', 0.941, 4, 0.857), fm('Hiram Walker', 0.763, 64, 0.545)])).toBeNull());
  it('a far better rare fit blocks the guess', () => expect(probableFromFragments([fm('Oddname', 1.6, 3, 1), fm('Bacardi', 1.0, 149, 0.7)])).toBeNull());
  it('pieces sent for the search', () => expect(fragmentWords(['AMESON', 'VODKA', 'WILD TURKEY', 'ab'])).toEqual(['ameson', 'wildturkey', 'wild', 'turkey']));
});

describe('part-word guesses near the bottle edge (synthetic curved labels, 17 Nov 2026)', () => {
  it('JAMESO -> Jameson', () => expect(probableFromFragments([fm('Jameson', 1.1, 105, 0.857), fm('St. James', 0.751, 7, 0.643), fm('Tobin James', 0.642, 39, 0.45)])).toBe('Jameson'));
  it('CAMPAR fits Camparo and Campari: no guess', () => expect(probableFromFragments([fm('Camparo', 1.054, 43, 0.857), fm('Campari', 0.987, 11, 0.857)])).toBeNull());
  it('BACAR -> Bacardi', () => expect(probableFromFragments([fm('Bacardi', 0.975, 149, 0.714), fm('Bacaro', 0.906, 3, 0.833), fm('Bacardi 8', 0.772, 2, 0.714)])).toBe('Bacardi'));
  it('LAPHRO -> Laphroaig', () => expect(probableFromFragments([fm('Laphroaig', 0.899, 85, 0.667), fm('Laphroig', 0.786, 1, 0.75)])).toBe('Laphroaig'));
  it('JAMES alone is too close to St. James: no guess', () => expect(probableFromFragments([fm('Jameson', 0.957, 105, 0.714), fm('James I', 0.869, 1, 0.833), fm('St. James', 0.823, 7, 0.714)])).toBeNull());
  it('a cut word spelling another brand loses to the longer brand', () => {
    expect(chooseGuess({ brand: 'Barac', labels: 9 }, { brand: 'Bacardi', labels: 149 }, true)).toBe('Bacardi');
    expect(chooseGuess({ brand: 'Mater', labels: 9 }, { brand: 'Martell', labels: 56 }, false)).toBe('Martell');
  });
  it('a clean whole word keeps its guess', () => {
    expect(chooseGuess({ brand: 'Absolut', labels: 174 }, null, false)).toBe('Absolut');
    expect(chooseGuess({ brand: 'Jameson', labels: 105 }, { brand: "Jameson's Vodka", labels: 1 }, false)).toBe('Jameson');
  });
  it('a cut word spelling a lesser-known brand is not trusted alone', () => {
    expect(chooseGuess({ brand: 'James', labels: 27 }, null, true)).toBeNull();
  });
});
