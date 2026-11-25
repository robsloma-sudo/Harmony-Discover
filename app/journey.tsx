import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { getMockJourney } from '../src/services/mockJourneyApi';
import { getJourneyTimed, GUEST_LIMIT_MESSAGE, pollJourney, type ExploreKind, type Journey as JourneyData, type JourneySource } from '../src/services/menuExplore';
import { BigActionButton, BuildingStoryState, ExploreSheet, SectionEyebrow } from '../src/explore/ExploreKit';
import { palette, space, type } from '../src/explore/exploreTheme';

const KINDS: ExploreKind[] = ['cocktail', 'spirit', 'wine', 'beer', 'other'];
const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

export default function Journey() {
  const p = useLocalSearchParams<{ kind?: string; ref?: string; name?: string; itemId?: string }>();
  const kind = KINDS.find(k => k === one(p.kind));
  const refId = one(p.ref);
  // Old links (?itemId=) still show the demonstration journey.
  if (!kind || !refId) return <MockJourney itemId={one(p.itemId)} />;
  return <RealJourney kind={kind} refId={refId} name={one(p.name) || 'This item'} />;
}

function RealJourney({ kind, refId, name }: { kind: ExploreKind; refId: string; name: string }) {
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [timing, setTiming] = useState<{ ms: number; source: JourneySource } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let cancelPoll: (() => void) | undefined;
    setJourney(null); setFailed(false); setTiming(null);
    getJourneyTimed(kind, refId, name).then(r => {
      if (cancelled) return;
      setTiming({ ms: r.ms, source: r.source });
      setJourney(r.journey);
      if (r.journey.status === 'failed') setFailed(true);
      else if (r.journey.status === 'building') {
        cancelPoll = pollJourney(kind, refId, name, j => {
          if (cancelled) return;
          setJourney(j);
          if (j.status === 'failed') setFailed(true);
        });
      }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; cancelPoll?.(); };
  }, [kind, refId, name, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const status = journey?.status;
  const building = !failed && (!journey || status === 'building');
  const stillBuilding = !failed && status === 'still_building';
  const ready = !failed && !!journey && (status === 'ready' || status === 'built');
  const limited = !failed && status === 'limit';
  const noStory = failed || status === 'failed';
  const none = !failed && status === 'none';
  const openedLabel = kind === 'cocktail' ? 'COCKTAIL STORY' : `${kind.toUpperCase()} STORY`;

  return (
    <Screen hideTabs>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <SectionEyebrow>{openedLabel}</SectionEyebrow>
      <Text style={{ ...type.hero, color: palette.ivory, marginTop: space.sm }}>{journey?.title || name}</Text>
      {building && <BuildingStoryState style={{ marginTop: space.lg }} />}
      {limited && <ExploreSheet style={{ marginTop: space.lg, gap: space.md }}>
        <Text style={{ ...type.value, color: palette.ivory }}>{journey?.message || GUEST_LIMIT_MESSAGE}</Text>
        <Text style={{ ...type.body, color: palette.muted }}>Signing in is free and lets you keep exploring.</Text>
        <BigActionButton primary icon="log-in-outline" label="Sign in" onPress={() => router.push('/sign-in' as never)} />
      </ExploreSheet>}
      {stillBuilding && <ExploreSheet style={{ marginTop: space.lg, gap: space.md }}>
        <Text style={{ ...type.value, color: palette.ivory }}>Still being written</Text>
        <Text style={{ ...type.body, color: palette.muted }}>This story is taking a little longer. Check back soon.</Text>
        <BigActionButton icon="refresh" label="Check again" onPress={retry} />
      </ExploreSheet>}
      {none && <ExploreSheet style={{ marginTop: space.lg, gap: space.md }}>
        <Text style={{ ...type.value, color: palette.ivory }}>No story for this one yet.</Text>
        <Text style={{ ...type.body, color: palette.muted }}>Nothing is wrong on your side. Check back a little later.</Text>
      </ExploreSheet>}
      {noStory && <ExploreSheet style={{ marginTop: space.lg, gap: space.md }}>
        <Text style={{ ...type.value, color: palette.ivory }}>We could not load this story.</Text>
        <Text style={{ ...type.body, color: palette.muted }}>Check your connection and try again.</Text>
        <BigActionButton icon="refresh" label="Try again" onPress={retry} />
      </ExploreSheet>}
      {ready && journey && <>
        {!!journey.intro && <Text style={{ ...type.body, color: palette.muted, marginTop: space.md }}>{journey.intro}</Text>}
        {journey.sections.map(s => <ExploreSheet key={s.heading} style={{ marginTop: space.md }}>
          <SectionEyebrow>{s.heading}</SectionEyebrow>
          <Text style={{ ...type.body, color: palette.ivory, marginTop: space.sm }}>{s.body}</Text>
          {!!s.evidence && <Text style={{ ...type.caption, color: palette.mutedDim, marginTop: space.sm }}>{s.evidence}</Text>}
        </ExploreSheet>)}
        {kind === 'cocktail' && <View style={{ marginTop: space.lg }}>
          <BigActionButton primary icon="wine-outline" label="Open in cocktail maker" onPress={() => {
            router.push({ pathname: '/explore-cocktail', params: { cocktail: refId, name: journey?.title || name } } as never);
          }} />
        </View>}
      </>}
      {(__DEV__ || process.env.EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK === '1') && timing && <Text style={{ ...type.caption, color: palette.noData, marginTop: space.xl }}>opened in {timing.ms} ms from {timing.source}</Text>}
    </Screen>
  );
}

function MockJourney({ itemId }: { itemId?: string }) {
  const journey = getMockJourney(itemId || 'paper-plane');
  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Menu</Text>
      <Text style={styles.eyebrow}>YOUR JOURNEY</Text>
      <Text style={styles.title}>{journey.title}</Text>
      <Text style={styles.sub}>{journey.intro}</Text>
      {journey.sections.map((section: { heading: string; body: string; evidence: string }) => (
        <View key={section.heading} style={styles.journeySection}>
          <Text style={styles.sectionTitle}>{section.heading}</Text>
          <Text style={styles.body}>{section.body}</Text>
          <Text style={styles.evidence}>{section.evidence}</Text>
        </View>
      ))}
      <Pressable style={styles.primary} onPress={() => router.push('/collection')}>
        <Text style={styles.primaryText}>Save this discovery</Text>
      </Pressable>
    </Screen>
  );
}
