import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

export type ARKitCapabilities = {
  platform: 'ios';
  systemVersion: string;
  model: string;
  machineIdentifier: string;
  worldTrackingSupported: boolean;
  sceneDepthSupported: boolean;
  smoothedSceneDepthSupported: boolean;
  meshReconstructionSupported: boolean;
  trackingState: 'not_started';
  liDARAssumed: false;
};

export type ScannerCapabilityProfile = {
  hardwareIdentifier: string;
  tier: 'lidar_depth' | 'camera_3d' | 'smart_scan';
  modes: Array<'smart_scan' | 'live_3d_bottle' | 'digital_twin'>;
  depthSource: 'arkit_scene_depth' | 'camera_motion_estimate' | 'none';
  meshReconstruction: boolean;
  calibratedMetricMeasurements: boolean;
  reason: string;
};

type DiscoverARKitNative = {
  getCapabilities(): Promise<ARKitCapabilities>;
};

let nativeModule: DiscoverARKitNative | null | undefined;

function getNativeModule(): DiscoverARKitNative | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    nativeModule = requireNativeModule<DiscoverARKitNative>('DiscoverARKit');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export async function getDiscoverARKitCapabilities(): Promise<ARKitCapabilities | null> {
  if (Platform.OS !== 'ios') return null;
  const module = getNativeModule();
  if (!module) return null;
  return module.getCapabilities();
}

/**
 * Capability tier is based on live API probes, never a marketing model name.
 * A depth-capable device may still need calibration before metric measurements
 * are considered authoritative.
 */
export function createScannerCapabilityProfile(
  capabilities: ARKitCapabilities | null,
): ScannerCapabilityProfile {
  if (!capabilities || !capabilities.worldTrackingSupported) {
    return {
      hardwareIdentifier: capabilities?.machineIdentifier ?? 'unknown',
      tier: 'smart_scan',
      modes: ['smart_scan'],
      depthSource: 'none',
      meshReconstruction: false,
      calibratedMetricMeasurements: false,
      reason: 'ARKit world tracking is unavailable; use photo-based recognition.',
    };
  }

  const hasDepth = capabilities.sceneDepthSupported;
  const hasMesh = capabilities.meshReconstructionSupported;
  return {
    hardwareIdentifier: capabilities.machineIdentifier,
    tier: hasDepth ? 'lidar_depth' : 'camera_3d',
    modes: ['smart_scan', 'live_3d_bottle', 'digital_twin'],
    depthSource: hasDepth ? 'arkit_scene_depth' : 'camera_motion_estimate',
    meshReconstruction: hasMesh,
    calibratedMetricMeasurements: false,
    reason: hasDepth
      ? 'Depth is available. Metric dimensions still require calibration and quality checks.'
      : 'No scene depth reported. Use camera motion and feature-based geometry; measurements are estimates.',
  };
}
