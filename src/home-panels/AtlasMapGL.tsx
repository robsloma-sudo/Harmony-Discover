// Native fallback: the existing 2D raster AtlasMap. The web build resolves AtlasMapGL.web.tsx (MapLibre, pitch, 3D).
// A MapLibre Native pass (@maplibre/maplibre-react-native) is needed for pitch on the iPhone app.
import React from 'react';
import { AtlasMap } from './AtlasMap';
import type { AtlasMapGLProps } from './AtlasMapGL.types';

export function AtlasMapGL({ center, venues, onSelectVenue, height = 360, fullScreen, fitKey }: AtlasMapGLProps) {
  return <AtlasMap center={center} venues={venues} onSelectVenue={onSelectVenue} height={fullScreen ? 640 : height} fitKey={fitKey} />;
}

export default AtlasMapGL;
