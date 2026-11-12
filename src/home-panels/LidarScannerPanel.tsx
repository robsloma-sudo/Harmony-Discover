import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ARKitDepthFrame, ARTrackingUpdate } from '../live/DiscoverARSurface';
import type { BottleRead } from '../services/discoverLiveApi';
import { arkitOrientationFromRawValue, cameraPointToWorld, intrinsicsFromARKitDepth, unprojectDetection, updateWorldSpatialTracks, type SpatialTrack } from '../live/spatialTracking';

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
  // Candidate association is one-to-one: two cloud bottle boxes must not
  // inherit the same transient detector ID and collapse into one world track.
  const usedCandidateTrackIds = new Set<number>();
  const spatialPoints = metricDepth && depthFrame && orientation && intrinsics
    ? [...bottles].sort((a, b) => b.confidence - a.confidence).flatMap((bottle, index) => {
        const point = unprojectDetection(
          bottle.box,
          { width: depthFrame.width, height: depthFrame.height, metres: depthFrame.depthMeters, confidence: depthFrame.confidence },
          intrinsics,
        );
        if (!point) return [];
        const world = cameraPointToWorld(point, depthFrame.cameraTransform, orientation);
        if (!world) return [];
        const box = { x: bottle.box.x0, y: bottle.box.y0, width: bottle.box.x1 - bottle.box.x0, height: bottle.box.y1 - bottle.box.y0 };
        let best: { trackId: number; score: number } | null = null;
        for (const candidate of candidates) {
          if (usedCandidateTrackIds.has(candidate.trackId)) continue;
          const left = Math.max(box.x, candidate.x), top = Math.max(box.y, candidate.y);
          const right = Math.min(box.x + box.width, candidate.x + candidate.width);
          const bottom = Math.min(box.y + box.height, candidate.y + candidate.height);
          const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
          const union = box.width * box.height + candidate.width * candidate.height - intersection;
          const overlap = union > 0 ? intersection / union : 0;
          const dx = (box.x + box.width / 2) - (candidate.x + candidate.width / 2);
          const dy = (box.y + box.height / 2) - (candidate.y + candidate.height / 2);
          const distance = Math.hypot(dx, dy);
          const score = overlap >= 0.05 ? overlap : distance <= 0.16 ? 0.05 * (1 - distance / 0.16) : 0;
          if (score > (best?.score ?? 0)) best = { trackId: candidate.trackId, score };
        }
        if (best) usedCandidateTrackIds.add(best.trackId);
        return [{
          key: `${bottle.category}-${index}`,
          trackId: best?.trackId ?? null,
          categoryKey: bottle.category.toLowerCase(),
          identityKey: (bottle.match?.brand || bottle.brand || bottle.product || '').trim().toLowerCase().replace(/\\s+/g, ' '),
          box: bottle.box,
          confidence: bottle.confidence,
          name: bottle.match?.brand || bottle.brand || bottle.product || bottle.category.replace(/_/g, ' '),
          world,
          samples: point.sampleCount,
        }];
      })
    : [];

  const worldTracksRef = React.useRef<SpatialTrack[]>([]);
  const spatialPointMetadataRef = React.useRef(new Map<number, (typeof spatialPoints)[number]>());
  for (const point of spatialPoints) {
    if (point.trackId !== null) spatialPointMetadataRef.current.set(point.trackId, point);
  }
  React.useEffect(() => {
    if (tracking.state !== 'normal') {
      worldTracksRef.current = [];
      return;
    }
    const updates = spatialPoints
      .filter(point => point.trackId !== null)
      .map(point => ({ trackId: point.trackId as number, point: point.world, confidence: 1 }));
    worldTracksRef.current = updateWorldSpatialTracks(worldTracksRef.current, updates, Date.now());
  }, [depthFrame?.timestamp, bottles, candidates, tracking.state]);
  const activeWorldSourceIds = new Set(worldTracksRef.current.map(track => track.sourceTrackId ?? track.trackId));
  for (const sourceTrackId of spatialPointMetadataRef.current.keys()) {
    if (!activeWorldSourceIds.has(sourceTrackId)) spatialPointMetadataRef.current.delete(sourceTrackId);
  }
  const persistentWorldPoints = worldTracksRef.current.flatMap(track => {
    const source = spatialPointMetadataRef.current.get(track.sourceTrackId ?? track.trackId);
    return source ? [{ ...source, world: track.position, velocity: track.velocity, trackAge: Date.now() - track.lastSeenAt }] : [];
  });
  const displayedSpatialPoints = persistentWorldPoints.length ? persistentWorldPoints : spatialPoints;

  return <View style={{ width: '100%', flex: 1, minHeight: 0, justifyContent: 'space-between', paddingBottom: 2 }}>
    <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
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
        <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>WORLD-TRACKED BOTTLE CENTRES</Text>
        <Text style={{ color: spatialPoints.length ? green : amber, fontSize: 11, fontWeight: '900', marginTop: 5 }}>{persistentWorldPoints.length} PERSISTENT · {spatialPoints.length} PROJECTED THIS FRAME</Text>
        {displayedSpatialPoints.slice(0, 4).map(point => (
          <View key={point.key} style={{ marginTop: 7 }}>
            <Text numberOfLines={1} style={{ color: ink, fontSize: 10, fontWeight: '800' }}>{point.name}</Text>
            <Text style={{ color: muted, fontSize: 9, fontVariant: ['tabular-nums'] }}>X {point.world.x.toFixed(2)}m · Y {point.world.y.toFixed(2)}m · Z {point.world.z.toFixed(2)}m · {point.samples} depth samples</Text>
          </View>
        ))}
        <Text style={{ color: muted, fontSize: 9, lineHeight: 14, marginTop: 7 }}>Smoothed world-space centre estimates are associated through temporal 2D track IDs. Large position jumps are rejected. This is not bottle-surface reconstruction, and physical iPhone validation is still required.</Text>
      </View>
      <Text style={{ color: muted, fontSize: 9, lineHeight: 14 }}>World tracking and metric depth are device capabilities, not proof of bottle reconstruction. These projections depend on physical-device coordinate validation.</Text>
    </ScrollView>
    <Pressable onPress={onClose} style={{ padding: 14, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
      <Text style={{ color: ink, fontSize: 11, fontWeight: '800' }}>CLOSE DIAGNOSTICS</Text>
    </Pressable>
  </View>;
}
