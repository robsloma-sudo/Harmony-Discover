import { describe, expect, it } from 'vitest';
import { LocalBottleTracker, isNestedBottlePart, isSameBottle, removeNestedBottleProposals } from '../src/live/localBottleTracker';

const box = (x: number, y = 0.3, width = 0.12, height = 0.4) => ({ x, y, width, height });
const bottle = (x: number, y = 0.3, confidence = 0.9) => ({ bounds: box(x, y), confidence });
const pan = (dx: number) => ({ tx: dx, ty: 0, scale: 1 });
// Distinct colour fingerprints for distinct labels.
const look = (bin: number) => { const signature = new Float32Array(64); signature[bin] = 1; return signature; };

describe('bottle neck and part duplicates', () => {
  const full = box(0.4, 0.2, 0.14, 0.6);

  it('treats a neck box poking above the shoulder as part of the bottle', () => {
    // Neck box partly above the full box: 70% of it lies inside.
    const neck = { x: 0.445, y: 0.15, width: 0.05, height: 0.17 };
    expect(isNestedBottlePart(full, neck)).toBe(true);
    expect(isSameBottle(full, neck)).toBe(true);
  });

  it('treats a wide shoulder-and-neck box as part of the bottle', () => {
    const shoulder = { x: 0.41, y: 0.2, width: 0.12, height: 0.24 };
    expect(isNestedBottlePart(full, shoulder)).toBe(true);
  });

  it('treats a label box inside the bottle as part of it', () => {
    const label = { x: 0.42, y: 0.45, width: 0.1, height: 0.2 };
    expect(isNestedBottlePart(full, label)).toBe(true);
  });

  it('keeps a neighbouring bottle that only touches the edge', () => {
    const neighbour = { x: 0.53, y: 0.22, width: 0.12, height: 0.55 };
    expect(isNestedBottlePart(full, neighbour)).toBe(false);
    expect(removeNestedBottleProposals([{ bounds: full, confidence: 0.9 }, { bounds: neighbour, confidence: 0.9 }])).toHaveLength(2);
  });

  it('never adds a second box when only the neck is detected on a later pass', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([{ bounds: full, confidence: 0.9 }], 1000);
    const [track] = tracker.update([{ bounds: full, confidence: 0.9 }], 1300);
    const neckOnly = tracker.update([{ bounds: { x: 0.445, y: 0.16, width: 0.05, height: 0.16 }, confidence: 0.9 }], 1600);
    expect(neckOnly).toHaveLength(1);
    expect(neckOnly[0]!.trackId).toBe(track!.trackId);
    expect(neckOnly[0]!.bounds).toEqual(track!.bounds);
  });

  it('merges a neck track into the whole bottle once the whole bottle is found', () => {
    const tracker = new LocalBottleTracker();
    const neck = { bounds: { x: 0.445, y: 0.16, width: 0.05, height: 0.16 }, confidence: 0.9 };
    tracker.update([neck], 1000);
    tracker.update([neck], 1300);
    // A full-bottle box elsewhere in the same frame as a second track.
    const visible = tracker.update([{ bounds: full, confidence: 0.92 }, neck], 1600);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.bounds.height).toBeGreaterThan(0.3);
    tracker.takeMergedTrackIds();
  });
});

describe('spatial memory of bottles', () => {
  it('remembers a bottle that leaves the screen and restores its ID when the camera returns', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([bottle(0.3)], 1000);
    const [original] = tracker.update([bottle(0.3)], 1300);
    // Pan right: the bottle slides off the left edge.
    for (let i = 0; i < 6; i++) tracker.applyCameraMotion(pan(-0.12), 1400 + i * 30);
    expect(tracker.update([], 2000)).toEqual([]);
    expect(tracker.update([], 9000)).toEqual([]);
    // Pan back: it is shown at once from memory, before the detector sees it.
    for (let i = 0; i < 6; i++) tracker.applyCameraMotion(pan(0.12), 60_000 + i * 30);
    const shown = tracker.visible(60_200);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ trackId: original!.trackId, remembered: true });
    expect(shown[0]!.bounds.x).toBeCloseTo(0.3, 5);
    // The detector confirms it; the same ID continues.
    const confirmed = tracker.update([bottle(0.31)], 60_400);
    expect(confirmed[0]!.trackId).toBe(original!.trackId);
    expect(confirmed[0]!.remembered).toBeUndefined();
    expect(tracker.takeReacquiredTrackIds()).toEqual([original!.trackId]);
  });

  it('re-finds a whole remembered shelf even after its position drifted', () => {
    const tracker = new LocalBottleTracker();
    const shelf = [0.1, 0.3, 0.5, 0.7].map(x => bottle(x));
    tracker.update(shelf, 1000);
    const first = tracker.update(shelf, 1300);
    tracker.applyCameraMotion(pan(-1.2), 1400);
    tracker.update([], 2000);
    // Come back with 0.1 of accumulated drift (more than half the spacing / 2).
    tracker.applyCameraMotion(pan(1.2), 30_000);
    const drifted = [0.2, 0.4, 0.6, 0.8].map(x => bottle(x));
    const back = tracker.update(drifted, 30_200);
    expect(back.map(item => item.trackId)).toEqual(first.map(item => item.trackId));
  });

  it('does not attach a remembered name to a different-looking bottle', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([{ ...bottle(0.3), appearance: look(5) }], 1000);
    const [original] = tracker.update([{ ...bottle(0.3), appearance: look(5) }], 1300);
    tracker.applyCameraMotion(pan(-1), 1400);
    tracker.update([], 2000);
    tracker.applyCameraMotion(pan(1), 20_000);
    const replaced = tracker.update([{ ...bottle(0.3), appearance: look(40) }], 20_200);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.trackId).not.toBe(original!.trackId);
  });

  it('forgets a remembered bottle that is no longer where it was', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([bottle(0.3)], 1000);
    tracker.update([bottle(0.3)], 1300);
    tracker.applyCameraMotion(pan(-1), 1400);
    tracker.update([], 2000);
    tracker.applyCameraMotion(pan(1), 20_000);
    expect(tracker.visible(20_100)).toHaveLength(1);
    for (let i = 1; i <= 4; i++) tracker.update([], 20_000 + i * 400);
    expect(tracker.visible(22_000)).toEqual([]);
    // Coming back again does not resurrect it.
    tracker.applyCameraMotion(pan(-1), 23_000);
    tracker.applyCameraMotion(pan(1), 24_000);
    expect(tracker.visible(24_100)).toEqual([]);
  });

  it('does not drop bottles while fast motion blurs the detector', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([bottle(0.3)], 1000);
    const [original] = tracker.update([bottle(0.3)], 1300);
    for (let i = 1; i <= 5; i++) tracker.update([], 1300 + i * 300, { countMisses: false });
    const [kept] = tracker.visible(2800);
    expect(kept?.trackId).toBe(original!.trackId);
  });

  it('moves and zooms remembered boxes with the camera', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([bottle(0.44)], 1000);
    tracker.applyCameraMotion({ tx: 0.02, ty: 0, scale: 1.1 }, 1100);
    const [moved] = tracker.visible(1100);
    expect(moved!.bounds.width).toBeCloseTo(0.132, 5);
    expect(moved!.bounds.x).toBeCloseTo(1.1 * (0.44 - 0.5) + 0.5 + 0.02, 5);
  });
});

describe('re-finding bottles without reading them again (Rob, 17 Nov 2026)', () => {
  it('keeps a bottle the detector lost in view, and gives its ID back when it is detected there again', () => {
    const tracker = new LocalBottleTracker();
    let t = 1000;
    let original: number | undefined;
    for (let i = 0; i < 4; i++, t += 300) original = tracker.update([{ ...bottle(0.3), appearance: look(7) }], t)[0]!.trackId;
    // Missed for several passes (a hand in front): not drawn.
    for (let i = 0; i < 6; i++, t += 1000) tracker.update([], t);
    expect(tracker.visible(t)).toEqual([]);
    // Seen again in the same place: same ID, and no fresh check needed.
    const back = tracker.update([{ ...bottle(0.305), appearance: look(7) }], t);
    expect(back[0]!.trackId).toBe(original);
    expect(tracker.takeConfidentReacquiredTrackIds()).toEqual([original]);
    expect(tracker.takeReacquiredTrackIds()).toEqual([]);
  });

  it('forgets a lost bottle when a different-looking bottle stands in its place', () => {
    const tracker = new LocalBottleTracker();
    let t = 1000;
    let original: number | undefined;
    for (let i = 0; i < 4; i++, t += 300) original = tracker.update([{ ...bottle(0.3), appearance: look(7) }], t)[0]!.trackId;
    for (let i = 0; i < 6; i++, t += 1000) tracker.update([], t);
    const other = tracker.update([{ ...bottle(0.3), appearance: look(50) }], t);
    expect(other[0]?.trackId ?? -1).not.toBe(original);
    for (let i = 1; i <= 2; i++) tracker.update([{ ...bottle(0.3), appearance: look(50) }], t + i * 300);
    expect(tracker.visible(t + 600).map(item => item.trackId)).not.toContain(original);
  });

  it('re-finds a remembered bottle that came back further off than expected when it looks the same', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([{ ...bottle(0.3), appearance: look(9) }], 1000);
    const [original] = tracker.update([{ ...bottle(0.3), appearance: look(9) }], 1300);
    for (let i = 0; i < 6; i++) tracker.applyCameraMotion(pan(-0.12), 1400 + i * 30);
    tracker.update([], 2000);
    // The camera's path drifted: it comes back 0.25 to the right of where memory put it.
    for (let i = 0; i < 6; i++) tracker.applyCameraMotion(pan(0.12), 30_000 + i * 30);
    const back = tracker.update([{ ...bottle(0.55), appearance: look(9) }], 30_400);
    expect(back.map(item => item.trackId)).toContain(original!.trackId);
    expect(tracker.takeReacquiredTrackIds()).toEqual([original!.trackId]);   // further off: one fresh check
  });
});
