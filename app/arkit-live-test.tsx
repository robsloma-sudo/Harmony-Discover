import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { Screen, styles } from '../src/ui';
import { DiscoverARSurface, type ARTrackingUpdate, type ARKitDepthFrame } from '../src/live/DiscoverARSurface';
import { downloadAndInitializeDfineNativeRuntime, runDfineNativeSmokeTest } from '../modules/discover-arkit';

export default function ARKitLiveTest() {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const [tracking, setTracking] = useState<ARTrackingUpdate>({ state: 'paused', reason: 'not_started' });
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<Array<{ trackId: number; confidence: number }>>([]);
  const [depthFrame, setDepthFrame] = useState<ARKitDepthFrame | null>(null);
  const [depthStatus, setDepthStatus] = useState('waiting_for_lidar_depth');
  const [dfineBusy, setDfineBusy] = useState(false);
  const [dfineReady, setDfineReady] = useState(false);
  const [dfineResult, setDfineResult] = useState<Record<string, unknown> | null>(null);
  const [dfineError, setDfineError] = useState('');

  const initializeDfine = async () => {
    setDfineBusy(true);
    setDfineError('');
    setDfineResult(null);
    try {
      const result = await downloadAndInitializeDfineNativeRuntime();
      setDfineResult(result as Record<string, unknown>);
      setDfineReady(result.ready === true);
    } catch (reason) {
      setDfineReady(false);
      setDfineError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDfineBusy(false);
    }
  };

  const runDfineSmokeTest = async () => {
    setDfineBusy(true);
    setDfineError('');
    try {
      const result = await runDfineNativeSmokeTest();
      setDfineResult(previous => ({ ...(previous || {}), ...(result as Record<string, unknown>) }));
    } catch (reason) {
      setDfineError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDfineBusy(false);
    }
  };

  const start = async () => {
    setError('');
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission is required for the ARKit test.');
        return;
      }
    }
    setTracking({ state: 'limited', reason: 'starting' });
    setActive(true);
  };

  return (
    <Screen>
      <Text style={styles.back} onPress={() => { setActive(false); router.back(); }}>‹  Back to diagnostics</Text>
      <Text style={styles.eyebrow}>DISCOVER DEV · AR SESSION TEST</Text>
      <Text style={styles.title}>Live world tracking</Text>
      <Text style={styles.sub}>This test starts an on-device ARKit camera session and reports world tracking plus real metric LiDAR depth frames. It does not yet detect bottles, reconstruct meshes, record video, or save images.</Text>
      <View style={{ height: 380, overflow: 'hidden', borderRadius: 14, backgroundColor: '#050A12', borderWidth: 1, borderColor: '#34527A', marginVertical: 16 }}>
        <DiscoverARSurface
          style={{ flex: 1 }}
          active={active}
          onTrackingUpdate={event => setTracking(event.nativeEvent)}
          onVisualCandidates={event => setCandidates(event.nativeEvent.candidates)}
          onDepthEstimate={event => { const value = event.nativeEvent; if ('depthMeters' in value) setDepthFrame(value); }}
          onDepthStatus={event => setDepthStatus(event.nativeEvent.status)}
          onARError={event => { setError(event.nativeEvent.message || 'ARKit session failed.'); setActive(false); }}
          onARReady={() => setError('')}
        />
        {!active && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,10,18,0.82)' }}>
          <Text style={{ color: '#EAF2FF', fontWeight: '800', letterSpacing: 1 }}>AR SESSION PAUSED</Text>
        </View>}
      </View>
      <View style={[styles.item, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <Text style={styles.itemTitle}>Tracking state</Text>
        <Text style={styles.price}>{tracking.state.toUpperCase().replace('_', ' ')}</Text>
        <Text style={styles.categoryDesc}>{tracking.reason || 'Camera pose tracking is stable.'}</Text>
      </View>
      <View style={[styles.item, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <Text style={styles.itemTitle}>Native LiDAR depth feed</Text>
        <Text style={styles.price}>{depthFrame ? 'LIVE METRIC DEPTH RECEIVED' : depthStatus.replace(/_/g, ' ').toUpperCase()}</Text>
        <Text style={styles.categoryDesc}>{depthFrame ? `${depthFrame.width} × ${depthFrame.height} sampled depth grid · ${depthFrame.depthMeters.filter(value => value > 0).length} valid samples · units: meters · source: ${depthFrame.source}` : 'Waiting for ARKit sceneDepth / smoothedSceneDepth frames. World tracking alone does not prove LiDAR depth is active.'}</Text>
        {depthFrame ? <Text style={styles.categoryDesc}>Camera calibration and pose metadata: {depthFrame.cameraIntrinsics.length} intrinsics values · {depthFrame.cameraTransform.length} transform values · confidence samples: {depthFrame.confidence.length}</Text> : null}
      </View>
      <View style={[styles.item, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <Text style={styles.itemTitle}>Live geometry candidates</Text>
        <Text style={styles.price}>{active ? candidates.length + ' TRACKED CANDIDATES' : 'INACTIVE'}</Text>
        <Text style={styles.categoryDesc}>Blue rectangles are generic Vision regions, not confirmed bottles. IDs persist while frame-to-frame overlap remains sufficient. Confidence is rectangle-detection confidence, not bottle identity confidence.</Text>
        {candidates.slice(0, 4).map(candidate => <Text key={candidate.trackId} style={styles.categoryDesc}>Track #{candidate.trackId} · {Math.round(candidate.confidence * 100)}% rectangle confidence</Text>)}
      </View>
      {Platform.OS === 'ios' && (
        <View style={[styles.item, { flexDirection: 'column', alignItems: 'flex-start' }]}>
          <Text style={styles.itemTitle}>Native D-FINE / CoreML runtime</Text>
          <Text style={styles.categoryDesc}>Research-only device test. Downloads the pinned 16 MB model, verifies SHA-256, initializes one cached CoreML-first session, then runs a synthetic tensor. It does not change live bottle detection.</Text>
          <Text style={styles.price}>{dfineReady ? 'NATIVE MODEL SESSION READY' : 'NOT INITIALIZED'}</Text>
          {!!dfineResult?.inferenceMs && <Text style={styles.categoryDesc}>Synthetic inference: {Number(dfineResult.inferenceMs).toFixed(1)} ms</Text>}
          {!!dfineResult?.outputNames && <Text style={styles.categoryDesc}>Outputs: {(dfineResult.outputNames as string[]).join(', ')}</Text>}
          {!!dfineResult?.outputShapes && <Text style={styles.categoryDesc}>Output shapes: {JSON.stringify(dfineResult.outputShapes)}</Text>}
          {!!dfineError && <Text style={styles.categoryDesc}>{dfineError}</Text>}
          <Pressable disabled={dfineBusy} style={[styles.primary, dfineBusy && { opacity: 0.5 }]} onPress={() => void initializeDfine()}>
            <Text style={styles.primaryText}>{dfineBusy ? 'INITIALIZING…' : 'DOWNLOAD & INITIALIZE D-FINE'}</Text>
          </Pressable>
          <Pressable disabled={dfineBusy || !dfineReady} style={[styles.item, { justifyContent: 'center', opacity: dfineBusy || !dfineReady ? 0.45 : 1 }]} onPress={() => void runDfineSmokeTest()}>
            <Text style={styles.itemTitle}>Run synthetic inference test</Text>
          </Pressable>
        </View>
      )}
      {!!error && <Text style={styles.categoryDesc}>{error}</Text>}
      {!permission && <ActivityIndicator />}
      <Pressable style={styles.primary} onPress={() => void start()}><Text style={styles.primaryText}>START AR SESSION</Text></Pressable>
      <Pressable style={[styles.item, { justifyContent: 'center' }]} onPress={() => { setActive(false); setTracking({ state: 'paused', reason: 'user_paused' }); }}>
        <Text style={styles.itemTitle}>Pause session</Text>
      </Pressable>
    </Screen>
  );
}
