import React, { useEffect, useRef } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

export type SpatialRenderTrack = {
  trackId: number;
  /** Camera coordinates in metres: x right, y up, z forward. */
  position: { x: number; y: number; z: number };
  /** Estimated object dimensions in metres. Must be positive and finite. */
  dimensions: { width: number; height: number; depth: number };
  confidence: number;
};

export type RenderIntrinsics = { fx: number; fy: number; cx: number; cy: number };

type Props = ViewProps & {
  tracks: SpatialRenderTrack[];
  intrinsics: RenderIntrinsics | null;
};

/** Draws projected 3D cuboids. It never fabricates depth or object dimensions. */
export function SpatialWireframe({ tracks, intrinsics, style, ...viewProps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<unknown>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas || !intrinsics || ![intrinsics.fx, intrinsics.fy].every(v => Number.isFinite(v) && v > 0)) return;
    const host = canvas.parentElement;
    if (!host) return;
    hostRef.current = host;
    let raf = 0;
    const draw = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.scale(dpr, dpr);
      const project = (x: number, y: number, z: number) => {
        if (!Number.isFinite(z) || z <= 0.05) return null;
        return { x: rect.width / 2 + (x / z) * intrinsics.fx * rect.width / (intrinsics.cx * 2), y: rect.height / 2 - (y / z) * intrinsics.fy * rect.height / (intrinsics.cy * 2) };
      };
      const edges: Array<[number, number]> = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      for (const track of tracks) {
        const { x, y, z } = track.position;
        const { width: w, height: h, depth: d } = track.dimensions;
        if (![x,y,z,w,h,d,track.confidence].every(Number.isFinite) || z <= 0 || w <= 0 || h <= 0 || d <= 0) continue;
        const vertices = [
          [x-w/2,y-h/2,z-d/2],[x+w/2,y-h/2,z-d/2],[x+w/2,y+h/2,z-d/2],[x-w/2,y+h/2,z-d/2],
          [x-w/2,y-h/2,z+d/2],[x+w/2,y-h/2,z+d/2],[x+w/2,y+h/2,z+d/2],[x-w/2,y+h/2,z+d/2],
        ] as const;
        const points = vertices.map(v => project(v[0],v[1],v[2]));
        if (points.some(p => !p)) continue;
        ctx.strokeStyle = 'rgba(83,164,255,0.92)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(50,135,255,0.8)';
        ctx.shadowBlur = 9;
        ctx.beginPath();
        edges.forEach(([a,b]) => { const p=points[a]!, q=points[b]!; ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); });
        ctx.stroke();
        const top = points[2]!;
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#B9D8FF';
        ctx.font = '11px system-ui';
        ctx.fillText(`3D TRACK #${track.trackId} · ${Math.round(track.confidence*100)}%`, top.x, Math.max(12,top.y-8));
      }
      ctx.restore();
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    observer?.observe(host);
    draw();
    raf = window.requestAnimationFrame(draw);
    return () => { observer?.disconnect(); window.cancelAnimationFrame(raf); };
  }, [tracks, intrinsics]);

  if (Platform.OS !== 'web') return null;
  return <View {...viewProps} pointerEvents="none" style={[{ position: 'absolute', inset: 0 }, style]}>
    {React.createElement('canvas' as any, { ref: canvasRef, 'aria-hidden': true, style: { width: '100%', height: '100%', display: 'block' } })}
  </View>;
}
