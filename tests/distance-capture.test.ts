import { describe, expect, it } from 'vitest';
import { isReadableLabel, samplesForLabel, zoomReadiness, zoomSteps } from '../src/live/distanceCapture';
import { stagePercent } from '../src/live/boxStageProgress';

describe('reading labels at a distance', () => {
  it('looks at more frames the smaller the label', () => {
    expect(samplesForLabel(900)).toBe(1);
    expect(samplesForLabel(450)).toBe(2);
    expect(samplesForLabel(320)).toBe(3);
    expect(samplesForLabel(210)).toBe(5);
  });
  it('too-small labels are not sent and report how close they are', () => {
    expect(isReadableLabel(150, 60)).toBe(false);
    expect(isReadableLabel(220, 80)).toBe(true);
    expect(zoomReadiness(150, 60)).toBeCloseTo(0.75, 2);
    expect(stagePercent('zoom', zoomReadiness(150, 60), undefined, 0)).toBe(75);
  });
  it('offers zoom steps only inside the camera range', () => {
    expect(zoomSteps(1, 10)).toEqual([1, 2, 3, 5]);
    expect(zoomSteps(1, 2.5)).toEqual([1, 2]);
    expect(zoomSteps(1, 1)).toEqual([]);
  });
});
