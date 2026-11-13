import { describe, expect, it } from 'vitest';
import { sampleBoxDepth, unprojectDetection, updateSpatialTracks, type MetricDepthMap } from '../src/live/spatialTracking';

const depth: MetricDepthMap = { width: 4, height: 4, metres: [2,2,2,2, 2,1.5,1.5,2, 2,1.5,1.5,2, 2,2,2,2] };

describe('Discover camera-space reconstruction', () => {
  it('uses the median depth inside the central detection region', () => {
    expect(sampleBoxDepth(depth, { x0: 0, y0: 0, x1: 1, y1: 1 })).toMatchObject({ metres: 1.5, sampleCount: 4 });
  });

  it('unprojects a detection centre with pinhole camera intrinsics', () => {
    const point = unprojectDetection({ x0: .25, y0: .25, x1: .75, y1: .75 }, depth, { fx: 4, fy: 4, cx: 2, cy: 2 });
    expect(point).not.toBeNull();
    expect(point?.z).toBe(1.5);
    expect(point?.x).toBe(0);
    expect(point?.y).toBe(0);
  });

  it('rejects invalid depth rather than inventing a distance', () => {
    const invalid = { width: 2, height: 2, metres: [0, NaN, Infinity, -1] };
    expect(sampleBoxDepth(invalid, { x0: 0, y0: 0, x1: 1, y1: 1 })).toBeNull();
  });

  it('smooths persistent spatial tracks and expires missing tracks', () => {
    const first = updateSpatialTracks([], [{ trackId: 7, point: { x: 0, y: 0, z: 2, depthMetres: 2, sampleCount: 9 }, confidence: .9 }], 1000);
    const second = updateSpatialTracks(first, [{ trackId: 7, point: { x: 1, y: 0, z: 4, depthMetres: 4, sampleCount: 9 }, confidence: .8 }], 1100, .5);
    expect(second[0].position).toEqual({ x: .5, y: 0, z: 3 });
    expect(second[0].velocity.x).toBe(5);
    expect(updateSpatialTracks(second, [], 2400)).toHaveLength(0);
  });
});
