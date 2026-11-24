// Works out which menu lines are on screen so only those get their stories pre-loaded.
import type { MenuLineLink } from '../services/menuExplore/types';

export type LineBox = { y: number; height: number };

/** Ids of lines whose box overlaps the viewport (plus a small margin). `offset` is where the list starts inside the scroll content. */
export function visibleLineIds(boxes: Record<string, LineBox>, scrollY: number, viewportHeight: number, offset = 0, margin = 40): string[] {
  if (!(viewportHeight > 0)) return [];
  const top = scrollY - margin, bottom = scrollY + viewportHeight + margin;
  return Object.keys(boxes).filter(id => {
    const b = boxes[id];
    const y = b.y + offset;
    return y + b.height >= top && y <= bottom;
  });
}

/** Linked lines that are currently on screen. */
export function visibleLinkedLines(links: MenuLineLink[], boxes: Record<string, LineBox>, scrollY: number, viewportHeight: number, offset = 0): MenuLineLink[] {
  const ids = new Set(visibleLineIds(boxes, scrollY, viewportHeight, offset));
  return links.filter(l => l.status === 'linked' && ids.has(l.line_id));
}

