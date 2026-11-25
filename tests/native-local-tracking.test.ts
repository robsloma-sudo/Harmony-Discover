import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyLocalTrackerBoxes, buildTrackingSeeds, MAX_TRACKED_BOTTLES, MIN_SEED_CONFIDENCE,
  type LocalTrackerBox,
} from '../src/live/nativeLocalTracking';

// Fix kit S2-B2-004: iPhone boxes used to move only when a cloud read came back (every 2.5-5 s).
const cloudFrame = 100.0; // ARFrame seconds
const cloud = [
  { trackId: 1, x: 0.10, y: 0.20, width: 0.15, height: 0.40, confidence: 0.9, timestamp: cloudFrame, bottle: { brand: 'A' } },
  { trackId: 2, x: 0.50, y: 0.25, width: 0.12, height: 0.35, confidence: 0.8, timestamp: cloudFrame, bottle: { brand: 'B' } },
];
const tracked = (trackId: number, x: number, at: number, extra: Partial<LocalTrackerBox> = {}): LocalTrackerBox => ({
  trackId, sourceTimestamp: cloudFrame, timestamp: at, x, y: 0.2, width: 0.15, height: 0.4, confidence: 0.8, ...extra,
});

describe('which cloud boxes the phone follows', () => {
  it('follows confident boxes from a frame without LiDAR depth', () => {
    const seeds = buildTrackingSeeds(cloud, cloudFrame, false);
    expect(seeds.map(seed => seed.trackId)).toEqual([1, 2]);
    expect(seeds[0]).toMatchObject({ sourceTimestamp: cloudFrame, x: 0.10, y: 0.20, width: 0.15, height: 0.40 });
  });

  it('leaves LiDAR frames to the 3D anchors, which already follow the camera', () => {
    expect(buildTrackingSeeds(cloud, cloudFrame, true)).toEqual([]);
  });

  it('skips weak, tiny or out-of-frame boxes and caps the number followed', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ trackId: i + 1, x: 0.05 * i, y: 0.1, width: 0.04, height: 0.3, confidence: 0.6 + i * 0.01 }));
    expect(buildTrackingSeeds(many, cloudFrame, false)).toHaveLength(MAX_TRACKED_BOTTLES);
    expect(buildTrackingSeeds([{ ...cloud[0], confidence: MIN_SEED_CONFIDENCE - 0.01 }], cloudFrame, false)).toEqual([]);
    expect(buildTrackingSeeds([{ ...cloud[0], width: 0.01 }], cloudFrame, false)).toEqual([]);
    expect(buildTrackingSeeds([{ ...cloud[0], x: 0.95 }], cloudFrame, false)).toEqual([]);
  });
});

describe('boxes keep up with the bottles between cloud reads', () => {
  it('BEFORE: without the phone tracker a box stays where the cloud saw it until the next read', () => {
    // Ten tracker steps (one second) with no tracker output: nothing moves.
    const { candidates, moved } = applyLocalTrackerBoxes(cloud, [], cloudFrame, 0);
    expect(moved).toBe(0);
    expect(candidates[0].x).toBe(0.10);
  });

  it('AFTER: each tracker update (10 a second) moves the box, keeping its name and read', () => {
    let x = 0.10;
    for (let step = 1; step <= 10; step++) {
      x += 0.02; // the phone pans: the bottle slides across the picture
      const { candidates, moved } = applyLocalTrackerBoxes(cloud, [tracked(1, x, cloudFrame + step * 0.1)], cloudFrame, 1000 + step * 100);
      expect(moved).toBe(1);
      expect(candidates[0].x).toBeCloseTo(x, 6);
      expect(candidates[0].bottle).toBe(cloud[0].bottle);
      expect(candidates[0].confidence).toBe(0.9);
      expect(candidates[0].source).toBe('local');
      // Uses this device's clock so the home screen's 1.5 s local expiry applies.
      expect(candidates[0].timestamp).toBe(1000 + step * 100);
      // A bottle the tracker is not following is left exactly as the cloud read it.
      expect(candidates[1]).toBe(cloud[1]);
    }
  });

  it('ignores tracker boxes from an older cloud read, unsure matches and sudden size jumps', () => {
    expect(applyLocalTrackerBoxes(cloud, [tracked(1, 0.3, 100.5, { sourceTimestamp: 97.5 })], cloudFrame, 1).moved).toBe(0);
    expect(applyLocalTrackerBoxes(cloud, [tracked(1, 0.3, 100.5, { confidence: 0.1 })], cloudFrame, 1).moved).toBe(0);
    expect(applyLocalTrackerBoxes(cloud, [tracked(1, 0.3, 100.5, { width: 0.6, height: 0.79 })], cloudFrame, 1).moved).toBe(0);
    expect(applyLocalTrackerBoxes(cloud, [tracked(1, 0.3, 99.0)], cloudFrame, 1).moved).toBe(0);
  });

  it('uses the newest tracker box for a bottle and clamps it to the picture', () => {
    const { candidates } = applyLocalTrackerBoxes(cloud, [tracked(1, 0.2, 100.2), tracked(1, 0.3, 100.4), tracked(1, 0.25, 100.3)], cloudFrame, 5);
    expect(candidates[0].x).toBeCloseTo(0.3, 6);
  });
});

describe('the iPhone module runs a per-frame Vision tracker', () => {
  const swift = readFileSync('modules/discover-arkit/ios/DiscoverARKitModule.swift', 'utf8');
  const surface = readFileSync('src/live/DiscoverARSurface.tsx', 'utf8');
  it('native side: seeds VNTrackObjectRequest from the exact cloud frame and reports at up to 10 Hz', () => {
    expect(swift).toContain('VNTrackObjectRequest');
    expect(swift).toContain('Prop("trackingSeeds")');
    expect(swift).toContain('"onLocalTrack"');
    expect(swift).toMatch(/now - lastLocalTrackingTime >= 0\.10/);
    // Private frame copies, so ARKit's camera buffers are never held on to.
    expect(swift).toContain('copyPixelBuffer');
    // Tracking stops whenever the camera pauses, recognition is turned off or ARKit tracking is lost.
    expect(swift.match(/resetLocalTracking\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
  it('app side: hands cloud boxes to the tracker and applies its updates', () => {
    expect(surface).toContain('trackingSeeds={nativeTrackingSeeds}');
    expect(surface).toContain('onLocalTrack={event =>');
    expect(surface).toContain('buildTrackingSeeds(candidates, frame.timestamp, hasMetricDepth)');
  });
});
