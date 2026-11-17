/**
 * What an empty candidate list means for world anchors.
 * - reset: the scanner ended the session (camera off, page hidden, recognition off, unmount). Start a new world.
 * - miss: a real metric-depth camera frame found no bottles. The tracker ages its tracks once
 *   (occluded, then lost after its retention), so a single empty read never erases 3D memory.
 * - clear: nothing on screen right now (e.g. a routine web refresh). Hide boxes; anchors keep their own clock.
 */
export function emptyCandidatesAction(event: {
  reset?: boolean;
  source?: "cloud" | "local";
  depthFrame?: { unit?: string; timestamp?: number } | null;
}): "reset" | "miss" | "clear" {
  if (event.reset) return "reset";
  if (event.source !== "local" && event.depthFrame?.unit === "meters" && Number.isFinite(event.depthFrame.timestamp)) return "miss";
  return "clear";
}

export function isEligibleWorldAnchorCandidate(
  source: "cloud" | "local" | undefined,
  candidateTimestamp: number | undefined,
  observationTimestamp: number,
  maximumDeltaSeconds = 0.001,
): boolean {
  return source === "cloud"
    && candidateTimestamp !== undefined
    && Number.isFinite(candidateTimestamp)
    && Number.isFinite(observationTimestamp)
    && Number.isFinite(maximumDeltaSeconds)
    && maximumDeltaSeconds >= 0
    && Math.abs(candidateTimestamp - observationTimestamp) <= maximumDeltaSeconds;
}
