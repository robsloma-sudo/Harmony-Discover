import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { contourSegments, type NormalizedPoint } from './contourGeometry';

type Props = {
  points?: NormalizedPoint[];
  color?: string;
  strokeWidth?: number;
};

/**
 * Draws only contours supplied by an actual instance mask. It deliberately
 * renders nothing when no mask contour is available; callers must not replace
 * missing segmentation with a rectangle and call it a silhouette.
 */
export function MaskContourOverlay({ points, color = '#1677FF', strokeWidth = 2.5 }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  if (!points || points.length < 3) return null;
  const segments = contourSegments(points, size.width, size.height);
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
