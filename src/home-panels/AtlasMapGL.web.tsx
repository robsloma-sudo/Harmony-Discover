// Discover's Atlas = a mirror of Harmony Atlas (atlas.html) on the web build:
//  * same engine and version: MapLibre GL JS 5.24.0 from the same unpkg URL (SRI-pinned here);
//  * same basemap as Harmony Atlas opens with (Satellite, copied verbatim in atlasBasemaps.web.ts), same globe and sky;
//  * same data: PHG phg_atlas_points / phg_atlas_clusters through the public door (same SQL core), same six layers,
//    same colours, cluster bubbles below zoom 9 and real points from zoom 9 (Harmony's ATZ), same 3D tilt
//    (pitch 58, bearing -18) and the same fly-to on select.
// Only Discover's own Atlas controls are shown (zoom, recenter, 3D); Harmony's staff tools are not brought over.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { loadMapLibre, type MapLibre, type MlGeoJSONSource, type MlMap, type MlMarker } from './maplibreLoader.web';
import { ATLAS_DEFAULT_BASEMAP, buildAtlasStyle } from './atlasBasemaps.web';
import type { AtlasMapGLProps } from './AtlasMapGL.types';
import { ATLAS_LAYERS, ATLAS_LAYER_ORDER, ATLAS_POINT_ZOOM, atlasRowToVenue, type AtlasLayer, type DiscoverVenue } from '../services/phgAtlasRecords';
import { fetchAtlasClusters, fetchAtlasPoints } from '../services/discoverVenueApi';
import { addPinImages, pinImageId, pinKind, pinSize, PIN_SIZE } from './atlasPins.web';

const US_CENTER: [number, number] = [-97, 38.6];
const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features });

/** Harmony Atlas gridBox(): snap the padded view to the cluster grid so bubbles do not jump. */
function gridBox(map: MlMap & { getBounds(): { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number } }) {
  const b = map.getBounds(), pw = (b.getEast() - b.getWest()) * .1, ph = (b.getNorth() - b.getSouth()) * .1;
  const z = Math.max(0, Math.min(14, Math.round(map.getZoom()))), c = 360 / Math.pow(2, z) / 5;
  return { z, minLng: Math.max(-180, Math.floor((b.getWest() - pw) / c) * c), minLat: Math.max(-85, Math.floor((b.getSouth() - ph) / c) * c),
    maxLng: Math.min(180, Math.ceil((b.getEast() + pw) / c) * c), maxLat: Math.min(85, Math.ceil((b.getNorth() + ph) / c) * c) };
}

export function AtlasMapGL({ center, venues, onSelectVenue, height = 360, fullScreen = false, selectedId, fitKey, layers, onViewportVenues, onPickPoint }: AtlasMapGLProps) {
  const viewport = !!layers; // full Atlas mode: the map loads Harmony Atlas data for whatever is on screen
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<(MlMap & Record<string, any>) | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const userMarkerRef = useRef<MlMarker | null>(null);
  const venuesById = useRef(new Map<string, DiscoverVenue>());
  const onSelectRef = useRef(onSelectVenue); onSelectRef.current = onSelectVenue;
  const onViewportRef = useRef(onViewportVenues); onViewportRef.current = onViewportVenues;
  const onPickPointRef = useRef(onPickPoint); onPickPointRef.current = onPickPoint;
  const layersRef = useRef(layers); layersRef.current = layers;
  const centerRef = useRef(center); centerRef.current = center;
  const reqRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState('');
  const [is3D, setIs3D] = useState(false);
  const is3DRef = useRef(false); is3DRef.current = is3D;
  const [status, setStatus] = useState('');

  const addDataLayers = (map: MlMap) => {
    if (map.getSource('atlas-pts')) return;
    map.addSource('atlas-pts', { type: 'geojson', data: fc([]) });
    map.addSource('atlas-cells', { type: 'geojson', data: fc([]) });
    map.addSource('atlas-sel', { type: 'geojson', data: fc([]) });
    const color = ['match', ['get', 'layer'], ...ATLAS_LAYER_ORDER.flatMap(l => [l, ATLAS_LAYERS[l].color]), '#22d3ee'];
    map.addLayer({ id: 'atlas-cells', type: 'circle', source: 'atlas-cells', paint: {
      'circle-color': color, 'circle-opacity': .78, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1,
      'circle-radius': ['min', 34, ['+', 7, ['*', 2.2, ['sqrt', ['get', 'n']]]]], 'circle-pitch-alignment': 'map' } });
    map.addLayer({ id: 'atlas-cells-n', type: 'symbol', source: 'atlas-cells', layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
      paint: { 'text-color': '#05070d' } });
    // Teardrop pins: the tip is the business's exact coordinate; emoji = kind of business; grow as you zoom in.
    addPinImages(map as never);
    map.addLayer({ id: 'atlas-pts', type: 'symbol', source: 'atlas-pts', layout: {
      'icon-image': ['get', 'pin'], 'icon-anchor': 'bottom', 'icon-size': PIN_SIZE,
      'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport',
      'symbol-sort-key': ['-', 0, ['get', 'lat']] } });
    map.addLayer({ id: 'atlas-pts-label', type: 'symbol', source: 'atlas-pts', minzoom: 15, layout: {
      'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 0.35], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'],
      'text-optional': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.3 } });
    // Selected place: the same pin, a size larger, drawn on top.
    map.addLayer({ id: 'atlas-sel', type: 'symbol', source: 'atlas-sel', layout: {
      'icon-image': ['get', 'pin'], 'icon-anchor': 'bottom', 'icon-size': pinSize(1.4),
      'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport' } });
  };

  const setPoints = (list: DiscoverVenue[]) => {
    const map = mapRef.current; if (!map) return;
    venuesById.current = new Map(list.map(v => [v.id, v]));
    (map.getSource('atlas-pts') as MlGeoJSONSource | undefined)?.setData(fc(list.map(v => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
      properties: { id: v.id, name: v.name, layer: v.atlas_layer ?? 'venues', pin: pinImageId(pinKind(v)), lat: v.latitude } }))));
  };
  const setCells = (cells: Array<{ layer: AtlasLayer; lat: number; lng: number; n: number }>) => {
    (mapRef.current?.getSource('atlas-cells') as MlGeoJSONSource | undefined)?.setData(fc(cells.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { layer: c.layer, n: c.n } }))));
  };

  /** Harmony Atlas fetchPoints(): bubbles below ATZ, real points at/after ATZ, for the view plus 10 % padding. */
  const loadViewport = async () => {
    const map = mapRef.current, on = layersRef.current;
    if (!map || !on) return;
    const rq = ++reqRef.current;
    const g = gridBox(map as never);
    if (map.getZoom() < ATLAS_POINT_ZOOM) {
      setStatus('');
      const res = await Promise.all(on.map(l => fetchAtlasClusters(l, g, g.z).then(r => r.cells.map(c => ({ layer: l, lat: c.lat, lng: c.lng, n: c.n }))).catch(() => [])));
      if (rq !== reqRef.current) return;
      setPoints([]); setCells(res.flat());
      onViewportRef.current?.([], true);
      return;
    }
    const pages = await Promise.all(on.map(l => fetchAtlasPoints(l, g, 1000).catch(() => null)));
    if (rq !== reqRef.current) return;
    const list: DiscoverVenue[] = []; let capped = false;
    for (const p of pages) { if (!p) continue; capped = capped || p.capped; for (const row of p.rows) { const v = atlasRowToVenue(p.layer, row, centerRef.current); if (v) list.push(v); } }
    setCells([]); setPoints(list);
    setStatus(capped ? 'Zoom in to see every place' : '');
    onViewportRef.current?.(list, false);
  };
  const loadRef = useRef(loadViewport); loadRef.current = loadViewport;

  useEffect(() => {
    let cancelled = false; let t: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const lib = await loadMapLibre();
        const style = await buildAtlasStyle(ATLAS_DEFAULT_BASEMAP);
        if (cancelled || !hostRef.current) return;
        libRef.current = lib;
        const c = centerRef.current;
        const map = new lib.Map({ container: hostRef.current, style, center: c ? [c.longitude, c.latitude] : US_CENTER, zoom: c ? 13 : 3.6, pitch: 0,
          attributionControl: { compact: true }, maxPitch: 70, cooperativeGestures: !fullScreen }) as MlMap & Record<string, any>;
        mapRef.current = map;
        if (fullScreen) (window as unknown as { __discoverAtlas?: unknown }).__discoverAtlas = map; // same idea as Harmony Atlas window.__map (tests, voice)
        map.on('style.load', () => {
          try { map.setProjection({ type: 'vertical-perspective' }); if (map.setSky) map.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }); } catch { /* older engines */ }
          addDataLayers(map);
          if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', is3DRef.current ? 'visible' : 'none');
          setReady(true);
          if (layersRef.current) void loadRef.current();
        });
        map.on('click', 'atlas-pts', (e: { features?: Array<{ properties?: Record<string, unknown> }> }) => {
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === 'string') onSelectRef.current?.(id, venuesById.current.get(id));
        });
        map.on('click', 'atlas-cells', (e: { features?: Array<{ geometry: { coordinates?: unknown } }> }) => {
          const xy = e.features?.[0]?.geometry.coordinates as [number, number] | undefined;
          if (xy) map.easeTo({ center: xy, zoom: Math.max(map.getZoom() + 2, ATLAS_POINT_ZOOM), duration: 700 });
        });
        // Tap anywhere that isn't a pin or bubble: Street View for that spot, inside the page.
        map.on('click', (e: { point: unknown; lngLat: { lng: number; lat: number } }) => {
          if (!onPickPointRef.current) return;
          const hits = (map as any).queryRenderedFeatures(e.point, { layers: ['atlas-pts', 'atlas-cells', 'atlas-sel'] });
          if (hits && hits.length) return;
          onPickPointRef.current({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
        });
        for (const l of ['atlas-pts', 'atlas-cells']) {
          map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
        }
        map.on('moveend', () => { if (!layersRef.current) return; if (t) clearTimeout(t); t = setTimeout(() => void loadRef.current(), 300); });
        // Only a failure before the first draw is shown; later tile hiccups retry on their own.
        let drawn = false; map.once('load', () => { drawn = true; });
        map.on('error', (e: { error?: { message?: string } }) => { if (!drawn) setFailed(e?.error?.message || 'Map could not load.'); });
      } catch (e) { if (!cancelled) setFailed(e instanceof Error ? e.message : 'Map could not load.'); }
    })();
    return () => { cancelled = true; if (t) clearTimeout(t); userMarkerRef.current?.remove(); mapRef.current?.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Panel mode: the parent supplies the venues (radius search). Full Atlas mode loads by viewport instead.
  useEffect(() => { if (ready && !viewport) setPoints(venues as DiscoverVenue[]); }, [ready, viewport, venues]);
  const layerKey = (layers ?? []).join(',');
  useEffect(() => { if (ready && viewport) void loadRef.current(); }, [ready, viewport, layerKey]);

  // Selection ring + Harmony Atlas select(): fly to zoom >= 15, keep the 3D angle.
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    const v = selectedId ? venuesById.current.get(selectedId) ?? (venues as DiscoverVenue[]).find(x => x.id === selectedId) : null;
    (map.getSource('atlas-sel') as MlGeoJSONSource | undefined)?.setData(fc(v ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] }, properties: { pin: pinImageId(pinKind(v)) } }] : []));
    if (v) map.flyTo({ center: [v.longitude, v.latitude], zoom: Math.max(map.getZoom(), 15), pitch: is3DRef.current ? 60 : map.getPitch(), bearing: is3DRef.current ? -20 : map.getBearing(), duration: 1300, curve: 1.4, essential: true });
  }, [ready, selectedId]);

  // The person's location dot (shown only; never sent anywhere from here).
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!ready || !map || !lib || !center) return;
    if (!userMarkerRef.current) {
      const dot = document.createElement('div');
      dot.style.cssText = 'width:16px;height:16px;border-radius:8px;background:#58A6FF;border:2px solid #EAF4FF;box-shadow:0 0 12px #318BFF;';
      userMarkerRef.current = new lib.Marker({ element: dot, pitchAlignment: 'map' }).setLngLat([center.longitude, center.latitude]).addTo(map);
    } else userMarkerRef.current.setLngLat([center.longitude, center.latitude]);
  }, [ready, center?.latitude, center?.longitude]);

  // Panel mode: frame the person and the radius results.
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!ready || !map || !lib || !center || viewport) return;
    const bounds = new lib.LngLatBounds([center.longitude, center.latitude], [center.longitude, center.latitude]);
    venues.forEach(v => bounds.extend([v.longitude, v.latitude]));
    if (venues.length) map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 600 });
    else map.easeTo({ center: [center.longitude, center.latitude], zoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey]);
  // Full Atlas mode: go to the person once.
  useEffect(() => { const map = mapRef.current; if (ready && map && viewport && center) map.flyTo({ center: [center.longitude, center.latitude], zoom: 14, duration: 1600 }); }, [ready, viewport, !!center]);

  useEffect(() => { mapRef.current?.resize(); }, [fullScreen, height]);

  // Harmony Atlas 3D button: pitch 58 / bearing -18 and 3D buildings on; off = flat, north up.
  const toggle3D = () => {
    const map = mapRef.current; const next = !is3D; setIs3D(next);
    map?.easeTo({ pitch: next ? 58 : 0, bearing: next ? -18 : 0, duration: 1200 });
    if (map?.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', next ? 'visible' : 'none');
  };
  const btn = { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: 'rgba(5,15,32,0.92)', borderWidth: 1, borderColor: 'rgba(91,155,255,0.7)' } as const;

  return <View style={{ height: fullScreen ? '100%' : height, width: '100%', borderRadius: fullScreen ? 0 : 14, overflow: 'hidden', backgroundColor: '#05070d', borderWidth: fullScreen ? 0 : 1, borderColor: 'rgba(54,123,255,0.42)' }}>
    {React.createElement('div', { ref: hostRef, style: { position: 'absolute', inset: 0 } })}
    <View pointerEvents="box-none" style={{ position: 'absolute', right: 10, top: fullScreen ? 52 : 10, gap: 6, alignItems: 'flex-end' }}>
      <Pressable onPress={() => mapRef.current?.zoomIn({ duration: 400 })} accessibilityLabel="Zoom in" style={btn}><Text style={{ color: '#EAF4FF', fontSize: 15, fontWeight: '900' }}>+</Text></Pressable>
      <Pressable onPress={() => mapRef.current?.zoomOut({ duration: 400 })} accessibilityLabel="Zoom out" style={btn}><Text style={{ color: '#EAF4FF', fontSize: 15, fontWeight: '900' }}>−</Text></Pressable>
      <Pressable onPress={toggle3D} accessibilityRole="button" accessibilityLabel={is3D ? '3D off' : '3D on'} style={[btn, is3D ? { backgroundColor: '#22d3ee' } : null]}>
        <Text style={{ color: is3D ? '#05070d' : '#EAF4FF', fontSize: 11, fontWeight: '900', letterSpacing: 1 }}>3D</Text></Pressable>
      <Pressable onPress={() => { const c = centerRef.current, m = mapRef.current; if (c && m) m.flyTo({ center: [c.longitude, c.latitude], zoom: 14, duration: 900 }); }} accessibilityLabel="Recenter on me" style={btn}><Text style={{ color: '#8FC2FF', fontSize: 13, fontWeight: '900' }}>◎</Text></Pressable>
    </View>
    {!!status && <View pointerEvents="none" style={{ position: 'absolute', left: 10, bottom: 30, padding: 6, borderRadius: 7, backgroundColor: 'rgba(5,15,32,0.85)' }}><Text style={{ color: '#C9D6EA', fontSize: 10 }}>{status}</Text></View>}
    {!!failed && <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10, padding: 8, borderRadius: 8, backgroundColor: 'rgba(60,15,15,0.9)' }}>
      <Text style={{ color: '#FFD9D0', fontSize: 10 }}>Map could not load: {failed}</Text></View>}
  </View>;
}

export default AtlasMapGL;
