import React from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
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
  onVisualCandidates?: (event: { nativeEvent: { count: number; candidates: Array<{ trackId: number; x: number; y: number; width: number; height: number; confidence: number }> } }) => void;
  onRecognitionUpdate?: (event: { nativeEvent: { text: string[]; barcodes: Array<{ value: string; symbology: string }>; classifications: Array<{ identifier: string; confidence: string }>; frameTimestamp: number } }) => void;
};

let NativeARView: React.ComponentType<NativeProps> | null = null;
if (Platform.OS === 'ios') {
  try {
    NativeARView = requireNativeViewManager<NativeProps>('DiscoverARKit');
  } catch {
    NativeARView = null;
  }
}

function WebLiveCamera(props: NativeProps) {
  const { active, style, onTrackingUpdate, onRecognitionUpdate, onARError } = props;
  if (!active) return <View style={style} />;
  return (
    <CameraView
      style={style}
      facing="back"
      barcodeScannerSettings={{
        barcodeTypes: ['ean13', 'ean8', 'upc_e', 'upc_a', 'code128', 'code39', 'qr'],
      }}
      onCameraReady={() => {
        onTrackingUpdate?.({ nativeEvent: { state: 'normal', reason: 'browser_camera_ready' } });
        props.onARReady?.({ nativeEvent: { state: 'ready', reason: 'browser_camera_ready' } });
      }}
      onBarcodeScanned={(result: BarcodeScanningResult) => {
        onRecognitionUpdate?.({
          nativeEvent: {
            text: [],
            barcodes: [{ value: result.data, symbology: result.type }],
            classifications: [],
            frameTimestamp: Date.now(),
          },
        });
      }}
      onMountError={(event) => {
        onARError?.({ nativeEvent: { message: event.message } });
        onTrackingUpdate?.({ nativeEvent: { state: 'not_available', reason: event.message } });
      }}
    />
  );
}

export function DiscoverARSurface(props: NativeProps) {
  if (Platform.OS === 'web') return <WebLiveCamera {...props} />;
  if (!NativeARView) return <View {...props} />;
  return <NativeARView {...props} />;
}
