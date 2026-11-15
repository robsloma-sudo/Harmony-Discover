// Green box layout (Rob, 15 Nov 2026):
// 1. A box outlines the bottle's LABEL, not the whole bottle (less clutter, more space).
// 2. Boxes never overlap. When one bottle stands in front of another, only the front box is shown
//    (the biggest box is treated as the nearest bottle).
// 3. When side-by-side boxes touch or overlap a little, both are trimmed back at the shared edge with a
//    small gap, so their edges never touch.
export type LayoutBox = { trackId: number; x: number; y: number; width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

// Where the label usually sits on a bottle box (fractions of the bottle's width / height).
const LABEL_TOP = 0.4, LABEL_BOTTOM = 0.86, LABEL_SIDE = 0.1;
// Overlap (share of the smaller box) above which the back box is hidden instead of trimmed.
const HIDE_BEHIND = 0.35;
// Gap kept between neighbouring boxes (fraction of the screen).
const GAP = 0.008;
const MIN_W = 0.03, MIN_H = 0.04;

export function labelRect(b: Rect): Rect {
  // A bottle cut off by the bottom of the view shows its label in the lower half of what is visible.
  const cut = b.y + b.height >= 0.97;
  const top = cut ? 0.5 : LABEL_TOP, bottom = cut ? 0.99 : LABEL_BOTTOM;
  return {
    x: b.x + b.width * LABEL_SIDE,
    y: b.y + b.height * top,
    width: Math.max(MIN_W, b.width * (1 - 2 * LABEL_SIDE)),
    height: Math.max(MIN_H, b.height * (bottom - top)),
  };
}

const area = (r: Rect) => r.width * r.height;
function intersection(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { w, h };
}

/** Screen rectangle for each box, or null when it is hidden behind a bottle in front of it. */
export function layoutBoxes(boxes: LayoutBox[]): Map<number, Rect | null> {
  const out = new Map<number, Rect | null>();
  const order = boxes.map((b) => ({ id: b.trackId, rect: labelRect(b) }))
    .sort((a, b) => area(b.rect) - area(a.rect));        // nearest (biggest) first
  const kept: Array<{ id: number; rect: Rect }> = [];
  for (const item of order) {
    let r = { ...item.rect };
    let hidden = false;
    for (const front of kept) {
      const f = front.rect;
      const { w, h } = intersection(r, f);
      if (w <= -GAP || h <= -GAP) continue;               // clear of each other, gap included
      const shared = Math.max(0, w) * Math.max(0, h);
      if (shared / Math.min(area(r), area(f)) >= HIDE_BEHIND) { hidden = true; break; }
      // Side by side (or stacked): pull this box back from the front box's edge, keeping a gap.
      const rCx = r.x + r.width / 2, fCx = f.x + f.width / 2, rCy = r.y + r.height / 2, fCy = f.y + f.height / 2;
      if (Math.abs(rCx - fCx) / (r.width + f.width) >= Math.abs(rCy - fCy) / (r.height + f.height)) {
        if (rCx >= fCx) { const edge = f.x + f.width + GAP; r = { ...r, width: r.x + r.width - edge, x: edge }; }
        else { r = { ...r, width: f.x - GAP - r.x }; }
      } else {
        if (rCy >= fCy) { const edge = f.y + f.height + GAP; r = { ...r, height: r.y + r.height - edge, y: edge }; }
        else { r = { ...r, height: f.y - GAP - r.y }; }
      }
      if (r.width < MIN_W || r.height < MIN_H) { hidden = true; break; }
    }
    if (hidden) { out.set(item.id, null); continue; }
    kept.push({ id: item.id, rect: r });
    out.set(item.id, r);
  }
  return out;
}
