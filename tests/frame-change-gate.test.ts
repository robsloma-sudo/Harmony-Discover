import { describe, expect, it } from 'vitest';
import { changedCellRatio, sampleLumaGrid, shouldReadChangedFrame } from '../src/live/frameChangeGate';

describe('live frame change gate', () => {
  it('samples a bounded grayscale grid from RGBA input', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i += 1) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = 255;
    }
    expect(sampleLumaGrid(rgba, 4, 4, 2)).toEqual(new Uint8Array([255, 255, 255, 255]));
  });

  it('always sends the first frame and skips an unchanged frame', () => {
    const first = new Uint8Array(100).fill(80);
    expect(shouldReadChangedFrame(null, first)).toBe(true);
    expect(shouldReadChangedFrame(first, first.slice())).toBe(false);
    expect(changedCellRatio(first, first.slice())).toBe(0);
  });

  it('sends when enough sampled pixels materially change', () => {
    const previous = new Uint8Array(100).fill(80);
    const current = previous.slice();
    for (let i = 0; i < 5; i += 1) current[i] = 140;
    expect(changedCellRatio(previous, current)).toBe(0.05);
    expect(shouldReadChangedFrame(previous, current)).toBe(true);
  });

  it('treats incompatible sample grids as changed', () => {
    expect(changedCellRatio(new Uint8Array(10), new Uint8Array(9))).toBe(1);
  });
});
