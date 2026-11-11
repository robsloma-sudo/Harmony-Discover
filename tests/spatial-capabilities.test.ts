import { describe, expect, it } from 'vitest';
import { assessSpatialCapabilities } from '../src/live/spatialCapabilities';

describe('spatial capability honesty', () => {
  it('does not confuse GPU support with depth estimation', () => {
    const report = assessSpatialCapabilities({ secureContext: true, mediaDevices: true, webgl2: true, webgpu: false, depthModelLoaded: false, cameraPoseAvailable: false });
    expect(report.gpu).toBe('webgl2');
    expect(report.depth).toBe('unavailable');
    expect(report.canRender3D).toBe(false);
    expect(report.canClaimWorldTracking).toBe(false);
  });
  it('only allows world tracking when depth and camera pose exist', () => {
    const report = assessSpatialCapabilities({ secureContext: true, mediaDevices: true, webgl2: true, webgpu: true, depthModelLoaded: true, cameraPoseAvailable: true });
    expect(report.canRender3D).toBe(true);
    expect(report.canClaimWorldTracking).toBe(true);
  });
  it('reports browser security and camera blockers', () => {
    const report = assessSpatialCapabilities({ secureContext: false, mediaDevices: false, webgl2: false, webgpu: false, depthModelLoaded: false, cameraPoseAvailable: false });
    expect(report.camera).toBe(false);
    expect(report.blockers).toHaveLength(5);
  });
});
