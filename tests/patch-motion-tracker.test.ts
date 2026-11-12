import { describe, expect, it } from 'vitest';
import { grayscaleFrame, propagateMotionTrack, seedMotionFeatures, type GrayFrame, type MotionTrack } from '../src/live/patchMotionTracker';

function noiseFrame(width: number, height: number, seed = 7): GrayFrame {
  let value = seed >>> 0;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    value = (value * 1664525 + 1013904223) >>> 0;
    pixels[i] = value >>> 24;
  }
  return { width, height, pixels };
}

function translate(source: GrayFrame, dx: number, dy: number): GrayFrame {
  const pixels = new Uint8Array(source.width * source.height);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < source.width && ny < source.height) {
        pixels[ny * source.width + nx] = source.pixels[y * source.width + x];
      }
    }
  }
  return { width: source.width, height: source.height, pixels };
}

describe('browser patch-motion tracker', () => {
  it('seeds textured points inside a bottle box', () => {
    const frame = noiseFrame(200, 240);
    const features = seedMotionFeatures(frame, { x: 0.2, y: 0.15, width: 0.5, height: 0.65 });
    expect(features.length).toBeGreaterThanOrEqual(3);
    expect(features.every(point => point.x >= 40 && point.x <= 140 && point.y >= 36 && point.y <= 192)).toBe(true);
  });

  it('propagates a bottle box through frame translation', () => {
    const first = noiseFrame(200, 240, 19);
    const box = { x: 0.2, y: 0.15, width: 0.5, height: 0.65 };
    const features = seedMotionFeatures(first, box);
    const track: MotionTrack = { trackId: 4, ...box, confidence: 0.9, misses: 0, features };
    const moved = propagateMotionTrack(track, translate(first, 4, 3));
    expect(moved.misses).toBe(0);
    expect(moved.x).toBeCloseTo(box.x + 4 / first.width, 2);
    expect(moved.y).toBeCloseTo(box.y + 3 / first.height, 2);
    expect(moved.confidence).toBeGreaterThan(0.3);
  });

  it('decays confidence instead of inventing motion when features disappear', () => {
    const first = noiseFrame(200, 240, 23);
    const box = { x: 0.2, y: 0.15, width: 0.5, height: 0.65 };
    const track: MotionTrack = {
      trackId: 5, ...box, confidence: 0.8, misses: 0,
      features: seedMotionFeatures(first, box),
    };
    const lost = propagateMotionTrack(track, { width: 200, height: 240, pixels: new Uint8Array(200 * 240) });
    expect(lost.misses).toBe(1);
    expect(lost.confidence).toBeLessThan(track.confidence);
    expect(lost.x).toBe(track.x);
    expect(lost.y).toBe(track.y);
  });

  it('does not track without seeded features', () => {
    const track: MotionTrack = { trackId: 6, x: 0.2, y: 0.2, width: 0.3, height: 0.6, confidence: 0.7, misses: 0, features: [] };
    const lost = propagateMotionTrack(track, noiseFrame(200, 240));
    expect(lost.misses).toBe(1);
    expect(lost.confidence).toBeCloseTo(0.455);
  });

  it('converts RGBA image data to grayscale', () => {
    const gray = grayscaleFrame(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]));
    expect(gray.pixels).toHaveLength(2);
    expect(gray.pixels[0]).toBeGreaterThan(gray.pixels[1]);
  });
});
