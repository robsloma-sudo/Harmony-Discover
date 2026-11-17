import { describe, expect, it } from 'vitest';
import { compensateDetections, projectLabelBox, transferBox } from '../src/live/trackMotionCompensation';

const box = (x: number, y: number, width = 0.15, height = 0.4) => ({ x, y, width, height });

describe('moving late cloud detections into the current view', () => {
  // Three tubes side by side; the camera pans so everything shifts left by 0.2
  // during the 3 s the cloud read takes (PR #104 recording 0:24-0:27).
  const atCapture = [
    { trackId: -1, box: box(0.10, 0.3) },
    { trackId: -2, box: box(0.30, 0.3) },
    { trackId: -3, box: box(0.50, 0.3) },
  ];
  const now = atCapture.map(t => ({ trackId: t.trackId, box: { ...t.box, x: t.box.x - 0.2 } }));

  it('binds each detection to the track it overlapped at capture and follows it', () => {
    const [middle] = compensateDetections([box(0.31, 0.31)], atCapture, now);
    expect(middle!.method).toBe('track');
    expect(middle!.boundTrackId).toBe(-2);
    expect(middle!.box.x).toBeCloseTo(0.11, 5);
  });

  it('without compensation the stale box would land on the neighbouring tube', () => {
    // The uncompensated capture box (x=0.31) overlaps track -3's current box (x=0.30).
    const stale = box(0.31, 0.31);
    const neighbour = now.find(t => t.trackId === -3)!.box;
    expect(Math.abs(stale.x - neighbour.x)).toBeLessThan(0.02);
  });

  it('uses the median camera motion for detections no track covered', () => {
    const [unbound] = compensateDetections([box(0.75, 0.3)], atCapture, now);
    expect(unbound!.method).toBe('global');
    expect(unbound!.box.x).toBeCloseTo(0.55, 5);
  });

  it('does not bind two detections to the same track', () => {
    const results = compensateDetections([box(0.30, 0.3), box(0.31, 0.31)], atCapture, now);
    expect(results[0]!.boundTrackId).toBe(-2);
    expect(results[1]!.boundTrackId).not.toBe(-2);
  });

  it('leaves detections unchanged when nothing was tracked', () => {
    const [result] = compensateDetections([box(0.4, 0.3)], [], []);
    expect(result!.method).toBe('none');
    expect(result!.box).toEqual(box(0.4, 0.3));
  });

  it('follows scale changes when the camera moves closer', () => {
    const moved = transferBox(box(0.30, 0.3, 0.1, 0.2), box(0.30, 0.3, 0.1, 0.2), box(0.25, 0.2, 0.2, 0.4));
    expect(moved.width).toBeCloseTo(0.2, 5);
    expect(moved.height).toBeCloseTo(0.4, 5);
  });
});

describe('projecting a cloud label box onto the current track', () => {
  it('keeps the label in the same place on the bottle after the bottle moved', () => {
    const label = projectLabelBox(
      { x0: 0.32, y0: 0.45, x1: 0.43, y1: 0.6 },
      { x0: 0.30, y0: 0.30, x1: 0.45, y1: 0.70 },
      box(0.10, 0.30),
    );
    expect(label!.x0).toBeCloseTo(0.12, 5);
    expect(label!.y0).toBeCloseTo(0.45, 5);
  });

  it('rejects degenerate geometry', () => {
    expect(projectLabelBox({ x0: 0.3, y0: 0.3, x1: 0.3, y1: 0.4 }, { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.8 }, box(0.1, 0.1))).toBeNull();
  });
});
