// Look and feel for the menu tap-to-explore screens: the same dark "simple Atlas" panels.
// Values are copied, not invented: app/index.tsx C (bg, panel, line, brass, ivory, muted, red, signal),
// src/home-panels/BottleProfilePanel.tsx C (green, card fills) and src/ui.tsx colors (screen bg, text).
import { StyleSheet } from 'react-native';

export const palette = {
  bg: '#07090C',            // app/index.tsx C.bg (map screen background)
  screen: '#0D1117',        // src/ui.tsx colors.bg (tab screens)
  panel: 'rgba(10,12,16,0.96)', // app/index.tsx C.panel
  panelSolid: '#111720',    // BottleProfilePanel C.panel
  card: 'rgba(17,23,32,0.68)',  // BottleProfilePanel section fill
  line: 'rgba(153,163,174,0.22)', // app/index.tsx C.line
  lineSoft: 'rgba(153,163,174,0.10)', // BottleProfilePanel field divider
  brass: '#C6A36A',         // app/index.tsx C.brass
  brassLine: 'rgba(198,163,106,0.45)', // BottleProfilePanel searchRow border
  ivory: '#F0F1F2',         // app/index.tsx C.ivory
  muted: '#A0A7B0',         // MartyPanel C.muted (a notch brighter than 858C95 for dim bars)
  mutedDim: '#858C95',      // app/index.tsx C.muted
  noData: '#68727D',        // BottleProfilePanel noData
  green: '#77E5B5',         // BottleProfilePanel C.green (confirmed / linked)
  red: '#A84343',           // app/index.tsx C.red
  signal: '#C05A50',        // app/index.tsx C.signal
  onBrass: '#07090C',       // dark text on brass buttons
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { chip: 999, card: 11, panel: 18, button: 16 } as const;

// Atlas panels use tiny type (8-12pt); these are deliberately larger for a dim bar.
export const type = {
  eyebrow: { fontSize: 12, fontWeight: '900' as const, letterSpacing: 1.5 },
  caption: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  body: { fontSize: 17, fontWeight: '500' as const, lineHeight: 26 },
  label: { fontSize: 12, fontWeight: '900' as const, letterSpacing: 0.8 },
  value: { fontSize: 18, fontWeight: '700' as const, lineHeight: 25 },
  title: { fontSize: 26, fontWeight: '900' as const, lineHeight: 32 },
  hero: { fontSize: 34, fontWeight: '900' as const, lineHeight: 40 },
  button: { fontSize: 18, fontWeight: '800' as const },
} as const;

export const MIN_TAP = 56;

export const exploreStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  content: { padding: space.lg, paddingBottom: 96 },
  sheet: { backgroundColor: palette.panelSolid, borderRadius: radius.panel, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' },
  sheetPad: { padding: space.lg },
  card: { padding: space.lg, marginBottom: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card },
  title: { ...type.title, color: palette.ivory },
  body: { ...type.body, color: palette.ivory },
  muted: { ...type.caption, color: palette.muted },
});
