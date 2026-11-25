import { describe, expect, it } from 'vitest';
import { TrackEvidence, identityKey } from '../src/live/trackEvidence';

const read = (brand: string, confidence = 0.9, matched = true) => ({
  brand, product: 'Small Batch', confidence, state: matched ? 'matched' : 'unsure',
  match: matched ? { id: 'id-' + brand, brand, product: 'Small Batch', score: 0.95 } : null,
});

describe('evidence that builds up while scanning', () => {
  it('bottle certainty only goes up, even when a later pass scores lower', () => {
    const evidence = new TrackEvidence();
    const shown = [0.7, 0.9, 0.6, 0.65, 0.8].map(c => evidence.observeDetection(1, c));
    for (let i = 1; i < shown.length; i++) expect(shown[i]!).toBeGreaterThanOrEqual(shown[i - 1]!);
    expect(shown[shown.length - 1]!).toBeGreaterThan(0.9);
  });

  it('does not confirm a name from one weaker read; confirms it once reads agree', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-1, read('Taylor', 0.7), 'frame:1');
    const first = evidence.identity(-1)!;
    expect(first.reliable).toBe(false);
    evidence.observeIdentity(-1, read('Taylor', 0.7), 'frame:1'); // same read again: counted once
    expect(evidence.identity(-1)!.confidence).toBe(first.confidence);
    evidence.observeIdentity(-1, read('Taylor', 0.75), 'label:2');
    const second = evidence.identity(-1)!;
    expect(second.confidence).toBeGreaterThan(first.confidence);
    expect(second.reliable).toBe(true);
    expect(second.read.brand).toBe('Taylor');
  });

  it('holds back a name while reads disagree', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-1, read('Taylor'), 'a');
    evidence.observeIdentity(-1, read('Weller'), 'b');
    evidence.observeIdentity(-1, read('Taylor'), 'c');
    expect(evidence.identity(-1)!.reliable).toBe(false);
    evidence.observeIdentity(-1, read('Taylor'), 'd');
    evidence.observeIdentity(-1, read('Taylor'), 'e');
    expect(evidence.identity(-1)!.reliable).toBe(true);
  });

  it('needs a third agreeing read when uncatalogued reads are only fairly legible', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-1, read('Blanton', 0.65, false), 'a');
    evidence.observeIdentity(-1, read('Blanton', 0.65, false), 'b');
    expect(evidence.identity(-1)!.reliable).toBe(false);
    evidence.observeIdentity(-1, read('Blanton', 0.65, false), 'c');
    expect(evidence.identity(-1)!.reliable).toBe(true);
  });

  it('carries evidence across merged tracks and ignores reads with no name', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-5, read('Taylor'), 'a');
    evidence.observeIdentity(-6, read('Taylor'), 'b');
    evidence.migrate(-5, -6);
    expect(evidence.identity(-6)!.reliable).toBe(true);
    expect(identityKey({ brand: '', product: '', confidence: 0.9 })).toBeNull();
  });
});

describe('reads that word the same bottle differently', () => {
  it('agree on one bottle despite OCR differences in brand and expression', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-1, { brand: 'E.H. Taylor', product: 'Small Batch', confidence: 0.86, state: 'reported', match: null }, 'a');
    evidence.observeIdentity(-1, { brand: 'Colonel E.H. Taylor, Jr.', product: 'Small Batch Bottled in Bond', confidence: 0.9, state: 'reported', match: null }, 'b');
    const identity = evidence.identity(-1)!;
    expect(identity.reliable).toBe(true);
    expect(identity.agreeingReads).toBe(2);
    expect(identity.read.product).toBe('Small Batch Bottled in Bond');
  });

  it('keeps different brands apart', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-1, { brand: 'Blanton\'s', product: 'Single Barrel', confidence: 0.9, state: 'reported', match: null }, 'a');
    evidence.observeIdentity(-1, { brand: 'Weller', product: 'Special Reserve', confidence: 0.9, state: 'reported', match: null }, 'b');
    expect(evidence.identity(-1)!.reliable).toBe(false);
  });
});

describe('identity builds up across reads', () => {
  it('fills what the best read missed from the other reads of the same bottle', async () => {
    const { TrackEvidence } = await import('../src/live/trackEvidence');
    const evidence = new TrackEvidence<{ brand: string; product: string; confidence: number; proof?: string; size?: string; words?: string[]; details?: Record<string, string> }>();
    evidence.observeIdentity(7, { brand: 'E.H. Taylor', product: 'Barrel Proof', confidence: 0.9, proof: '', size: '750ml', words: ['BARREL'] }, 'a');
    evidence.observeIdentity(7, { brand: 'E.H. Taylor', product: 'Barrel Proof', confidence: 0.92, proof: '127.3', size: '', words: ['PROOF'], details: { lot_code: 'L25295' } }, 'b');
    const read = evidence.identity(7)!.read;
    expect(read.proof).toBe('127.3');
    expect(read.size).toBe('750ml');
    expect(read.words).toEqual(['PROOF', 'BARREL']);
    expect(read.details?.lot_code).toBe('L25295');
  });

  it('confirms a name from one clear read (90%+)', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(5, read('Giuliano Rosati', 0.95), 'label:1');
    const shown = evidence.identity(5)!;
    expect(shown.reliable).toBe(true);
    expect(shown.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('a confirmed name and its number stick while the bottle is tracked', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(7, read('Taylor', 0.95), 'a');
    const confirmed = evidence.identity(7)!;
    expect(confirmed.reliable).toBe(true);
    // A single odd read of something else does not undo it or lower the number.
    evidence.observeIdentity(7, read('Weller', 0.7), 'b');
    const after = evidence.identity(7)!;
    expect(after.reliable).toBe(true);
    expect(after.read.brand).toBe('Taylor');
    expect(after.confidence).toBeGreaterThanOrEqual(confirmed.confidence);
  });

  it('the shown number only climbs while the same name leads', () => {
    const evidence = new TrackEvidence();
    const values: number[] = [];
    [0.7, 0.4, 0.6].forEach((c, i) => { evidence.observeIdentity(9, read('Mescladis', c, false), 'r' + i); values.push(evidence.identity(9)!.confidence); });
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  });
});

describe('wine labels with two names (estate and cuvée)', () => {
  const wine = (brand: string, product: string, confidence = 0.85) => ({ brand, product, confidence, state: 'reported', match: null });

  it('accents do not split one name', async () => {
    const { foldWords } = await import('../src/live/trackEvidence');
    expect(foldWords('Mescladís')).toBe('mescladis');
    expect(foldWords('Château Léoville')).toBe('chateau leoville');
  });

  it('"Mescladís / Pic Saint Loup" and "Domaine Clavel / Mescladís" are one bottle', async () => {
    const { sameBottleIdentity } = await import('../src/live/trackEvidence');
    expect(sameBottleIdentity(wine('Mescladís', 'Pic Saint Loup'), wine('Domaine Clavel', 'Mescladís'))).toBe(true);
    expect(sameBottleIdentity(wine('Mescladis', ''), wine('Mescladís', 'Rosé'))).toBe(true);
  });

  it('a shared grape or place never makes two brands agree', async () => {
    const { sameBottleIdentity } = await import('../src/live/trackEvidence');
    expect(sameBottleIdentity(wine('Giuliano Rosati', 'Pinot Grigio'), wine('Barefoot', 'Pinot Grigio'))).toBe(false);
    expect(sameBottleIdentity(wine('Domaine Clavel', 'Pic Saint Loup'), wine('Château de Lancyre', 'Pic Saint Loup'))).toBe(false);
  });

  it('the two wordings add up to a confirmed name instead of splitting the vote', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(3, wine('Mescladís', 'Pic Saint Loup', 0.85), 'label:base:1');
    evidence.observeIdentity(3, wine('Domaine Clavel', 'Mescladís', 0.8), 'label:escalate:1');
    const identity = evidence.identity(3)!;
    expect(identity.agreeingReads).toBe(2);
    expect(identity.reliable).toBe(true);
  });
});

describe('flies up at 80%', () => {
  it('one clear read at 80% confirms the name at once', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(4, read('Mescladis', 0.8), 'label:1');
    expect(evidence.identity(4)!.reliable).toBe(true);
  });
});

describe('reads of a partly hidden label are clues, not proof (17 Nov 2026)', () => {
  const taylor = (confidence: number, partial: boolean, product = '') => ({ brand: 'Taylor', product, confidence, state: 'reported', match: null, partial });

  it('never confirms a name from partial reads alone, however many agree', () => {
    const evidence = new TrackEvidence();
    // The canister behind the Knob Creek 21 read as plain "Taylor" (the rest of its label was hidden).
    for (let i = 0; i < 5; i++) evidence.observeIdentity(-2, taylor(0.9, true), 'label:' + i);
    const identity = evidence.identity(-2)!;
    expect(identity.reliable).toBe(false);
    expect(identity.agreeingReads).toBe(5);
  });

  it('confirms once a read of the whole label (or the targeted check) agrees, and shows that read', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-2, taylor(0.85, true, 'Kentucky Straight Bourbon'), 'label:1');
    evidence.observeIdentity(-2, { brand: 'Colonel E.H. Taylor', product: 'Cured Oak', confidence: 0.85, state: 'reported', match: null }, 'check:2');
    const identity = evidence.identity(-2)!;
    expect(identity.reliable).toBe(true);
    expect(identity.read.brand).toBe('Colonel E.H. Taylor');
    expect(identity.read.product).toBe('Cured Oak');
  });

  it('a partial read counts for less than a whole one', () => {
    const whole = new TrackEvidence(), part = new TrackEvidence();
    whole.observeIdentity(-1, taylor(0.7, false), 'a');
    part.observeIdentity(-1, taylor(0.7, true), 'a');
    expect(part.identity(-1)!.confidence).toBeLessThan(whole.identity(-1)!.confidence);
  });
});

describe('two hesitant reads are not enough (Very Old Barton, 17 Nov 2026)', () => {
  const plain = (confidence: number) => ({ brand: 'Very Old Barton', product: 'Kentucky Straight Rye', confidence, state: 'reported', match: null });
  it('does not confirm a name from two unmatched reads under 80%', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-1, plain(0.77), 'label:1');
    evidence.observeIdentity(-1, plain(0.78), 'label:2');
    expect(evidence.identity(-1)!.reliable).toBe(false);
  });
  it('confirms it with a third agreeing read, or one clear read', () => {
    const third = new TrackEvidence();
    ['label:1', 'label:2', 'label:3'].forEach(key => third.observeIdentity(-1, plain(0.77), key));
    expect(third.identity(-1)!.reliable).toBe(true);
    const clear = new TrackEvidence();
    clear.observeIdentity(-1, plain(0.77), 'label:1');
    clear.observeIdentity(-1, plain(0.82), 'label:2');
    expect(clear.identity(-1)!.reliable).toBe(true);
  });
});

describe('the scanner can change its mind about a name (FIX-015, 21 Nov 2026)', () => {
  const clock = () => { let t = 0; return { now: () => t, tick: (ms: number) => { t += ms; } }; };
  const wrong = (confidence = 0.9) => ({ brand: 'Weller', product: 'Special Reserve', confidence, state: 'reported', match: null });
  const right = (confidence = 0.75) => ({ brand: 'Blanton\'s', product: 'Original Single Barrel', confidence, state: 'reported', match: null });

  it('an early wrong name is replaced after a few clear different reads', () => {
    const time = clock();
    const evidence = new TrackEvidence({ now: time.now });
    evidence.observeIdentity(1, wrong(), 'label:0');
    expect(evidence.identity(1)!.reliable).toBe(true);
    expect(evidence.identity(1)!.read.brand).toBe('Weller');
    for (let i = 1; i <= 3; i++) {
      time.tick(1000);
      evidence.observeIdentity(1, right(), 'label:' + i);
    }
    const identity = evidence.identity(1)!;
    expect(identity.read.brand).toBe('Blanton\'s');
    expect(identity.reliable).toBe(true);
    // Before this fix it took about 8 such reads.
  });

  it('one or two different reads do not unseat a confirmed name', () => {
    const time = clock();
    const evidence = new TrackEvidence({ now: time.now });
    evidence.observeIdentity(1, right(0.85), 'label:0');
    time.tick(500);
    evidence.observeIdentity(1, right(0.8), 'label:1');
    for (let i = 2; i <= 3; i++) { time.tick(1000); evidence.observeIdentity(1, wrong(0.75), 'label:' + i); }
    expect(evidence.identity(1)!.read.brand).toBe('Blanton\'s');
  });

  it('near-identical camera frames count once', () => {
    const time = clock();
    const evidence = new TrackEvidence({ now: time.now });
    for (let i = 0; i < 10; i++) { evidence.observeIdentity(2, right(0.77 + (i % 2) * 0.01), 'frame:' + i); time.tick(100); }
    expect(evidence.identity(2)!.agreeingReads).toBe(1);
    // The same view a moment later, or a clearly different read, does count.
    time.tick(1500);
    evidence.observeIdentity(2, right(0.77), 'frame:later');
    expect(evidence.identity(2)!.agreeingReads).toBe(2);
  });

  it('identical frames cannot replace a name on their own', () => {
    const time = clock();
    const evidence = new TrackEvidence({ now: time.now });
    evidence.observeIdentity(3, right(0.85), 'label:0');
    time.tick(2000);
    for (let i = 0; i < 12; i++) { evidence.observeIdentity(3, wrong(0.8), 'frame:' + i); time.tick(80); }
    expect(evidence.identity(3)!.read.brand).toBe('Blanton\'s');
  });

  it('a name the person picked by hand never changes', () => {
    const time = clock();
    const evidence = new TrackEvidence({ now: time.now });
    evidence.observeIdentity(4, wrong(), 'label:0');
    evidence.confirm(4, right(1));
    for (let i = 1; i <= 20; i++) { time.tick(1000); evidence.observeIdentity(4, wrong(0.95), 'label:' + i); }
    const identity = evidence.identity(4)!;
    expect(identity.read.brand).toBe('Blanton\'s');
    expect(identity.confirmed).toBe(true);
    expect(identity.reliable).toBe(true);
  });
});
