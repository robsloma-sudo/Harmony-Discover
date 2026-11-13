export type WorldPoint = { x: number; y: number; z: number };

export type SpatialTrackState = 'confirmed' | 'potential' | 'occluded' | 'lost';
export type SpatialObservation = {
  worldPoint?: WorldPoint;
  confidence: number;
  geometryComplete: boolean;
  visualKey?: string;
  reason?: 'partial_occlusion' | 'low_confidence' | 'incomplete_geometry' | 'insufficient_depth';
};
export type SpatialTrack = {
  physicalObjectId: string;
  state: SpatialTrackState;
  worldPoint: WorldPoint | null;
  confidence: number;
  consecutiveHits: number;
  lastSeenAt: number;
  missedFrames: number;
  reason?: SpatialObservation['reason'];
  visualKey?: string;
};
export type SpatialTrackUpdate = {
  tracks: SpatialTrack[];
  /** Same order and length as input observations; null means no defensible 3D location. */
  observed: Array<SpatialTrack | null>;
};

export type SpatialTrackerOptions = {
  confirmationHits?: number;
  maxAssociationDistanceMeters?: number;
  occlusionGraceMs?: number;
  lostRetentionMs?: number;
  minimumConfidence?: number;
};

const distance = (a: WorldPoint, b: WorldPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Associates detections to physical objects in metric world space. IDs represent physical instances, not SKUs. */
export class SpatialBottleTracker {
  private tracks: SpatialTrack[] = [];
  private nextId = 1;
  private lastUpdateAt = Number.NEGATIVE_INFINITY;
  private readonly options: Required<SpatialTrackerOptions>;

  constructor(options: SpatialTrackerOptions = {}) {
    this.options = {
      confirmationHits: options.confirmationHits ?? 2,
      maxAssociationDistanceMeters: options.maxAssociationDistanceMeters ?? 0.22,
      occlusionGraceMs: options.occlusionGraceMs ?? 2500,
      lostRetentionMs: options.lostRetentionMs ?? 12000,
      minimumConfidence: options.minimumConfidence ?? 0.65,
    };
  }

  update(observations: SpatialObservation[], now: number): SpatialTrackUpdate {
    if (!Number.isFinite(now) || now <= this.lastUpdateAt) {
      return { tracks: this.tracks.map(track => ({ ...track })), observed: observations.map(() => null) };
    }
    this.lastUpdateAt = now;
    const observed: Array<SpatialTrack | null> = observations.map(() => null);
    const usedTracks = new Set<string>();
    const valid = observations.map((observation, index) => ({ observation, index }))
      .filter(({ observation }) => !!observation.worldPoint
        && [observation.worldPoint!.x, observation.worldPoint!.y, observation.worldPoint!.z, observation.confidence].every(Number.isFinite));

    // Build all plausible one-to-one matches first. Greedy assignment by the
    // globally shortest distances avoids input-order-dependent ID swaps when
    // two neighboring bottles are detected in the same frame.
    const edges: Array<{ observationIndex: number; trackId: string; distance: number }> = [];
    for (const { observation, index } of valid) {
      for (const track of this.tracks) {
        if (!track.worldPoint || track.state === 'lost' || now - track.lastSeenAt > this.options.lostRetentionMs) continue;
        if (track.visualKey && observation.visualKey && track.visualKey !== observation.visualKey) continue;
        const d = distance(track.worldPoint, observation.worldPoint!);
        if (d <= this.options.maxAssociationDistanceMeters) {
          edges.push({ observationIndex: index, trackId: track.physicalObjectId, distance: d });
        }
      }
    }
    edges.sort((a, b) => a.distance - b.distance);
    const matchByObservation = new Map<number, SpatialTrack>();
    for (const edge of edges) {
      if (matchByObservation.has(edge.observationIndex) || usedTracks.has(edge.trackId)) continue;
      const track = this.tracks.find(item => item.physicalObjectId === edge.trackId);
      if (!track) continue;
      matchByObservation.set(edge.observationIndex, track);
      usedTracks.add(edge.trackId);
    }

    observations.forEach((observation, index) => {
      const point = observation.worldPoint;
      if (!point || ![point.x, point.y, point.z, observation.confidence].every(Number.isFinite)) return;
      const sufficientlyStrong = observation.confidence >= this.options.minimumConfidence;
      const reason = observation.reason ??
        (!observation.geometryComplete ? 'incomplete_geometry' :
          !sufficientlyStrong ? 'low_confidence' : undefined);
      let track = matchByObservation.get(index);
      if (!track) {
        track = {
          physicalObjectId: `physical-${this.nextId++}`,
          state: 'potential',
          worldPoint: { ...point },
          confidence: observation.confidence,
          consecutiveHits: sufficientlyStrong && observation.geometryComplete ? 1 : 0,
          lastSeenAt: now,
          missedFrames: 0,
          reason,
          visualKey: observation.visualKey,
        };
        this.tracks.push(track);
        usedTracks.add(track.physicalObjectId);
      } else {
        track.worldPoint = { ...point };
        track.confidence = observation.confidence;
        track.lastSeenAt = now;
        track.missedFrames = 0;
        track.visualKey = observation.visualKey ?? track.visualKey;
        track.consecutiveHits = sufficientlyStrong && observation.geometryComplete
          ? track.consecutiveHits + 1 : 0;
        track.reason = reason;
        track.state = track.consecutiveHits >= this.options.confirmationHits ? 'confirmed' : 'potential';
      }
      observed[index] = { ...track };
    });

    this.tracks = this.tracks.flatMap(track => {
      if (usedTracks.has(track.physicalObjectId)) return [track];
      const age = now - track.lastSeenAt;
      track.missedFrames += 1;
      if (age <= this.options.occlusionGraceMs) {
        track.state = 'occluded';
        track.reason = 'partial_occlusion';
        return [track];
      }
      if (age <= this.options.lostRetentionMs) {
        if (track.state !== 'potential') track.state = 'occluded';
        return [track];
      }
      track.state = 'lost';
      return [];
    });

    return { tracks: this.tracks.map(track => ({ ...track })), observed };
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
    this.lastUpdateAt = Number.NEGATIVE_INFINITY;
  }
}
