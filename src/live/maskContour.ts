export type NormalizedPoint = { x: number; y: number };
export type NormalizedBounds = { x: number; y: number; width: number; height: number };
export type MaskContour = { points: NormalizedPoint[]; area: number; bounds: NormalizedBounds };

type Edge = { ax: number; ay: number; bx: number; by: number; direction: number };

const vertexKey = (x: number, y: number) => `${x},${y}`;

function polygonArea(points: NormalizedPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function simplifyCollinear(points: NormalizedPoint[]): NormalizedPoint[] {
  if (points.length <= 4) return points;
  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const cross = (point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x);
    return Math.abs(cross) > 1e-8;
  });
}

function limitPoints(points: NormalizedPoint[], maximum: number): NormalizedPoint[] {
  if (points.length <= maximum) return points;
  const result: NormalizedPoint[] = [];
  for (let i = 0; i < maximum; i++) {
    result.push(points[Math.floor(i * points.length / maximum)]!);
  }
  return result;
}

/**
 * Converts a binary/thresholded instance mask into its largest external contour.
 * This never guesses a silhouette from a box: every returned point is derived
 * from foreground/background mask boundaries.
 */
export function extractMaskContour(
  mask: Uint8Array | Float32Array,
  width: number,
  height: number,
  options: {
    threshold?: number;
    bounds?: NormalizedBounds;
    maxPoints?: number;
    minimumArea?: number;
  } = {},
): MaskContour | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || mask.length !== width * height) return null;
  const threshold = options.threshold ?? 0.5;
  const bounds = options.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const maxPoints = Math.max(4, Math.floor(options.maxPoints ?? 96));
  const minimumArea = options.minimumArea ?? 0.001;
  const foreground = (x: number, y: number) => Number(mask[y * width + x]) >= threshold;
  const edges: Edge[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!foreground(x, y)) continue;
      if (y === 0 || !foreground(x, y - 1)) edges.push({ ax: x, ay: y, bx: x + 1, by: y, direction: 0 });
      if (x === width - 1 || !foreground(x + 1, y)) edges.push({ ax: x + 1, ay: y, bx: x + 1, by: y + 1, direction: 1 });
      if (y === height - 1 || !foreground(x, y + 1)) edges.push({ ax: x + 1, ay: y + 1, bx: x, by: y + 1, direction: 2 });
      if (x === 0 || !foreground(x - 1, y)) edges.push({ ax: x, ay: y + 1, bx: x, by: y, direction: 3 });
    }
  }
  if (edges.length < 4) return null;

  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = vertexKey(edge.ax, edge.ay);
    const list = outgoing.get(key) ?? [];
    list.push(index);
    outgoing.set(key, list);
  });

  const used = new Uint8Array(edges.length);
  let largest: NormalizedPoint[] = [];
  let largestArea = 0;
  for (let seed = 0; seed < edges.length; seed++) {
    if (used[seed]) continue;
    const first = edges[seed]!;
    const pixelPoints: Array<{ x: number; y: number }> = [{ x: first.ax, y: first.ay }];
    let currentIndex = seed;
    let closed = false;
    for (let step = 0; step <= edges.length; step++) {
      if (used[currentIndex]) break;
      const edge = edges[currentIndex]!;
      used[currentIndex] = 1;
      pixelPoints.push({ x: edge.bx, y: edge.by });
      if (edge.bx === first.ax && edge.by === first.ay) { closed = true; break; }
      const choices = (outgoing.get(vertexKey(edge.bx, edge.by)) ?? []).filter(index => !used[index]);
      if (!choices.length) break;
      // Right-hand boundary walk keeps diagonally touching foreground islands separate.
      const turnPriority = [1, 0, 3, 2];
      const rank = (candidate: Edge) => {
        const turn = (candidate.direction - edge.direction + 4) % 4;
        return turnPriority.indexOf(turn);
      };
      currentIndex = choices.sort((a, b) => rank(edges[a]!) - rank(edges[b]!))[0]!;
    }
    if (!closed || pixelPoints.length < 5) continue;
    const points = simplifyCollinear(pixelPoints.slice(0, -1).map(point => ({
      x: bounds.x + (point.x / width) * bounds.width,
      y: bounds.y + (point.y / height) * bounds.height,
    })));
    if (points.length < 4) continue;
    const area = polygonArea(points);
    if (area > largestArea) { largestArea = area; largest = points; }
  }

  if (largest.length < 4 || largestArea < minimumArea) return null;
  const points = limitPoints(largest, maxPoints);
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    points,
    area: largestArea,
    bounds: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
  };
}
