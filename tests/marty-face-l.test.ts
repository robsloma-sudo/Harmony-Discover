import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BLINK_BOX, JAW_BOX, MAX_JAW_SHIFT, POSES, gapHeight, jawShift, ringWidth } from '../src/marty/faces/photoFaceLayout';

describe('photo face L layout', () => {
  it('jaw shift is 0 closed, monotonic, max at 1', () => {
    expect(jawShift(0, 416)).toBe(0);
    expect(gapHeight(0, 416)).toBe(0);
    let prev = -1;
    for (let i = 0; i <= 20; i++) { const v = jawShift(i / 20, 416); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(jawShift(1, 416)).toBeCloseTo(MAX_JAW_SHIFT * 416);
    expect(jawShift(1, 416)).toBeLessThan(11);
    expect(gapHeight(1, 416)).toBeGreaterThan(jawShift(1, 416));
  });
  it('clamps out of range and NaN', () => {
    expect(jawShift(5, 100)).toBe(jawShift(1, 100));
    expect(jawShift(-2, 100)).toBe(0);
    expect(jawShift(NaN, 100)).toBe(0);
    expect(gapHeight(Infinity, 100)).toBe(0);
  });
  it('poses differ per state', () => {
    expect(POSES.listening.scale).toBeGreaterThan(POSES.idle.scale);
    expect(POSES.thinking.scale).toBeLessThan(POSES.idle.scale);
    expect(Math.sign(POSES.listening.tiltDeg)).not.toBe(Math.sign(POSES.thinking.tiltDeg));
    expect(POSES.listening.ring).toBe(1);
    expect(POSES.thinking.dots).toBe(1);
    expect(POSES.thinking.blinks).toBe(false);
  });
  it('ring stays thin at the button size', () => {
    expect(ringWidth(52)).toBeLessThanOrEqual(2);
    expect(ringWidth(176)).toBeLessThanOrEqual(4);
  });
  it('asset boxes lie inside 0..1', () => {
    for (const b of [JAW_BOX, BLINK_BOX]) {
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1); expect(b.y + b.h).toBeLessThanOrEqual(1);
    }
  });
  it('asset files exist and stay phone-sized', () => {
    const dir = path.join(__dirname, '..', 'assets', 'marty');
    let total = 0;
    for (const f of ['marty-l.jpg', 'marty-l-jaw.png', 'marty-l-blink.png']) total += fs.statSync(path.join(dir, f)).size;
    expect(total).toBeLessThan(80 * 1024);
  });
});
