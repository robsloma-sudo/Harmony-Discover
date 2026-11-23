import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));
vi.mock('../src/services/supabase', () => ({
  DISCOVER_API_URL: 'https://d.example/functions/v1/discover-api',
  ensureDiscoverSession: vi.fn(async () => ({ access_token: 'tok' })),
}));

import {
  _resetExploreMemory, deleteMyVersion, getCocktailRecipe, getJourneyTimed, listMyVersions, modifyCocktail,
  pollJourney, prefetchJourneys, recordExploreEvent, saveMyVersion,
} from '../src/services/menuExplore';
import { resetMockJourneys } from '../src/services/menuExplore/mock';
import type { Journey, MenuLineLink } from '../src/services/menuExplore';

const ready = (refId: string, kind: Journey['kind'] = 'spirit'): Journey => ({ kind, refId, status: 'ready', title: refId, sections: [{ heading: 'h', body: 'b' }] });
const building = (refId: string): Journey => ({ kind: 'spirit', refId, status: 'building', title: refId, sections: [] });
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { store.clear(); _resetExploreMemory(); resetMockJourneys(); vi.stubEnv('EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('journey cache', () => {
  it('serves a cached ready journey from memory then storage with no fetch', async () => {
    const fetchMock = vi.fn(async () => json(ready('spirit:a')));
    vi.stubGlobal('fetch', fetchMock);
    expect((await getJourneyTimed('spirit', 'spirit:a', 'A')).source).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const hit = await getJourneyTimed('spirit', 'spirit:a', 'A');
    expect(hit.source).toBe('memory');
    expect(hit.ms).toBeLessThan(50);
    _resetExploreMemory();
    const disk = await getJourneyTimed('spirit', 'spirit:a', 'A');
    expect(disk.source).toBe('storage');
    expect(disk.ms).toBeLessThan(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never caches a building journey as final, and expires after 7 days', async () => {
    const fetchMock = vi.fn(async () => json(building('spirit:b')));
    vi.stubGlobal('fetch', fetchMock);
    await getJourneyTimed('spirit', 'spirit:b', 'B');
    await getJourneyTimed('spirit', 'spirit:b', 'B');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const f2 = vi.fn(async () => json(ready('spirit:c')));
    vi.stubGlobal('fetch', f2);
    await getJourneyTimed('spirit', 'spirit:c', 'C');
    const key = [...store.keys()].find(k => k.endsWith('spirit:c'))!;
    const e = JSON.parse(store.get(key)!); e.cachedAt -= 8 * 86400000; store.set(key, JSON.stringify(e));
    _resetExploreMemory();
    await getJourneyTimed('spirit', 'spirit:c', 'C');
    expect(f2).toHaveBeenCalledTimes(2);
  });

  it('asks the server to build on 404', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => init?.method === 'POST' ? json(building('spirit:d')) : json({ error: 'nope' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    const r = await getJourneyTimed('spirit', 'spirit:d', 'D');
    expect(r.journey.status).toBe('building');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ kind: 'spirit', refId: 'spirit:d', name: 'D' });
  });
});

describe('pollJourney', () => {
  it('goes building -> ready then stops; cancel works', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchMock = vi.fn(async () => json(++n < 3 ? building('spirit:p') : ready('spirit:p')));
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    pollJourney('spirit', 'spirit:p', 'P', j => seen.push(j.status), { intervalMs: 2000 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(seen).toEqual(['building', 'building', 'ready']);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const seen2: string[] = [];
    const cancel = pollJourney('spirit', 'spirit:z', 'Z', j => seen2.push(j.status), { intervalMs: 2000 });
    cancel();
    await vi.advanceTimersByTimeAsync(10000);
    expect(seen2.length).toBeLessThanOrEqual(1);
  });

  it('gives up with failed on timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => json(building('spirit:t'))));
    const seen: string[] = [];
    pollJourney('spirit', 'spirit:t', 'T', j => seen.push(j.status), { intervalMs: 1000, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(20000);
    expect(seen[seen.length - 1]).toBe('failed');
  });

  it('mock mode: one journey ready at once, another building then ready after 2 polls', async () => {
    vi.stubEnv('EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK', '1');
    expect((await getJourneyTimed('cocktail', 'cocktail:old-fashioned', 'Old Fashioned')).source).toBe('mock');
    vi.useFakeTimers();
    const seen: string[] = [];
    pollJourney('spirit', 'spirit:campari', 'Campari', j => seen.push(j.status), { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual(['building', 'building', 'ready']);
  });
});

describe('prefetchJourneys', () => {
  const links: MenuLineLink[] = [
    { itemId: '1', linked: true, cocktail: { refId: 'cocktail:x', name: 'X' }, components: [{ kind: 'spirit', refId: 'spirit:s1', name: 'S1', matchedText: 's1' }] },
    { itemId: '2', linked: true, cocktail: { refId: 'cocktail:x', name: 'X' }, components: [{ kind: 'spirit', refId: 'spirit:s1', name: 'S1', matchedText: 's1' }, { kind: 'beer', refId: 'beer:b', name: 'B', matchedText: 'b' }, { kind: 'wine', refId: 'wine:w', name: 'W', matchedText: 'w' }, { kind: 'spirit', refId: 'spirit:s2', name: 'S2', matchedText: 's2' }] },
  ];
  it('dedupes requests and never runs more than 3 at once', async () => {
    let active = 0, peak = 0;
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url); active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 15)); active--;
      const u = new URL(url); return json(ready(u.searchParams.get('ref')!, u.searchParams.get('kind') as never));
    }));
    await prefetchJourneys(links);
    expect(urls.length).toBe(5); // x, s1, b, w, s2 once each
    expect(new Set(urls).size).toBe(5);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    await prefetchJourneys(links); // all cached now
    expect(urls.length).toBe(5);
  });
  it('shares one in-flight request between prefetch and getJourney', async () => {
    const fetchMock = vi.fn(async () => { await new Promise(r => setTimeout(r, 10)); return json(ready('spirit:s1')); });
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([getJourneyTimed('spirit', 'spirit:s1', 'S1'), getJourneyTimed('spirit', 'spirit:s1', 'S1')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('recordExploreEvent', () => {
  it('never throws on network failure and sends only anonymous fields', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetchMock);
    expect(() => recordExploreEvent({ type: 'tap', itemKind: 'cocktail', refId: 'cocktail:x', action: 'smokier',
      ...({ name: 'Rob', email: 'r@x.com', deviceId: 'abc' } as object) })).not.toThrow();
    await flush();
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)));
    expect(Object.keys(body).sort()).toEqual(['action', 'at', 'itemKind', 'refId', 'type']);
    expect(JSON.stringify(body)).not.toMatch(/Rob|r@x\.com|abc/);
  });
  it('does not throw even when the input is garbage', () => {
    expect(() => recordExploreEvent(null as never)).not.toThrow();
  });
});

describe('my versions', () => {
  const recipe = { name: 'Old Fashioned', ingredients: [], changes: ['Less sweet'] };
  it('saves locally when the server fails and keeps it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'down' }, 500)));
    const v = await saveMyVersion(recipe, 'Old Fashioned', 'My OF');
    expect(v.name).toBe('My OF');
    const list = await listMyVersions(); // server list fails too
    expect(list.map(x => x.id)).toEqual([v.id]);
  });
  it('works with no account/config at all, and delete removes it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no session'); }));
    const v = await saveMyVersion(recipe, 'Old Fashioned');
    expect((await listMyVersions()).length).toBe(1);
    await deleteMyVersion(v.id);
    expect(await listMyVersions()).toEqual([]);
  });
});

describe('modify (mock)', () => {
  it('really changes the recipe for each of the 5 actions', async () => {
    vi.stubEnv('EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK', '1');
    const base = await getCocktailRecipe('cocktail:old-fashioned');
    const amt = (r: typeof base, role: string) => r.ingredients.find(i => i.role === role)?.amount;
    const swap = await modifyCocktail(base, 'swap_base');
    expect(swap.ingredients[0].name).not.toBe(base.ingredients[0].name);
    const smoky = await modifyCocktail(base, 'smokier');
    expect(smoky.ingredients.some(i => /mezcal/i.test(i.name))).toBe(true);
    const low = await modifyCocktail(base, 'lower_proof');
    expect(amt(low, 'base')!).toBeLessThan(amt(base, 'base')!);
    const less = await modifyCocktail(base, 'less_sweet');
    expect(amt(less, 'sweetener')!).toBeLessThan(amt(base, 'sweetener')!);
    const citrus = await modifyCocktail(base, 'more_citrus');
    expect(citrus.ingredients.some(i => i.role === 'acid')).toBe(true);
    for (const r of [swap, smoky, low, less, citrus]) expect(r.changes.length).toBe(1);
    expect(base.changes).toEqual([]); // input not mutated
  });
});
