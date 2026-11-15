import { describe, expect, it } from 'vitest';
import { isReadableLabel, samplesForLabel, zoomReadiness } from '../src/live/distanceCapture';
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
  it('pinching in makes Harmony look at more frames', () => {
    expect(samplesForLabel(900, 1)).toBe(1);
    expect(samplesForLabel(900, 2)).toBe(3);
    expect(samplesForLabel(900, 3.4)).toBe(5);
    expect(samplesForLabel(210, 1)).toBe(5);
  });
});
