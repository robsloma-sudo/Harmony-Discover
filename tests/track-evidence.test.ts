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

  it('does not show a name from a single read; shows it once reads agree', () => {
    const evidence = new TrackEvidence();
    evidence.observeIdentity(-1, read('Taylor'), 'frame:1');
    const first = evidence.identity(-1)!;
    expect(first.reliable).toBe(false);
    evidence.observeIdentity(-1, read('Taylor'), 'frame:1'); // same read again: counted once
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
