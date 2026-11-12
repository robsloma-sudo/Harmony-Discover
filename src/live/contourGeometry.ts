export type NormalizedPoint = { x: number; y: number };
export type ContourSegment = { left: number; top: number; length: number; angle: number };

/** Convert a normalized closed polygon to positioned line segments in pixels. */
export function contourSegments(points: NormalizedPoint[], viewportWidth: number, viewportHeight: number): ContourSegment[] {
  if (points.length < 3 || viewportWidth <= 0 || viewportHeight <= 0) return [];
  const result: ContourSegment[] = [];
  for (let index = 0; index < points.length; index++) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const x1 = start.x * viewportWidth;
    const y1 = start.y * viewportHeight;
    const x2 = end.x * viewportWidth;
    const y2 = end.y * viewportHeight;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    result.push({
      left: (x1 + x2) / 2 - length / 2,
      top: (y1 + y2) / 2,
      length,
      angle: Math.atan2(dy, dx),
    });
  }
  return result;
}
