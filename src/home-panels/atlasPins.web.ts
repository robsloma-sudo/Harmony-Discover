// Teardrop map pins (Google-style) with a simple emoji per kind of business. The pin's tip sits exactly on the
// business's coordinate (icon-anchor bottom), so the point is precise at every zoom. Colours are Harmony Atlas's layer
// colours, so on-premise and off-premise read the same way as in Harmony Atlas.
import { ATLAS_LAYERS, type AtlasLayer, type DiscoverVenue } from '../services/phgAtlasRecords';

export type PinKind = 'bar' | 'restaurant' | 'store' | 'brewery' | 'winery' | 'distillery';

/** Kept deliberately simple: one emoji per kind. Off premise = 🏪 shop; on premise = 🍸 bar / 🍽️ restaurant. */
export const PIN_EMOJI: Record<PinKind, string> = {
  bar: '🍸', restaurant: '🍽️', store: '🏪', brewery: '🍺', winery: '🍷', distillery: '🥃',
};
export const PIN_LABEL: Record<PinKind, string> = {
  bar: 'On premise · bar', restaurant: 'On premise · restaurant', store: 'Off premise · liquor store',
  brewery: 'Brewery', winery: 'Winery', distillery: 'Distillery',
};
const KIND_LAYER: Record<PinKind, AtlasLayer> = { bar: 'venues', restaurant: 'venues', store: 'stores', brewery: 'breweries', winery: 'wineries', distillery: 'distill' };

export function pinKind(v: Pick<DiscoverVenue, 'atlas_layer' | 'venue_type'>): PinKind {
  if (v.atlas_layer === 'stores' || v.venue_type === 'liquor_store') return 'store';
  if (v.atlas_layer === 'breweries' || v.venue_type === 'brewery') return 'brewery';
  if (v.atlas_layer === 'wineries' || v.venue_type === 'winery') return 'winery';
  if (v.atlas_layer === 'distill' || v.venue_type === 'distillery') return 'distillery';
  return v.venue_type === 'restaurant' ? 'restaurant' : 'bar';
}
export const pinImageId = (kind: PinKind) => `discover-pin-${kind}`;

/** Draw one pin: coloured teardrop, white disc, emoji. Returned at 2x for sharp screens. */
function drawPin(kind: PinKind, ratio = 2) {
  const w = 40, h = 52, W = w * ratio, H = h * ratio;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.scale(ratio, ratio);
  const cx = w / 2, cy = 19, r = 17;
  c.beginPath();                                   // teardrop: circle on top, point at the bottom centre
  c.moveTo(cx, h - 1.5);
  c.bezierCurveTo(cx - 5, h - 15, cx - r, cy + 11, cx - r, cy);
  c.arc(cx, cy, r, Math.PI, 0, false);
  c.bezierCurveTo(cx + r, cy + 11, cx + 5, h - 15, cx, h - 1.5);
  c.closePath();
  c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 3; c.shadowOffsetY = 1.5;
  c.fillStyle = ATLAS_LAYERS[KIND_LAYER[kind]].color; c.fill();
  c.shadowColor = 'transparent';
  c.lineWidth = 1.6; c.strokeStyle = 'rgba(5,7,13,0.85)'; c.stroke();
  c.beginPath(); c.arc(cx, cy, 12.5, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
  c.font = '15px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(PIN_EMOJI[kind], cx, cy + 1);
  return { width: W, height: H, data: new Uint8Array(c.getImageData(0, 0, W, H).data.buffer) };
}

/** Register every pin image on the map (call after each style load). */
export function addPinImages(map: { hasImage(id: string): boolean; addImage(id: string, img: unknown, opts?: unknown): void }) {
  for (const kind of Object.keys(PIN_EMOJI) as PinKind[]) {
    const id = pinImageId(kind);
    if (!map.hasImage(id)) map.addImage(id, drawPin(kind), { pixelRatio: 2 });
  }
}

/** Small at city zoom, large up close (icon-size, 1 = 40x52 px). */
const PIN_STOPS: Array<[number, number]> = [[9, 0.38], [12, 0.55], [15, 0.8], [17, 1.05], [19, 1.35]];
/** Zoom must be the outermost expression in MapLibre, so the selected-pin size is its own curve. */
export const pinSize = (scale = 1) => ['interpolate', ['linear'], ['zoom'], ...PIN_STOPS.flatMap(([z, v]) => [z, +(v * scale).toFixed(3)])];
export const PIN_SIZE = pinSize(1);
