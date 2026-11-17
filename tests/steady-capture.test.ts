import { describe, expect, it } from 'vitest';
import { frameSharpness, SteadyGate } from '../src/live/steadyCapture';

const pattern = (w: number, h: number, blur: number) => {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let k = -blur; k <= blur; k++) v += ((((x + k) >> 2) + (y >> 2)) % 2) ? 220 : 30;
    g[y * w + x] = Math.round(v / (2 * blur + 1));
  }
  return g;
};
const still = { tx: 0, ty: 0, scale: 1 };

describe('labels are captured only when the phone is steady and the picture sharp', () => {
  it('a smeared frame scores lower than a sharp one', () => {
    expect(frameSharpness(pattern(64, 64, 0), 64, 64)).toBeGreaterThan(frameSharpness(pattern(64, 64, 3), 64, 64) * 1.5);
  });

  it('moving camera is never steady', () => {
    const gate = new SteadyGate();
    for (let t = 0; t < 600; t += 30) gate.observe(t, 10, { tx: 0.02, ty: 0, scale: 1 });
    expect(gate.steady(600)).toBe(false);
  });

  it('still and sharp for a moment is steady; a blurred frame after a sharp one is not', () => {
    const gate = new SteadyGate();
    gate.observe(0, 10, still);
    gate.observe(60, 10, still);
    expect(gate.steady(60)).toBe(false); // not still long enough yet
    gate.observe(150, 10, still);
    expect(gate.steady(150)).toBe(true);
    gate.observe(180, 5, still);
    expect(gate.steady(180)).toBe(false);
  });

  it('a lost motion measurement counts as moving', () => {
    const gate = new SteadyGate();
    for (let t = 0; t < 300; t += 30) gate.observe(t, 10, null);
    expect(gate.steady(300)).toBe(false);
  });
});
