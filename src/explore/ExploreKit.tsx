import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MIN_TAP, palette, radius, space, type } from './exploreTheme';

export type ExploreKindName = 'cocktail' | 'spirit' | 'wine' | 'beer' | 'other';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const KIND_ICON: Record<ExploreKindName, IconName> = { cocktail: 'wine-outline', spirit: 'flask-outline', wine: 'wine', beer: 'beer-outline', other: 'flask-outline' };
export const KIND_LABEL: Record<ExploreKindName, string> = { cocktail: 'Cocktail', spirit: 'Spirit', wine: 'Wine', beer: 'Beer', other: 'Drink' };

/** Panel container in the Atlas card style (dark panel, hairline border, rounded 18). */
export function ExploreSheet({ children, style, padded = true }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[s.sheet, padded && s.sheetPad, style]}>{children}</View>;
}

/** Small brass caps label, like "HARMONY BOTTLE INTELLIGENCE". */
export function SectionEyebrow({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return <View style={style}><Text style={s.eyebrow} accessibilityRole="header">{children.toUpperCase()}</Text></View>;
}

/** Big tap target, at least 56pt tall. */
export function BigActionButton({ label, icon, onPress, primary = false, disabled = false, hint, style }: {
  label: string; icon?: IconName; onPress: () => void; primary?: boolean; disabled?: boolean; hint?: string; style?: StyleProp<ViewStyle>;
}) {
  const fg = primary ? palette.onBrass : palette.ivory;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, primary ? s.btnPrimary : s.btnPlain, pressed && (primary ? s.btnPrimaryDown : s.btnPlainDown), disabled && s.btnDisabled, style]}
    >
      {icon ? <Ionicons name={icon} size={24} color={fg} /> : null}
      <Text style={[s.btnText, { color: fg }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

/** A menu-line component. Linked = green dot, solid brass-edged chip, chevron; not linked = flat dashed grey chip. */
export function LinkedChip({ kind, label, linked, onPress, style }: {
  kind: ExploreKindName; label: string; linked: boolean; onPress?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const tappable = linked && !!onPress;
  return (
    <Pressable
      accessibilityRole={tappable ? 'button' : 'text'}
      accessibilityLabel={`${label}, ${KIND_LABEL[kind]}, ${linked ? 'linked, tap to explore' : 'not linked'}`}
      disabled={!tappable} onPress={onPress}
      style={({ pressed }) => [s.chip, linked ? s.chipOn : s.chipOff, pressed && s.chipDown, style]}
    >
      <View style={[s.dot, linked ? s.dotOn : s.dotOff]} />
      <Ionicons name={KIND_ICON[kind]} size={18} color={linked ? palette.brass : palette.noData} />
      <Text style={[s.chipText, { color: linked ? palette.ivory : palette.mutedDim }]} numberOfLines={1}>{label}</Text>
      {linked ? <Ionicons name="chevron-forward" size={16} color={palette.brass} /> : null}
    </Pressable>
  );
}

/** Friendly "building this story" state with a slow pulse. */
export function BuildingStoryState({ title = 'Building this story…', sub = 'This one has not been written yet. We are putting it together now, it usually takes under a minute. You can keep browsing.', style }: {
  title?: string; sub?: string; style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  return (
    <View style={[s.building, style]} accessibilityRole="progressbar" accessibilityLabel={title} accessibilityLiveRegion="polite">
      <Animated.View style={[s.pulse, { opacity, transform: [{ scale }] }]}>
        <Ionicons name="book-outline" size={32} color={palette.brass} />
      </Animated.View>
      <Text style={s.buildingTitle}>{title}</Text>
      <Text style={s.buildingSub}>{sub}</Text>
    </View>
  );
}

/** Label over value, like the bottle profile panel's fields. Empty value shows a quiet "Not known yet". */
export function FactRow({ label, value, note, first = false }: { label: string; value?: string | null; note?: string | null; first?: boolean }) {
  const has = !!value && value.trim().length > 0;
  return (
    <View style={[s.field, first && { borderTopWidth: 0 }]} accessible accessibilityLabel={`${label}: ${has ? value : 'not known yet'}`}>
      <Text style={s.fieldLabel}>{label.toUpperCase()}</Text>
      <Text style={has ? s.fieldValue : s.noData}>{has ? value : 'Not known yet'}</Text>
      {note ? <Text style={s.fieldNote}>{note}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  sheet: { backgroundColor: palette.panelSolid, borderRadius: radius.panel, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' },
  sheetPad: { padding: space.lg },
  eyebrow: { ...type.eyebrow, color: palette.brass },
  btn: { minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.button, borderWidth: 1 },
  btnPrimary: { backgroundColor: palette.brass, borderColor: palette.brass },
  btnPrimaryDown: { backgroundColor: '#A98A55' },
  btnPlain: { backgroundColor: palette.card, borderColor: palette.brassLine },
  btnPlainDown: { backgroundColor: 'rgba(198,163,106,0.18)' },
  btnDisabled: { opacity: 0.4 },
  btnText: { ...type.button, flexShrink: 1, textAlign: 'center' },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.chip, alignSelf: 'flex-start', maxWidth: '100%' },
  chipOn: { backgroundColor: 'rgba(198,163,106,0.14)', borderWidth: 1.5, borderColor: palette.brass },
  chipOff: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: palette.line },
  chipDown: { opacity: 0.7 },
  chipText: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotOn: { backgroundColor: palette.green },
  dotOff: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.noData },
  building: { alignItems: 'center', padding: space.xl, gap: space.md },
  pulse: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: palette.brassLine, backgroundColor: 'rgba(198,163,106,0.10)', alignItems: 'center', justifyContent: 'center' },
  buildingTitle: { ...type.title, color: palette.ivory, textAlign: 'center' },
  buildingSub: { ...type.body, color: palette.muted, textAlign: 'center', maxWidth: 420 },
  field: { paddingVertical: space.md, borderTopWidth: 1, borderTopColor: palette.lineSoft },
  fieldLabel: { ...type.label, color: palette.brass },
  fieldValue: { ...type.value, color: palette.ivory, marginTop: 4 },
  noData: { fontSize: 16, fontWeight: '600', color: palette.noData, marginTop: 4 },
  fieldNote: { ...type.caption, color: palette.muted, marginTop: 2 },
});
