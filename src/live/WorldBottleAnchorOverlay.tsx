import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BottleRead } from "../services/discoverLiveApi";
import type { ARKitDepthFrame, ARKitCameraPose } from "./DiscoverARSurface";
import { buildBottleWorldObservations } from "./bottleWorldAnchorBridge";
import { SpatialBottleTracker, type SpatialTrack } from "./spatialBottleTracker";
import { projectWorldRectangle } from "./worldAnchorProjection";
import { PhysicalBottleIdentityRegistry } from "./physicalBottleIdentity";
import { WorldAnchorObservationGate } from "./worldAnchorObservationGate";
import { isEligibleWorldAnchorCandidate } from "./worldAnchorFramePolicy";

type Candidate = {
  trackId: number; x: number; y: number; width: number; height: number;
  confidence: number; timestamp?: number; source?: 'cloud' | 'local'; contour?: Array<{x:number;y:number}>;
  bottle?: BottleRead;
  depthFrame?: ARKitDepthFrame;
};
type AnchorMetadata = { worldCorners: Array<{x:number;y:number;z:number}>; name: string; confidence: number; verified: boolean; candidate: Candidate };
export type WorldBottleCandidate = Candidate;
type Props = { candidates: Candidate[]; currentDepthFrame: ARKitDepthFrame | null; observationFrame?: ARKitDepthFrame | null; currentCameraPose?: ARKitCameraPose | null; sessionKey?: number; visible?: boolean; onSelectBottle?: (candidate: WorldBottleCandidate) => void };

export function WorldBottleAnchorOverlay({ candidates, currentDepthFrame, observationFrame, currentCameraPose, sessionKey = 0, visible = true, onSelectBottle }: Props) {
  // One registry owns the physical bottle ID through visible, occluded and
  // reacquired states. It is deliberately reset when ARKit changes world space.
  const trackerRef = useRef<SpatialBottleTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new SpatialBottleTracker({
    confirmationHits: 2,
    maxAssociationDistanceMeters: 0.22,
    occlusionGraceMs: 3000,
    lostRetentionMs: 30000,
    minimumConfidence: 0.65,
  });
  const metadataRef = useRef(new Map<string, AnchorMetadata>());
  const identityRegistryRef = useRef(new PhysicalBottleIdentityRegistry(0.85, 0.9));
  const tracksRef = useRef<SpatialTrack[]>([]);
  const observationGateRef = useRef(new WorldAnchorObservationGate(512));
  const lastProcessedFrameTimestampRef = useRef(Number.NEGATIVE_INFINITY);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    trackerRef.current?.reset();
    metadataRef.current.clear();
    identityRegistryRef.current.clear();
    tracksRef.current = [];
    observationGateRef.current.reset();
    lastProcessedFrameTimestampRef.current = Number.NEGATIVE_INFINITY;
    setRevision(value => value + 1);
  }, [sessionKey]);

  useEffect(() => {
    if (!observationFrame || observationFrame.unit !== "meters"
      || !Number.isFinite(observationFrame.timestamp)) return;
    const isNewObservationFrame = observationFrame.timestamp > lastProcessedFrameTimestampRef.current;
    if (isNewObservationFrame) lastProcessedFrameTimestampRef.current = observationFrame.timestamp;
    const paired = candidates.flatMap(candidate => {
      if (!isEligibleWorldAnchorCandidate(candidate.source, candidate.timestamp, observationFrame.timestamp)) return [];
      const result = buildBottleWorldObservations([{
        trackId: candidate.trackId,
        x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height,
        confidence: candidate.confidence, timestamp: candidate.timestamp,
        contour: candidate.contour,
        bottle: candidate.bottle,
      }], observationFrame);
      return result.observations.map(observation => ({
        observation,
        candidate,
        key: observationGateRef.current.key(candidate.trackId, candidate.timestamp!)!,
      }));
    });
    const now = observationFrame.timestamp * 1000;
    const upsertMetadata = (
      physicalObjectId: string,
      observation: (typeof paired)[number]["observation"],
      candidate: Candidate,
    ) => {
      const bottle = candidate.bottle;
      if (bottle?.state === "matched" && bottle.match?.id && bottle.brand && bottle.product) {
        identityRegistryRef.current.lock(physicalObjectId, {
          catalogId: bottle.match.id,
          brand: bottle.match.brand || bottle.brand,
          product: bottle.match.product || bottle.product,
          confidence: bottle.confidence ?? 0,
          matchScore: bottle.match.score,
          matched: true,
        }, now);
      }
      const lockedIdentity = identityRegistryRef.current.get(physicalObjectId);
      const observedName = [bottle?.brand, bottle?.product].filter(Boolean).join(" ").trim()
        || bottle?.category?.replace(/_/g, " ");
      const name = lockedIdentity
        ? [lockedIdentity.brand, lockedIdentity.product].filter(Boolean).join(" ")
        : observedName || "BOTTLE";
      const previousMetadata = metadataRef.current.get(physicalObjectId);
      metadataRef.current.set(physicalObjectId, {
        worldCorners: observation.worldCorners,
        name: lockedIdentity?.brand && lockedIdentity.product ? name : (observedName || previousMetadata?.name || "BOTTLE"),
        confidence: Math.max(observation.confidence, lockedIdentity?.confidence ?? 0),
        verified: !!lockedIdentity,
        candidate,
      });
    };

    // A depth-frame state update can re-render this component many times while
    // the same cloud detection is still in memory. Count each source-frame
    // observation exactly once or a single read can falsely satisfy the
    // tracker's two-frame confirmation threshold.
    const fresh = isNewObservationFrame
      ? paired.filter(item => observationGateRef.current.claim(item.key))
      : [];
    for (const item of paired) {
      if (!fresh.includes(item)) {
        const physicalId = observationGateRef.current.getPhysicalId(item.key);
        if (physicalId) upsertMetadata(physicalId, item.observation, item.candidate);
      }
    }

    if (fresh.length || (isNewObservationFrame && paired.length === 0)) {
      // A unique cloud frame with no usable detections is a real miss and ages
      // tracks once. Duplicate callbacks may refresh metadata, but never count
      // another hit or miss toward the physical track.
      const update = trackerRef.current!.update(fresh.map(({ observation }) => ({
        worldPoint: observation.worldPoint,
        confidence: observation.confidence,
        geometryComplete: observation.geometryComplete,
        visualKey: observation.visualKey,
      })), now);

      tracksRef.current = update.tracks;
      fresh.forEach(({ observation, candidate, key }, index) => {
        const physical = update.observed[index];
        if (!physical) return;
        observationGateRef.current.bind(key, physical.physicalObjectId);
        upsertMetadata(physical.physicalObjectId, observation, candidate);
      });

      const active = new Set(update.tracks.filter(track => track.state !== "lost").map(track => track.physicalObjectId));
      for (const id of metadataRef.current.keys()) if (!active.has(id)) metadataRef.current.delete(id);
      observationGateRef.current.retainActive(active);
    }

    setRevision(value => value + 1);
  }, [candidates, observationFrame?.timestamp, sessionKey]);

  const projectionFrame = currentCameraPose ?? currentDepthFrame;
  if (!visible || !projectionFrame || (!currentCameraPose && currentDepthFrame?.unit !== "meters")) return null;
  void revision;
  const anchors = tracksRef.current.flatMap(track => {
    if (track.state === "lost") return [];
    const metadata = metadataRef.current.get(track.physicalObjectId);
    if (!metadata) return [];
    const rect = projectWorldRectangle(metadata.worldCorners, projectionFrame);
    return rect ? [{ id: track.physicalObjectId, rect, ...metadata, state: track.state }] : [];
  });

  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {anchors.map(anchor => (
      <Pressable
        key={anchor.id}
        accessibilityRole="button"
        accessibilityLabel={`Open tracked bottle profile for ${anchor.name}`}
        onPress={() => onSelectBottle?.(anchor.candidate)}
        style={[styles.box, {
          left: ((anchor.rect.x * 100) + "%") as `${number}%`,
          top: ((anchor.rect.y * 100) + "%") as `${number}%`,
          width: ((anchor.rect.width * 100) + "%") as `${number}%`,
          height: ((anchor.rect.height * 100) + "%") as `${number}%`,
          opacity: anchor.state === "occluded" ? 0.45 : 1,
        }]}
      >
        <View pointerEvents="none" style={styles.label}>
          <Text numberOfLines={1} style={styles.name}>{anchor.name.toUpperCase()}</Text>
          <Text style={styles.meta}>{anchor.verified ? "IDENTITY LOCKED" : "IDENTITY PENDING"} · {anchor.state === "occluded" ? "BACKGROUND · REACQUIRABLE" : anchor.state === "confirmed" ? "WORLD ANCHORED" : "PROVISIONAL · DEPTH ESTIMATE"} · {Math.round(anchor.confidence * 100)}%</Text>
        </View>
      </Pressable>
    ))}
  </View>;
}

const styles = StyleSheet.create({
  box: { position: "absolute", borderWidth: 1.8, borderColor: "#70E6C2", borderRadius: 7, backgroundColor: "rgba(40,210,170,0.035)" },
  label: { position: "absolute", left: -1, top: -27, maxWidth: 210, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: "rgba(4,20,23,0.92)", borderWidth: 1, borderColor: "rgba(112,230,194,0.7)", borderRadius: 5 },
  name: { color: "#B8FFE8", fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  meta: { color: "#70E6C2", fontSize: 7, fontWeight: "800", marginTop: 1 },
});
