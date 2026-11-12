import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ARKitDepthFrame, ARTrackingUpdate } from '../live/DiscoverARSurface';
import type { BottleRead } from '../services/discoverLiveApi';
import { arkitOrientationFromRawValue, cameraPointToWorld, intrinsicsFromARKitDepth, unprojectDetection } from '../live/spatialTracking';

const ink = '#F1EEE7';
const muted = '#9DA7B5';
const brass = '#C6A36A';
const green = '#66E5A1';
const amber = '#E6B76C';

type Props = {
  onClose: () => void;
  tracking: ARTrackingUpdate;
  depthStatus: string;
  depthFrame: ARKitDepthFrame | null;
  candidates: Array<{ trackId: number; x: number; y: number; width: number; height: number; confidence: number }>;
  bottles: BottleRead[];
};

/**
 * Diagnostics for the one camera session owned by the home viewfinder.
 * This panel deliberately does not mount a camera or start another AR session.
 */
export default function LidarScannerPanel({ onClose, tracking, depthStatus, depthFrame, candidates, bottles }: Props) {
  const validDepthSamples = depthFrame?.depthMeters.filter(value => Number.isFinite(value) && value > 0).length ?? 0;
  const trackingColor = tracking.state === 'normal' ? green : amber;
  const metricDepth = !!depthFrame && depthFrame.unit === 'meters';
  const orientation = depthFrame ? arkitOrientationFromRawValue(depthFrame.imageOrientation) : null;
  const intrinsics = depthFrame ? intrinsicsFromARKitDepth(depthFrame) : null;
  const spatialPoints = metricDepth && depthFrame && orientation && intrinsics
    ? bottles.flatMap((bottle, index) => {
        const point = unprojectDetection(
          bottle.box,
          { width: depthFrame.width, height: depthFrame.height, metres: depthFrame.depthMeters, confidence: depthFrame.confidence },
          intrinsics,
        );
        if (!point) return [];
        const world = cameraPointToWorld(point, depthFrame.cameraTransform, orientation);
        return world ? [{ key: `${bottle.category}-${index}`, name: bottle.match?.brand || bottle.brand || bottle.product || bottle.category.replace(/_/g, ' '), world, samples: point.sampleCount }] : [];
      })
    : [];

  return <View style={{ width: '100%', flex: 1, minHeight: 0, justifyContent: 'space-between', paddingBottom: 2 }}>
    <View style={{ gap: 12 }}>
      <Text style={{ color: muted, fontSize: 10, lineHeight: 16 }}>SHARED CAMERA SESSION · ARKit WORLD TRACKING WHEN AVAILABLE</Text>
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(198,163,106,0.2)' }}>
        <Text style={{ color: trackingColor, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }}>TRACKING · {tracking.state.toUpperCase().replace('_', ' ')}</Text>
        <Text style={{ color: muted, fontSize: 10, marginTop: 4 }}>{tracking.reason || 'ARKit camera pose tracking is stable.'}</Text>
      </View>
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
        <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>METRIC DEPTH</Text>
        <Text style={{ color: metricDepth ? green : amber, fontSize: 11, fontWeight: '900', marginTop: 5 }}>{metricDepth ? 'LIVE DEPTH IN METRES' : depthStatus.replace(/_/g, ' ').toUpperCase()}</Text>
        <Text style={{ color: muted, fontSize: 10, marginTop: 4 }}>{metricDepth ? `${depthFrame.width} × ${depthFrame.height} depth grid · ${validDepthSamples} valid samples · ${depthFrame.source}` : 'Depth is unavailable until the native device supplies a calibrated ARKit scene-depth frame.'}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <Text style={{ color: brass, fontSize: 20, fontWeight: '900' }}>{bottles.length}</Text>
          <Text style={{ color: muted, fontSize: 9, fontWeight: '800' }}>BOTTLE READS</Text>
        </View>
        <View style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
          <Text style={{ color: brass, fontSize: 20, fontWeight: '900' }}>{candidates.length}</Text>
          <Text style={{ color: muted, fontSize: 9, fontWeight: '800' }}>TRACKED CANDIDATES</Text>
        </View>
      </View>
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
        <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>DEPTH-PROJECTED BOTTLE CENTRES</Text>
        <Text style={{ color: spatialPoints.length ? green : amber, fontSize: 11, fontWeight: '900', marginTop: 5 }}>{spatialPoints.length} / {bottles.length} PROJECTED THIS FRAME</Text>
        {spatialPoints.slice(0, 4).map(point => (
          <View key={point.key} style={{ marginTop: 7 }}>
            <Text numberOfLines={1} style={{ color: ink, fontSize: 10, fontWeight: '800' }}>{point.name}</Text>
            <Text style={{ color: muted, fontSize: 9, fontVariant: ['tabular-nums'] }}>X {point.world.x.toFixed(2)}m · Y {point.world.y.toFixed(2)}m · Z {point.world.z.toFixed(2)}m · {point.samples} depth samples</Text>
          </View>
        ))}
        <Text style={{ color: muted, fontSize: 9, lineHeight: 14, marginTop: 7 }}>Frame-local point estimates only. Stable object identity, bottle surfaces, and multi-frame world-space fusion are not implemented yet.</Text>
      </View>
      <Text style={{ color: muted, fontSize: 9, lineHeight: 14 }}>World tracking and metric depth are device capabilities, not proof of bottle reconstruction. These projections depend on physical-device coordinate validation.</Text>
    </View>
    <Pressable onPress={onClose} style={{ padding: 14, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
      <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>CLOSE DIAGNOSTICS</Text>
    </Pressable>
  </View>;
}
