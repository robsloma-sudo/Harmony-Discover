/**
 * Marty on the scanner (P-20261125-0216 part 2): a round Marty button bottom-right over the open
 * camera; tapping it slides his face up from the bottom. The camera keeps running underneath.
 * One switch (here and in Settings) turns him fully off: no button, no face, microphone off.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { MartyFace } from './MartyFace';
import { closeMartyFace, getMartyPresence, martyButtonVisible, openMarty, subscribeMartyPresence, turnMartyOff, type MartyPresence } from './martyPresence';
import { faceCaption, faceStateFor, microphoneLive } from './faceState';
import { useMartyVoice } from './useMartyVoice';
import { NO_MENU_WEB, NO_SELECT_WEB, SELECT_TEXT_WEB, shouldAutoStart, showHoldToTalk, showStopButton } from './martyControls';
import { martyAccountNote } from '../voice/martyGuest';
import { useAuth } from '../auth/AuthContext';

const C = { panel: 'rgba(10,13,18,0.97)', line: 'rgba(198,163,106,0.55)', gold: '#C6A36A', text: '#F0F1F2', muted: '#A0A7B0', live: '#FF5A4E' };
const native = Platform.OS !== 'web';
// Long press must never select button text (web); typed text stays selectable.
const noSelect = (native ? {} : NO_SELECT_WEB) as object;
const textOk = (native ? {} : SELECT_TEXT_WEB) as object;
const noMenu = (native ? {} : NO_MENU_WEB) as object;

export function useMartyPresence(): MartyPresence {
  const [p, setP] = useState(getMartyPresence());
  useEffect(() => subscribeMartyPresence(setP), []);
  return p;
}

export function MartyOverlay({ bottomOffset, hidden = false, onNavigateCommand, onOpenConsent }: {
  /** Distance from the bottom of the screen to just above the dock. */
  bottomOffset: number;
  /** Another sheet is open (settings, a panel, a bottle card): keep the session, hide the button and face. */
  hidden?: boolean;
  onNavigateCommand: (name: string, args: Record<string, unknown>) => Promise<string>;
  onOpenConsent: () => void;
}) {
  const presence = useMartyPresence();
  const voice = useMartyVoice({ onNavigateCommand });
  const { session } = useAuth();
  const [draft, setDraft] = useState('');
  const slide = useRef(new Animated.Value(0)).current;
  const [sheetMounted, setSheetMounted] = useState(presence.open);
  const [showTalk, setShowTalk] = useState(false);
  const autoTriedRef = useRef(false);

  // Opening the face starts Marty by itself when voice consent is already given (once per opening).
  useEffect(() => {
    if (!presence.open || !presence.enabled) { autoTriedRef.current = false; return; }
    if (shouldAutoStart({ open: presence.open, web: !native, loadingConsent: voice.loadingConsent, consent: voice.consent, connected: voice.connected, busy: voice.busy, alreadyTried: autoTriedRef.current })) {
      autoTriedRef.current = true;
      void voice.startSession();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence.open, presence.enabled, voice.loadingConsent, voice.consent, voice.connected, voice.busy]);

  useEffect(() => {
    if (presence.open) setSheetMounted(true);
    Animated.timing(slide, { toValue: presence.open ? 1 : 0, duration: presence.open ? 260 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: native })
      .start(({ finished }) => { if (finished && !presence.open) setSheetMounted(false); });
  }, [presence.open, slide]);

  if (!presence.enabled) return null;

  const connecting = voice.busy;
  const faceState = faceStateFor({ connected: voice.connected, connecting, handsFree: voice.handsFree, phase: voice.phase });
  const micOn = microphoneLive({ connected: voice.connected, handsFree: voice.handsFree, phase: voice.phase });
  const lastMarty = [...voice.lines].reverse().find(l => l.who === 'marty');

  if (hidden) {
    // Still listening while something else is on screen: always show it.
    return micOn ? (
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 90 }, noSelect]}>
        <Pressable testID="marty-listening-pill" accessibilityRole="button" accessibilityLabel="Marty is listening. Turn Marty off" onPress={turnMartyOff} style={s.pill}>
          <View style={s.dot} /><Text style={s.fabBadgeText}>MARTY LISTENING · TAP TO TURN OFF</Text>
        </Pressable>
      </View>
    ) : null;
  }

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 65 }, noSelect]}>
      {martyButtonVisible(presence, hidden) && (
        <Pressable
          testID="marty-button"
          accessibilityRole="button"
          accessibilityLabel={micOn ? 'Open Marty. Marty is listening' : 'Open Marty'}
          onPress={openMarty}
          style={[s.fab, { bottom: bottomOffset + 10 }, micOn && s.fabLive]}
        >
          <View style={s.fabFace}><MartyFace state={faceState} mouthOpen={voice.mouthOpen} size={52} /></View>
          {micOn && <View style={s.fabBadge}><View style={s.dot} /><Text style={s.fabBadgeText}>LISTENING</Text></View>}
        </Pressable>
      )}
      {sheetMounted && (
        <Animated.View
          testID="marty-face-sheet"
          style={[s.sheet, { bottom: bottomOffset, opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }] }]}
        >
          <View style={s.header}>
            <Text style={s.title}>MARTY</Text>
            <View style={s.switchRow}>
              <Text style={s.switchLabel}>ON</Text>
              <Switch
                testID="marty-off-switch"
                accessibilityLabel="Turn Marty off"
                value
                onValueChange={on => { if (!on) turnMartyOff(); }}
                trackColor={{ true: C.gold, false: '#3A3F47' }}
              />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Hide Marty's face" onPress={closeMartyFace} style={s.hide}><Text style={s.hideText}>⌄</Text></Pressable>
          </View>
          <View style={s.faceWrap}>
            <MartyFace state={faceState} mouthOpen={voice.mouthOpen} size={176} />
          </View>
          <View style={[s.micSign, micOn ? s.micSignOn : null]} accessibilityLiveRegion="polite">
            <View style={[s.dot, !micOn && s.dotOff]} />
            <Text style={[s.micText, micOn && { color: C.text }]}>{micOn ? 'LISTENING · MICROPHONE ON' : 'MICROPHONE OFF'}</Text>
          </View>
          <Text style={s.caption}>{faceCaption(faceState, voice.handsFree, voice.connected)}</Text>
          {!!lastMarty && <Text style={s.said} numberOfLines={3}>“{lastMarty.text}”</Text>}

          {voice.loadingConsent ? null : !voice.consent ? (
            <View style={s.block}>
              <Text style={s.body}>Tapping Enable voice is your consent to talk with Marty. Your browser then asks for the microphone. While Marty is on, he listens all the time and answers what he hears; turn him off with the switch above and the microphone goes off at once. Saved memory stays off unless you turn it on separately.</Text>
              <Text style={s.small}>{martyAccountNote(session)}</Text>
              <Pressable testID="marty-enable-voice" style={[s.primary, voice.busy && s.disabled]} disabled={voice.busy} onPress={() => void voice.enableVoice()}><Text style={s.primaryText}>{voice.busy ? 'GETTING READY…' : 'ENABLE VOICE'}</Text></Pressable>
            </View>
          ) : !voice.connected ? (
            <Pressable testID="marty-start" style={[s.primary, voice.busy && s.disabled]} disabled={voice.busy} onPress={() => void voice.startSession()}><Text style={s.primaryText}>{voice.busy ? 'CONNECTING…' : 'TALK TO MARTY'}</Text></Pressable>
          ) : (
            <View style={s.block}>
              {showHoldToTalk(voice) && <Pressable testID="marty-hold-to-talk" style={[s.talk, noSelect]} onPressIn={voice.beginTalk} onPressOut={voice.endTalk} {...noMenu}><Text selectable={false} style={s.talkText}>HOLD TO TALK</Text></Pressable>}
              <View style={s.row}>
                <TextInput value={draft} onChangeText={setDraft} placeholder="Or type to Marty…" placeholderTextColor="#707985" style={[s.input, textOk]} onSubmitEditing={() => { voice.sendText(draft); setDraft(''); }} />
                <Pressable style={s.secondary} onPress={() => { voice.sendText(draft); setDraft(''); }}><Text style={s.secondaryText}>SEND</Text></Pressable>
              </View>
            </View>
          )}
          {showStopButton(voice) && (
            <Pressable
              testID="marty-stop"
              accessibilityRole="button"
              accessibilityLabel="Stop Marty. The microphone goes off and the conversation ends"
              style={[s.stop, noSelect]}
              onPress={() => void voice.stop()}
              {...noMenu}
            >
              <Text selectable={false} style={s.stopText}>■ STOP · MICROPHONE OFF</Text>
            </Pressable>
          )}
          {voice.lines.length > 0 && (
            <Pressable testID="marty-what-we-said" accessibilityRole="button" onPress={() => setShowTalk(v => !v)}><Text style={s.fold}>{showTalk ? '▾' : '▸'} What we said</Text></Pressable>
          )}
          {showTalk && voice.lines.length > 0 && (
            <ScrollView style={s.talkLog} contentContainerStyle={{ gap: 6 }}>
              {voice.lines.map(l => <View key={l.id}><Text style={s.lineWho}>{l.who.toUpperCase()}</Text><Text style={[s.lineText, textOk]}>{l.text}</Text></View>)}
            </ScrollView>
          )}
          {!!voice.notice && <Text style={s.small}>{voice.notice}</Text>}
          {!!voice.error && <Text style={s.error}>{voice.error}</Text>}
          <Pressable onPress={onOpenConsent}><Text style={s.link}>Voice & memory settings</Text></Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fab: { position: 'absolute', right: 12, width: 64, height: 64, borderRadius: 32, backgroundColor: '#0E1116', borderWidth: 2, borderColor: C.gold, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 12 },
  fabLive: { borderColor: C.live },
  fabFace: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fabBadge: { position: 'absolute', top: -10, right: -6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(8,10,13,0.95)', borderWidth: 1, borderColor: C.live },
  fabBadgeText: { color: C.text, fontSize: 7, fontWeight: '900', letterSpacing: 0.6 },
  pill: { position: 'absolute', top: 54, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(8,10,13,0.95)', borderWidth: 1, borderColor: C.live },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.live },
  dotOff: { backgroundColor: '#5A6069' },
  sheet: { position: 'absolute', left: 8, right: 8, maxHeight: '86%', padding: 14, paddingTop: 10, borderRadius: 22, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: C.text, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  switchLabel: { color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  hide: { paddingHorizontal: 8, paddingVertical: 2 },
  hideText: { color: C.muted, fontSize: 22, lineHeight: 22 },
  faceWrap: { alignItems: 'center', marginTop: 2 },
  micSign: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#3A3F47' },
  micSignOn: { borderColor: C.live, backgroundColor: 'rgba(255,90,78,0.12)' },
  micText: { color: C.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  caption: { color: C.gold, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  said: { color: C.text, fontSize: 13, lineHeight: 19, textAlign: 'center', fontStyle: 'italic' },
  block: { gap: 8 },
  body: { color: C.muted, fontSize: 11, lineHeight: 17 },
  small: { color: C.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  primary: { backgroundColor: C.gold, padding: 13, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: '#111', fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  disabled: { opacity: 0.45 },
  talk: { backgroundColor: '#D8C39A', padding: 18, borderRadius: 12, alignItems: 'center' },
  talkText: { color: '#111', fontSize: 13, fontWeight: '900', letterSpacing: 1.4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#0D1117', borderColor: '#303741', borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, color: C.text, fontSize: 12 },
  stop: { backgroundColor: 'rgba(255,90,78,0.14)', borderWidth: 1, borderColor: C.live, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  stopText: { color: C.text, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  secondary: { borderWidth: 1, borderColor: C.gold, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 9, alignItems: 'center' },
  secondaryText: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  error: { color: '#E3A29A', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  fold: { color: C.muted, fontSize: 11, fontWeight: '700' },
  talkLog: { maxHeight: 140, borderTopWidth: 1, borderTopColor: '#303741', paddingTop: 6 },
  lineWho: { color: C.gold, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  lineText: { color: C.text, fontSize: 12, lineHeight: 17 },
  link: { color: C.muted, fontSize: 10, textAlign: 'center', textDecorationLine: 'underline', marginTop: 2 },
});
