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
