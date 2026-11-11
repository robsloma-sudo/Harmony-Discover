import React, { useEffect, useRef } from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { requireNativeViewManager } from 'expo-modules-core';
import { readLiveFrame } from '../services/discoverLiveApi';

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
  onRecognitionUpdate?: (event: { nativeEvent: { text: string[]; barcodes: Array<{ value: string; symbology: string }>; classifications: Array<{ identifier: string; confidence: string }>; frameTimestamp: number; bottles?: Awaited<ReturnType<typeof readLiveFrame>>['bottles']; menu?: Awaited<ReturnType<typeof readLiveFrame>>['menu']; diagnostics?: Awaited<ReturnType<typeof readLiveFrame>>['diagnostics']; barcodeStatus?: 'available' | 'unsupported' } }) => void;
};

let NativeARView: React.ComponentType<NativeProps> | null = null;
if (Platform.OS === 'ios') {
  try {
    NativeARView = requireNativeViewManager<NativeProps>('DiscoverARKit');
  } catch {
    NativeARView = null;
  }
}

/**
 * Use the browser's MediaDevices API directly on web. This avoids relying on
 * Expo Camera's web preview mounting lifecycle, which has exhibited blank
 * previews on iOS mobile browsers. The UI only reports ready after a real
 * video frame is playing.
 */
function WebLiveCamera(props: NativeProps) {
  const { active, style, onTrackingUpdate, onRecognitionUpdate, onARError } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const callbacksRef = useRef({ onTrackingUpdate, onARReady: props.onARReady, onARError, onRecognitionUpdate: props.onRecognitionUpdate, onVisualCandidates: props.onVisualCandidates });
  callbacksRef.current = { onTrackingUpdate, onARReady: props.onARReady, onARError, onRecognitionUpdate: props.onRecognitionUpdate, onVisualCandidates: props.onVisualCandidates };

  useEffect(() => {
    if (!active) {
      callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'paused', reason: 'camera_paused' } });
      return;
    }

    let disposed = false;
    let stream: MediaStream | null = null;
    let frameCheck = 0;
    let recognitionTimer = 0;
    let recognitionBusy = false;
    type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>> };
    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    let barcodeDetector: BarcodeDetectorLike | null = null;
    if (BarcodeDetectorCtor) { try { barcodeDetector = new BarcodeDetectorCtor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] }); } catch { barcodeDetector = null; } }
    let lastRecognitionStartedAt = 0;
    const recognitionIntervalMs = 2500;

    // Keep a single request in flight and pace requests by start time, not by
    // adding a full delay after the provider response. This stays below the
    // server's 30/minute limit even when inference is fast.
    const scheduleRecognition = (delay = recognitionIntervalMs) => {
      if (!disposed) recognitionTimer = window.setTimeout(() => { void recognizeFrame(); }, delay);
    };
    const recognizeFrame = async () => {
      if (disposed || recognitionBusy) return;
      const video = videoRef.current;
      if (!video || video.videoWidth < 2 || video.videoHeight < 2) { scheduleRecognition(); return; }
      recognitionBusy = true;
      lastRecognitionStartedAt = Date.now();
      try {
        const canvas = document.createElement('canvas');
        // Match the crop the user actually sees (object-fit: cover). On a
        // portrait phone the camera stream may be landscape; sending the full
        // uncropped frame makes the label much smaller than it appears on-screen.
        const displayWidth = video.clientWidth || video.videoWidth;
        const displayHeight = video.clientHeight || video.videoHeight;
        const displayAspect = displayWidth / displayHeight;
        const sourceAspect = video.videoWidth / video.videoHeight;
        let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
        if (sourceAspect > displayAspect) {
          sw = video.videoHeight * displayAspect;
          sx = (video.videoWidth - sw) / 2;
        } else if (sourceAspect < displayAspect) {
          sh = video.videoWidth / displayAspect;
          sy = (video.videoHeight - sh) / 2;
        }
        const scale = Math.min(1, 960 / Math.max(sw, sh));
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Frame capture is unavailable in this browser.');
        context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const jpeg = canvas.toDataURL('image/jpeg', 0.62);
        const barcodePromise = barcodeDetector ? barcodeDetector.detect(canvas).catch(() => []) : Promise.resolve([]);
        const result = await readLiveFrame(jpeg);
        const decodedBarcodes = await barcodePromise;
        if (disposed) return;
        const text = result.bottles.flatMap(b => [b.brand, b.product, ...b.words]).filter(Boolean);
        const classifications = result.bottles.map(b => ({ identifier: b.category, confidence: String(b.confidence) }));
        callbacksRef.current.onRecognitionUpdate?.({ nativeEvent: { text, barcodes: decodedBarcodes.map(code => ({ value: code.rawValue, symbology: code.format })), barcodeStatus: barcodeDetector ? 'available' : 'unsupported', classifications, frameTimestamp: Date.now(), bottles: result.bottles, menu: result.menu, diagnostics: result.diagnostics } });
        callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: result.bottles.length, candidates: result.bottles.map((b, i) => ({ trackId: i + 1, x: b.box.x0, y: b.box.y0, width: b.box.x1 - b.box.x0, height: b.box.y1 - b.box.y0, confidence: b.confidence })) } });
      } catch (error) {
        if (!disposed) callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? error.message : 'recognition_request_failed' } });
      } finally {
        recognitionBusy = false;
        const elapsed = Date.now() - lastRecognitionStartedAt;
        scheduleRecognition(Math.max(0, recognitionIntervalMs - elapsed));
      }
    };

    const fail = (error: unknown) => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error || 'Camera could not start');
      callbacksRef.current.onARError?.({ nativeEvent: { message } });
      callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'not_available', reason: message } });
    };

    const start = async () => {
      try {
        if (!window.isSecureContext) {
          throw new Error('Camera access requires a secure HTTPS page. Open the Harmony Discover HTTPS website.');
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('This browser does not provide camera access. Update Chrome or open the site in Safari.');
        }

        callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: 'requesting_browser_camera' } });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (disposed) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) throw new Error('Camera preview element was not mounted.');

        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        const verifyFrame = () => {
          if (disposed) return;
          const current = videoRef.current;
          if (current && !current.paused && current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && current.videoWidth > 0 && current.videoHeight > 0) {
            callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'normal', reason: 'browser_video_frames_verified' } });
            callbacksRef.current.onARReady?.({ nativeEvent: { state: 'ready', reason: 'browser_video_frames_verified' } });
            scheduleRecognition();
            return;
          }
          frameCheck = window.requestAnimationFrame(verifyFrame);
        };
        frameCheck = window.requestAnimationFrame(verifyFrame);
      } catch (error) {
        fail(error);
      }
    };

    void start();

    return () => {
      disposed = true;
      if (frameCheck) window.cancelAnimationFrame(frameCheck);
      if (recognitionTimer) window.clearTimeout(recognitionTimer);
      if (stream) stream.getTracks().forEach(track => track.stop());
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [active]);

  return (
    <View style={style}>
      {React.createElement('video' as any, {
        ref: videoRef,
        autoPlay: true,
        muted: true,
        playsInline: true,
        'aria-label': 'Live rear camera preview',
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          backgroundColor: '#030609',
        },
      })}
    </View>
  );
}

export function DiscoverARSurface(props: NativeProps) {
  if (Platform.OS === 'web') return <WebLiveCamera {...props} />;
  if (!NativeARView) return <View {...props} />;
  return <NativeARView {...props} />;
}
