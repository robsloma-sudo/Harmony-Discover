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

const IPHONE_MODEL_NAMES: Record<string, string> = {
  'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max',
  'iPhone12,8': 'iPhone SE (2nd generation)', 'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max', 'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max', 'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13',
  'iPhone14,6': 'iPhone SE (3rd generation)', 'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max', 'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus', 'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max', 'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus', 'iPhone17,5': 'iPhone 16e', 'iPhone18,1': 'iPhone 17 Pro',
  'iPhone18,2': 'iPhone 17 Pro Max', 'iPhone18,3': 'iPhone 17', 'iPhone18,4': 'iPhone Air',
  'iPhone18,5': 'iPhone 17e',
};

export function getFriendlyIPhoneModel(identifier: string): string {
  return IPHONE_MODEL_NAMES[identifier] ?? (identifier.startsWith('iPhone') ? `iPhone (${identifier})` : identifier || 'Unknown iPhone');
}

export type ScannerCapabilityProfile = {
  hardwareIdentifier: string;
  tier: 'lidar_depth' | 'camera_3d' | 'smart_scan';
  modes: Array<'smart_scan'>;
  hardwareSupportsLive3D: boolean;
  depthSource: 'arkit_scene_depth' | 'camera_motion_estimate' | 'none';
  meshReconstruction: boolean;
  calibratedMetricMeasurements: boolean;
  reason: string;
};

export function createScannerCapabilityProfile(capabilities: ARKitCapabilities | null): ScannerCapabilityProfile {
  if (!capabilities || !capabilities.worldTrackingSupported) {
    return {
      hardwareIdentifier: capabilities?.machineIdentifier ?? 'unknown',
      tier: 'smart_scan',
      modes: ['smart_scan'],
      hardwareSupportsLive3D: false,
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
    modes: ['smart_scan'],
    hardwareSupportsLive3D: true,
    depthSource: hasDepth ? 'arkit_scene_depth' : 'camera_motion_estimate',
    meshReconstruction: hasMesh,
    calibratedMetricMeasurements: false,
    reason: hasDepth
      ? 'Depth is available. Metric dimensions still require calibration and quality checks.'
      : 'No scene depth reported. Use camera motion and feature-based geometry; measurements are estimates.',
  };
}
