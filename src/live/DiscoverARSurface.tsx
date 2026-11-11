import React from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

export type ARTrackingUpdate = {
  state: 'normal' | 'limited' | 'not_available' | 'paused' | 'interrupted';
  reason: string;
};

export type ARViewEvent = { nativeEvent: { state?: string; reason?: string; message?: string } };

type NativeProps = ViewProps & {
  active?: boolean;
  onTrackingUpdate?: (event: { nativeEvent: ARTrackingUpdate }) => void;
  onARReady?: (event: ARViewEvent) => void;
  onARError?: (event: ARViewEvent) => void;
};

let NativeARView: React.ComponentType<NativeProps> | null = null;
if (Platform.OS === 'ios') {
  try {
    NativeARView = requireNativeViewManager<NativeProps>('DiscoverARKit');
  } catch {
    NativeARView = null;
  }
}

export function DiscoverARSurface(props: NativeProps) {
  if (!NativeARView) return <View {...props} />;
  return <NativeARView {...props} />;
}
