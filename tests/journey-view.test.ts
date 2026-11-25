import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));
vi.mock('../src/services/supabase', () => ({
  ensureDiscoverSession: vi.fn(async () => ({ access_token: 'tok', user: { is_anonymous: true } })),
}));

import { _resetExploreMemory, getJourneyTimed, GUEST_LIMIT_MESSAGE, pollJourney } from '../src/services/menuExplore';
import type { Journey } from '../src/services/menuExplore';
import { resetMockJourneys } from '../src/services/menuExplore/mock';
import { journeyView, JOURNEY_BUILDING_TITLE } from '../src/explore/journeyView';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const readyReply = { ok: true, status: 'ready', built_now: false, from_cache: true, journey: { title: 'Negroni', summary: 'S', chapters: [{ title: 'h', text: 'b' }] } };
function pretendServer(answer: (body: any) => unknown) {
  const calls: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { const b = JSON.parse(init.body); calls.push(b); return json(answer(b)); }));
  return calls;
}

beforeEach(() => {
  store.clear(); _resetExploreMemory(); resetMockJourneys();
  vi.stubEnv('EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK', '');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://p.example');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pub');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Journey screen messages from a pretend server', () => {
  it("'none' shows the warm building message, never the error look", async () => {
    pretendServer(() => ({ ok: true, status: 'none', journey: null }));
    const { journey } = await getJourneyTimed('cocktail', 'c1', 'Negroni');
    const v = journeyView(journey, false);
    expect(v).toMatchObject({ kind: 'building', title: JOURNEY_BUILDING_TITLE, watching: false });
    expect(JOURNEY_BUILDING_TITLE).toBe("We're building this Journey for you");
    if (v.kind === 'building') expect(v.sub).toMatch(/check back soon/i);
  });

  it("'building' shows the warm message, re-checks look-only every 5 s, then opens the Journey when ready", async () => {
    vi.useFakeTimers();
    let peeks = 0;
    const calls = pretendServer(b => (b.peek && ++peeks <= 2 ? { ok: true, status: 'building', journey: null } : readyReply));
    const { journey: first } = await getJourneyTimed('cocktail', 'c2', 'Negroni');
    expect(journeyView(first, false)).toMatchObject({ kind: 'building', title: JOURNEY_BUILDING_TITLE, watching: true });
    const seen: Journey[] = [];
    pollJourney('cocktail', 'c2', 'Negroni', j => seen.push(j));
    await vi.advanceTimersByTimeAsync(100);
    expect(journeyView(seen.at(-1)!, false).kind).toBe('building'); // second peek still building
    await vi.advanceTimersByTimeAsync(5000);
    const last = seen.at(-1)!;
    expect(journeyView(last, false)).toEqual({ kind: 'ready' });
    expect(last.title).toBe('Negroni');
    expect(calls.every(c => c.action === 'journey' && c.peek === true)).toBe(true); // re-checks never build
  });

  it("'limit' keeps the sign-in message", async () => {
    pretendServer(() => ({ ok: true, status: 'limit', journey: null, message: null }));
    const { journey } = await getJourneyTimed('cocktail', 'c3', 'Negroni');
    expect(journeyView(journey, false)).toEqual({ kind: 'limit' });
    expect(GUEST_LIMIT_MESSAGE).toMatch(/free guest limit/);
  });

  it('a network error keeps the error message with Try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    let failed = false;
    await getJourneyTimed('cocktail', 'c4', 'Negroni').catch(() => { failed = true; });
    expect(journeyView(null, failed)).toEqual({ kind: 'error' });
    expect(journeyView(null, false)).toEqual({ kind: 'loading' });
  });
});
