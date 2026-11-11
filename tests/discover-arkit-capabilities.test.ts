import { describe, expect, it } from 'vitest';
import { createScannerCapabilityProfile, getFriendlyIPhoneModel, type ARKitCapabilities } from '../src/services/discoverARKit';

const base: ARKitCapabilities = {
  platform: 'ios',
  systemVersion: '26.0',
  model: 'iPhone',
  machineIdentifier: 'iPhone99,1',
  worldTrackingSupported: true,
  sceneDepthSupported: false,
  smoothedSceneDepthSupported: false,
  meshReconstructionSupported: false,
  trackingState: 'not_started',
  liDARAssumed: false,
};

describe('createScannerCapabilityProfile', () => {
  it('falls back to Smart Scan when ARKit is unavailable', () => {
    const profile = createScannerCapabilityProfile(null);
    expect(profile.tier).toBe('smart_scan');
    expect(profile.modes).toEqual(['smart_scan']);
    expect(profile.depthSource).toBe('none');
  });

  it('uses camera-based 3D when world tracking exists without depth', () => {
    const profile = createScannerCapabilityProfile(base);
    expect(profile.tier).toBe('camera_3d');
    expect(profile.depthSource).toBe('camera_motion_estimate');
    expect(profile.modes).toContain('live_3d_bottle');
    expect(profile.calibratedMetricMeasurements).toBe(false);
  });

  it('uses depth tier only when runtime scene depth is supported', () => {
    const profile = createScannerCapabilityProfile({
      ...base,
      sceneDepthSupported: true,
      meshReconstructionSupported: true,
    });
    expect(profile.tier).toBe('lidar_depth');
    expect(profile.depthSource).toBe('arkit_scene_depth');
    expect(profile.meshReconstruction).toBe(true);
    expect(profile.calibratedMetricMeasurements).toBe(false);
  });

  it('falls back when the device cannot world-track', () => {
    const profile = createScannerCapabilityProfile({ ...base, worldTrackingSupported: false });
    expect(profile.tier).toBe('smart_scan');
    expect(profile.modes).toEqual(['smart_scan']);
  });
});


describe('getFriendlyIPhoneModel', () => {
  it('recognizes known hardware identifiers', () => {
    expect(getFriendlyIPhoneModel('iPhone13,3')).toBe('iPhone 12 Pro');
    expect(getFriendlyIPhoneModel('iPhone16,1')).toBe('iPhone 15 Pro');
    expect(getFriendlyIPhoneModel('iPhone17,3')).toBe('iPhone 16');
  });

  it('preserves unknown identifiers rather than guessing a model', () => {
    expect(getFriendlyIPhoneModel('iPhone99,9')).toBe('iPhone (iPhone99,9)');
  });
});
