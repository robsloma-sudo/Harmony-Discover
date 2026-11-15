// When green boxes overlap, line weight shows which bottle is in front (Rob, 15 Nov 2026):
// front = 1.5x the normal line, next = normal, further back = half. The biggest box in an
// overlapping group is treated as the nearest bottle. Boxes that overlap nothing keep the normal line.
export type DepthBox = { trackId: number; x: number; y: number; width: number; height: number };
export type DepthTier = { weight: number; opacity: number };

const NORMAL: DepthTier = { weight: 1, opacity: 1 };

function overlaps(a: DepthBox, b: DepthBox) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return false;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 && (w * h) / smaller >= 0.15;
}

export function boxDepthTiers(boxes: DepthBox[]): Map<number, DepthTier> {
  const out = new Map<number, DepthTier>();
  const seen = new Set<number>();
  for (let i = 0; i < boxes.length; i++) {
    if (seen.has(i)) continue;
    // Group every box connected to this one by overlap.
    const group: number[] = [];
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const k = stack.pop()!;
      group.push(k);
      for (let j = 0; j < boxes.length; j++) {
        if (!seen.has(j) && overlaps(boxes[k], boxes[j])) { seen.add(j); stack.push(j); }
      }
    }
    if (group.length === 1) { out.set(boxes[i].trackId, NORMAL); continue; }
    group.sort((a, b) => boxes[b].width * boxes[b].height - boxes[a].width * boxes[a].height);
    group.forEach((k, rank) => {
      out.set(boxes[k].trackId, rank === 0 ? { weight: 1.5, opacity: 1 } : rank === 1 ? NORMAL : { weight: 0.5, opacity: 0.7 });
    });
  }
  return out;
}
