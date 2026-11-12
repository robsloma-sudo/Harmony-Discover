import React, { useEffect, useRef } from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { CameraView } from 'expo-camera';
import { requireNativeViewManager } from 'expo-modules-core';
import { readLiveFrame, type BottleRead } from '../services/discoverLiveApi';
import { BrowserDepthEstimator, type RelativeDepthMap } from './BrowserDepthEstimator';

export type ARTrackingUpdate = {
  state: 'normal' | 'limited' | 'not_available' | 'paused' | 'interrupted';
  reason: string;
};

export type ARViewEvent = { nativeEvent: { state?: string; reason?: string; message?: string } };

export type ARKitDepthFrame = { width: number; height: number; sourceWidth: number; sourceHeight: number; depthMeters: number[]; confidence: number[]; cameraIntrinsics: number[]; cameraTransform: number[]; timestamp: number; unit: 'meters'; source: 'sceneDepth' | 'smoothedSceneDepth' };

type NativeProps = ViewProps & {
  active?: boolean;
  recognitionEnabled?: boolean;
  captureRequestId?: number;
  onCapturedImage?: (event: { nativeEvent: { uri: string; width: number; height: number; timestamp: number } }) => void;
  onFrame?: (event: { nativeEvent: { imageBase64: string; timestamp: number } }) => void;
  onTrackingUpdate?: (event: { nativeEvent: ARTrackingUpdate }) => void;
  onARReady?: (event: ARViewEvent) => void;
  onARError?: (event: ARViewEvent) => void;
  onVisualCandidates?: (event: { nativeEvent: { count: number; candidates: Array<{ trackId: number; x: number; y: number; width: number; height: number; confidence: number }> } }) => void;
  onDepthEstimate?: (event: { nativeEvent: RelativeDepthMap | ARKitDepthFrame }) => void;
  onDepthStatus?: (event: { nativeEvent: { status: string } }) => void;
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
  const { active, recognitionEnabled, style, onTrackingUpdate, onRecognitionUpdate, onARError, captureRequestId } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recognitionSchedulerRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onTrackingUpdate, onARReady: props.onARReady, onARError, onRecognitionUpdate: props.onRecognitionUpdate, onVisualCandidates: props.onVisualCandidates, onDepthEstimate: props.onDepthEstimate, onDepthStatus: props.onDepthStatus, onCapturedImage: props.onCapturedImage, recognitionEnabled: props.recognitionEnabled });
  callbacksRef.current = { onTrackingUpdate, onARReady: props.onARReady, onARError, onRecognitionUpdate: props.onRecognitionUpdate, onVisualCandidates: props.onVisualCandidates, onDepthEstimate: props.onDepthEstimate, onDepthStatus: props.onDepthStatus, onCapturedImage: props.onCapturedImage, recognitionEnabled: props.recognitionEnabled };

  useEffect(() => {
    if (!captureRequestId || !active) return;
    let attempts = 0;
    let retryTimer = 0;
    let cancelled = false;
    const captureWhenReady = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const ready = !!video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth >= 2 && video.videoHeight >= 2;
      if (!ready) {
        attempts += 1;
        if (attempts < 40) {
          retryTimer = window.setTimeout(captureWhenReady, 50);
        } else {
          callbacksRef.current.onARError?.({ nativeEvent: { message: 'The live camera did not become ready. Please try again.' } });
        }
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video!.videoWidth;
      canvas.height = video!.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        callbacksRef.current.onARError?.({ nativeEvent: { message: 'The camera frame could not be captured.' } });
        return;
      }
      context.drawImage(video!, 0, 0, canvas.width, canvas.height);
      callbacksRef.current.onCapturedImage?.({ nativeEvent: { uri: canvas.toDataURL('image/jpeg', 0.88), width: canvas.width, height: canvas.height, timestamp: Date.now() } });
    };
    captureWhenReady();
    return () => { cancelled = true; if (retryTimer) window.clearTimeout(retryTimer); };
  }, [captureRequestId, active]);

  useEffect(() => {
    if (!active) {
      callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'paused', reason: 'camera_paused' } });
      return;
    }

    let disposed = false;
    let stream: MediaStream | null = null;
    let frameCheck = 0;
    let recognitionTimer = 0;
    let depthTimer = 0;
    let depthEstimator: BrowserDepthEstimator | null = null;
    let recognitionBusy = false;
    type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>> };
    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    let barcodeDetector: BarcodeDetectorLike | null = null;
    if (BarcodeDetectorCtor) { try { barcodeDetector = new BarcodeDetectorCtor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] }); } catch { barcodeDetector = null; } }
    let lastRecognitionStartedAt = 0;
    const recognitionIntervalMs = 2500;
    // Temporal object tracker for the web camera path. Cloud detections arrive
    // intermittently; stable IDs and smoothed boxes keep an object visually
    // attached between recognition passes instead of resetting by array index.
    type WebTrack = { id: number; x: number; y: number; width: number; height: number; confidence: number; lastSeenAt: number; misses: number };
    let webTracks: WebTrack[] = [];
    let nextWebTrackId = 1;
    const intersectionOverUnion = (a: WebTrack, b: { x: number; y: number; width: number; height: number }) => {
      const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
      const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
      const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
      const union = a.width * a.height + b.width * b.height - intersection;
      return union > 0 ? intersection / union : 0;
    };
    const updateWebTracks = (detections: Array<{ x: number; y: number; width: number; height: number; confidence: number }>) => {
      const now = Date.now();
      const used = new Set<number>();
      const next: WebTrack[] = [];
      const output = detections.map(detection => {
        let bestIndex = -1, bestScore = 0;
        webTracks.forEach((track, index) => {
          if (used.has(index)) return;
          const overlap = intersectionOverUnion(track, detection);
          const dx = (track.x + track.width / 2) - (detection.x + detection.width / 2);
          const dy = (track.y + track.height / 2) - (detection.y + detection.height / 2);
          const distance = Math.hypot(dx, dy);
          const score = overlap >= 0.08 ? overlap : (distance <= 0.16 ? 0.08 * (1 - distance / 0.16) : 0);
          if (score > bestScore) { bestScore = score; bestIndex = index; }
        });
        const previous = bestIndex >= 0 ? webTracks[bestIndex] : null;
        if (bestIndex >= 0) used.add(bestIndex);
        const blend = previous ? 0.38 : 1;
        const track: WebTrack = {
          id: previous?.id ?? nextWebTrackId++,
          x: previous ? previous.x * (1 - blend) + detection.x * blend : detection.x,
          y: previous ? previous.y * (1 - blend) + detection.y * blend : detection.y,
          width: previous ? previous.width * (1 - blend) + detection.width * blend : detection.width,
          height: previous ? previous.height * (1 - blend) + detection.height * blend : detection.height,
          confidence: detection.confidence,
          lastSeenAt: now,
          misses: 0,
        };
        next.push(track);
        return { trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence };
      });
      webTracks.forEach((track, index) => {
        if (!used.has(index) && now - track.lastSeenAt < 7000) next.push({ ...track, misses: track.misses + 1 });
      });
      webTracks = next;
      return next.map(track => ({ trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence }));
    };

    // Keep a single request in flight and pace requests by start time, not by
    // adding a full delay after the provider response. This stays below the
    // server's 30/minute limit even when inference is fast.
    const scheduleRecognition = (delay = recognitionIntervalMs) => {
      if (!disposed && callbacksRef.current.recognitionEnabled) recognitionTimer = window.setTimeout(() => { void recognizeFrame(); }, delay);
    };
    const recognizeFrame = async () => {
      if (disposed || recognitionBusy || !callbacksRef.current.recognitionEnabled) return;
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
        const trackedCandidates = updateWebTracks(result.bottles.map(b => ({ x: b.box.x0, y: b.box.y0, width: b.box.x1 - b.box.x0, height: b.box.y1 - b.box.y0, confidence: b.confidence })));
        callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: trackedCandidates.length, candidates: trackedCandidates } });
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

        depthEstimator = new BrowserDepthEstimator(
          depth => callbacksRef.current.onDepthEstimate?.({ nativeEvent: depth }),
          status => callbacksRef.current.onDepthStatus?.({ nativeEvent: { status } }),
        );
        depthEstimator.start();
        depthTimer = window.setInterval(() => {
          if (!disposed && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) depthEstimator?.submit(video);
        }, 1700);

        const verifyFrame = () => {
          if (disposed) return;
          const current = videoRef.current;
          if (current && !current.paused && current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && current.videoWidth > 0 && current.videoHeight > 0) {
            callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: 'browser_camera_ready_no_world_pose' } });
            callbacksRef.current.onARReady?.({ nativeEvent: { state: 'ready', reason: 'browser_video_frames_verified' } });
            if (callbacksRef.current.recognitionEnabled) scheduleRecognition();
            return;
          }
          frameCheck = window.requestAnimationFrame(verifyFrame);
        };
        frameCheck = window.requestAnimationFrame(verifyFrame);
      } catch (error) {
        fail(error);
      }
    };

    recognitionSchedulerRef.current = () => scheduleRecognition(0);
    void start();

    return () => {
      recognitionSchedulerRef.current = null;
      disposed = true;
      if (frameCheck) window.cancelAnimationFrame(frameCheck);
      if (recognitionTimer) window.clearTimeout(recognitionTimer);
      if (depthTimer) window.clearInterval(depthTimer);
      depthEstimator?.dispose();
      if (stream) stream.getTracks().forEach(track => track.stop());
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [active]);

  useEffect(() => {
    if (active && recognitionEnabled) recognitionSchedulerRef.current?.();
  }, [active, recognitionEnabled]);

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

function FallbackNativeCamera(props: NativeProps) {
  const cameraRef = useRef<any>(null);
  const cameraReady = useRef(false);
  const lastRequest = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!props.active || !props.captureRequestId || props.captureRequestId === lastRequest.current) return;
    lastRequest.current = props.captureRequestId;
    let cancelled = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const capture = async () => {
      if (cancelled) return;
      if (!cameraReady.current || !cameraRef.current || busy.current) {
        attempts += 1;
        if (attempts < 40) { retry = setTimeout(() => { void capture(); }, 100); return; }
        props.onARError?.({ nativeEvent: { message: 'The live camera did not become ready. Please try again.' } });
        return;
      }
      busy.current = true;
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.88 });
        if (!cancelled && photo?.uri) props.onCapturedImage?.({ nativeEvent: { uri: photo.uri, width: photo.width, height: photo.height, timestamp: Date.now() } });
        else if (!cancelled) props.onARError?.({ nativeEvent: { message: 'The camera did not return an image.' } });
      } catch (error) {
        if (!cancelled) props.onARError?.({ nativeEvent: { message: error instanceof Error ? error.message : 'Camera capture failed.' } });
      } finally { busy.current = false; }
    };
    void capture();
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [props.active, props.captureRequestId]);
  useEffect(() => {
    if (!props.active || !props.recognitionEnabled) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled || busy.current || !cameraRef.current) return;
      busy.current = true;
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.62, base64: true });
        if (!cancelled && photo.base64) {
          const result = await readLiveFrame(`data:image/jpeg;base64,${photo.base64}`);
          if (!cancelled) {
            props.onRecognitionUpdate?.({ nativeEvent: {
              text: result.bottles.flatMap(bottle => [bottle.brand, bottle.product, ...bottle.words]).filter(Boolean),
              barcodes: [], classifications: result.bottles.map(bottle => ({ identifier: bottle.category, confidence: String(bottle.confidence) })),
              frameTimestamp: Date.now(), bottles: result.bottles, menu: result.menu, diagnostics: result.diagnostics, barcodeStatus: 'unsupported',
            } });
          }
        }
      } catch (error) {
        if (!cancelled) props.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? error.message : 'fallback_frame_read_failed' } });
      } finally { busy.current = false; }
    }, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [props.active, props.recognitionEnabled]);
  return <CameraView ref={cameraRef} style={props.style} facing="back" onCameraReady={() => { cameraReady.current = true; props.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: 'expo_camera_ready_no_arkit_world_pose' } }); }} />;
}

type RecognitionTrack = { trackId: number; x: number; y: number; width: number; height: number; confidence: number; lastSeenAt: number };
let nativeRecognitionTracks: RecognitionTrack[] = [];
let nextNativeRecognitionTrackId = 1;
let nativeFrameReadBusy = false;

function trackNativeBottleReads(bottles: BottleRead[]) {
  const now = Date.now();
  const used = new Set<number>();
  const next: RecognitionTrack[] = [];
  const tracked = bottles.map(bottle => {
    const box = { x: bottle.box.x0, y: bottle.box.y0, width: bottle.box.x1 - bottle.box.x0, height: bottle.box.y1 - bottle.box.y0 };
    let bestIndex = -1, bestOverlap = 0;
    nativeRecognitionTracks.forEach((prior, index) => {
      if (used.has(index)) return;
      const left = Math.max(prior.x, box.x), top = Math.max(prior.y, box.y);
      const right = Math.min(prior.x + prior.width, box.x + box.width), bottom = Math.min(prior.y + prior.height, box.y + box.height);
      const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
      const union = prior.width * prior.height + box.width * box.height - intersection;
      const overlap = union > 0 ? intersection / union : 0;
      if (overlap > bestOverlap) { bestOverlap = overlap; bestIndex = index; }
    });
    const prior = bestIndex >= 0 && bestOverlap >= 0.12 ? nativeRecognitionTracks[bestIndex] : null;
    if (prior && bestIndex >= 0) used.add(bestIndex);
    const blend = prior ? 0.38 : 1;
    const track: RecognitionTrack = {
      trackId: prior?.trackId ?? nextNativeRecognitionTrackId++,
      x: prior ? prior.x * (1 - blend) + box.x * blend : box.x,
      y: prior ? prior.y * (1 - blend) + box.y * blend : box.y,
      width: prior ? prior.width * (1 - blend) + box.width * blend : box.width,
      height: prior ? prior.height * (1 - blend) + box.height * blend : box.height,
      confidence: bottle.confidence,
      lastSeenAt: now,
    };
    next.push(track);
    return track;
  });
  nativeRecognitionTracks.forEach((track, index) => {
    if (!used.has(index) && now - track.lastSeenAt < 1200) next.push(track);
  });
  nativeRecognitionTracks = next;
  return tracked;
}

export function DiscoverARSurface(props: NativeProps) {
  const nativeVisionSignals = useRef<{ text: string[]; barcodes: Array<{ value: string; symbology: string }>; timestamp: number } | null>(null);
  if (Platform.OS === 'web') return <WebLiveCamera {...props} />;
  if (!NativeARView) return <FallbackNativeCamera {...props} />;
  return <NativeARView {...props}
    onRecognitionUpdate={event => {
      const value = event.nativeEvent;
      nativeVisionSignals.current = { text: value.text || [], barcodes: value.barcodes || [], timestamp: value.frameTimestamp || Date.now() };
      props.onRecognitionUpdate?.({ nativeEvent: { ...value, barcodeStatus: 'available' } });
    }}
    onFrame={event => {
      if (nativeFrameReadBusy) return;
      nativeFrameReadBusy = true;
      const frame = event.nativeEvent;
      void readLiveFrame(`data:image/jpeg;base64,${frame.imageBase64}`).then(result => {
        const signals = nativeVisionSignals.current;
        const signalsAreFresh = !!signals && Date.now() - signals.timestamp < 3500;
        const cloudText = result.bottles.flatMap(bottle => [bottle.brand, bottle.product, ...bottle.words]).filter(Boolean);
        const mergedText = Array.from(new Set([...cloudText, ...(signalsAreFresh ? signals!.text : [])]));
        props.onRecognitionUpdate?.({ nativeEvent: {
          text: mergedText,
          barcodes: signalsAreFresh ? signals!.barcodes : [],
          classifications: result.bottles.map(bottle => ({ identifier: bottle.category, confidence: String(bottle.confidence) })),
          frameTimestamp: Date.now(),
          bottles: result.bottles,
          menu: result.menu,
          diagnostics: result.diagnostics,
          barcodeStatus: 'available',
        } });
        const tracked = trackNativeBottleReads(result.bottles);
        props.onVisualCandidates?.({ nativeEvent: { count: tracked.length, candidates: tracked.map(track => ({ trackId: track.trackId, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence })) } });
      }).catch(error => {
        props.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? error.message : 'native_frame_read_failed' } });
      }).finally(() => { nativeFrameReadBusy = false; });
    }}
  />;
}
