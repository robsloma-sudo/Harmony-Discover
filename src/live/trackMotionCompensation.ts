/**
 * Cloud reads return 2-5 s after the frame was captured. Their boxes describe
 * where bottles were at capture time, not where they are now. These helpers
 * move capture-time geometry into the current view using the displacement of
 * tracks the device followed in the meantime (local detector + optical flow).
 */
export type Box = { x: number; y: number; width: number; height: number };
export type TrackPosition = { trackId: number; box: Box };
export type NormalizedRect = { x0: number; y0: number; x1: number; y1: number };

const MIN_SNAPSHOT_IOU = 0.3;

export function boxIoU(a: Box, b: Box): number {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

const validBox = (b: Box) => [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Map a box relative to `from` onto `to` (translation + scale), clamped to the frame. */
export function transferBox(box: Box, from: Box, to: Box): Box {
  const sx = to.width / from.width, sy = to.height / from.height;
  const x = to.x + (box.x - from.x) * sx, y = to.y + (box.y - from.y) * sy;
  const x1 = clamp01(x + box.width * sx), y1 = clamp01(y + box.height * sy);
  const x0 = clamp01(x), y0 = clamp01(y);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

export type CompensationResult = {
  box: Box;
  method: 'track' | 'global' | 'none';
  /** Track this detection was bound to at capture time, if any. */
  boundTrackId: number | null;
};

/**
 * Move each capture-time detection into the current view.
 * 1. Bind it to the snapshot track it overlapped at capture (IoU >= 0.3) and
 *    follow that track's current box.
 * 2. Otherwise apply the median translation of all tracks seen at both times.
 * 3. Otherwise leave it unchanged (no motion information).
 */
export function compensateDetections(detections: Box[], snapshot: TrackPosition[], current: TrackPosition[]): CompensationResult[] {
  const currentById = new Map(current.filter(t => validBox(t.box)).map(t => [t.trackId, t.box]));
  const pairs = snapshot.filter(t => validBox(t.box) && currentById.has(t.trackId));
  const dx = pairs.map(t => (currentById.get(t.trackId)!.x + currentById.get(t.trackId)!.width / 2) - (t.box.x + t.box.width / 2));
  const dy = pairs.map(t => (currentById.get(t.trackId)!.y + currentById.get(t.trackId)!.height / 2) - (t.box.y + t.box.height / 2));
  const global = pairs.length ? { dx: median(dx), dy: median(dy) } : null;
  const claimed = new Set<number>();

  return detections.map(detection => {
    if (!validBox(detection)) return { box: detection, method: 'none', boundTrackId: null };
    let best: TrackPosition | null = null, bestIoU = MIN_SNAPSHOT_IOU;
    for (const track of pairs) {
      if (claimed.has(track.trackId)) continue;
      const iou = boxIoU(detection, track.box);
      if (iou >= bestIoU) { best = track; bestIoU = iou; }
    }
    if (best) {
      claimed.add(best.trackId);
      return { box: transferBox(detection, best.box, currentById.get(best.trackId)!), method: 'track', boundTrackId: best.trackId };
    }
    if (global) {
      const x0 = clamp01(detection.x + global.dx), y0 = clamp01(detection.y + global.dy);
      const x1 = clamp01(detection.x + detection.width + global.dx), y1 = clamp01(detection.y + detection.height + global.dy);
      return { box: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }, method: 'global', boundTrackId: null };
    }
    return { box: detection, method: 'none', boundTrackId: null };
  });
}

/**
 * A cloud label_box is measured in the capture frame. Keep it in the same
 * relative position on the bottle, then place it on the bottle's current box.
 */
export function projectLabelBox(labelBox: NormalizedRect, captureBottle: NormalizedRect, currentBottle: Box): NormalizedRect | null {
  const from = { x: captureBottle.x0, y: captureBottle.y0, width: captureBottle.x1 - captureBottle.x0, height: captureBottle.y1 - captureBottle.y0 };
  const label = { x: labelBox.x0, y: labelBox.y0, width: labelBox.x1 - labelBox.x0, height: labelBox.y1 - labelBox.y0 };
  if (!validBox(from) || !validBox(label) || !validBox(currentBottle)) return null;
  const moved = transferBox(label, from, currentBottle);
  if (moved.width <= 0 || moved.height <= 0) return null;
  return { x0: moved.x, y0: moved.y, x1: moved.x + moved.width, y1: moved.y + moved.height };
}
