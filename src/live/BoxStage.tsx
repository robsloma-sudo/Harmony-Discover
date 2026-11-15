// What the scanner is doing with one bottle, shown inside its green box (Rob, 15 Nov 2026):
// SCANNING → RECOGNIZING → IDENTIFYING → RESEARCHING → ✓ name, each with a percentage and a progress bar
// running from the box's left edge to its right edge. One centred line that shrinks to fit the box.
//   SCANNING     the box is found; % = how sure the scanner is this is a bottle
//   ZOOM IN      the label is too small to read yet; % = how close it is to readable (zoom or move closer)
//   RECOGNIZING  the label is being read; % grows with the time a read usually takes (~1-3 s)
//   IDENTIFYING  a name was read and is being confirmed; % = how sure the name is
//   RESEARCHING  a new bottle is being looked up on the web; % grows with the time research usually takes (~20-40 s)
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LABEL, TYPICAL_MS, stagePercent, type BoxStageName } from './boxStageProgress';

type Props = {
  stage: BoxStageName;
  /** 0-1 for scanning / identifying; ignored for the timed stages. */
  value?: number;
  /** When a timed stage (recognizing / researching) began, ms since epoch. */
  since?: number;
  /** Shown on a found bottle. */
  name?: string;
  /** Box width in screen points (text shrinks to fit). */
  boxWidth: number;
};

export function BoxStage({ stage, value, since, name, boxWidth }: Props) {
  const timed = !!TYPICAL_MS[stage] && !!since;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timed) return;
    const tick = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(tick);
  }, [timed]);
  const pct = stagePercent(stage, value, since, timed ? now : Date.now());
  const fill = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: pct, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [pct, fill]);
  const text = stage === 'found' ? '✓ ' + (name || '') : LABEL[stage] + ' ' + pct + '%';
  // One line that always fits inside the box: the font shrinks with the box width.
  // Bold capitals are about 0.8 em wide, plus 0.3 pt letter spacing; 16 pt go to the tag's padding and the box margins.
  const chars = Math.max(1, text.length);
  const room = Math.max(10, boxWidth - 16);
  const fontSize = Math.max(3.5, Math.min(7.5, (room - chars * 0.3) / (chars * 0.8)));
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, stage === 'found' && styles.fillDone,
          { width: fill.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
      </View>
      <View style={styles.tag}>
        <Text numberOfLines={1} ellipsizeMode="clip" style={[styles.text, { fontSize }]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center' },
  // Runs edge to edge across the top of the box.
  track: { alignSelf: 'stretch', height: 2.5, marginHorizontal: 3, marginTop: 3, borderRadius: 2, backgroundColor: 'rgba(119,229,181,0.18)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2, backgroundColor: '#77E5B5' },
  fillDone: { backgroundColor: '#BFF5DD' },
  tag: { marginTop: 3, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, backgroundColor: 'rgba(5,15,16,0.86)' },
  text: { color: '#E9FFF5', fontWeight: '900', letterSpacing: 0.3, textAlign: 'center' },
});
