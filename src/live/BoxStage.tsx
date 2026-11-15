// What the scanner is doing with one bottle, shown inside its green box (Rob, 15 Nov 2026):
// SCANNING → RECOGNIZING → IDENTIFYING → RESEARCHING → ✓ name, each with a percentage and a progress bar
// running from the box's left edge to its right edge. One centred line that shrinks to fit the box.
//   SCANNING     the box is found; % = how sure the scanner is this is a bottle
//   RECOGNIZING  the label is being read; % grows with the time a read usually takes (~1-3 s)
//   IDENTIFYING  a name was read and is being confirmed; % = how sure the name is
//   RESEARCHING  a new bottle is being looked up on the web; % grows with the time research usually takes (~20-40 s)
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

export type BoxStageName = 'scanning' | 'recognizing' | 'identifying' | 'researching' | 'found';

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

const LABEL: Record<BoxStageName, string> = {
  scanning: 'SCANNING', recognizing: 'RECOGNIZING', identifying: 'IDENTIFYING', researching: 'RESEARCHING', found: '',
};
// Typical durations: progress eases toward 95% over them and never claims 100% before the stage really ends.
const TYPICAL_MS: Partial<Record<BoxStageName, number>> = { recognizing: 1_400, researching: 14_000 };

export function stagePercent(stage: BoxStageName, value: number | undefined, since: number | undefined, now: number): number {
  if (stage === 'found') return 100;
  const typical = TYPICAL_MS[stage];
  if (typical && since) return Math.min(95, Math.round(95 * (1 - Math.exp(-Math.max(0, now - since) / typical))));
  return Math.max(0, Math.min(99, Math.round((value ?? 0) * 100)));
}

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
  const room = Math.max(10, boxWidth - 12);
  const fontSize = Math.max(3.5, Math.min(7.5, room / (Math.max(1, text.length) * 0.74)));
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
  tag: { marginTop: 3, maxWidth: '96%', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, backgroundColor: 'rgba(5,15,16,0.86)' },
  text: { color: '#E9FFF5', fontWeight: '900', letterSpacing: 0.4, textAlign: 'center' },
});
