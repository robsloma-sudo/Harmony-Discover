import React, { useEffect, useRef } from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import type { RelativeDepthMap } from './BrowserDepthEstimator';

export function RelativeDepthOverlay({ map, style }: ViewProps & { map: RelativeDepthMap | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !map) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = map.width;
    canvas.height = map.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pixels = ctx.createImageData(map.width, map.height);
    for (let i = 0; i < map.values.length; i++) {
      const brightness = Math.round(Math.max(0, Math.min(1, map.values[i])) * 255);
      const p = i * 4;
      pixels.data[p] = brightness;
      pixels.data[p + 1] = brightness;
      pixels.data[p + 2] = brightness;
      pixels.data[p + 3] = 190;
    }
    ctx.putImageData(pixels, 0, 0);
  }, [map]);
  if (Platform.OS !== 'web' || !map) return null;
  return <View pointerEvents="none" style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: .34 }, style]}>
    {React.createElement('canvas' as any, { ref: canvasRef, 'aria-label': 'Relative depth map; white is nearer, black is farther', style: { width: '100%', height: '100%', objectFit: 'cover' } })}
  </View>;
}
