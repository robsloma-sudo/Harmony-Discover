import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { contourSegments, type NormalizedPoint } from './contourGeometry';

type Props = {
  points?: NormalizedPoint[];
  color?: string;
  strokeWidth?: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

/**
 * Draws only contours supplied by an actual instance mask. It deliberately
 * renders nothing when no mask contour is available; callers must not replace
 * missing segmentation with a rectangle and call it a silhouette.
 */
export function MaskContourOverlay({ points, color = '#1677FF', strokeWidth = 2.5, sourceWidth, sourceHeight }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  if (!points || points.length < 3) return null;
  const hasSourceSize = !!sourceWidth && !!sourceHeight && sourceWidth > 0 && sourceHeight > 0 && size.width > 0 && size.height > 0;
  const displayPoints = hasSourceSize
    ? (() => {
        // Match the camera's objectFit:'cover' crop. Stretching normalized mask
        // coordinates to the view distorts and shifts contours on portrait phones.
        const scale = Math.max(size.width / sourceWidth!, size.height / sourceHeight!);
        const renderedWidth = sourceWidth! * scale;
        const renderedHeight = sourceHeight! * scale;
        const cropLeft = (renderedWidth - size.width) / 2;
        const cropTop = (renderedHeight - size.height) / 2;
        return points.map(point => ({
          x: (point.x * renderedWidth - cropLeft) / size.width,
          y: (point.y * renderedHeight - cropTop) / size.height,
        }));
      })()
    : points;
  const segments = contourSegments(displayPoints, size.width, size.height);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {segments.map((segment, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            left: segment.left,
            top: segment.top - strokeWidth / 2,
            width: segment.length,
            height: strokeWidth,
            borderRadius: strokeWidth,
            backgroundColor: color,
            shadowColor: color,
            shadowOpacity: 0.95,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
            elevation: 4,
            transform: [{ rotate: `${segment.angle}rad` }],
          }}
        />
      ))}
    </View>
  );
}
