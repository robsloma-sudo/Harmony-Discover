import { NativeModules, Platform } from 'react-native';

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

export async function getDiscoverARKitCapabilities(): Promise<ARKitCapabilities | null> {
  if (Platform.OS !== 'ios') return null;
  const nativeModule = NativeModules.DiscoverARKit as DiscoverARKitNative | undefined;
  if (!nativeModule?.getCapabilities) return null;
  return nativeModule.getCapabilities();
}
