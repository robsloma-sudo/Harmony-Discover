import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ARKitDepthFrame } from "./DiscoverARSurface";
import { buildBottleWorldObservations } from "./bottleWorldAnchorBridge";
import { SpatialBottleTracker, type SpatialTrack } from "./spatialBottleTracker";
import { projectWorldRectangle } from "./worldAnchorProjection";

type Candidate = {
  trackId: number; x: number; y: number; width: number; height: number;
  confidence: number; timestamp?: number; contour?: Array<{x:number;y:number}>;
  bottle?: { brand?: string; product?: string; category?: string };
  depthFrame?: ARKitDepthFrame;
};
type AnchorMetadata = { worldCorners: Array<{x:number;y:number;z:number}>; name: string; confidence: number };
type Props = { candidates: Candidate[]; currentDepthFrame: ARKitDepthFrame | null; sessionKey?: number; visible?: boolean };

export function WorldBottleAnchorOverlay({ candidates, currentDepthFrame, sessionKey = 0, visible = true }: Props) {
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
  const tracksRef = useRef<SpatialTrack[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    trackerRef.current?.reset();
    metadataRef.current.clear();
    tracksRef.current = [];
    setRevision(value => value + 1);
  }, [sessionKey]);

  useEffect(() => {
    const paired = candidates.flatMap(candidate => {
      const frame = candidate.depthFrame;
      if (!frame || candidate.timestamp === undefined) return [];
      const result = buildBottleWorldObservations([{
        trackId: candidate.trackId,
        x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height,
        confidence: candidate.confidence, timestamp: candidate.timestamp,
        contour: candidate.contour,
        bottle: candidate.bottle,
      }], frame);
      return result.observations.map(observation => ({ observation, candidate }));
    });
    const now = Date.now();
    const update = trackerRef.current!.update(paired.map(({ observation }) => ({
      worldPoint: observation.worldPoint,
      confidence: observation.confidence,
      geometryComplete: observation.geometryComplete,
      visualKey: observation.visualKey,
    })), now);

    tracksRef.current = update.tracks;
    paired.forEach(({ observation, candidate }, index) => {
      const physical = update.observed[index];
      if (!physical) return;
      const name = [candidate.bottle?.brand, candidate.bottle?.product].filter(Boolean).join(" ").trim()
        || candidate.bottle?.category?.replace(/_/g, " ")
        || "BOTTLE";
      metadataRef.current.set(physical.physicalObjectId, {
        worldCorners: observation.worldCorners,
        name,
        confidence: observation.confidence,
      });
    });

    const active = new Set(update.tracks.filter(track => track.state !== "lost").map(track => track.physicalObjectId));
    for (const id of metadataRef.current.keys()) if (!active.has(id)) metadataRef.current.delete(id);
    setRevision(value => value + 1);
  }, [candidates]);

  useEffect(() => {
    // Keep occluded bottle identities available while the camera is turned away.
    const update = trackerRef.current?.update([], Date.now());
    tracksRef.current = update?.tracks ?? [];
    const active = new Set(tracksRef.current.filter(track => track.state !== "lost").map(track => track.physicalObjectId));
    for (const id of metadataRef.current.keys()) if (!active.has(id)) metadataRef.current.delete(id);
    setRevision(value => value + 1);
  }, [currentDepthFrame?.timestamp]);

  if (!visible || !currentDepthFrame || currentDepthFrame.unit !== "meters") return null;
  void revision;
  const anchors = tracksRef.current.flatMap(track => {
    if (track.state === "lost") return [];
    const metadata = metadataRef.current.get(track.physicalObjectId);
    if (!metadata) return [];
    const rect = projectWorldRectangle(metadata.worldCorners, currentDepthFrame);
    return rect ? [{ id: track.physicalObjectId, rect, ...metadata, state: track.state }] : [];
  });

  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {anchors.map(anchor => (
      <View key={anchor.id} style={[styles.box, {
        left: ((anchor.rect.x * 100) + "%") as `${number}%`,
        top: ((anchor.rect.y * 100) + "%") as `${number}%`,
        width: ((anchor.rect.width * 100) + "%") as `${number}%`,
        height: ((anchor.rect.height * 100) + "%") as `${number}%`,
        opacity: anchor.state === "occluded" ? 0.45 : 1,
      }]}>
        <View style={styles.label}>
          <Text numberOfLines={1} style={styles.name}>{anchor.name.toUpperCase()}</Text>
          <Text style={styles.meta}>{anchor.state === "occluded" ? "BACKGROUND · REACQUIRABLE" : "FOREGROUND · TRACKED"} · {Math.round(anchor.confidence * 100)}%</Text>
        </View>
      </View>
    ))}
  </View>;
}

const styles = StyleSheet.create({
  box: { position: "absolute", borderWidth: 1.8, borderColor: "#70E6C2", borderRadius: 7, backgroundColor: "rgba(40,210,170,0.035)" },
  label: { position: "absolute", left: -1, top: -27, maxWidth: 210, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: "rgba(4,20,23,0.92)", borderWidth: 1, borderColor: "rgba(112,230,194,0.7)", borderRadius: 5 },
  name: { color: "#B8FFE8", fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  meta: { color: "#70E6C2", fontSize: 7, fontWeight: "800", marginTop: 1 },
});
