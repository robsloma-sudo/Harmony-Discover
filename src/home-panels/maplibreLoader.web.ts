// Loads MapLibre GL JS (BSD-3-Clause) on demand for the web Atlas, pinned to one version with Subresource Integrity.
// The browser refuses the file if a single byte differs from the hash below, so a compromised CDN cannot inject code.
// Same engine, version and URL as Harmony Atlas (atlas.html loads unpkg.com/maplibre-gl@5.24.0).
export const MAPLIBRE_VERSION = '5.24.0';
const BASE = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist`;
const JS_SRI = 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp';
const CSS_SRI = 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK';

/* Minimal typing of the parts of the MapLibre API the Atlas uses. */
export type LngLat = [number, number];
export interface MlGeoJSONSource { setData(data: unknown): void; getClusterExpansionZoom(id: number): Promise<number> }
export interface MlFeature { properties?: Record<string, unknown>; geometry: { type: string; coordinates?: unknown } }
export interface MlMap {
  addControl(control: unknown, position?: string): void;
  addSource(id: string, source: unknown): void;
  addLayer(layer: unknown): void;
  getSource(id: string): unknown;
  setFilter(layer: string, filter: unknown): void;
  on(event: string, layerOrHandler: unknown, handler?: (e: { features?: MlFeature[]; error?: { message?: string } }) => void): void;
  easeTo(options: Record<string, unknown>): void;
  fitBounds(bounds: unknown, options?: Record<string, unknown>): void;
  getZoom(): number;
  getPitch(): number;
  getLayer(id: string): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): void;
  setStyle(style: unknown): void;
  setProjection(p: unknown): void;
  setSky?(s: unknown): void;
  flyTo(options: Record<string, unknown>): void;
  zoomIn(options?: Record<string, unknown>): void;
  zoomOut(options?: Record<string, unknown>): void;
  getBearing(): number;
  getCanvas(): HTMLCanvasElement;
  isStyleLoaded(): boolean;
  resize(): void;
  remove(): void;
}
export interface MlMarker { setLngLat(p: LngLat): MlMarker; addTo(map: MlMap): MlMarker; remove(): void }
export interface MlLngLatBounds { extend(p: LngLat): MlLngLatBounds }
export interface MapLibre {
  Map: new (options: Record<string, unknown>) => MlMap;
  NavigationControl: new (options?: Record<string, unknown>) => unknown;
  Marker: new (options?: Record<string, unknown>) => MlMarker;
  LngLatBounds: new (sw: LngLat, ne: LngLat) => MlLngLatBounds;
}

let pending: Promise<MapLibre> | null = null;

function addTag<T extends HTMLElement>(tag: T, attrs: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    Object.entries(attrs).forEach(([k, v]) => tag.setAttribute(k, v));
    tag.addEventListener('load', () => resolve(), { once: true });
    tag.addEventListener('error', () => reject(new Error('Map library failed to load.')), { once: true });
    document.head.appendChild(tag);
  });
}

export function loadMapLibre(): Promise<MapLibre> {
  const existing = (globalThis as { maplibregl?: MapLibre }).maplibregl;
  if (existing) return Promise.resolve(existing);
  if (pending) return pending;
  pending = (async () => {
    if (!document.querySelector('link[data-maplibre]')) {
      await addTag(document.createElement('link'), { rel: 'stylesheet', href: `${BASE}/maplibre-gl.css`, integrity: CSS_SRI, crossorigin: 'anonymous', 'data-maplibre': MAPLIBRE_VERSION });
    }
    await addTag(document.createElement('script'), { src: `${BASE}/maplibre-gl.js`, integrity: JS_SRI, crossorigin: 'anonymous', 'data-maplibre': MAPLIBRE_VERSION });
    const lib = (globalThis as { maplibregl?: MapLibre }).maplibregl;
    if (!lib) throw new Error('Map library did not initialise.');
    return lib;
  })();
  pending.catch(() => { pending = null; });
  return pending;
}
