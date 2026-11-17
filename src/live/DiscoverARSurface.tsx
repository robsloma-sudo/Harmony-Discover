import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, View, type ViewProps } from 'react-native';
import { CameraView } from 'expo-camera';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { frameSharpness, SteadyGate } from './steadyCapture';
import { isReadableLabel, SAMPLE_GAP_MS, samplesForLabel, zoomReadiness } from './distanceCapture';
import { readLiveFrame, readLiveLabelBatch, saveLiveSightings, type BottleRead, type LabelBatchRead, type LiveSightingInput, type ResolvedIdentity } from '../services/discoverLiveApi';
import { BrowserDepthEstimator, type RelativeDepthMap } from './BrowserDepthEstimator';
import { frameGateRetryDelay, sampleLumaGrid, shouldReadChangedFrame } from './frameChangeGate';
import { SegmentationRunner } from './segmentationEngine';
import { extractMaskContour } from './maskContour';
import { LocalBottleTracker, isSameBottle, type LocalBottleCandidate } from './localBottleTracker';
import { calculateLabelCrop } from './labelCrop';
import { selectLabelBatchCandidates, selectSecondLookCrops } from './labelBatch';
import { LabelTextReader, OCR_MAX_EDGE, PHONE_READ_GAP_MS, cylinderForCrop, textReaderEnabled, type Cylinder } from './labelTextReader';
import { biggestWords, brandWords, chooseGuess, fragmentWords, probableBrand, probableFromFragments, sameBrand } from './letterGuess';
import { looksLikeNoDrink } from './labelBatch';
import { fragmentLookup, letterLookup, logScanTimings, type ScanTimingRow } from '../services/discoverLetterApi';
import { associateBottleReadTracks, type BottleReadTrack } from './bottleReadIdentity';
import { loadDfineSegOnnxProvider } from './dfineSegRuntime';
import { hasBottleIdentityConflict, isConfirmedWebBottleTrack, mergeBottleRead } from './webTrackPolicy';
import { compensateDetections, projectLabelBox, type TrackPosition } from './trackMotionCompensation';
import { rgbaToGrayscale } from './browserOpticalFlow';
import {
  CameraMotionHistory, IDENTITY_MOTION, applyMotionToBox, applyMotionToPoint, buildGrayPyramid, clipBoxToFrame,
  estimateCameraMotion, invertMotion as invertCameraMotion, refineBoxMotion, visibleFraction, type CameraMotion, type GrayPyramid,
} from './cameraMotion';
import { computeAppearanceSignature } from './appearanceSignature';
import { checkPreviousScannerExit, markScannerRunning, markScannerStopped } from './scannerHealth';
import { TrackEvidence, identityKey } from './trackEvidence';
import { getObjectFitCoverCrop } from './cameraCoverCrop';
import { decodeEanFromCanvas } from './browserBarcodeDecoder';
import { assessLiquidInterface, type LiquidLineObservation } from '../services/liquidInterface';
import { LiquidAnalysisQueue } from '../services/liquidAnalysisQueue';
import { LiquidTrackGuard } from './liquidTrackGuard';
import { estimateCalibratedBottleVolume } from '../services/bottleVolumeCalibration';
import { getBottleCalibrationKey, getCachedBottleVolumeProfile, loadBottleVolumeProfiles } from '../services/bottleVolumeProfileStore';
import type { BottleVolumeProfile } from '../services/bottleVolumeCalibration';

/** Smallest label crop (longest side, in camera pixels) worth sending to the label reader. */
export { MIN_READABLE_LABEL_PX } from './distanceCapture';
/** How long a newly saved bottle shows RESEARCHING (web research typically finishes in 20-40 s). */
const RESEARCH_SHOWN_MS = 40_000;
/** Whole-bottle crops narrower than this (width / height) are slivers with no readable label. */
export const MIN_BODY_CROP_ASPECT = 0.16;

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
  onVisualCandidates?: (event: { nativeEvent: { count: number; source?: 'cloud' | 'local'; depthFrame?: ARKitDepthFrame; candidates: Array<{ trackId: number; x: number; y: number; width: number; height: number; confidence: number; timestamp?: number; source?: 'cloud' | 'local'; contour?: Array<{ x: number; y: number }>; bottle?: BottleRead; liquidLevel?: { heightPercent: number; confidence: number; method: 'temporal_consensus'; calibratedVolume?: { milliliters: number; fluidOunces: number; profileId: string } } }> } }) => void;
  onDepthEstimate?: (event: { nativeEvent: RelativeDepthMap | ARKitDepthFrame }) => void;
  onCameraPose?: (event: { nativeEvent: ARKitCameraPose }) => void;
  onDepthStatus?: (event: { nativeEvent: { status: string } }) => void;
  onLiquidMetrics?: (event: { nativeEvent: { jobsDispatched: number; jobsCompleted: number; framesSkipped: number; workerErrors: number; lastWorkerMs: number; maxWorkerMs: number; segmentationMs: number; localFrameMs: number; workerAvailable: boolean } }) => void;
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
/** The part of the camera picture on screen: object-fit cover, then narrowed around the centre by a picture zoom. */
function zoomedCoverCrop(video: HTMLVideoElement, digitalZoom: number) {
  const crop = getObjectFitCoverCrop(video.videoWidth, video.videoHeight, video.clientWidth || video.videoWidth, video.clientHeight || video.videoHeight);
  if (!crop || digitalZoom <= 1.001) return crop;
  const width = crop.width / digitalZoom, height = crop.height / digitalZoom;
  return { x: crop.x + (crop.width - width) / 2, y: crop.y + (crop.height - height) / 2, width, height };
}

/** How sharp a label crop is (same measure as the steady-capture gate), on a small grey copy. */
let sharpnessCanvas: HTMLCanvasElement | null = null;
function cropSharpness(source: HTMLCanvasElement): number {
  const width = Math.min(192, source.width), height = Math.max(2, Math.round(source.height * width / Math.max(1, source.width)));
  const canvas = sharpnessCanvas ??= document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!context || width < 3 || height < 3) return 0;
  context.drawImage(source, 0, 0, width, height);
  return frameSharpness(rgbaToGrayscale(context.getImageData(0, 0, width, height).data, width, height), width, height);
}

function WebLiveCamera(props: NativeProps) {
  const { active, recognitionEnabled, style, onTrackingUpdate, onRecognitionUpdate, onARError, captureRequestId } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recognitionSchedulerRef = useRef<(() => void) | null>(null);
  // Pinch to zoom (Rob, 15 Nov 2026): the camera's own zoom when the browser offers it, else the picture is
  // enlarged on screen and every part of the scanner (boxes, reads) uses the same enlarged view.
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const nativeZoomRef = useRef<{ min: number; max: number } | null>(null);
  const zoomRef = useRef(1);              // the zoom the user chose (1 = none)
  const digitalZoomRef = useRef(1);       // the part of it done by enlarging the picture
  const [digitalZoom, setDigitalZoom] = useState(1);
  const [zoomLabel, setZoomLabel] = useState<string | null>(null);
  const containerRef = useRef<any>(null);
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
      callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: 0, candidates: [] } });
      callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'paused', reason: 'camera_paused' } });
      return;
    }

    let disposed = false;
    // Invalidates async recognition work when the user pauses recognition or the page hides.
    let recognitionGeneration = 0;
    let recognitionEpochStartedAt = 0;
    let stream: MediaStream | null = null;
    let frameCheck = 0;
    let recognitionTimer = 0;
    let localDetectionTimer = 0;
    let opticalFlowFrame = 0;
    let opticalFlowCanvas: HTMLCanvasElement | null = null;
    let opticalFlowContext: CanvasRenderingContext2D | null = null;
    let previousPyramid: GrayPyramid | null = null;
    let sparePyramid: GrayPyramid | null = null;
    // If the last scanner session crashed the page (out of memory), step down:
    // no GPU, then a lighter detection rate.
    const scannerMode = checkPreviousScannerExit();
    const visibleCrop = (video: HTMLVideoElement) => zoomedCoverCrop(video, digitalZoomRef.current);
    const flowIntervalMs = scannerMode.lite ? 50 : 30;
    let previousOpticalSize = '';
    let lastOpticalFlowAt = 0;
    let lastPublishAt = 0;
    let lastPublishedSignature = '';
    // Whole-frame camera motion: moves every bottle (on and off screen) and
    // brings late detector/cloud results into the current view.
    const cameraMotionHistory = new CameraMotionHistory(8_000);
    let lastCameraMotion: CameraMotion = IDENTITY_MOTION;
    // Labels are captured at a steady, sharp moment (moving phones gave blurry, unreadable crops).
    const steadyGate = new SteadyGate();
    let labelWaitingForSteady = false;
    let labelWaitStartedAt = 0;
    const MAX_STEADY_WAIT_MS = 700;
    let lostMotionFrames = 0;
    let localDetectionBusy = false;
    let detectorFailures = 0;
    // Evidence per bottle (cloud ids > 0, local ids < 0): detector passes and
    // label reads add up instead of replacing each other. A name is shown only
    // once reads agree; it stays with the bottle while it is off screen.
    const evidence = new TrackEvidence<BottleRead>();
    const lastHitsByLocalTrack = new Map<number, number>();
    // Automatic saving: once a bottle's name is reliable, it is saved once per
    // scan session as a sighting (Live Recognition consent covers this). The
    // server links it to a product and queues background web research.
    const newScanSessionId = () => {
      const cryptoApi = globalThis.crypto as Crypto & { randomUUID?: () => string };
      if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    let scanSessionId = newScanSessionId();
    const saveState = new Map<string, 'queued' | 'saving' | 'saved'>();
    // Box stages (shown on the green boxes): when a bottle's label went to be read, and when its web research started.
    const readingSince = new Map<number, number>();
    // Labels too small to read yet (0-1 = how close to readable): their boxes say ZOOM IN.
    const tooSmall = new Map<number, number>();
    const researchSince = new Map<string, number>();
    // Server-resolved identity per read key (brand + line + release + size); feeds liquid-level calibration.
    const resolvedByKey = new Map<string, ResolvedIdentity>();
    let saveQueue: Array<{ key: string; input: LiveSightingInput }> = [];
    let saveBusy = false;
    let saveRetryAt = 0;
    const resetAutoSave = () => {
      scanSessionId = newScanSessionId();
      saveState.clear();
      saveQueue = [];
      saveRetryAt = 0;
    };
    const queueAutoSave = (read: BottleRead, identityConfidence: number, agreeingReads: number) => {
      const key = identityKey(read);
      if (!key || saveState.has(key) || !read.brand) return;
      // Agreement between independent reads is the evidence: carry it into the
      // brand/product confidence the server uses for matching and research.
      const fieldConfidence: Record<string, number> = { ...(read.fieldConfidence ?? {}) };
      fieldConfidence.brand = Math.max(fieldConfidence.brand ?? 0, identityConfidence);
      if (read.product) fieldConfidence.product = Math.max(fieldConfidence.product ?? 0, identityConfidence);
      saveState.set(key, 'queued');
      saveQueue.push({ key, input: {
        brand: read.match?.brand || read.brand, product: read.match?.product || read.product || '',
        category: read.category || 'other', proof: read.proof || '', size: read.size || '', origin: read.origin || '',
        words: read.words ?? [], confidence: Math.max(read.confidence ?? 0, identityConfidence), agreeingReads,
        details: read.details ?? {}, fieldConfidence,
      } });
    };
    const flushAutoSave = async () => {
      if (disposed || saveBusy || !saveQueue.length || Date.now() < saveRetryAt || !callbacksRef.current.recognitionEnabled) return;
      const batch = saveQueue.slice(0, 8);
      const session = scanSessionId;
      saveBusy = true;
      batch.forEach(item => saveState.set(item.key, 'saving'));
      try {
        const results = await saveLiveSightings(session, batch.map(item => item.input));
        if (session !== scanSessionId) return;
        saveQueue = saveQueue.filter(item => !batch.includes(item));
        batch.forEach((item, index) => {
          const status = results[index]?.status;
          const resolved = results[index]?.identity;
          if (resolved) resolvedByKey.set(item.key, resolved);
          if (status === 'saved' || status === 'already_saved') {
            saveState.set(item.key, 'saved');
            // A new bottle is researched on the web right after it is saved (known bottles already were).
            if (results[index]?.researching && results[index]?.newProduct && !researchSince.has(item.key)) researchSince.set(item.key, Date.now());
          } else saveState.delete(item.key); // not saved: may be queued again later
        });
        publishVisibleCandidates();
      } catch (error) {
        if (session !== scanSessionId) return;
        batch.forEach(item => saveState.set(item.key, 'queued'));
        const status = (error as { status?: number }).status ?? 0;
        saveRetryAt = Date.now() + (status === 429 ? 60_000 : 10_000);
      } finally {
        saveBusy = false;
      }
    };
    const autoSaveTimer = window.setInterval(() => { void flushAutoSave(); }, 2_500);
    // Instant "Probably …" (17 Nov 2026): the phone reads the biggest words on a label crop and the letter
    // catalogue turns them into a guess, shown until the cloud read names the bottle. A guess is never saved
    // and never counts as evidence. Skipped after an out-of-memory crash, or with ?ocr=off.
    const textReader = !scannerMode.lite && textReaderEnabled() ? new LabelTextReader() : null;
    const probableByTrack = new Map<number, { brand: string; at: number }>();
    let lastPhoneReadAt = 0;
    // Boxes the label reader said are not drinks at all (a book, sign, phone...): hidden and not read again.
    const notDrinkTracks = new Set<number>();
    const noLabelVotes = new Map<number, number>();
    // How fast each bottle was named (no photos): one row per bottle per scan session.
    type TimingDraft = { startedAt: number; labelPx: number; ocrMs?: number; textAt?: number; guessAt?: number; guess?: string; words?: string[] };
    const timingByTrack = new Map<number, TimingDraft>();
    const loggedTimingTracks = new Set<number>();
    let timingQueue: ScanTimingRow[] = [];
    const deviceName = (() => { try { return (navigator.userAgent.match(/\(([^;)]+)/)?.[1] ?? 'web').slice(0, 60); } catch { return 'web'; } })();
    const finishTiming = (trackId: number, read: { brand?: string; product?: string } | null) => {
      const draft = timingByTrack.get(trackId);
      if (!draft || loggedTimingTracks.has(trackId)) return;
      timingByTrack.delete(trackId);
      loggedTimingTracks.add(trackId);
      const confirmedBrand = read?.brand || '';
      const guessFirst = !!draft.guessAt && (!confirmedBrand || !!draft.guess && sameBrand(draft.guess, confirmedBrand));
      timingQueue.push({
        scan_session_id: scanSessionId, track_id: String(trackId),
        named_by: guessFirst ? 'letters' : confirmedBrand ? 'ai_label' : 'none',
        ms_to_text: draft.textAt ? draft.textAt - draft.startedAt : null,
        ms_to_name: draft.guessAt ? draft.guessAt - draft.startedAt : null,
        ms_to_confirm: confirmedBrand ? Date.now() - draft.startedAt : null,
        brand: confirmedBrand || null, product: read?.product || null,
        label_px: draft.labelPx, zoom: zoomRef.current, device: deviceName, app_version: 'ocr2-' + (textReader?.backend ?? 'none'),
        guess_brand: draft.guess ?? null, guess_agreed: draft.guess && confirmedBrand ? sameBrand(draft.guess, confirmedBrand) : null,
        ocr_ms: draft.ocrMs ?? null, ocr_words: draft.words ?? [],
      });
    };
    const flushTimings = () => {
      // Bottles never named within 20 s are recorded as unnamed.
      const now = Date.now();
      for (const [trackId, draft] of timingByTrack) if (now - draft.startedAt > 20_000) finishTiming(trackId, null);
      if (!timingQueue.length || !callbacksRef.current.recognitionEnabled) return;
      const batch = timingQueue.slice(0, 50);
      timingQueue = timingQueue.slice(50);
      void logScanTimings(batch).catch(() => { /* timing records are best effort */ });
    };
    const timingTimer = window.setInterval(flushTimings, 15_000);
    const guessFromWords = async (rawWords: string[], cutAtEdge: boolean): Promise<string | null> => {
      const words = brandWords(rawWords).slice(0, 4);
      const pieces = fragmentWords(rawWords);
      // Whole words and part-words are looked up together (round bottles hide the letters at their edges).
      const [letters, fragments] = await Promise.all([
        words.length ? letterLookup(words, 5) : Promise.resolve([]),
        pieces.length ? fragmentLookup(pieces, 5) : Promise.resolve([]),
      ]);
      const wholeBrand = probableBrand(letters, words);
      const partBrand = probableFromFragments(fragments);
      const labelsOf = (brand: string | null, rows: Array<{ brand: string; labels: number }>) =>
        brand ? { brand, labels: rows.find(row => row.brand === brand)?.labels ?? 0 } : null;
      return chooseGuess(labelsOf(wholeBrand, letters), labelsOf(partBrand, fragments), cutAtEdge);
    };
    const readTextForGuess = (trackId: number, image: ImageData, cylinder: Cylinder | null, generation: number) => {
      if (!textReader) return;
      void textReader.read(image, cylinder).then(async read => {
        if (!read || disposed || generation !== recognitionGeneration) return;
        const draft = timingByTrack.get(trackId);
        if (draft) { draft.ocrMs = Math.round(read.totalMs); draft.textAt = Date.now(); draft.words = read.words.map(word => word.text).slice(0, 6); }
        const words = biggestWords(read.words, 4);
        if (!words.length) return;
        const biggest = read.words.slice().sort((a, b) => b.height - a.height).slice(0, 2);
        const brand = await guessFromWords(words, biggest.some(word => !!word.edge));
        if (!brand || disposed || generation !== recognitionGeneration) return;
        // The cloud read got there first, or the name is already confirmed: nothing to hint.
        if (labelReadsByTrack.get(trackId)?.brand || evidence.identity(trackId)) return;
        probableByTrack.set(trackId, { brand, at: Date.now() });
        const timing = timingByTrack.get(trackId);
        if (timing && !timing.guessAt) { timing.guessAt = Date.now(); timing.guess = brand; }
        publishVisibleCandidates();
      }).catch(() => { /* the cloud read carries on */ });
    };
    const labelReadToBottle = (read: LabelBatchRead): BottleRead => ({
      box: { x0: 0, y0: 0, x1: 0, y1: 0 }, label_box: null, edgePaths: [], words: read.words,
      brand: read.brand, product: read.product, category: read.category,
      proof: read.proof, size: read.size, origin: read.origin,
      confidence: read.confidence, detectionConfidence: read.confidence,
      fieldConfidence: read.fieldConfidence, researchSources: [], details: read.details,
      match: read.match, state: read.state,
    });
    // Bottles re-found from memory get one fresh label check before their
    // remembered name is trusted as verified again.
    const reverifyTracks = new Set<number>();
    let depthTimer = 0;
    let depthEstimator: BrowserDepthEstimator | null = null;
    let recognitionBusy = false;
    let labelBatchBusy = false;
    let lastSentFrameSignature: Uint8Array | null = null;
    let lastLiveReadAt = 0;
    let lastLiveBottleCount = 0;
    const unchangedFrameHeartbeatMs = 7_500;
    const emptyFrameRetryMs = 5_000;
    let nextLabelBatchAt = Date.now() + 2200;
    const labelReadsByTrack = new Map<number, LabelBatchRead>();
    const lastLabelReadAt = new Map<number, number>();
    // Second looks (stronger reader) run on their own, so easy bottles never wait for hard ones.
    const lastSecondLookAt = new Map<number, number>();
    let secondLookBusy = false;
    let segmentationRunner: SegmentationRunner | null = null;
    let segmentationLoading: Promise<void> | null = null;
    let segmentationLoadFailed = false;
    const localBottleTracker = new LocalBottleTracker();
    let pageVisible = document.visibilityState === 'visible';
    const handleVisibilityChange = () => {
      pageVisible = document.visibilityState === 'visible';
      if (!pageVisible) {
        recognitionGeneration += 1;
        recognitionEpochStartedAt = Date.now();
        if (recognitionTimer) window.clearTimeout(recognitionTimer);
        if (localDetectionTimer) window.clearTimeout(localDetectionTimer);
        recognitionTimer = 0;
        localDetectionTimer = 0;
        localBottleTracker.reset();
        liquidHistoryByTrack.clear();
        liquidGuard.clear();
        latestLocalCandidates = [];
        webTracks = [];
        labelReadsByTrack.clear();
        lastLabelReadAt.clear();
        evidence.clear();
        lastHitsByLocalTrack.clear();
        probableByTrack.clear();
        timingByTrack.clear();
        loggedTimingTracks.clear();
        notDrinkTracks.clear();
        noLabelVotes.clear();
        resetAutoSave();
        reverifyTracks.clear();
        nextWebTrackId = 1;
        lastSentFrameSignature = null;
        lastLiveReadAt = 0;
        lastLiveBottleCount = 0;
        resetCameraMotion();
        lastPublishedSignature = '';
        markScannerStopped();
        callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: 0, candidates: [] } });
        callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'paused', reason: 'page_hidden' } });
      } else {
        if (detectorProvider) markScannerRunning(detectorProvider.backend ?? 'main-thread');
        if (!callbacksRef.current.recognitionEnabled) return;
        scheduleRecognition(250);
        startLocalDetectionLoop();
        startOpticalFlow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const handlePageHide = () => markScannerStopped();
    window.addEventListener('pagehide', handlePageHide);
    function resetCameraMotion() {
      cameraMotionHistory.reset();
      previousPyramid = null;
      sparePyramid = null;
      previousOpticalSize = '';
      lastCameraMotion = IDENTITY_MOTION;
      lostMotionFrames = 0;
    }
    // Diagnostics only (backend may move from WASM to WebGPU after a check).
    let detectorProvider: { backend?: string; gpuTrialResult?: string } | null = null;
    const ensureSegmentationRunner = () => {
      if (segmentationRunner || segmentationLoading || segmentationLoadFailed || disposed) return segmentationLoading;
      const gpuPossible = scannerMode.allowGpu && typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;
      // Recorded before loading: a crash while the GPU is being tried counts against the GPU.
      markScannerRunning(gpuPossible ? 'webgpu' : 'wasm');
      segmentationLoading = loadDfineSegOnnxProvider({ minimumScore: 0.5, nmsIoUThreshold: 0.45 }, { allowGpu: scannerMode.allowGpu }).then(provider => {
        if (disposed) { void provider.dispose?.(); return; }
        detectorProvider = provider as { backend?: string; gpuTrialResult?: string };
        const backend = detectorProvider.backend ?? 'main-thread';
        if (pageVisible) markScannerRunning(backend);
        // The text reader loads after the bottle detector, so the first boxes are never slowed down.
        textReader?.warmUp();
        segmentationRunner = new SegmentationRunner(provider, {
          // Run as often as the device allows: the worker keeps the camera view
          // smooth, and camera motion moves late results to the current view,
          // so slow phones are no longer forced to throw results away. The GPU
          // is paced (heat, memory); after a crash, a lighter rate is used.
          minimumIntervalMs: scannerMode.lite ? 700 : backend === 'webgpu' ? 150 : 100,
          maximumFrameAgeMs: 4_000,
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
    const decodeBarcodeFrame = (sourceCanvas: HTMLCanvasElement, frameTimestamp: number) => {
      const generation = recognitionGeneration;
      const barcodeCanvas = document.createElement('canvas');
      barcodeCanvas.width = sourceCanvas.width;
      barcodeCanvas.height = sourceCanvas.height;
      barcodeCanvas.getContext('2d')?.drawImage(sourceCanvas, 0, 0);
      void (async () => {
        let decodedBarcodes: Array<{ rawValue: string; format: string }> = [];
        if (barcodeDetector) {
          try { decodedBarcodes = await barcodeDetector.detect(barcodeCanvas); } catch { decodedBarcodes = []; }
        }
        return decodedBarcodes.length ? decodedBarcodes : decodeEanFromCanvas(barcodeCanvas);
      })().then(decodedBarcodes => {
        if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled || generation !== recognitionGeneration || !decodedBarcodes.length) return;
        callbacksRef.current.onRecognitionUpdate?.({ nativeEvent: {
          text: [],
          barcodes: decodedBarcodes.map(code => ({ value: code.rawValue, symbology: code.format })),
          barcodeStatus: 'available',
          classifications: [],
          frameTimestamp,
          imageWidth: barcodeCanvas.width,
          imageHeight: barcodeCanvas.height,
        } });
      }).catch(() => {
        // Barcode support is best-effort; decoder failures are non-fatal.
      }).finally(() => releaseCanvas(barcodeCanvas));
    };
    let lastRecognitionStartedAt = 0;
    // Full-frame reads and label batches share the DEV endpoint's 30-request/minute quota.
    // Each path is paced at 3.4s (whole-frame reads are short since live-read 0.5.4) and recognitionBusy serializes them under the shared ceiling.
    const recognitionIntervalMs = 3400;
    // Temporal object tracker for the web camera path. Cloud detections arrive
    // intermittently; stable IDs and smoothed boxes keep an object visually
    // attached between recognition passes instead of resetting by array index.
    type WebTrack = { id: number; x: number; y: number; width: number; height: number; confidence: number; lastSeenAt: number; timestamp: number; misses: number; hits: number; contour?: Array<{ x: number; y: number }>; bottle: BottleRead };
    let webTracks: WebTrack[] = [];
    let latestLocalCandidates: Array<{ trackId: number; x: number; y: number; width: number; height: number; confidence: number; timestamp: number; source: 'local'; contour?: Array<{ x: number; y: number }>; liquidLevel?: { heightPercent: number; confidence: number; method: 'temporal_consensus'; calibratedVolume?: { milliliters: number; fluidOunces: number; profileId: string } } }> = [];
    // Positions of every device-followed track (cloud ids > 0, local ids < 0),
    // used to move late cloud results into the current view.
    const trackPositionsNow = (): TrackPosition[] => [
      ...webTracks.filter(track => track.misses === 0).map(track => ({ trackId: track.id, box: { x: track.x, y: track.y, width: track.width, height: track.height } })),
      ...latestLocalCandidates.map(candidate => ({ trackId: candidate.trackId, box: { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height } })),
    ];
    // Capture the pixels the user currently sees (object-fit: cover crop).
    // iPhone Safari frees canvas memory late: a fresh full-resolution canvas
    // (plus up to 8 crop canvases) every 1.5 s with many bottles in view used
    // up the page's memory and Safari killed the tab. These two are reused.
    let labelSourceCanvas: HTMLCanvasElement | null = null;
    let labelCropCanvas: HTMLCanvasElement | null = null;
    let frameReadCanvas: HTMLCanvasElement | null = null;
    const releaseCanvas = (canvas: HTMLCanvasElement | null) => { if (canvas) { canvas.width = 0; canvas.height = 0; } };
    const captureVisibleFrame = (maxLongEdge: number): HTMLCanvasElement | null => {
      const video = videoRef.current;
      if (!video || video.videoWidth < 2 || video.videoHeight < 2) return null;
      const crop = visibleCrop(video);
      if (!crop) return null;
      const scale = Math.min(1, maxLongEdge / Math.max(crop.width, crop.height));
      const canvas = labelSourceCanvas ??= document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(crop.width * scale));
      canvas.height = Math.max(1, Math.round(crop.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      return canvas;
    };
    // Liquid evidence is kept per local bottle track and never blocks cloud label recognition.
    const liquidHistoryByTrack = new Map<number, { observations: LiquidLineObservation[]; updatedAt: number; calibrationKey: string | null }>();
    // Late worker results only count if the track has not been re-found, merged or renamed since the frame was sent.
    const liquidGuard = new LiquidTrackGuard();
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
    // One physical bottle: overlapping boxes, or a neck/cork/label box that is
    // part of a whole-bottle box (shared rule with the local tracker).
    const isSameBottleBox = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      isSameBottle(a, b);
    // Cross-model boxes can have different extents (cloud label/body box vs
    // local bottle silhouette). Associate by center as well as IoU so one
    // physical bottle is not painted twice merely because box sizes differ.
    const isCrossSourceSameBottle = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => {
      if (isSameBottleBox(a, b)) return true;
      const centerDistance = Math.hypot(
        (a.x + a.width / 2) - (b.x + b.width / 2),
        (a.y + a.height / 2) - (b.y + b.height / 2),
      );
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      const areaRatio = areaA > 0 && areaB > 0 ? Math.max(areaA, areaB) / Math.min(areaA, areaB) : Infinity;
      return centerDistance <= 0.055 && areaRatio <= 4.5;
    };

    const updateWebTracks = (detections: Array<{ x: number; y: number; width: number; height: number; confidence: number; bottle: BottleRead }>, frameTimestamp: number) => {
      const now = Date.now();
      const used = new Set<number>();
      const next: WebTrack[] = [];
      // Collapse duplicate cloud proposals within this recognition frame before
      // assigning IDs. Otherwise the first proposal consumes the old track and
      // the second proposal for the same bottle is forced to create a new ID.
      const rankedDetections = detections.slice().sort((a, b) => b.confidence - a.confidence);
      const uniqueDetections = rankedDetections.filter((candidate, index) =>
        !rankedDetections.slice(0, index).some(kept => isSameBottleBox(kept, candidate)),
      );
      const output = uniqueDetections.map(detection => {
        let bestIndex = -1, bestScore = 0;
        webTracks.forEach((track, index) => {
          if (used.has(index)) return;
          const overlap = intersectionOverUnion(track, detection);
          const dx = (track.x + track.width / 2) - (detection.x + detection.width / 2);
          const dy = (track.y + track.height / 2) - (detection.y + detection.height / 2);
          const distance = Math.hypot(dx, dy);
          const score = overlap >= 0.08 ? overlap : (distance <= 0.20 ? 0.08 * (1 - distance / 0.20) : 0);
          if (score > bestScore) { bestScore = score; bestIndex = index; }
        });
        // Spatial continuity, not a repeated product name, determines physical
        // track identity. Two bottles can share a SKU; never resurrect a stale
        // track solely because its old OCR result matches this detection.
        const previous = bestIndex >= 0 ? webTracks[bestIndex] : null;
        if (previous && hasBottleIdentityConflict(previous.bottle, detection.bottle)) {
          // A changed product identity invalidates all OCR/catalogue enrichment
          // cached under this physical track. The new observation is authoritative.
          labelReadsByTrack.delete(previous.id);
          lastLabelReadAt.delete(previous.id);
        }
        if (bestIndex >= 0) used.add(bestIndex);
        // Weight the newest observation more heavily so boxes catch up during camera movement.
        const blend = previous ? 0.58 : 1;
        const trackBounds = { x: previous ? previous.x * (1 - blend) + detection.x * blend : detection.x, y: previous ? previous.y * (1 - blend) + detection.y * blend : detection.y, width: previous ? previous.width * (1 - blend) + detection.width * blend : detection.width, height: previous ? previous.height * (1 - blend) + detection.height * blend : detection.height };
        const track: WebTrack = {
          id: previous?.id ?? nextWebTrackId++,
          x: trackBounds.x,
          y: trackBounds.y,
          width: trackBounds.width,
          height: trackBounds.height,
          confidence: detection.confidence,
          timestamp: frameTimestamp,
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
        evidence.observeDetection(track.id, detection.confidence);
        if (hasIdentity(detection.bottle)) evidence.observeIdentity(track.id, detection.bottle, 'frame:' + frameTimestamp + ':' + track.id);
        return { trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, contour: track.contour };
      });
      webTracks.forEach((track, index) => {
        if (!used.has(index) && now - track.lastSeenAt < 30000) next.push({ ...track, misses: track.misses + 1 });
      });
      webTracks = next;
      // Do not expose one-frame guesses as visible bottle tracks. A track must
      // be seen twice and may survive only one missed recognition interval.
      return next.filter(isConfirmedWebBottleTrack)
        .map(track => ({ trackId: track.id, x: track.x, y: track.y, width: track.width, height: track.height, confidence: track.confidence, timestamp: track.timestamp, source: 'cloud' as const, contour: track.contour, bottle: track.bottle }));
    };

    // Local D-FINE detection has its own cadence. It must not wait for slower
    // cloud recognition before updating spatial boxes.

    const hasIdentity = (bottle?: BottleRead | null) => !!bottle && !!(bottle.match?.brand || bottle.brand || bottle.match?.product || bottle.product);
    const toLocalCandidates = (tracks: LocalBottleCandidate[], timestamp: number) => {
      const previous = new Map(latestLocalCandidates.map(candidate => [candidate.trackId, candidate]));
      return tracks.map(local => {
        const trackId = -Math.abs(local.trackId);
        return {
          trackId,
          x: local.bounds.x, y: local.bounds.y,
          width: local.bounds.width, height: local.bounds.height,
          confidence: local.confidence, timestamp, source: 'local' as const, contour: local.contour,
          liquidLevel: previous.get(trackId)?.liquidLevel,
        };
      });
    };
    // Carry names and reads across tracker merges (a neck track folded into its bottle).
    const migrateLocalTrackIds = (merged: Array<{ from: number; to: number }>) => {
      for (const { from, to } of merged) {
        const source = -Math.abs(from), target = -Math.abs(to);
        const read = labelReadsByTrack.get(source);
        if (read && !labelReadsByTrack.has(target)) labelReadsByTrack.set(target, { ...read, trackId: target });
        evidence.migrate(source, target);
        const readAt = lastLabelReadAt.get(source);
        if (readAt !== undefined && !lastLabelReadAt.has(target)) lastLabelReadAt.set(target, readAt);
        labelReadsByTrack.delete(source);
        lastLabelReadAt.delete(source);
        liquidHistoryByTrack.delete(source);
        liquidHistoryByTrack.delete(target);
        liquidGuard.bump(source);
        liquidGuard.bump(target);
        if (reverifyTracks.delete(source)) reverifyTracks.add(target);
        if (notDrinkTracks.delete(source)) notDrinkTracks.add(target);
      }
    };

    const publishVisibleCandidates = () => {
      lastPublishAt = performance.now();
      // Local geometry (detector + camera motion) is preferred; a confirmed
      // cloud box is shown only where no local box covers the same bottle.
      const now = Date.now();
      const freshLocalCandidates = latestLocalCandidates.filter(local => now - local.timestamp <= 2_500);
      // Shown values only build up: the box's certainty is the evidence from
      // every detector pass, and a name appears only once reads agree on it.
      const withEvidence = <C extends { trackId: number; confidence: number }>(candidate: C) => {
        const identity = evidence.identity(candidate.trackId);
        const confidence = evidence.detection(candidate.trackId) || candidate.confidence;
        if (identity?.reliable) {
          queueAutoSave(identity.read, identity.confidence, identity.agreeingReads);
          const key = identityKey(identity.read);
          const resolved = key ? resolvedByKey.get(key) : undefined;
          const researchAt = key ? researchSince.get(key) : undefined;
          const stage = researchAt !== undefined && now - researchAt < RESEARCH_SHOWN_MS
            ? { name: 'researching' as const, since: researchAt } : { name: 'found' as const };
          return { ...candidate, confidence, bottle: resolved ? { ...identity.read, resolved } : identity.read, identityConfidence: identity.confidence, saved: !!key && saveState.get(key) === 'saved', stage };
        }
        // Instant reading: show the first read straight away as provisional; it
        // updates as more reads arrive and is confirmed once they agree.
        const readAt = readingSince.get(candidate.trackId);
        const small = tooSmall.get(candidate.trackId);
        const stage = readAt !== undefined ? { name: 'reading' as const, since: readAt }
          : identity ? { name: 'identifying' as const }
          : small !== undefined ? { name: 'zoom' as const, value: small } : { name: 'scanning' as const };
        // "Probably …" only until the cloud has read something for this bottle.
        const probable = identity ? undefined : probableByTrack.get(candidate.trackId)?.brand;
        return { ...candidate, confidence, bottle: undefined, identifying: identity ? identity.confidence : undefined, provisional: identity ? identity.read : undefined, probable, stage };
      };
      const cloudCandidates = webTracks
        // A bottle whose name is already confirmed shows at once; it does not wait for a second whole-picture read.
        .filter(track => isConfirmedWebBottleTrack(track) || (track.misses === 0 && !!evidence.identity(track.id)?.reliable))
        .filter(track => visibleFraction(track) >= 0.5)
        .filter(track => !freshLocalCandidates.some(local => isCrossSourceSameBottle(track, local)))
        .map(track => {
          const box = clipBoxToFrame({ x: track.x, y: track.y, width: track.width, height: track.height });
          return withEvidence({ trackId: track.id, ...box, confidence: track.confidence, timestamp: track.timestamp, source: 'cloud' as const, contour: track.contour });
        });
      const localCandidates = freshLocalCandidates
        .filter(candidate => !cloudCandidates.some(cloud => isCrossSourceSameBottle(cloud, candidate)))
        .map(candidate => {
          // The cloud track covering this bottle contributes its read once per
          // cloud frame; the local box keeps the identity off screen.
          const matchingCloud = webTracks.find(track =>
            isConfirmedWebBottleTrack(track) && visibleFraction(track) >= 0.5 && isCrossSourceSameBottle(track, candidate)
          );
          if (matchingCloud && hasIdentity(matchingCloud.bottle)) {
            evidence.observeIdentity(candidate.trackId, matchingCloud.bottle, 'cloud:' + matchingCloud.id + ':' + matchingCloud.timestamp);
          }
          return withEvidence(candidate);
        });
      const visibleCandidates = [...cloudCandidates, ...localCandidates].filter(candidate => !notDrinkTracks.has(candidate.trackId));
      // Skip identical updates (nothing moved, nothing renamed): the camera
      // screen re-renders on every update.
      const signature = visibleCandidates.map(candidate => {
        const bottle = (candidate as { bottle?: BottleRead }).bottle;
        const liquid = (candidate as { liquidLevel?: { heightPercent: number } }).liquidLevel;
        const shown = candidate as { identityConfidence?: number; identifying?: number; saved?: boolean; probable?: string; stage?: { name: string; since?: number; value?: number } };
        return [
          shown.probable ?? '',
          shown.saved ? 'S' : '', shown.stage ? shown.stage.name + (shown.stage.since ?? '') + (shown.stage.value !== undefined ? Math.round(shown.stage.value * 100) : '') : '',
          Math.round(candidate.confidence * 100), Math.round((shown.identityConfidence ?? shown.identifying ?? 0) * 100),
          candidate.trackId,
          Math.round(candidate.x * 2000), Math.round(candidate.y * 2000),
          Math.round(candidate.width * 2000), Math.round(candidate.height * 2000),
          bottle ? (bottle.match?.id || bottle.brand + '|' + bottle.product + '|' + bottle.state) : '',
          liquid ? liquid.heightPercent : '',
        ].join(',');
      }).join(';');
      if (signature === lastPublishedSignature) return;
      lastPublishedSignature = signature;
      callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: visibleCandidates.length, candidates: visibleCandidates } });
    };

    // Camera motion between detector passes. Each display frame (up to ~33Hz)
    // a pyramidal Lucas-Kanade tracker measures how the whole view moved
    // (pan + zoom). That one motion moves every bottle, including bottles that
    // are off screen, so boxes stay glued to bottles during fast moves and
    // remembered bottles are back in place when the camera returns.
    const startOpticalFlow = () => {
      if (disposed || !pageVisible || opticalFlowFrame || !callbacksRef.current.recognitionEnabled) return;
      const tick = (time: number) => {
        if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled) {
          opticalFlowFrame = 0;
          previousPyramid = null;
          return;
        }
        const video = videoRef.current;
        if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && time - lastOpticalFlowAt >= flowIntervalMs) {
          const elapsedMs = lastOpticalFlowAt ? time - lastOpticalFlowAt : 33;
          lastOpticalFlowAt = time;
          const crop = visibleCrop(video);
          if (!crop) { previousPyramid = null; opticalFlowFrame = window.requestAnimationFrame(tick); return; }
          const { x: sx, y: sy, width: sw, height: sh } = crop;
          const scale = Math.min(1, 320 / Math.max(sw, sh));
          const width = Math.max(24, Math.round(sw * scale));
          const height = Math.max(24, Math.round(sh * scale));
          if (!opticalFlowCanvas) {
            opticalFlowCanvas = document.createElement('canvas');
            opticalFlowContext = opticalFlowCanvas.getContext('2d', { willReadFrequently: true });
          }
          if (opticalFlowCanvas && opticalFlowContext) {
            if (opticalFlowCanvas.width !== width || opticalFlowCanvas.height !== height) {
              opticalFlowCanvas.width = width;
              opticalFlowCanvas.height = height;
              previousPyramid = null;
              sparePyramid = null;
            }
            opticalFlowContext.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
            // Reuse the pyramid from two frames ago: no per-frame buffer garbage.
            const recycle = sparePyramid;
            const gray = rgbaToGrayscale(opticalFlowContext.getImageData(0, 0, width, height).data, width, height, recycle?.[0]?.data);
            const pyramid = buildGrayPyramid(gray, width, height, 4, recycle);
            const sizeKey = width + 'x' + height;
            const now = Date.now();
            let tickMotion: { tx: number; ty: number; scale: number } | null = null;
            if (previousPyramid && previousOpticalSize === sizeKey && pyramid.length) {
              // Each tracked bottle is its own vote: a bottle picked up and carried
              // is seen as moving by itself instead of dragging every box with it.
              const visibleLocals = localBottleTracker.visible(now);
              const measured = estimateCameraMotion(previousPyramid, pyramid, { guess: lastCameraMotion, objects: visibleLocals.map(local => local.bounds) });
              tickMotion = measured ? { tx: measured.tx, ty: measured.ty, scale: measured.scale } : null;
              let motion: CameraMotion | null = null;
              if (measured) {
                motion = { tx: measured.tx, ty: measured.ty, scale: measured.scale };
                lostMotionFrames = 0;
              } else if (lostMotionFrames < 4 && Math.hypot(lastCameraMotion.tx, lastCameraMotion.ty) > 0.002) {
                // Blur or a featureless wall: coast on the last motion briefly.
                lostMotionFrames += 1;
                motion = { tx: lastCameraMotion.tx * 0.7, ty: lastCameraMotion.ty * 0.7, scale: 1 + (lastCameraMotion.scale - 1) * 0.7 };
              } else {
                lostMotionFrames += 1;
              }
              lastCameraMotion = motion ?? IDENTITY_MOTION;
              if (motion) {
                // Parallax: near bottles move more than the shelf behind them.
                // Measure each visible bottle's own shift before moving it.
                // A bottle that moved on its own follows its own motion (the hand),
                // not the camera's; the rest get the usual parallax refinement.
                const carried = new Map((measured?.movingObjects ?? [])
                  .filter(item => visibleLocals[item.index] && Math.abs(item.dx) <= 0.25 && Math.abs(item.dy) <= 0.25)
                  .map(item => [visibleLocals[item.index]!.trackId, item]));
                const nudges = measured
                  ? visibleLocals.flatMap(local => {
                    const own = carried.get(local.trackId);
                    if (own) return [{ trackId: local.trackId, dx: own.dx, dy: own.dy }];
                    const shift = refineBoxMotion(previousPyramid!, pyramid, local.bounds, motion!);
                    if (!shift || shift.quality < 0.5 || Math.abs(shift.dx) > 0.08 || Math.abs(shift.dy) > 0.08) return [];
                    return [{ trackId: local.trackId, dx: shift.dx, dy: shift.dy }];
                  })
                  : [];
                cameraMotionHistory.record(now, motion, elapsedMs);
                localBottleTracker.applyCameraMotion(motion, now);
                if (nudges.length) localBottleTracker.nudgeTracks(nudges);
                webTracks = webTracks.map(track => {
                  const moved = applyMotionToBox({ x: track.x, y: track.y, width: track.width, height: track.height }, motion!);
                  // Moving with the camera is not a new recognition observation:
                  // timestamps and lastSeenAt stay, so ghosts still expire.
                  return { ...track, ...moved, contour: track.contour?.map(point => applyMotionToPoint(point, motion!)) };
                });
              } else {
                cameraMotionHistory.record(now, IDENTITY_MOTION, elapsedMs);
              }
            }
            sparePyramid = previousPyramid;
            previousPyramid = pyramid.length ? pyramid : null;
            previousOpticalSize = sizeKey;
            const tickAt = performance.now();
            steadyGate.observe(tickAt, frameSharpness(gray, width, height), tickMotion);
            if (labelWaitingForSteady && (steadyGate.steady(tickAt) || tickAt - labelWaitStartedAt >= MAX_STEADY_WAIT_MS)) void readCandidateLabels();
            latestLocalCandidates = toLocalCandidates(localBottleTracker.visible(now), now);
            if (performance.now() - lastPublishAt >= 30) publishVisibleCandidates();
          }
        }
        opticalFlowFrame = window.requestAnimationFrame(tick);
      };
      opticalFlowFrame = window.requestAnimationFrame(tick);
    };

    // Liquid work is isolated in a dedicated worker. If Worker support is
    // missing, the feature abstains instead of consuming camera/UI-thread time.
    let lastSegmentationMs = 0;
    let lastLocalFrameMs = 0;
    const liquidAnalysisQueue = new LiquidAnalysisQueue((timestamp, results) => {
      if (disposed || !pageVisible || timestamp < recognitionEpochStartedAt || Date.now() - timestamp > 1400) return;
      let changed = false;
      for (const item of results) {
        const current = latestLocalCandidates.find(candidate => candidate.trackId === item.trackId);
        if (!current) continue; // Track disappeared while the worker was busy.
        if (!liquidGuard.accepts(timestamp, item.trackId)) continue; // Track changed while the worker was busy.
        if (item.optical.status !== 'observable' || item.optical.score < 0.55) {
          liquidHistoryByTrack.delete(item.trackId);
          continue;
        }
        if (item.result.status !== 'candidate' || item.result.confidence < 0.7 || item.result.boundaryShape === 'irregular') continue;
        const labelRead = labelReadsByTrack.get(item.trackId);
        const readKey = labelRead ? identityKey(labelRead) : null;
        const calibrationKey = getBottleCalibrationKey(labelRead?.match, labelRead?.state ?? 'unsure', labelRead?.size, readKey ? resolvedByKey.get(readKey) : undefined);
        const previous = liquidHistoryByTrack.get(item.trackId);
        // A new or changed identity starts a fresh fill reading: never mix bottles.
        const history = previous && timestamp - previous.updatedAt <= 2200 && previous.calibrationKey === calibrationKey ? previous.observations : [];
        if (previous && previous.calibrationKey !== calibrationKey) current.liquidLevel = undefined;
        const observations = [...history, {
          frameId: String(timestamp),
          normalizedHeight: item.result.normalizedHeight,
          confidence: item.result.confidence,
        }].slice(-5);
        liquidHistoryByTrack.set(item.trackId, { observations, updatedAt: timestamp, calibrationKey });
        const consensus = assessLiquidInterface(observations);
        if (consensus.status === 'visible') {
          const profile = calibrationKey ? (getCachedBottleVolumeProfile(calibrationKey) ?? bottleVolumeProfiles[calibrationKey]) : undefined;
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
    }, undefined, metrics => callbacksRef.current.onLiquidMetrics?.({ nativeEvent: { ...metrics, segmentationMs: lastSegmentationMs, localFrameMs: lastLocalFrameMs } }));

    const readCandidateLabels = async () => {
      // Label reads no longer wait behind the slower whole-frame read: a new bottle gets its first name fast.
      if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled || labelBatchBusy || Date.now() < nextLabelBatchAt) return;
      // Wait (at most 0.7 s) for the phone to be still and the picture sharp.
      const steadyAt = performance.now();
      if (!steadyGate.steady(steadyAt)) {
        if (!labelWaitStartedAt) labelWaitStartedAt = steadyAt;
        if (steadyAt - labelWaitStartedAt < MAX_STEADY_WAIT_MS) { labelWaitingForSteady = true; return; }
      }
      const steadyCapture = steadyGate.steady(steadyAt);
      const sharpRatio = steadyGate.sharpRatio();
      labelWaitingForSteady = false;
      labelWaitStartedAt = 0;
      // Crop from the live video at the camera's full resolution (up to 4K): only the label is cut out,
      // so a distant label keeps every real pixel the camera captured.
      const sourceVideo = videoRef.current;
      if (!sourceVideo || sourceVideo.videoWidth < 2 || sourceVideo.videoHeight < 2) return;
      const frameRegion = visibleCrop(sourceVideo);
      if (!frameRegion) return;
      const frameCanvas = { width: Math.round(frameRegion.width), height: Math.round(frameRegion.height) };
      const generation = recognitionGeneration;
      const now = Date.now();
      const isVerifiedRead = (trackId: number) => {
        const read = labelReadsByTrack.get(trackId);
        // A bottle re-found from memory gets one fresh check before its
        // remembered name counts as verified again.
        // Keep reading a bottle until its name is reliable (reads agree).
        void read;
        return !reverifyTracks.has(trackId) && !!evidence.identity(trackId)?.reliable;
      };
      // Until a bottle's name is reliable, keep re-reading it (every 6 s), even
      // when one earlier read looked complete: agreement needs a second read.
      // Only the label position of earlier reads is passed on.
      const placementOnly = (bottle?: { box?: BottleRead['box']; label_box?: BottleRead['label_box'] } | null) =>
        bottle ? { label_box: bottle.label_box ?? null, box: bottle.box } : undefined;
      // A catalog-verified label read belongs to this tracked object. Do not
      // spend another label-batch request re-reading it on every later frame.
      const activeCloudTracks = webTracks.filter(track => track.misses === 0
        && visibleFraction(track) >= 0.5
        && !isVerifiedRead(track.id));
      const candidates = [
        ...activeCloudTracks.map(track => ({
          trackId: track.id, ...clipBoxToFrame({ x: track.x, y: track.y, width: track.width, height: track.height }), confidence: track.confidence,
          bottle: placementOnly(track.bottle),
        })),
        ...latestLocalCandidates
          .filter(local => !activeCloudTracks.some(cloud => isSameBottleBox(cloud, local)))
          .filter(local => !isVerifiedRead(local.trackId))
          .map(candidate => ({ ...candidate, bottle: undefined })),
      ];
      const eligible = selectLabelBatchCandidates(candidates.filter(candidate => !notDrinkTracks.has(candidate.trackId)), lastLabelReadAt, now, 8, 6_000);
      const crops: Array<{ trackId: number; image: string }> = [];
      const planned: Array<{ trackId: number; crop: NonNullable<ReturnType<typeof calculateLabelCrop>>; samples: number; best: HTMLCanvasElement | null; bestSharp: number; bottle: { x: number; width: number } }> = [];
      for (const candidate of eligible) {
        if (planned.length >= 8) break;
        const capturedBottle = candidate.bottle as { label_box?: { x0: number; y0: number; x1: number; y1: number } | null; box?: { x0: number; y0: number; x1: number; y1: number } } | undefined;
        const projectedLabel = capturedBottle?.label_box && capturedBottle.box
          ? projectLabelBox(capturedBottle.label_box, capturedBottle.box, { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height })
          : null;
        // No known label position yet: send the whole bottle body (brand names
        // often sit high on the label or on the shoulder).
        const labelBox = projectedLabel || {
          x0: candidate.x + candidate.width * 0.04,
          y0: candidate.y + candidate.height * 0.12,
          x1: candidate.x + candidate.width * 0.96,
          y1: candidate.y + candidate.height * 0.92,
        };
        const crop = calculateLabelCrop(labelBox, frameCanvas.width, frameCanvas.height, { maxLongEdge: 896, maxUpscale: 1.5 });
        if (!crop) continue;
        // A thin sliver (a bottle edge behind its neighbour, or a neck) never shows a readable label.
        if (!projectedLabel && Math.min(crop.sw, crop.sh) / Math.max(crop.sw, crop.sh) < MIN_BODY_CROP_ASPECT) continue;
        // Too few real pixels to read (enlarging adds nothing): not sent; its box says ZOOM IN with how
        // close it is to readable. The bottle is read once it is closer or the camera zooms in.
        const longEdge = Math.max(crop.sw, crop.sh), shortEdge = Math.min(crop.sw, crop.sh);
        if (!isReadableLabel(longEdge, shortEdge)) { tooSmall.set(candidate.trackId, zoomReadiness(longEdge, shortEdge)); continue; }
        tooSmall.delete(candidate.trackId);
        planned.push({ trackId: candidate.trackId, crop, samples: samplesForLabel(longEdge, zoomRef.current), best: null, bestSharp: -1, bottle: { x: candidate.x, width: candidate.width } });
      }
      // Far labels: look at several frames and keep the sharpest (more frames the smaller the label).
      const maxSamples = planned.reduce((n, plan) => Math.max(n, plan.samples), 0);
      for (let k = 0; k < maxSamples; k++) {
        if (k > 0) await new Promise(resolve => window.setTimeout(resolve, SAMPLE_GAP_MS));
        if (disposed || generation !== recognitionGeneration) return;
        const video = videoRef.current;
        if (!video || video.videoWidth < 2) break;
        for (const plan of planned) {
          if (k >= plan.samples) continue;
          const { crop } = plan;
          const scratch = document.createElement('canvas');
          scratch.width = crop.outputWidth;
          scratch.height = crop.outputHeight;
          const context = scratch.getContext('2d');
          if (!context) continue;
          context.drawImage(video, frameRegion.x + crop.sx, frameRegion.y + crop.sy, crop.sw, crop.sh, 0, 0, crop.outputWidth, crop.outputHeight);
          const sharp = plan.samples > 1 ? cropSharpness(scratch) : 0;
          if (!plan.best || sharp > plan.bestSharp) { if (plan.best) releaseCanvas(plan.best); plan.best = scratch; plan.bestSharp = sharp; }
          else releaseCanvas(scratch);
        }
      }
      // The phone's own text reader looks at one bottle with no name or guess yet, at most every 3 s,
      // and only while the reader is free (it shares the processor with the bottle detector).
      // Only at a quiet moment: phone held still (the detector then steps back while the text is read).
      let phoneReads = textReader && !textReader.isBusy && steadyCapture && now - lastPhoneReadAt >= PHONE_READ_GAP_MS ? 0 : 1;
      for (const plan of planned) {
        if (!plan.best) continue;
        if (!timingByTrack.has(plan.trackId) && !loggedTimingTracks.has(plan.trackId)) {
          timingByTrack.set(plan.trackId, { startedAt: now, labelPx: Math.round(Math.max(plan.crop.sw, plan.crop.sh)) });
        }
        if (textReader && phoneReads < 1 && textReader.available && !probableByTrack.has(plan.trackId) && !labelReadsByTrack.get(plan.trackId)?.brand) {
          try {
            // Shrunk copy: the biggest words read fine at 640 px, and it is less to copy and process.
            const scale = Math.min(1, OCR_MAX_EDGE / Math.max(plan.best.width, plan.best.height));
            const small = document.createElement('canvas');
            small.width = Math.max(2, Math.round(plan.best.width * scale));
            small.height = Math.max(2, Math.round(plan.best.height * scale));
            const context = small.getContext('2d', { willReadFrequently: true });
            if (context) {
              context.drawImage(plan.best, 0, 0, small.width, small.height);
              const image = context.getImageData(0, 0, small.width, small.height);
              const cylinder = cylinderForCrop(plan.bottle, plan.crop, frameCanvas.width);
              readTextForGuess(plan.trackId, image, cylinder ? { centerX: cylinder.centerX * scale, radius: cylinder.radius * scale } : null, generation);
              phoneReads += 1;
              lastPhoneReadAt = now;
            }
            releaseCanvas(small);
          } catch { /* canvas unreadable: the cloud read carries on */ }
        }
        // Best quality that fits this crop's share of the server's batch limit.
        const budget = Math.min(99_000, Math.max(38_000, Math.floor(340_000 / Math.max(1, eligible.length))));
        let image = '';
        for (const quality of [0.86, 0.78, 0.7, 0.6]) {
          image = plan.best.toDataURL('image/jpeg', quality);
          if (image.length <= budget) break;
        }
        releaseCanvas(plan.best);
        if (image.length > budget) continue;
        crops.push({ trackId: plan.trackId, image });
      }
      // A bottle that has never been read is read again soon, so a name shows
      // within about a second; after that, reads come at the normal pace.
      const unreadWaiting = candidates.some(candidate => !lastLabelReadAt.has(candidate.trackId) && !crops.some(crop => crop.trackId === candidate.trackId));
      nextLabelBatchAt = now + (unreadWaiting ? 1500 : 4000);
      if (!crops.length) return;
      labelBatchBusy = true;
      crops.forEach(crop => { lastLabelReadAt.set(crop.trackId, now); if (!readingSince.has(crop.trackId)) readingSince.set(crop.trackId, now); });
      publishVisibleCandidates();
      const applyReads = (reads: LabelBatchRead[], readAt: number) => {
        for (const read of reads) readingSince.delete(read.trackId);
        for (const read of reads) {
          if (looksLikeNoDrink(read)) {
            const votes = (noLabelVotes.get(read.trackId) ?? 0) + 1;
            noLabelVotes.set(read.trackId, votes);
            // Two reads (usually the quick one and the careful second look) saw no label and no words:
            // not a drink (a book, box, sign...). Its box goes and it is not read again.
            if (votes >= 2 || read.unreadableReason === 'not_a_drink') {
              notDrinkTracks.add(read.trackId); probableByTrack.delete(read.trackId); timingByTrack.delete(read.trackId);
            }
          } else if (read.brand) noLabelVotes.delete(read.trackId);
          // A blank second look adds nothing; keep what the first read had.
          if (read.tier === 'escalate' && !read.brand) continue;
          labelReadsByTrack.set(read.trackId, read);
          reverifyTracks.delete(read.trackId);
          if (read.brand) { probableByTrack.delete(read.trackId); finishTiming(read.trackId, read); }
          evidence.observeIdentity(read.trackId, labelReadToBottle(read), 'label:' + read.tier + ':' + readAt + ':' + read.trackId);
          const cloudTrack = webTracks.find(track => track.id === read.trackId);
          if (cloudTrack) {
            cloudTrack.bottle = mergeBottleRead(cloudTrack.bottle, read);
          }
        }
        publishVisibleCandidates();
      };
      try {
        const video = videoRef.current;
        const diag = { video_w: video?.videoWidth ?? 0, video_h: video?.videoHeight ?? 0, frame_w: frameCanvas.width, frame_h: frameCanvas.height, steady: steadyCapture, sharp: Math.round(sharpRatio * 100) / 100 };
        const reads = await readLiveLabelBatch(crops, 'base', diag);
        if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled || generation !== recognitionGeneration) return;
        const returnedTrackIds = new Set(reads.map(read => read.trackId));
        crops.filter(crop => !returnedTrackIds.has(crop.trackId)).forEach(crop => lastLabelReadAt.delete(crop.trackId));
        applyReads(reads, now);
        // Hard labels only: send the unsure or guessed ones (same crops) for a second look, in the background.
        const secondLook = secondLookBusy ? [] : selectSecondLookCrops(crops, reads, lastSecondLookAt, Date.now());
        if (secondLook.length) {
          secondLookBusy = true;
          const lookAt = Date.now();
          secondLook.forEach(crop => { lastSecondLookAt.set(crop.trackId, lookAt); lastLabelReadAt.set(crop.trackId, lookAt); });
          void readLiveLabelBatch(secondLook, 'escalate', diag)
            .then(better => {
              if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled || generation !== recognitionGeneration) return;
              applyReads(better, lookAt);
            })
            .catch(() => { /* the normal re-read pace covers a failed second look */ })
            .finally(() => { secondLookBusy = false; });
        }
      } catch (error) {
        crops.forEach(crop => lastLabelReadAt.delete(crop.trackId));
        if (!disposed) callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? 'label_batch_failed: ' + error.message : 'label_batch_failed' } });
      } finally {
        labelBatchBusy = false;
        // Labels that came back unreadable go back to scanning.
        if (crops.some(crop => readingSince.get(crop.trackId) === now)) {
          crops.forEach(crop => { if (readingSince.get(crop.trackId) === now) readingSince.delete(crop.trackId); });
          publishVisibleCandidates();
        }
      }
    };

    let detectionCanvas: HTMLCanvasElement | null = null;
    let detectionContext: CanvasRenderingContext2D | null = null;
    const runLocalDetection = async () => {
      if (disposed || !pageVisible || localDetectionBusy || !callbacksRef.current.recognitionEnabled || !segmentationRunner) return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth < 2 || video.videoHeight < 2) return;
      localDetectionBusy = true;
      const runner = segmentationRunner;
      const generation = recognitionGeneration;
      const localFrameStartedAt = performance.now();
      const frameTimestamp = Date.now();
      try {
        const crop = visibleCrop(video);
        if (!crop) return;
        const { x: sx, y: sy, width: sw, height: sh } = crop;
        const scale = Math.min(1, 640 / Math.max(sw, sh));
        if (!detectionCanvas) {
          detectionCanvas = document.createElement('canvas');
          detectionContext = detectionCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (!detectionContext) return;
        const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
        if (detectionCanvas.width !== width || detectionCanvas.height !== height) {
          detectionCanvas.width = width;
          detectionCanvas.height = height;
        }
        detectionContext.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
        const frame = detectionContext.getImageData(0, 0, width, height);
        const segmentationStartedAt = performance.now();
        const result = await runner.runInferenceDetailed(frame, frameTimestamp);
        lastSegmentationMs = performance.now() - segmentationStartedAt;
        if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled || generation !== recognitionGeneration) return;
        // Skipped (busy/too soon/stale) is not evidence that bottles are gone.
        if (result.status !== 'ran') return;
        detectorFailures = 0;
        const now = Date.now();
        // The camera kept moving while the model ran: move this frame's boxes
        // to where those bottles are now.
        const motion = cameraMotionHistory.motionSince(frameTimestamp) ?? IDENTITY_MOTION;
        // Fast moves blur the frame; a missed bottle then is not a gone bottle.
        const countMisses = cameraMotionHistory.peakSpeed(frameTimestamp - 100, now) < 0.9 && lostMotionFrames === 0;
        const localTracks = localBottleTracker.update(result.instances.map(instance => {
          const contour = extractMaskContour(instance.data, instance.width, instance.height, {
            bounds: instance.bounds, minimumPixels: 12, minimumArea: 0.001, maxPoints: 96,
          });
          return {
            bounds: clipBoxToFrame(applyMotionToBox(instance.bounds, motion)),
            confidence: instance.detectionConfidence,
            contour: contour?.points.map(point => applyMotionToPoint(point, motion)),
            appearance: computeAppearanceSignature(frame.data, frame.width, frame.height, instance.bounds),
          };
        }), now, { countMisses });
        migrateLocalTrackIds(localBottleTracker.takeMergedTrackIds());
        for (const trackId of localBottleTracker.takeReacquiredTrackIds()) {
          const id = -Math.abs(trackId);
          reverifyTracks.add(id);
          // Same spot is not proof of the same bottle: its fill reading starts again.
          liquidGuard.bump(id);
          liquidHistoryByTrack.delete(id);
          const shown = latestLocalCandidates.find(candidate => candidate.trackId === id);
          if (shown) shown.liquidLevel = undefined;
        }
        for (const local of localTracks) {
          if ((lastHitsByLocalTrack.get(local.trackId) ?? 0) < local.hits) evidence.observeDetection(-Math.abs(local.trackId), local.confidence);
          lastHitsByLocalTrack.set(local.trackId, local.hits);
        }
        if (lastHitsByLocalTrack.size > 400) lastHitsByLocalTrack.clear();
        latestLocalCandidates = toLocalCandidates(localTracks, now);
        // Transfer this frame's pixel buffer to the liquid worker (capture-time
        // geometry). Neither detection nor recognition waits for its result.
        liquidGuard.stamp(frameTimestamp, latestLocalCandidates.map(local => local.trackId));
        liquidAnalysisQueue.submit(frame, frameTimestamp, latestLocalCandidates.map(local => {
          const back = clipBoxToFrame(applyMotionToBox({ x: local.x, y: local.y, width: local.width, height: local.height }, invertCameraMotion(motion)));
          return {
            trackId: local.trackId,
            bounds: { x: back.x * frame.width, y: back.y * frame.height, width: back.width * frame.width, height: back.height * frame.height },
          };
        }));
        publishVisibleCandidates();
        lastLocalFrameMs = performance.now() - localFrameStartedAt;
        const diagnostics = window as unknown as { __discoverDetector?: { frames?: number } };
        diagnostics.__discoverDetector = {
          backend: detectorProvider?.backend ?? 'main-thread', gpu: detectorProvider?.gpuTrialResult,
          segmentationMs: Math.round(lastSegmentationMs), frames: (diagnostics.__discoverDetector?.frames ?? 0) + 1,
          boxes: latestLocalCandidates.length,
        } as { frames: number };
        void readCandidateLabels();
      } catch (error) {
        detectorFailures += 1;
        if (!disposed) callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? 'local_segmentation_frame_failed: ' + error.message : 'local_segmentation_frame_failed' } });
        // A dead worker (or repeated failures) gets a fresh detector next pass.
        if ((runner.providerFailed || detectorFailures >= 3) && segmentationRunner === runner) {
          segmentationRunner = null;
          detectorFailures = 0;
          void runner.dispose();
        }
      } finally {
        localDetectionBusy = false;
      }
    };
    // Back-to-back local detection: the next pass starts as soon as the
    // detector is free (bounded by its cadence limit), not on a fixed timer.
    const scheduleLocalDetection = (delay: number) => {
      if (disposed || !pageVisible || localDetectionTimer || !callbacksRef.current.recognitionEnabled) return;
      localDetectionTimer = window.setTimeout(() => {
        localDetectionTimer = 0;
        if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled) return;
        if (!segmentationRunner) {
          if (segmentationLoadFailed) return;
          void Promise.resolve(ensureSegmentationRunner()).then(() => scheduleLocalDetection(segmentationRunner ? 0 : 1_000));
          return;
        }
        void runLocalDetection().finally(() => {
          // While the phone reads label text on the processor, the detector steps back a little (the camera is
          // steady then, and camera motion keeps the boxes on the bottles).
          const readingText = !!textReader?.isBusy;
          const yieldMs = readingText ? (textReader?.backend === 'webgpu' ? 120 : 350) : 0;
          scheduleLocalDetection(Math.max(30, yieldMs, segmentationRunner?.msUntilReady() ?? 250));
        });
      }, delay);
    };
    const startLocalDetectionLoop = () => {
      if (disposed || !pageVisible || localDetectionTimer || !callbacksRef.current.recognitionEnabled) return;
      void Promise.resolve(ensureSegmentationRunner()).then(() => {
        if (disposed || !pageVisible || localDetectionTimer || !callbacksRef.current.recognitionEnabled) return;
        scheduleLocalDetection(0);
      });
    };

    // Cloud identity reads remain deliberately separate from the 10Hz local detector.
    // Keep a single request in flight and pace requests by start time, not by
    // adding a full delay after the provider response. This stays below the
    // server's 30/minute limit even when inference is fast.
    const scheduleRecognition = (delay = recognitionIntervalMs) => {
      if (!disposed && pageVisible && callbacksRef.current.recognitionEnabled) { void ensureSegmentationRunner(); recognitionTimer = window.setTimeout(() => { void recognizeFrame(); }, delay); }
    };
    const recognizeFrame = async () => {
      if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled) return;
      // A label read in flight goes first; the whole-frame read waits for it.
      if (recognitionBusy || labelBatchBusy) { scheduleRecognition(500); return; }
      const video = videoRef.current;
      if (!video || video.videoWidth < 2 || video.videoHeight < 2) { scheduleRecognition(); return; }
      recognitionBusy = true;
      const generation = recognitionGeneration;
      lastRecognitionStartedAt = Date.now();
      let labelFrameCanvas: HTMLCanvasElement | null = null;
      let nextRecognitionDelay: number | null = null;
      try {
        // Reused between reads (recognitionBusy keeps them one at a time); see labelSourceCanvas.
        const canvas = frameReadCanvas ??= document.createElement('canvas');
        labelFrameCanvas = canvas;
        // Match the crop the user actually sees (object-fit: cover). On a
        // portrait phone the camera stream may be landscape; sending the full
        // uncropped frame makes the label much smaller than it appears on-screen.
        const crop = visibleCrop(video);
        if (!crop) return;
        const { x: sx, y: sy, width: sw, height: sh } = crop;
        const scale = Math.min(1, 960 / Math.max(sw, sh));
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Frame capture is unavailable in this browser.');
        context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const frameTimestamp = Date.now();
        const captureTracks = trackPositionsNow();
        const frameSignature = sampleLumaGrid(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        );
        const now = Date.now();
        // Local barcode decoding remains active even when cloud recognition is gated.
        decodeBarcodeFrame(canvas, frameTimestamp);
        const sceneChanged = shouldReadChangedFrame(lastSentFrameSignature, frameSignature);
        const heartbeatMs = lastLiveBottleCount > 0 ? unchangedFrameHeartbeatMs : emptyFrameRetryMs;
        if (!sceneChanged && now - lastLiveReadAt < heartbeatMs) {
          // Do not spend a cloud read on an unchanged shelf. Schedule the next
          // attempt for the exact remaining heartbeat, not another full 4.4s.
          nextRecognitionDelay = frameGateRetryDelay(now, lastLiveReadAt, heartbeatMs);
          labelFrameCanvas = null;
          return;
        }
        const jpeg = canvas.toDataURL('image/jpeg', 0.62);
        const result = await readLiveFrame(jpeg);
        if (disposed || !pageVisible || !callbacksRef.current.recognitionEnabled || generation !== recognitionGeneration) return;
        lastSentFrameSignature = frameSignature;
        lastLiveReadAt = Date.now();
        lastLiveBottleCount = result.bottles.length;
        const text = result.bottles.flatMap(b => [b.brand, b.product, ...b.words]).filter(Boolean);
        const classifications = result.bottles.map(b => ({ identifier: b.category, confidence: String(b.confidence) }));
        callbacksRef.current.onRecognitionUpdate?.({ nativeEvent: { text, barcodes: [], barcodeStatus: barcodeDetector ? 'available' : 'unsupported', classifications, frameTimestamp, bottles: result.bottles, menu: result.menu, diagnostics: result.diagnostics } });
        // Boxes describe the capture frame; follow the tracks the device kept
        // moving since then so identities land on the bottle they were read from.
        const captureBoxes = result.bottles.map(b => ({ x: b.box.x0, y: b.box.y0, width: b.box.x1 - b.box.x0, height: b.box.y1 - b.box.y0 }));
        const compensated = compensateDetections(captureBoxes, captureTracks, trackPositionsNow());
        const motionSinceCapture = cameraMotionHistory.motionSince(frameTimestamp);
        const currentBoxes = compensated.map((item, index) => item.method === 'track' || !motionSinceCapture
          ? item.box
          : clipBoxToFrame(applyMotionToBox(captureBoxes[index]!, motionSinceCapture)));
        // A name read from the bottle a local track was following at capture
        // time belongs to that track; it stays with the bottle off screen.
        // Cloud boxes are approximate: when a read was not bound by overlap at
        // capture time, give it to the local bottle box that contains its
        // centre now (each local bottle takes at most one read per frame).
        const boundLocal = new Set(compensated.map(item => item.boundTrackId).filter((id): id is number => id !== null && id < 0));
        compensated.forEach((item, index) => {
          const bottle = result.bottles[index]!;
          if (!hasIdentity(bottle)) return;
          let trackId = item.boundTrackId !== null && item.boundTrackId < 0 ? item.boundTrackId : null;
          if (trackId === null) {
            const box = currentBoxes[index]!;
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const host = latestLocalCandidates
              .filter(local => !boundLocal.has(local.trackId)
                && cx >= local.x && cx <= local.x + local.width && cy >= local.y && cy <= local.y + local.height)
              .sort((a, b) => Math.abs(a.x + a.width / 2 - cx) - Math.abs(b.x + b.width / 2 - cx))[0];
            if (host) { trackId = host.trackId; boundLocal.add(host.trackId); }
          }
          if (trackId !== null) evidence.observeIdentity(trackId, bottle, 'frame:' + frameTimestamp + ':' + index);
        });
        updateWebTracks(result.bottles.map((b, index) => ({ ...currentBoxes[index]!, confidence: b.detectionConfidence, bottle: b })), frameTimestamp);
        // Publish model detections immediately; optional local segmentation must
        // never block the basic bottle boxes from reaching the viewfinder.
        publishVisibleCandidates();

      } catch (error) {
        if (!disposed) callbacksRef.current.onTrackingUpdate?.({ nativeEvent: { state: 'limited', reason: error instanceof Error ? error.message : 'recognition_request_failed' } });
      } finally {
        recognitionBusy = false;
        if (labelFrameCanvas && !disposed) void readCandidateLabels();
        const elapsed = Date.now() - lastRecognitionStartedAt;
        scheduleRecognition(nextRecognitionDelay ?? Math.max(0, recognitionIntervalMs - elapsed));
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
        // Download and initialize the local detector while camera permission
        // and stream startup are in progress, not after the first live frame.
        void ensureSegmentationRunner();
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
            // Labels are read from crops of this stream at full resolution: 4K gives a distant label four
            // times the pixels of 1080p (phones that struggled before stay at 1080p).
            width: { ideal: scannerMode.lite ? 1920 : 3840 },
            height: { ideal: scannerMode.lite ? 1080 : 2160 },
          },
        });
        // Does this camera zoom itself (real detail)? Otherwise pinching enlarges the picture.
        const videoTrack = stream.getVideoTracks()[0] ?? null;
        videoTrackRef.current = videoTrack;
        try {
          const caps = (videoTrack?.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } };
          nativeZoomRef.current = caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null;
        } catch { nativeZoomRef.current = null; }

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
        // The camera may have been closed while play() was pending. Do not
        // allocate depth workers or schedule frame checks for a dead session.
        if (disposed) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

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
            if (callbacksRef.current.recognitionEnabled) { scheduleRecognition(0); startLocalDetectionLoop(); startOpticalFlow(); }
            return;
          }
          frameCheck = window.requestAnimationFrame(verifyFrame);
        };
        frameCheck = window.requestAnimationFrame(verifyFrame);
      } catch (error) {
        fail(error);
      }
    };

    recognitionSchedulerRef.current = () => {
      if (!callbacksRef.current.recognitionEnabled) {
        recognitionGeneration += 1;
        recognitionEpochStartedAt = Date.now();
        // Turning recognition off ends the current visual-tracking epoch.
        // Do not allow old candidates or cached OCR to return on the next toggle.
        webTracks = [];
        latestLocalCandidates = [];
        labelReadsByTrack.clear();
        lastLabelReadAt.clear();
        liquidHistoryByTrack.clear();
        liquidGuard.clear();
        localBottleTracker.reset();
        evidence.clear();
        lastHitsByLocalTrack.clear();
        resetAutoSave();
        reverifyTracks.clear();
        nextWebTrackId = 1;
        resetCameraMotion();
        lastPublishedSignature = '';
        lastSentFrameSignature = null;
        lastLiveReadAt = 0;
        lastLiveBottleCount = 0;
        callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: 0, candidates: [] } });
        return;
      }
      if (detectorProvider) markScannerRunning(detectorProvider.backend ?? 'main-thread');
      scheduleRecognition(0);
      startLocalDetectionLoop();
      startOpticalFlow();
    };
    void start();

    return () => {
      recognitionSchedulerRef.current = null;
      // Clear the rendered overlay before the camera element is torn down so
      // no candidates from this session survive a close/reopen transition.
      callbacksRef.current.onVisualCandidates?.({ nativeEvent: { count: 0, candidates: [] } });
      webTracks = [];
      latestLocalCandidates = [];
      labelReadsByTrack.clear();
      lastLabelReadAt.clear();
      liquidHistoryByTrack.clear();
        liquidGuard.clear();
      evidence.clear();
      lastHitsByLocalTrack.clear();
      flushTimings();
      resetAutoSave();
      window.clearInterval(autoSaveTimer);
      window.clearInterval(timingTimer);
      probableByTrack.clear();
      timingByTrack.clear();
      textReader?.dispose();
      reverifyTracks.clear();
      releaseCanvas(labelSourceCanvas); releaseCanvas(labelCropCanvas); releaseCanvas(frameReadCanvas);
      labelSourceCanvas = labelCropCanvas = frameReadCanvas = null;
      nextWebTrackId = 1;
      lastSentFrameSignature = null;
      lastLiveReadAt = 0;
      lastLiveBottleCount = 0;
      disposed = true;
      if (frameCheck) window.cancelAnimationFrame(frameCheck);
      if (recognitionTimer) window.clearTimeout(recognitionTimer);
      if (localDetectionTimer) window.clearTimeout(localDetectionTimer);
      if (opticalFlowFrame) window.cancelAnimationFrame(opticalFlowFrame);
      resetCameraMotion();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      markScannerStopped();
      if (depthTimer) window.clearInterval(depthTimer);
      localBottleTracker.reset();
      liquidAnalysisQueue.dispose();
      liquidHistoryByTrack.clear();
        liquidGuard.clear();
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
    if (active) recognitionSchedulerRef.current?.();
  }, [active, recognitionEnabled]);

  // Pinch: two fingers apart zoom in, together zoom out (1x to 5x).
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    let startDistance = 0, startZoom = 1, lastApplied = 0, labelTimer = 0;
    const inCamera = (target: EventTarget | null) => {
      const node = containerRef.current as HTMLElement | null;
      return !!node && target instanceof Node && node.contains(target);
    };
    const distance = (touches: TouchList) => Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY);
    const setZoomLevel = (level: number) => {
      const native = nativeZoomRef.current;
      const maxZoom = native ? Math.min(5, native.max) : 4;
      const z = Math.max(1, Math.min(maxZoom, level));
      zoomRef.current = z;
      if (native) {
        const now = performance.now();
        if (now - lastApplied > 60) {
          lastApplied = now;
          void videoTrackRef.current?.applyConstraints({ advanced: [{ zoom: Math.max(native.min, z) } as MediaTrackConstraintSet] }).catch(() => undefined);
        }
      } else {
        digitalZoomRef.current = z;
        setDigitalZoom(z);
      }
      setZoomLabel(z.toFixed(1) + '×');
      window.clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => setZoomLabel(null), 900);
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !inCamera(event.target)) return;
      startDistance = distance(event.touches);
      startZoom = zoomRef.current;
      event.preventDefault();
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !startDistance) return;
      event.preventDefault();   // the page itself must not zoom
      setZoomLevel(startZoom * distance(event.touches) / startDistance);
    };
    const onEnd = (event: TouchEvent) => { if (event.touches.length < 2) startDistance = 0; };
    // Safari's own pinch gesture would zoom the whole page.
    const onGesture = (event: Event) => { if (inCamera(event.target)) event.preventDefault(); };
    window.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    window.addEventListener('gesturestart', onGesture, { passive: false } as AddEventListenerOptions);
    window.addEventListener('gesturechange', onGesture, { passive: false } as AddEventListenerOptions);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
      window.removeEventListener('gesturestart', onGesture);
      window.removeEventListener('gesturechange', onGesture);
      window.clearTimeout(labelTimer);
    };
  }, [active]);

  return (
    <View ref={containerRef} style={[style, { overflow: 'hidden' }]}>
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
          transform: digitalZoom > 1.001 ? `scale(${digitalZoom})` : undefined,
          transformOrigin: 'center center',
        },
      })}
      {zoomLabel && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: '46%', alignItems: 'center', zIndex: 30 }}>
          <Text style={{ color: '#F0F1F2', fontSize: 15, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(5,9,12,0.6)' }}>{zoomLabel}</Text>
        </View>
      )}
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
    30000,
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
  // ARFrame timestamps are monotonic seconds. Used only to reject delayed
  // liquid enrichments; bottle recognition publication remains independent.
  const latestNativeFrameTimestamp = useRef(0);
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
    latestNativeFrameTimestamp.current = 0;
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
      const incomingFrame = event.nativeEvent;
      latestNativeFrameTimestamp.current = Math.max(latestNativeFrameTimestamp.current, incomingFrame.timestamp);
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
          const liquidAnalysisStartedAt = Date.now();
          void NativeLiquidAnalyzer.analyzeLiquidLevels(frame.imageBase64, tracked.slice(0, 4).map(track => ({
            trackId: track.trackId, x: track.x, y: track.y, width: track.width, height: track.height,
          }))).then(analyses => {
            if (generation !== nativeSessionGeneration.current) return;
            // Never attach a delayed measurement to a bottle whose live geometry
            // may have moved since this analysis frame was captured.
            if (Date.now() - liquidAnalysisStartedAt > 1400
              || latestNativeFrameTimestamp.current - frame.timestamp > 1.4) {
              onLiquidMetrics?.({ nativeEvent: {
                jobsDispatched: 1, jobsCompleted: 0, framesSkipped: 1, workerErrors: 0,
                lastWorkerMs: 0, maxWorkerMs: 0, segmentationMs: 0, localFrameMs: 0, workerAvailable: true,
              } });
              return;
            }
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
                const calibrationKey = getBottleCalibrationKey(current.bottle.match, current.bottle.state, current.bottle.size, current.bottle.resolved);
                const profile = calibrationKey ? (getCachedBottleVolumeProfile(calibrationKey) ?? nativeVolumeProfiles.current[calibrationKey]) : undefined;
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
              jobsDispatched: 1, jobsCompleted: 1, framesSkipped: 0,
              workerErrors: 0, lastWorkerMs: nativeProcessingMs, maxWorkerMs: nativeProcessingMs,
              segmentationMs: 0, localFrameMs: 0, workerAvailable: true,
            } });
            if (changed) props.onVisualCandidates?.({ nativeEvent: { count: candidates.length, depthFrame: frame.depthEstimate, candidates } });
          }).catch(() => {
            onLiquidMetrics?.({ nativeEvent: {
              jobsDispatched: 1, jobsCompleted: 0, framesSkipped: 0, workerErrors: 1,
              lastWorkerMs: 0, maxWorkerMs: 0, segmentationMs: 0, localFrameMs: 0, workerAvailable: true,
            } });
          }).finally(() => {
            if (generation === nativeSessionGeneration.current) nativeLiquidBusy.current = false;
          });
        } else {
          onLiquidMetrics?.({ nativeEvent: {
            jobsDispatched: 0, jobsCompleted: 0, framesSkipped: tracked.length ? 1 : 0,
            workerErrors: 0, lastWorkerMs: 0, maxWorkerMs: 0, segmentationMs: 0, localFrameMs: 0,
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
