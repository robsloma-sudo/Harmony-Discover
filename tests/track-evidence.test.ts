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
    evidence.observeIdentity(-1, read('Taylor', 0.8), 'frame:1');
    const first = evidence.identity(-1)!;
    expect(first.reliable).toBe(false);
    evidence.observeIdentity(-1, read('Taylor', 0.8), 'frame:1'); // same read again: counted once
    expect(evidence.identity(-1)!.confidence).toBe(first.confidence);
    evidence.observeIdentity(-1, read('Taylor', 0.88), 'label:2');
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
