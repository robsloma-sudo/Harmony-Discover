import type { BottleRead } from "../services/discoverLiveApi";

export type BottleReadTrack = {
  trackId: number;
  x: number; y: number; width: number; height: number;
  confidence: number;
  lastSeenAt: number;
  categoryKey: string;
  identityKey: string;
  bottle: BottleRead;
};

const normalize = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const identityOf = (bottle: BottleRead) => normalize([
  bottle.match?.brand || bottle.brand,
  bottle.match?.product || bottle.product,
].filter(Boolean).join(" "));
const categoryOf = (bottle: BottleRead) => normalize(bottle.category);

function overlap(a: BottleReadTrack, b: { x: number; y: number; width: number; height: number }) {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Re-identifies physical bottle instances between cloud-read frames.
 * Product text is supporting evidence; world position and category remain
 * the primary safeguards against swapping two neighbouring bottles.
 */
export function associateBottleReadTracks(
  bottles: BottleRead[],
  previous: BottleReadTrack[],
  now: number,
  nextId: number,
  retentionMs = 7000,
): { tracks: BottleReadTrack[]; nextId: number } {
  const used = new Set<number>();
  const tracks: BottleReadTrack[] = [];
  const ordered = bottles.map((bottle, index) => ({
    bottle, index,
    box: { x: bottle.box.x0, y: bottle.box.y0, width: bottle.box.x1 - bottle.box.x0, height: bottle.box.y1 - bottle.box.y0 },
    categoryKey: categoryOf(bottle),
    identityKey: identityOf(bottle),
  })).filter(item => [item.box.x, item.box.y, item.box.width, item.box.height].every(Number.isFinite)
    && item.box.width > 0 && item.box.height > 0)
    .sort((a, b) => b.bottle.detectionConfidence - a.bottle.detectionConfidence);

  for (const item of ordered) {
    let best: BottleReadTrack | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const prior of previous) {
      if (used.has(prior.trackId) || now - prior.lastSeenAt > retentionMs) continue;
      if (prior.categoryKey && item.categoryKey && prior.categoryKey !== item.categoryKey) continue;
      const iou = overlap(prior, item.box);
      const ax = prior.x + prior.width / 2, ay = prior.y + prior.height / 2;
      const bx = item.box.x + item.box.width / 2, by = item.box.y + item.box.height / 2;
      const distance = Math.hypot(ax - bx, ay - by);
      if (iou < 0.06 && distance > 0.18) continue;
      const exactIdentity = !!prior.identityKey && prior.identityKey === item.identityKey;
      const identityConflict = !!prior.identityKey && !!item.identityKey && prior.identityKey !== item.identityKey;
      const score = iou * 0.62 + Math.max(0, 1 - distance / 0.18) * 0.28
        + (exactIdentity ? 0.14 : 0) - (identityConflict ? 0.10 : 0);
      if (score > bestScore) { bestScore = score; best = prior; }
    }
    const trackId = best?.trackId ?? nextId++;
    if (best) used.add(best.trackId);
    const blend = best ? 0.38 : 1;
    tracks.push({
      trackId,
      x: best ? best.x * (1 - blend) + item.box.x * blend : item.box.x,
      y: best ? best.y * (1 - blend) + item.box.y * blend : item.box.y,
      width: best ? best.width * (1 - blend) + item.box.width * blend : item.box.width,
      height: best ? best.height * (1 - blend) + item.box.height * blend : item.box.height,
      confidence: item.bottle.detectionConfidence,
      lastSeenAt: now,
      categoryKey: item.categoryKey || best?.categoryKey || "",
      identityKey: item.identityKey || best?.identityKey || "",
      bottle: item.bottle,
    });
  }
  for (const prior of previous) {
    if (!used.has(prior.trackId) && !tracks.some(track => track.trackId === prior.trackId) && now - prior.lastSeenAt <= retentionMs) {
      tracks.push(prior);
    }
  }
  return { tracks, nextId };
}
