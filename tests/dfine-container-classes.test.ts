import { describe, expect, it } from 'vitest';
import { adaptDfineSegOnnxOutput, UPRIGHT_CONTAINER_CLASS_RULES } from '../src/live/dfineSegAdapter';
import recording from './fixtures/dfine-pr104-recording-detections.json';

type Detection = { label: number; score: number; box: number[] };
const MASK = 32;

function toOutput(rows: Detection[]) {
  // Real labels/boxes/scores from the recording; masks are solid so the test
  // isolates class, score and shape gating from mask quality.
  return {
    labels: rows.map(row => row.label),
    boxes: rows.flatMap(row => row.box),
    scores: rows.map(row => row.score),
    masks: new Float32Array(rows.length * MASK * MASK).fill(1),
    maskWidth: MASK,
    maskHeight: MASK,
  };
}

function adapt(frame: '32.5' | '33.5', withContainers: boolean) {
  const rows = (recording.frames as Record<string, Detection[]>)[frame];
  return adaptDfineSegOnnxOutput(
    toOutput(rows),
    recording.image.width, recording.image.height,
    recording.input.width, recording.input.height,
    1_000,
    withContainers ? { containerClassRules: UPRIGHT_CONTAINER_CLASS_RULES } : {},
  );
}

describe('D-FINE upright container classes (PR #104 recording 0:32-0:34)', () => {
  it('bottle-only filtering misses the three legible E.H. Taylor tubes (the recorded failure)', () => {
    const tubes = adapt('33.5', false).filter(instance => instance.bounds.x < 0.75);
    expect(tubes).toHaveLength(0);
  });

  it('accepts the three tall tubes the COCO head labels "book"', () => {
    const tubes = adapt('33.5', true)
      .filter(instance => instance.detectionConfidence >= 0.58 && instance.bounds.x + instance.bounds.width < 0.97)
      .sort((a, b) => a.bounds.x - b.bounds.x);
    expect(tubes).toHaveLength(3);
    for (const tube of tubes) {
      const aspect = (tube.bounds.height * recording.image.height) / (tube.bounds.width * recording.image.width);
      expect(aspect).toBeGreaterThanOrEqual(1.6);
    }
    expect(tubes[0]!.bounds.x).toBeLessThan(tubes[1]!.bounds.x);
    expect(tubes[1]!.bounds.x).toBeLessThan(tubes[2]!.bounds.x);
  });

  it('also recovers the tubes in the 0:32.5 frame', () => {
    const books = adapt('32.5', true).filter(instance => instance.bounds.x + instance.bounds.width < 0.82);
    expect(books.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps weak and wide "book" boxes and non-container classes out', () => {
    const accepted = adapt('33.5', true);
    for (const instance of accepted) expect(instance.detectionConfidence).toBeGreaterThanOrEqual(0.5);
    // Full-frame / wall / table boxes from classes 72, 69, 0 never pass.
    expect(accepted.every(instance => instance.bounds.width < 0.9)).toBe(true);
  });

  it('rejects a flat "book" even at high confidence', () => {
    const flat = adaptDfineSegOnnxOutput(
      toOutput([{ label: 73, score: 0.95, box: [100, 300, 500, 380] }]),
      512, 720, 640, 640, 1_000, { containerClassRules: UPRIGHT_CONTAINER_CLASS_RULES },
    );
    expect(flat).toEqual([]);
  });
});

import { LocalBottleTracker } from '../src/live/localBottleTracker';

describe('container detections through the local tracker', () => {
  it('shows the strongest tube on the first pass and all three tubes on the second', () => {
    const tracker = new LocalBottleTracker();
    const proposals = adapt('33.5', true).map(instance => ({ bounds: instance.bounds, confidence: instance.detectionConfidence }));
    const tubesOf = (list: ReturnType<LocalBottleTracker['update']>) =>
      list.filter(candidate => candidate.bounds.x + candidate.bounds.width < 0.97 && candidate.confidence >= 0.58);
    // Existing policy: >=0.72 is visible immediately, weaker proposals need a repeat.
    expect(tubesOf(tracker.update(proposals, 10_000))).toHaveLength(1);
    const second = tubesOf(tracker.update(proposals, 11_000));
    expect(second).toHaveLength(3);
    expect(new Set(second.map(candidate => candidate.trackId)).size).toBe(3);
  });
});
