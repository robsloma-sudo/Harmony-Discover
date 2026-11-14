import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FoundItem } from './foundTray';

export type FoundFlight = { id: string; key: string; name: string; from: { x: number; y: number }; to: { x: number; y: number } };

/** Thin strip at the top of the scanner: one chip per identified product, newest on the left. */
export function FoundTray({ items, hiddenKeys, top, onSelect, onClear }: {
  items: FoundItem[];
  hiddenKeys: ReadonlySet<string>;
  top: number;
  onSelect: (item: FoundItem) => void;
  onClear: () => void;
}) {
  const scroll = useRef<ScrollView>(null);
  // Newest chip is on the left: bring it into view when one arrives.
  useEffect(() => { scroll.current?.scrollTo({ x: 0, animated: true }); }, [items.length]);
  if (!items.length) return null;
  return (
    <View pointerEvents="box-none" style={[s.wrap, { top }]}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} style={s.scroll}>
        {items.map(item => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
            onPress={() => onSelect(item)}
            style={[s.chip, hiddenKeys.has(item.key) && { opacity: 0 }]}
          >
            <Text numberOfLines={1} style={s.chipText}>{item.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Clear found bottles" onPress={onClear} style={s.count}>
        <Text style={s.countText}>{items.length}</Text>
        <Text style={s.clearText}>×</Text>
      </Pressable>
    </View>
  );
}

/** The small label that flies from the bottle's green box up into the strip. */
export function FoundFlightLabel({ flight, onDone }: { flight: FoundFlight; onDone: (flight: FoundFlight) => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.cubic), useNativeDriver: false });
    animation.start(() => onDone(flight));
    return () => animation.stop();
    // One animation per flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const left = progress.interpolate({ inputRange: [0, 1], outputRange: [flight.from.x, flight.to.x] });
  const top = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [flight.from.y, flight.from.y - 14, flight.to.y] });
  const scale = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 1.08, 0.86] });
  return (
    <Animated.View pointerEvents="none" style={[s.flight, { left, top, transform: [{ scale }] }]}>
      <Text numberOfLines={1} style={s.chipText}>{flight.name}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 8, right: 8, height: 26, zIndex: 25, flexDirection: 'row', alignItems: 'center' },
  scroll: { flex: 1 },
  row: { alignItems: 'center', gap: 6, paddingRight: 4 },
  chip: { height: 22, maxWidth: 170, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 11, backgroundColor: 'rgba(5,15,16,0.9)', borderWidth: 1, borderColor: 'rgba(119,229,181,0.85)' },
  chipText: { color: '#E9FFF5', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.2 },
  count: { height: 22, marginLeft: 6, paddingHorizontal: 7, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(8,10,13,0.75)', borderWidth: 1, borderColor: 'rgba(153,163,174,0.3)' },
  countText: { color: '#77E5B5', fontSize: 9.5, fontWeight: '900' },
  clearText: { color: '#99A3AE', fontSize: 12, fontWeight: '700', marginTop: -1 },
  flight: { position: 'absolute', zIndex: 26, height: 22, maxWidth: 170, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 11, backgroundColor: 'rgba(5,15,16,0.95)', borderWidth: 1, borderColor: '#77E5B5' },
});
