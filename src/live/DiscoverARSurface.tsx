import React, { useEffect, useRef } from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { CameraView } from 'expo-camera';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { readLiveFrame, readLiveLabelBatch, type BottleRead, type LabelBatchRead } from '../services/discoverLiveApi';
import { BrowserDepthEstimator, type RelativeDepthMap } from './BrowserDepthEstimator';
import { SegmentationRunner } from './segmentationEngine';
import { extractMaskContour } from './maskContour';
import { LocalBottleTracker } from './localBottleTracker';
import { calculateLabelCrop } from './labelCrop';
import { selectLabelBatchCandidates } from './labelBatch';
import { associateBottleReadTracks, type BottleReadTrack } from './bottleReadIdentity';
import { loadDfineSegOnnxProvider } from './dfineSegRuntime';
import { isConfirmedWebBottleTrack } from './webTrackPolicy';
import { assessLiquidInterface, type LiquidLineObservation } from '../services/liquidInterface';
import { LiquidAnalysisQueue } from '../services/liquidAnalysisQueue';
import { estimateCalibratedBottleVolume } from '../services/bottleVolumeCalibration';
import { getBottleCalibrationKey, getCachedBottleVolumeProfile, loadBottleVolumeProfiles } from '../services/bottleVolumeProfileStore';
import type { BottleVolumeProfile } from '../services/bottleVolumeCalibration';

export type ARTrackingUpdate = {
  state: 'normal' | 'limited' | 'not_available' | 'paused' | 'interrupted';
  reason: string;
};

export type ARViewEvent = { nativeEvent: { state?: string; reason?: string; message?: string } };

export type ARKitDepthFrame = { width: number; height: number; sourceWidth: number; sourceHeight: number; depthMeters: number[]; confidence: number[]; cameraIntrinsics: number[]; cameraTransform: number[]; timestamp: number; unit: 'meters'; source: 'sceneDepth' | 'smoothedSceneDepth'; imageOrientation: number };

export type ARKitCameraPose = { width: number; height: number; cameraIntrinsics: number[]; cameraTransform: number[]; timestamp: number; imageOrientation: number };

type NativeProps = ViewProps & {
  active?: boolean;
  recognitionEnabled?: boolean;
  captureRequestId?: number;
  onCapturedImage?: (event: { nativeEvent: { uri: string; width: number; height: number; timestamp: number } }) => void;
  onFrame?: (event: { nativeEvent: { imageBase64: string; timestamp: number; depthEstimate?: ARKitDepthFrame } }) => void;
  onTrackingUpdate?: (event: { nativeEvent: ARTrackingUpdate }) => void;
  onARReady?: (event: ARViewEvent) => void;
  onARError?: (event: ARViewEvent) => void;
  onVisualCandidates?: (event: { nativeEvent: { count: number; source?: 'cloud' | 'local'; depthFrame?: ARKitDepthFrame; candidates: Array<{ trackId: number; x: number; y: number; width: number; height: number; confidence: number; timestamp?: number; contour?: Array<{ x: number; y: number }>; bottle?: BottleRead; liquidLevel?: { heightPercent: number; confidence: number; method: 'temporal_consensus'; calibratedVolume?: { milliliters: number; fluidOunces: number; profileId: string } } }> } }) => void;
  onDepthEstimate?: (event: { nativeEvent: RelativeDepthMap | ARKitDepthFrame }) => void;
  onCameraPose?: (event: { nativeEvent: ARKitCameraPose }) => void;
  onDepthStatus?: (event: { nativeEvent: { status: string } }) => void;
  onLiquidMetrics?: (event: { nativeEvent: { jobsDispatched: number; jobsCompleted: number; framesSkipped: number; workerErrors: number; lastWorkerMs: number; maxWorkerMs: number; segmentationMs: number; workerAvailable: boolean } }) => void;
  onRecognitionUpdate?: (event: { nativeEvent: { text: string[]; barcodes: Array<{ value: string; symbology: string }>; textItems?: Array<{ text: string; confidence: number; box: { x0: number; y0: number; x1: number; y1: number } }>; barcodeItems?: Array<{ value: string; symbology: string; box: { x0: number; y0: number; x1: number; y1: number } }>; imageWidth?: number; imageHeight?: number; classifications: Array<{ identifier: string; confidence: string }>; frameTimestamp: number; bottles?: Awaited<ReturnType<typeof readLiveFrame>>['bottles']; menu?: Awaited<ReturnType<typeof readLiveFrame>>['menu']; diagnostics?: Awaited<ReturnType<typeof readLiveFrame>>['diagnostics']; barcodeStatus?: 'available' | 'unsupported' } }) => void;
};


type NativeLiquidAnalysisModule = {
  analyzeLiquidLevels: (imageBase64: string, boxes: Array<{ trackId: number; x: number; y: number; width: number; height: number }>) => Promise<Array<{
    trackId: number; normalizedHeight: number; confidence: number; boundaryShape: string; opticalScore: number; processingMs: number;
  }>>;
};
let NativeLiquidAnalyzer: NativeLiquidAnalysisModule | null = null;
if (Platform.OS === 'ios') {
  try { NativeLiquidAnalyzer = requireNativeModule<NativeLiquidAnalysisModule>('DiscoverARKit'); }
  catch { NativeLiquidAnalyzer = null; }
}

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
  const callbacksRef = useRef({ onTrackingUpdate, onARReady: props.onARReady, onARError, onRecognitionUpdate: props.onRecognitionUpdate, onVisualCandidates: props.onVisualCandidates, onDepthEstimate: props.onDepthEstimate, onDepthStatus: props.onDepthStatus, onLiquidMetrics: props.onLiquidMetrics, onCapturedImage: props.onCapturedImage, recognitionEnabled: props.recognitionEnabled });
  callbacksRef.current = { onTrackingUpdate, onARReady: props.onARReady, onARError, onRecognitionUpdate: props.onRecognitionUpdate, onVisualCandidates: props.onVisualCandidates, onDepthEstimate: props.onDepthEstimate, onDepthStatus: props.onDepthStatus, onLiquidMetrics: props.onLiquidMetrics, onCapturedImage: props.onCapturedImage, recognitionEnabled: props.recognitionEnabled };

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
    let localDetectionTimer = 0;
    let localDetectionBusy = false;
    let depthTimer = 0;
    let depthEstimator: BrowserDepthEstimator | null = null;
    let recognitionBusy = false;
    let labelBatchBusy = false;
    let nextLabelBatchAt = Date.now() + 2200;
    const labelReadsByTrack = new Map<number, LabelBatchRead>();
    const lastLabelReadAt = new Map<number, number>();
    let segmentationRunner: SegmentationRunner | null = null;
    let segmentationLoading: Promise<void> | null = null;
    let segmentationLoadFailed = false;
    const localBottleTracker = new LocalBottleTracker();
    let pageVisible = document.visibilityState === 'visible';
    const handleVisibilityChange = () => {
      pageVisible = document.visibilityState === 'visible';
      if (!pageVisible) {
        if (recognitionTimer) window.clearTimeout(recognitionTimer);
        if (localDetectionTimer) window.clearInterval(localDetectionTimer);
        recognitionTimer = 0;
        localDetectionTimer = 0;
        localBottleTracker.reset();
        liquidHistoryByTrack.clear();
        latestLocalCandidates = [];
        callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: 0, source: 'local', candidates: [] } });
        callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'paused', reason: 'page_hidden' } });
      } else if (callbacksRef.current.recognitionEnabled) {
        scheduleRecognition(250);
        startLocalDetectionLoop();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const ensureSegmentationRunner = () => {
      if (segmentationRunner || segmentationLoading || segmentationLoadFailed || disposed) return segmentationLoading;
      segmentationLoading = loadDfineSegOnnxProvider({ minimumScore: 0.5 }).then(provider => {
        if (disposed) { void provider.dispose?.(); return; }
        segmentationRunner = new SegmentationRunner(provider, {
          minimumIntervalMs: 850,
          maximumFrameAgeMs: 1400,
          maximumTracksPerFrame: 8,
        });
      }).catch(error => {
        segmentationLoadFailed = true;
        callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? `local_segmentation_unavailable: ${error.message}` : 'local_segmentation_unavailable' } });
      }).finally(() => { segmentationLoading = null; });
      return segmentationLoading;
    };
    type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>> };
    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    let barcodeDetector: BarcodeDetectorLike | null = null;
    if (BarcodeDetectorCtor) { try { barcodeDetector = new BarcodeDetectorCtor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] }); } catch { barcodeDetector = null; } }
    let lastRecognitionStartedAt = 0;
    // Full-frame reads and label batches share the DEV endpoint's 30-request/minute quota.
    // Each path is paced at 4.4s and recognitionBusy serializes them under the shared ceiling.
    const recognitionIntervalMs = 4400;
    // Temporal object tracker for the web camera path. Cloud detections arrive
    // intermittently; stable IDs and smoothed boxes keep an object visually
    // attached between recognition passes instead of resetting by array index.
    type WebTrack = { id: number; x: number; y: number; width: number; height: number; confidence: number; lastSeenAt: number; misses: number; hits: number; contour?: Array<{ x: number; y: number }>; bottle: BottleRead };
    let webTracks: WebTrack[] = [];
    let latestLocalCandidates: Array<{ trackId: number; x: number; y: number; width: number; height: number; confidence: number; contour?: Array<{ x: number; y: number }>; liquidLevel?: { heightPercent: number; confidence: number; method: 'temporal_consensus'; calibratedVolume?: { milliliters: number; fluidOunces: number; profileId: string } } }> = [];
    // Liquid evidence is kept per local bottle track and never blocks cloud label recognition.
    const liquidHistoryByTrack = new Map<number, { observations: LiquidLineObservation[]; updatedAt: number }>();
    let bottleVolumeProfiles: Record<string, import('../services/bottleVolumeCalibration').BottleVolumeProfile> = {};
    void loadBottleVolumeProfiles().then(registry => { if (!disposed) bottleVolumeProfiles = registry.profiles; });
    let nextWebTrackId = 1;
    const intersectionOverUnion = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => {
      const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
      const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
      const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
      const union = a.width * a.height + b.width * b.height - intersection;
      return union > 0 ? intersection / union : 0;
    };
    const updateWebTracks = (detections: Array<{ x: number; y: number; width: number; height: number; confidence: number; bottle: BottleRead }>) => {
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
        const trackBounds = { x: previous ? previous.x * (1 - blend) + detection.x * blend : detection.x, y: previous ? previous.y * (1 - blend) + detection.y * blend : detection.y, width: previous ? previous.width * (1 - blend) + detection.width * blend : detection.width, height: previous ? previous.height * (1 - blend) + detection.height * blend : detection.height };
        const track: WebTrack = {
          id: previous?.id ?? nextWebTrackId++,
          x: trackBounds.x,
          y: trackBounds.y,
          width: trackBounds.width,
          height: trackBounds.height,
          confidence: detection.confidence,
          bottle: detection.bottle,
          lastSeenAt: now,
          misses: 0,
          hits: (previous?.hits ?? 0) + 1,
          contour: previous?.contour?.map(point => ({
            x: trackBounds.x + ((point.x - previous.x) / Math.max(previous.width, 0.0001)) * trackBounds.width,
            y: trackBounds.y + ((point.y - previous.y) / Math.max(previous.height, 0.0001)) * trackBounds.height,
          })),
        };
        next.push(track);
        return { trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, contour: track.contour };
      });
      webTracks.forEach((track, index) => {
        if (!used.has(index) && now - track.lastSeenAt < 7000) next.push({ ...track, misses: track.misses + 1 });
      });
      webTracks = next;
      // Do not expose one-frame guesses as visible bottle tracks. A track must
      // be seen twice and may survive only one missed recognition interval.
      return next.filter(isConfirmedWebBottleTrack)
        .map(track => ({ trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, contour: track.contour, bottle: track.bottle }));
    };

    // Local D-FINE detection has its own cadence. It must not wait for slower
    // cloud recognition before updating spatial boxes.

    const publishVisibleCandidates = () => {
      const cloudCandidates = webTracks
        .filter(isConfirmedWebBottleTrack)
        .map(track => ({ trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, contour: track.contour, bottle: track.bottle }));
      const localCandidates = latestLocalCandidates
        .filter(candidate => !cloudCandidates.some(cloud => intersectionOverUnion(cloud, candidate) > 0.25))
        .map(candidate => {
        const read = labelReadsByTrack.get(candidate.trackId);
        if (!read) return candidate;
        const bottle: BottleRead = {
          box: { x0: candidate.x, y0: candidate.y, x1: candidate.x + candidate.width, y1: candidate.y + candidate.height },
          label_box: null, edgePaths: [], words: read.words,
          brand: read.brand, product: read.product, category: read.category,
          proof: read.proof, size: read.size, origin: read.origin,
          confidence: read.confidence, detectionConfidence: candidate.confidence,
          fieldConfidence: read.fieldConfidence, researchSources: [], details: read.details,
          match: read.match, state: read.state,
        };
        return { ...candidate, bottle };
      });
      const visibleCandidates = [...cloudCandidates, ...localCandidates];
      callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: visibleCandidates.length, source: 'local', candidates: visibleCandidates } });
    };

    // Liquid work is isolated in a dedicated worker. If Worker support is
    // missing, the feature abstains instead of consuming camera/UI-thread time.
    let lastSegmentationMs = 0;
    const liquidAnalysisQueue = new LiquidAnalysisQueue((timestamp, results) => {
      if (disposed || !pageVisible || Date.now() - timestamp > 1400) return;
      let changed = false;
      for (const item of results) {
        const current = latestLocalCandidates.find(candidate => candidate.trackId === item.trackId);
        if (!current) continue; // Track disappeared while the worker was busy.
        if (item.optical.status !== 'observable' || item.optical.score < 0.55) {
          liquidHistoryByTrack.delete(item.trackId);
          continue;
        }
        if (item.result.status !== 'candidate' || item.result.confidence < 0.7 || item.result.boundaryShape === 'irregular') continue;
        const previous = liquidHistoryByTrack.get(item.trackId);
        const history = previous && timestamp - previous.updatedAt <= 2200 ? previous.observations : [];
        const observations = [...history, {
          frameId: String(timestamp),
          normalizedHeight: item.result.normalizedHeight,
          confidence: item.result.confidence,
        }].slice(-5);
        liquidHistoryByTrack.set(item.trackId, { observations, updatedAt: timestamp });
        const consensus = assessLiquidInterface(observations);
        if (consensus.status === 'visible') {
          const labelRead = labelReadsByTrack.get(item.trackId);
          const identityKey = getBottleCalibrationKey(labelRead?.match, labelRead?.state ?? 'unsure', labelRead?.size);
          const profile = identityKey ? (getCachedBottleVolumeProfile(identityKey) ?? bottleVolumeProfiles[identityKey]) : undefined;
          const calibrated = estimateCalibratedBottleVolume(consensus.normalizedHeight, profile);
          current.liquidLevel = {
            heightPercent: Math.round(consensus.normalizedHeight * 100),
            confidence: consensus.confidence,
            method: 'temporal_consensus',
            ...(calibrated.status === 'calibrated' ? {
              calibratedVolume: {
                milliliters: calibrated.milliliters,
                fluidOunces: calibrated.fluidOunces,
                profileId: calibrated.profileId,
              },
            } : {}),
          };
          changed = true;
        }
      }
      // Bound the history map even when many objects pass through the view.
      for (const [trackId, history] of liquidHistoryByTrack) {
        if (timestamp - history.updatedAt > 7000) liquidHistoryByTrack.delete(trackId);
      }
      if (changed) publishVisibleCandidates();
    }, undefined, metrics => callbacksRef.current.onLiquidMetrics?.({ nativeEvent: { ...metrics, segmentationMs: lastSegmentationMs } }));

    const readCandidateLabels = async (frameCanvas: HTMLCanvasElement) => {
      if (disposed || !pageVisible || recognitionBusy || labelBatchBusy || Date.now() < nextLabelBatchAt) return;
      const now = Date.now();
      const isVerifiedRead = (read?: LabelBatchRead) =>
        !!read?.brand && !!read.product && read.confidence >= 0.85
        && read.state === 'matched' && !!read.match?.id && read.match.score >= 0.9;
      // A catalog-verified label read belongs to this tracked object. Do not
      // spend another label-batch request re-reading it on every later frame.
      const activeCloudTracks = webTracks.filter(track => track.misses === 0
        && !isVerifiedRead(labelReadsByTrack.get(track.id)));
      const candidates = [
        ...activeCloudTracks.map(track => ({
          trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence,
          bottle: track.bottle,
        })),
        ...latestLocalCandidates
          .filter(local => !activeCloudTracks.some(cloud => intersectionOverUnion(cloud, local) > 0.25))
          .filter(local => !isVerifiedRead(labelReadsByTrack.get(local.trackId)))
          .map(candidate => ({ ...candidate, bottle: labelReadsByTrack.get(candidate.trackId) })),
      ];
      const eligible = selectLabelBatchCandidates(candidates, lastLabelReadAt, now, 8, 15000);
      const crops: Array<{ trackId: number; image: string }> = [];
      for (const candidate of eligible) {
        if (crops.length >= 8) break;
        const labelBox = candidate.bottle?.label_box || {
          x0: candidate.x + candidate.width * 0.12,
          y0: candidate.y + candidate.height * 0.30,
          x1: candidate.x + candidate.width * 0.88,
          y1: candidate.y + candidate.height * 0.74,
        };
        const crop = calculateLabelCrop(labelBox, frameCanvas.width, frameCanvas.height, { maxLongEdge: 1024, maxUpscale: 1.5 });
        if (!crop) continue;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = crop.outputWidth;
        cropCanvas.height = crop.outputHeight;
        const cropContext = cropCanvas.getContext('2d');
        if (!cropContext) continue;
        cropContext.drawImage(frameCanvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.outputWidth, crop.outputHeight);
        const image = cropCanvas.toDataURL('image/jpeg', 0.78);
        if (image.length > 100000) continue;
        crops.push({ trackId: candidate.trackId, image });
      }
      nextLabelBatchAt = now + 4400;
      if (!crops.length) return;
      labelBatchBusy = true;
      recognitionBusy = true;
      crops.forEach(crop => lastLabelReadAt.set(crop.trackId, now));
      try {
        const reads = await readLiveLabelBatch(crops);
        if (disposed) return;
        const returnedTrackIds = new Set(reads.map(read => read.trackId));
        crops.filter(crop => !returnedTrackIds.has(crop.trackId)).forEach(crop => lastLabelReadAt.delete(crop.trackId));
        for (const read of reads) {
          labelReadsByTrack.set(read.trackId, read);
          const cloudTrack = webTracks.find(track => track.id === read.trackId);
          if (cloudTrack) {
            const previous = cloudTrack.bottle;
            cloudTrack.bottle = {
              ...previous,
              brand: read.brand || previous.brand,
              product: read.product || previous.product,
              category: read.category || previous.category,
              proof: read.proof || previous.proof,
              size: read.size || previous.size,
              origin: read.origin || previous.origin,
              words: read.words.length ? read.words : previous.words,
              confidence: Math.max(previous.confidence, read.confidence),
              fieldConfidence: { ...previous.fieldConfidence, ...read.fieldConfidence },
              details: { ...previous.details, ...read.details },
              match: read.match || previous.match,
              state: read.state === 'matched' ? 'matched' : read.brand ? read.state : previous.state,
            };
          }
        }
        publishVisibleCandidates();
      } catch (error) {
        crops.forEach(crop => lastLabelReadAt.delete(crop.trackId));
        if (!disposed) callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? 'label_batch_failed: ' + error.message : 'label_batch_failed' } });
      } finally {
        labelBatchBusy = false;
        recognitionBusy = false;
      }
    };

    const runLocalDetection = async () => {
      if (disposed || !pageVisible || localDetectionBusy || !callbacksRef.current.recognitionEnabled || !segmentationRunner) return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth < 2 || video.videoHeight < 2) return;
      localDetectionBusy = true;
      const frameTimestamp = Date.now();
      try {
        const displayWidth = video.clientWidth || video.videoWidth;
        const displayHeight = video.clientHeight || video.videoHeight;
        const displayAspect = displayWidth / displayHeight;
        const sourceAspect = video.videoWidth / video.videoHeight;
        let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
        if (sourceAspect > displayAspect) { sw = video.videoHeight * displayAspect; sx = (video.videoWidth - sw) / 2; }
        else if (sourceAspect < displayAspect) { sh = video.videoWidth / displayAspect; sy = (video.videoHeight - sh) / 2; }
        const scale = Math.min(1, 640 / Math.max(sw, sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const segmentationStartedAt = performance.now();
        const instances = await segmentationRunner.runInference(frame, frameTimestamp);
        lastSegmentationMs = performance.now() - segmentationStartedAt;
        if (disposed || !pageVisible || Date.now() - frameTimestamp > 1400) return;
        const localTracks = localBottleTracker.update(instances.map(instance => {
          const contour = extractMaskContour(instance.data, instance.width, instance.height, {
            bounds: instance.bounds, minimumPixels: 12, minimumArea: 0.001, maxPoints: 96,
          });
          return { bounds: instance.bounds, confidence: instance.detectionConfidence, contour: contour?.points };
        }), frameTimestamp);
        const activeLocalTracks = localTracks.filter(local =>
          !webTracks.some(cloud => intersectionOverUnion(cloud, local.bounds) > 0.25)
        );
        const candidates = activeLocalTracks.map(local => ({
          trackId: -Math.abs(local.trackId),
          x: local.bounds.x, y: local.bounds.y,
          width: local.bounds.width, height: local.bounds.height,
          confidence: local.confidence, contour: local.contour,
        }));
        latestLocalCandidates = candidates;
        // Transfer this frame's pixel buffer to the worker. The worker owns the
        // buffer after transfer; the primary segmentation and recognition paths
        // do not wait for its result.
        liquidAnalysisQueue.submit(frame, frameTimestamp, activeLocalTracks.map(local => ({
          trackId: -Math.abs(local.trackId),
          bounds: {
            x: local.bounds.x * frame.width,
            y: local.bounds.y * frame.height,
            width: local.bounds.width * frame.width,
            height: local.bounds.height * frame.height,
          },
        })));
        const cloudCandidates = webTracks
          .filter(track => track.hits >= 1 && track.misses === 0 && track.confidence >= 0.45)
          .map(track => ({ trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, contour: track.contour, bottle: track.bottle }));
        publishVisibleCandidates();
        void readCandidateLabels(canvas);
      } catch (error) {
        if (!disposed) callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? 'local_segmentation_frame_failed: ' + error.message : 'local_segmentation_frame_failed' } });
      } finally {
        localDetectionBusy = false;
      }
    };
    const startLocalDetectionLoop = () => {
      if (disposed || !pageVisible || localDetectionTimer || !callbacksRef.current.recognitionEnabled) return;
      void Promise.resolve(ensureSegmentationRunner()).then(() => {
        if (disposed || !pageVisible || localDetectionTimer || !callbacksRef.current.recognitionEnabled || !segmentationRunner) return;
        void runLocalDetection();
        localDetectionTimer = window.setInterval(() => { void runLocalDetection(); }, 1000);
      });
    };

    // Keep a single request in flight and pace requests by start time, not by
    // adding a full delay after the provider response. This stays below the
    // server's 30/minute limit even when inference is fast.
    const scheduleRecognition = (delay = recognitionIntervalMs) => {
      if (!disposed && pageVisible && callbacksRef.current.recognitionEnabled) { void ensureSegmentationRunner(); recognitionTimer = window.setTimeout(() => { void recognizeFrame(); }, delay); }
    };
    const recognizeFrame = async () => {
      if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled) return;
      if (recognitionBusy) { scheduleRecognition(500); return; }
      const video = videoRef.current;
      if (!video || video.videoWidth < 2 || video.videoHeight < 2) { scheduleRecognition(); return; }
      recognitionBusy = true;
      lastRecognitionStartedAt = Date.now();
      let labelFrameCanvas: HTMLCanvasElement | null = null;
      try {
        const canvas = document.createElement('canvas');
        labelFrameCanvas = canvas;
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
        const frameTimestamp = Date.now();
        const jpeg = canvas.toDataURL('image/jpeg', 0.62);
        // Barcode decoding is deliberately independent from bottle recognition.
        // Keep this frame's canvas and timestamp so a late barcode result can be
        // traced to the image that produced it without delaying the bottle boxes.
        if (barcodeDetector) {
          void barcodeDetector.detect(canvas).then(decodedBarcodes => {
            if (disposed || !decodedBarcodes.length) return;
            callbacksRef.current.onRecognitionUpdate?.({ nativeEvent: {
              text: [],
              barcodes: decodedBarcodes.map(code => ({ value: code.rawValue, symbology: code.format })),
              barcodeStatus: 'available',
              classifications: [],
              frameTimestamp,
              imageWidth: canvas.width,
              imageHeight: canvas.height,
            } });
          }).catch(() => {
            // Barcode support is best-effort; a decoder failure must never
            // turn a successful bottle recognition pass into a failed pass.
          });
        }
        const result = await readLiveFrame(jpeg);
        if (disposed) return;
        const text = result.bottles.flatMap(b => [b.brand, b.product, ...b.words]).filter(Boolean);
        const classifications = result.bottles.map(b => ({ identifier: b.category, confidence: String(b.confidence) }));
        callbacksRef.current.onRecognitionUpdate?.({ nativeEvent: { text, barcodes: [], barcodeStatus: barcodeDetector ? 'available' : 'unsupported', classifications, frameTimestamp, bottles: result.bottles, menu: result.menu, diagnostics: result.diagnostics } });
        updateWebTracks(result.bottles.map(b => ({ x: b.box.x0, y: b.box.y0, width: b.box.x1 - b.box.x0, height: b.box.y1 - b.box.y0, confidence: b.detectionConfidence, bottle: b })));
        // Publish model detections immediately; optional local segmentation must
        // never block the basic bottle boxes from reaching the viewfinder.
        const cloudCandidates = webTracks
          .filter(track => track.hits >= 1 && track.misses === 0 && track.confidence >= 0.45)
          .map(track => ({ trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, contour: track.contour, bottle: track.bottle }));
        const visibleCandidates = [...cloudCandidates, ...latestLocalCandidates];
        callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: visibleCandidates.length, candidates: visibleCandidates } });

      } catch (error) {
        if (!disposed) callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? error.message : 'recognition_request_failed' } });
      } finally {
        recognitionBusy = false;
        if (labelFrameCanvas && !disposed) void readCandidateLabels(labelFrameCanvas);
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

        // The relative-depth transformer is a large additional WASM/WebGPU
        // allocation. Mobile browsers have a much tighter camera-process memory
        // budget, so keep it off the mobile web path; native iOS uses ARKit depth.
        const mobileBrowser = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (mobileBrowser) {
          callbacksRef.current.onDepthStatus?.({ nativeEvent: { status: 'Mobile browser depth paused for camera stability; use native iPhone ARKit for metric depth.' } });
        } else {
          depthEstimator = new BrowserDepthEstimator(
            depth => callbacksRef.current.onDepthEstimate?.({ nativeEvent: depth }),
            status => callbacksRef.current.onDepthStatus?.({ nativeEvent: { status } }),
          );
          depthEstimator.start();
          depthTimer = window.setInterval(() => {
            if (!disposed && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) depthEstimator?.submit(video);
          }, 1700);
        }

        const verifyFrame = () => {
          if (disposed) return;
          const current = videoRef.current;
          if (current && !current.paused && current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && current.videoWidth > 0 && current.videoHeight > 0) {
            callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: 'browser_camera_ready_no_world_pose' } });
            callbacksRef.current.onARReady?.({ nativeEvent: { state: 'ready', reason: 'browser_video_frames_verified' } });
            if (callbacksRef.current.recognitionEnabled) { scheduleRecognition(); startLocalDetectionLoop(); }
            return;
          }
          frameCheck = window.requestAnimationFrame(verifyFrame);
        };
        frameCheck = window.requestAnimationFrame(verifyFrame);
      } catch (error) {
        fail(error);
      }
    };

    recognitionSchedulerRef.current = () => { scheduleRecognition(0); startLocalDetectionLoop(); };
    void start();

    return () => {
      recognitionSchedulerRef.current = null;
      disposed = true;
      if (frameCheck) window.cancelAnimationFrame(frameCheck);
      if (recognitionTimer) window.clearTimeout(recognitionTimer);
      if (localDetectionTimer) window.clearInterval(localDetectionTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (depthTimer) window.clearInterval(depthTimer);
      localBottleTracker.reset();
      liquidAnalysisQueue.dispose();
      liquidHistoryByTrack.clear();
      if (segmentationRunner) void segmentationRunner.dispose();
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
            const tracked = trackNativeBottleReads(result.bottles);
            props.onVisualCandidates?.({ nativeEvent: { count: tracked.length, candidates: tracked.map(track => ({ trackId: track.trackId, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, bottle: track.bottle })) } });
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

let nativeRecognitionTracks: BottleReadTrack[] = [];
let nextNativeRecognitionTrackId = 1;

function trackNativeBottleReads(bottles: BottleRead[]) {
  const result = associateBottleReadTracks(
    bottles,
    nativeRecognitionTracks,
    Date.now(),
    nextNativeRecognitionTrackId,
    7000,
  );
  nativeRecognitionTracks = result.tracks;
  nextNativeRecognitionTrackId = result.nextId;
  return result.tracks.filter(track => bottles.includes(track.bottle));
}

export function DiscoverARSurface(props: NativeProps) {
  const nativeVisionSignals = useRef<{ text: string[]; barcodes: Array<{ value: string; symbology: string }>; timestamp: number } | null>(null);
  const nativeFrameReadBusy = useRef(false);
  const nativeLiquidBusy = useRef(false);
  const nativeSessionGeneration = useRef(0);
  const nativeLiquidHistory = useRef(new Map<number, { observations: LiquidLineObservation[]; updatedAt: number }>());
  const nativeVolumeProfiles = useRef<Record<string, BottleVolumeProfile>>({});
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    void loadBottleVolumeProfiles().then(registry => { if (active) nativeVolumeProfiles.current = registry.profiles; });
    return () => { active = false; };
  }, []);
  const resetNativeSession = () => {
    nativeSessionGeneration.current += 1;
    nativeFrameReadBusy.current = false;
    nativeLiquidBusy.current = false;
    nativeRecognitionTracks = [];
    nextNativeRecognitionTrackId = 1;
    nativeVisionSignals.current = null;
    nativeLiquidHistory.current.clear();
  };
  useEffect(() => () => {
    nativeSessionGeneration.current += 1;
    nativeFrameReadBusy.current = false;
  }, []);
  if (Platform.OS === 'web') return <WebLiveCamera {...props} />;
  if (!NativeARView) return <FallbackNativeCamera {...props} />;
  const { onLiquidMetrics, ...nativeViewProps } = props;
  return <NativeARView {...nativeViewProps}
    onARReady={event => {
      if (event.nativeEvent.state === 'starting') resetNativeSession();
      props.onARReady?.(event);
    }}
    onTrackingUpdate={event => {
      if (event.nativeEvent.state === 'paused' || event.nativeEvent.state === 'interrupted' || event.nativeEvent.state === 'not_available') resetNativeSession();
      props.onTrackingUpdate?.(event);
    }}
    onRecognitionUpdate={event => {
      const value = event.nativeEvent;
      nativeVisionSignals.current = { text: value.text || [], barcodes: value.barcodes || [], timestamp: Date.now() };
      props.onRecognitionUpdate?.({ nativeEvent: { ...value, barcodeStatus: 'available' } });
    }}
    onFrame={event => {
      if (nativeFrameReadBusy.current) return;
      nativeFrameReadBusy.current = true;
      const generation = nativeSessionGeneration.current;
      const frame = event.nativeEvent;
      // The attached metric depth and image share this exact ARFrame timestamp.
      if (frame.depthEstimate) props.onDepthEstimate?.({ nativeEvent: frame.depthEstimate });
      void readLiveFrame(`data:image/jpeg;base64,${frame.imageBase64}`).then(async result => {
        if (generation !== nativeSessionGeneration.current) return;
        const signals = nativeVisionSignals.current;
        const signalsAreFresh = !!signals && Date.now() - signals.timestamp < 3500;
        const cloudText = result.bottles.flatMap(bottle => [bottle.brand, bottle.product, ...bottle.words]).filter(Boolean);
        const mergedText = Array.from(new Set([...cloudText, ...(signalsAreFresh ? signals!.text : [])]));
        props.onRecognitionUpdate?.({ nativeEvent: {
          text: mergedText,
          barcodes: signalsAreFresh ? signals!.barcodes : [],
          classifications: result.bottles.map(bottle => ({ identifier: bottle.category, confidence: String(bottle.confidence) })),
          frameTimestamp: frame.timestamp,
          bottles: result.bottles,
          menu: result.menu,
          diagnostics: result.diagnostics,
          barcodeStatus: 'available',
        } });
        const tracked = trackNativeBottleReads(result.bottles);
        const candidates = tracked.map(track => ({ trackId: track.trackId, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, timestamp: frame.timestamp, bottle: track.bottle } as {
          trackId: number; x: number; y: number; width: number; height: number; confidence: number; timestamp: number; bottle: BottleRead;
          liquidLevel?: { heightPercent: number; confidence: number; method: 'temporal_consensus'; calibratedVolume?: { milliliters: number; fluidOunces: number; profileId: string } };
        }));
        // Publish bottle boxes immediately. Liquid analysis is fire-and-forget
        // and can only enrich these candidates after its background result.
        props.onVisualCandidates?.({ nativeEvent: { count: candidates.length, depthFrame: frame.depthEstimate, candidates } });
        if (NativeLiquidAnalyzer && tracked.length && !nativeLiquidBusy.current) {
          nativeLiquidBusy.current = true;
          void NativeLiquidAnalyzer.analyzeLiquidLevels(frame.imageBase64, tracked.map(track => ({
            trackId: track.trackId, x: track.x, y: track.y, width: track.width, height: track.height,
          }))).then(analyses => {
            if (generation !== nativeSessionGeneration.current) return;
            const nativeProcessingMs = analyses.reduce((max, item) => Math.max(max, Number(item.processingMs) || 0), 0);
            let changed = false;
            for (const item of analyses) {
              const current = candidates.find(candidate => candidate.trackId === item.trackId);
              if (!current || item.opticalScore < 0.55 || item.confidence < 0.7 || item.boundaryShape === 'irregular') {
                nativeLiquidHistory.current.delete(item.trackId);
                continue;
              }
              const previous = nativeLiquidHistory.current.get(item.trackId);
              const history = previous && frame.timestamp - previous.updatedAt <= 7 ? previous.observations : [];
              const observations = [...history, {
                frameId: String(frame.timestamp),
                normalizedHeight: item.normalizedHeight,
                confidence: item.confidence,
              }].slice(-5);
              nativeLiquidHistory.current.set(item.trackId, { observations, updatedAt: frame.timestamp });
              const consensus = assessLiquidInterface(observations);
              if (consensus.status === 'visible') {
                const identityKey = getBottleCalibrationKey(current.bottle.match, current.bottle.state, current.bottle.size);
                const profile = identityKey ? (getCachedBottleVolumeProfile(identityKey) ?? nativeVolumeProfiles.current[identityKey]) : undefined;
                const calibrated = estimateCalibratedBottleVolume(consensus.normalizedHeight, profile);
                current.liquidLevel = {
                  heightPercent: Math.round(consensus.normalizedHeight * 100),
                  confidence: consensus.confidence,
                  method: 'temporal_consensus',
                  ...(calibrated.status === 'calibrated' ? { calibratedVolume: {
                    milliliters: calibrated.milliliters, fluidOunces: calibrated.fluidOunces, profileId: calibrated.profileId,
                  } } : {}),
                };
                changed = true;
              }
            }
            for (const [trackId, history] of nativeLiquidHistory.current) {
              if (frame.timestamp - history.updatedAt > 7) nativeLiquidHistory.current.delete(trackId);
            }
            onLiquidMetrics?.({ nativeEvent: {
              jobsDispatched: 1, jobsCompleted: analyses.length > 0 ? 1 : 0, framesSkipped: 0,
              workerErrors: 0, lastWorkerMs: nativeProcessingMs, maxWorkerMs: nativeProcessingMs,
              segmentationMs: 0, workerAvailable: true,
            } });
            if (changed) props.onVisualCandidates?.({ nativeEvent: { count: candidates.length, depthFrame: frame.depthEstimate, candidates } });
          }).catch(() => {
            onLiquidMetrics?.({ nativeEvent: {
              jobsDispatched: 1, jobsCompleted: 0, framesSkipped: 0, workerErrors: 1,
              lastWorkerMs: 0, maxWorkerMs: 0, segmentationMs: 0, workerAvailable: true,
            } });
          }).finally(() => { nativeLiquidBusy.current = false; });
        } else {
          onLiquidMetrics?.({ nativeEvent: {
            jobsDispatched: 0, jobsCompleted: 0, framesSkipped: tracked.length ? 1 : 0,
            workerErrors: 0, lastWorkerMs: 0, maxWorkerMs: 0, segmentationMs: 0,
            workerAvailable: !!NativeLiquidAnalyzer,
          } });
        }
      }).catch(error => {
        if (generation === nativeSessionGeneration.current) {
          props.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? error.message : 'native_frame_read_failed' } });
        }
      }).finally(() => {
        if (generation === nativeSessionGeneration.current) nativeFrameReadBusy.current = false;
      });
    }}
  />;
}
