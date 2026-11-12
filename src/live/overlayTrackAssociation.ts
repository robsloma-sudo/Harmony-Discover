export type DetectionBox = { x: number; y: number; width: number; height: number };
export type OverlayTrack = DetectionBox & { trackId: number; confidence?: number };

function intersectionOverUnion(a: DetectionBox, b: DetectionBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Assigns smoothed camera-space tracks to the latest recognition detections.
 * A candidate can be used only once, preventing adjacent bottle overlays from
 * accidentally sharing one visual track. Weak matches fall back to raw boxes.
 */
export function matchDetectionsToTracks(
  detections: DetectionBox[],
  candidates: OverlayTrack[],
  minimumIoU = 0.08,
): Array<OverlayTrack | null> {
  const matches: Array<{ detectionIndex: number; candidateIndex: number; score: number }> = [];
  detections.forEach((detection, detectionIndex) => {
    candidates.forEach((candidate, candidateIndex) => {
      const values = [detection.x, detection.y, detection.width, detection.height, candidate.x, candidate.y, candidate.width, candidate.height];
      if (!values.every(Number.isFinite) || detection.width <= 0 || detection.height <= 0 || candidate.width <= 0 || candidate.height <= 0) return;
      const score = intersectionOverUnion(detection, candidate);
      if (score >= minimumIoU) matches.push({ detectionIndex, candidateIndex, score });
    });
  });
  matches.sort((a, b) => b.score - a.score);
  const assignedDetections = new Set<number>();
  const assignedCandidates = new Set<number>();
  const result: Array<OverlayTrack | null> = detections.map(() => null);
  for (const match of matches) {
    if (assignedDetections.has(match.detectionIndex) || assignedCandidates.has(match.candidateIndex)) continue;
    assignedDetections.add(match.detectionIndex);
    assignedCandidates.add(match.candidateIndex);
    result[match.detectionIndex] = candidates[match.candidateIndex];
  }
  return result;
}
