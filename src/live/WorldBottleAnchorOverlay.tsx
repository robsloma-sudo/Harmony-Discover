import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ARKitDepthFrame } from "./DiscoverARSurface";
import { buildBottleWorldObservations } from "./bottleWorldAnchorBridge";
import { updateWorldSpatialTracks, type SpatialTrack } from "./spatialTracking";
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
  const tracksRef = useRef<SpatialTrack[]>([]);
  const metadataRef = useRef(new Map<number, AnchorMetadata>());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    // A newly started AR session has a new world coordinate frame. Old anchors
    // must not be projected into that unrelated coordinate system.
    tracksRef.current = [];
    metadataRef.current.clear();
    setRevision(value => value + 1);
  }, [sessionKey]);

  useEffect(() => {
    const observations = candidates.flatMap(candidate => {
      const frame = candidate.depthFrame;
      if (!frame || candidate.timestamp === undefined) return [];
      return buildBottleWorldObservations([{
        trackId: candidate.trackId,
        x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height,
        confidence: candidate.confidence, timestamp: candidate.timestamp,
        contour: candidate.contour,
        bottle: candidate.bottle,
      }], frame).observations;
    });
    const now = Date.now();
    tracksRef.current = updateWorldSpatialTracks(
      tracksRef.current,
      observations.map(item => ({
        trackId: item.trackId,
        point: item.worldPoint,
        confidence: item.confidence,
        identityKey: item.visualKey,
        categoryKey: candidates.find(candidate => candidate.trackId === item.trackId)?.bottle?.category,
        box: item.box,
      })),
      now,
      { maxAgeMs: 12000, reassociationMeters: 0.22, maxJumpMeters: 0.45 },
    );
    for (const observation of observations) {
      const track = tracksRef.current.find(item => item.sourceTrackId === observation.trackId || item.trackId === observation.trackId);
      if (!track) continue;
      const candidate = candidates.find(item => item.trackId === observation.trackId);
      const name = [candidate?.bottle?.brand, candidate?.bottle?.product].filter(Boolean).join(" ").trim()
        || candidate?.bottle?.category?.replace(/_/g, " ")
        || "BOTTLE";
      metadataRef.current.set(track.trackId, {
        worldCorners: observation.worldCorners,
        name,
        confidence: observation.confidence,
      });
    }
    const active = new Set(tracksRef.current.map(track => track.trackId));
    for (const id of metadataRef.current.keys()) if (!active.has(id)) metadataRef.current.delete(id);
    setRevision(value => value + 1);
  }, [candidates]);

  useEffect(() => {
    // Age out anchors even when the detector stops returning candidates.
    tracksRef.current = updateWorldSpatialTracks(
      tracksRef.current,
      [],
      Date.now(),
      { maxAgeMs: 12000 },
    );
    const active = new Set(tracksRef.current.map(track => track.trackId));
    for (const id of metadataRef.current.keys()) if (!active.has(id)) metadataRef.current.delete(id);
    setRevision(value => value + 1);
  }, [currentDepthFrame?.timestamp]);

  if (!visible || !currentDepthFrame || currentDepthFrame.unit !== "meters") return null;
  // revision makes the ref-backed anchor state observable without recreating it.
  void revision;
  const anchors = tracksRef.current.flatMap(track => {
    const metadata = metadataRef.current.get(track.trackId);
    if (!metadata) return [];
    const rect = projectWorldRectangle(metadata.worldCorners, currentDepthFrame);
    return rect ? [{ id: track.trackId, rect, ...metadata }] : [];
  });

  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {anchors.map(anchor => (
      <View key={anchor.id} style={[styles.box, {
        left: ((anchor.rect.x * 100) + "%") as `${number}%`,
        top: ((anchor.rect.y * 100) + "%") as `${number}%`,
        width: ((anchor.rect.width * 100) + "%") as `${number}%`,
        height: ((anchor.rect.height * 100) + "%") as `${number}%`,
      }]}>
        <View style={styles.label}>
          <Text numberOfLines={1} style={styles.name}>{anchor.name.toUpperCase()}</Text>
          <Text style={styles.meta}>WORLD ANCHOR · {Math.round(anchor.confidence * 100)}%</Text>
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
