import { describe, expect, it } from 'vitest';
import { projectBottleBoxToWorld, type SpatialDepthFrame } from '../src/live/spatialBottleProjection';

function frame(overrides: Partial<SpatialDepthFrame> = {}): SpatialDepthFrame {
  return {
    width: 8,
    height: 8,
    depthMeters: Array(64).fill(2),
    confidence: Array(64).fill(2),
    cameraIntrinsics: [100, 0, 4, 0, 100, 4, 0, 0, 1],
    // Identity camera transform.
    cameraTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    ...overrides,
  };
}

describe('metric bottle box projection', () => {
  it('projects a confident depth sample through camera intrinsics into world space', () => {
    const result = projectBottleBoxToWorld(frame(), { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(result.status).toBe('located');
    if (result.status === 'located') {
      expect(result.depthMeters).toBe(2);
      expect(result.worldPoint.x).toBe(0);
      expect(result.worldPoint.y).toBe(0);
      expect(result.worldPoint.z).toBe(-2);
    }
  });

  it('applies camera translation so the point remains in world coordinates', () => {
    const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.5, 0.5, 3, 1];
    const result = projectBottleBoxToWorld(frame({ cameraTransform: transform }), { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(result.status).toBe('located');
    if (result.status === 'located') expect(result.worldPoint).toEqual({ x: 1.5, y: 0.5, z: 1 });
  });

  it('uses image-right as camera-right and image-down as camera-down', () => {
    const result = projectBottleBoxToWorld(frame(), { x: 0.5, y: 0.5, width: 0.25, height: 0.25 });
    expect(result.status).toBe('located');
    if (result.status === 'located') {
      expect(result.worldPoint.x).toBeCloseTo(0.02, 6);
      expect(result.worldPoint.y).toBeCloseTo(-0.02, 6);
      expect(result.worldPoint.z).toBe(-2);
    }
  });

  it('rotates the camera-space point through the camera world orientation', () => {
    const transform = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
    const result = projectBottleBoxToWorld(frame({ cameraTransform: transform }), { x: 0.5, y: 0.5, width: 0.25, height: 0.25 });
    expect(result.status).toBe('located');
    if (result.status === 'located') {
      expect(result.worldPoint.x).toBeCloseTo(-2, 6);
      expect(result.worldPoint.y).toBeCloseTo(-0.02, 6);
      expect(result.worldPoint.z).toBeCloseTo(-0.02, 6);
    }
  });

  it('rejects missing or invalid depth rather than inventing a location', () => {
    const result = projectBottleBoxToWorld(frame({ depthMeters: Array(64).fill(0) }), { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(result).toMatchObject({ status: 'potential', reason: 'insufficient_depth' });
  });

  it('keeps low-confidence depth as a potential candidate', () => {
    const result = projectBottleBoxToWorld(frame({ confidence: Array(64).fill(1) }), { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(result).toMatchObject({ status: 'potential', reason: 'low_depth_confidence' });
  });

  it('rejects boxes outside normalized image bounds', () => {
    const result = projectBottleBoxToWorld(frame(), { x: 0.8, y: 0.2, width: 0.4, height: 0.4 });
    expect(result).toMatchObject({ status: 'potential', reason: 'invalid_frame' });
  });
});
