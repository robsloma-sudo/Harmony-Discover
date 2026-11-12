import type { WorldPoint } from './spatialBottleProjection';

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
  observed: SpatialTrack[];
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

/**
 * Associates detections to physical objects in metric world space.
 * IDs represent physical instances, never product/catalog SKUs.
 */
export class SpatialBottleTracker {
  private tracks: SpatialTrack[] = [];
  private nextId = 1;
  private readonly options: Required<SpatialTrackerOptions>;

  constructor(options: SpatialTrackerOptions = {}) {
    this.options = {
      confirmationHits: options.confirmationHits ?? 2,
      maxAssociationDistanceMeters: options.maxAssociationDistanceMeters ?? 0.38,
      occlusionGraceMs: options.occlusionGraceMs ?? 2500,
      lostRetentionMs: options.lostRetentionMs ?? 12000,
      minimumConfidence: options.minimumConfidence ?? 0.65,
    };
  }

  update(observations: SpatialObservation[], now: number): SpatialTrackUpdate {
    const used = new Set<string>();
    const observed: SpatialTrack[] = [];

    for (const observation of observations) {
      let match: SpatialTrack | undefined;
      let bestDistance = this.options.maxAssociationDistanceMeters;
      if (observation.worldPoint) {
        for (const candidate of this.tracks) {
          if (used.has(candidate.physicalObjectId) || !candidate.worldPoint || candidate.state === 'lost') continue;
          if (candidate.visualKey && observation.visualKey && candidate.visualKey !== observation.visualKey) continue;
          const d = distance(candidate.worldPoint, observation.worldPoint);
          if (d < bestDistance) { bestDistance = d; match = candidate; }
        }
      }

      const sufficientlyStrong = !!observation.worldPoint &&
        observation.confidence >= this.options.minimumConfidence;
      const reason = observation.reason ??
        (!observation.worldPoint ? 'insufficient_depth' :
          !observation.geometryComplete ? 'incomplete_geometry' :
            !sufficientlyStrong ? 'low_confidence' : undefined);

      if (!match) {
        match = {
          physicalObjectId: `physical-${this.nextId++}`,
          state: 'potential',
          worldPoint: observation.worldPoint ?? null,
          confidence: observation.confidence,
          consecutiveHits: sufficientlyStrong && observation.geometryComplete ? 1 : 0,
          lastSeenAt: now,
          missedFrames: 0,
          reason,
          visualKey: observation.visualKey,
        };
        this.tracks.push(match);
      } else {
        used.add(match.physicalObjectId);
        match.worldPoint = observation.worldPoint ?? match.worldPoint;
        match.confidence = observation.confidence;
        match.lastSeenAt = now;
        match.missedFrames = 0;
        match.visualKey = observation.visualKey ?? match.visualKey;
        match.consecutiveHits = sufficientlyStrong && observation.geometryComplete
          ? match.consecutiveHits + 1 : 0;
        match.reason = reason;
        match.state = match.consecutiveHits >= this.options.confirmationHits
          ? 'confirmed' : 'potential';
      }
      used.add(match.physicalObjectId);
      observed.push({ ...match });
    }

    this.tracks = this.tracks.flatMap(track => {
      if (used.has(track.physicalObjectId)) return [track];
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
      return [track];
    });

    return { tracks: this.tracks.map(track => ({ ...track })), observed };
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }
}
