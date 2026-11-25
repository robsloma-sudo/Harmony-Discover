import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
const session = vi.hoisted(() => ({ anonymous: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));
vi.mock('../src/services/supabase', () => ({
  ensureDiscoverSession: vi.fn(async () => ({ access_token: 'tok', user: { is_anonymous: session.anonymous } })),
}));

import {
  _resetExploreMemory, changeCocktail, deleteMyVersion, ExploreLimitError, findMenuLine, getJourneyTimed, getRecipe, getMenuLinks, listMyVersions,
  JOURNEY_POLL_INTERVAL_MS, JOURNEY_POLL_TIMEOUT_MS, pollJourney, prefetchVisibleLines, recordTap, saveMyVersion, startingRecipe,
} from '../src/services/menuExplore';
import { resetMockJourneys } from '../src/services/menuExplore/mock';
import type { ChangedCocktail, Journey, MenuLineLink, Recipe } from '../src/services/menuExplore';

const URL = 'https://p.example/functions/v1/discover-explore';
const LINE = '11111111-1111-4111-8111-111111111111';
const OBS = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const flush = () => new Promise(r => setTimeout(r, 0));
const readyReply = (title = 'T') => ({ ok: true, status: 'ready', built_now: false, from_cache: true, journey: { title, summary: 'S', chapters: [{ title: 'h', text: 'b' }] } });
const recipe: Recipe = { name: 'Negroni', base_cocktail_id: 'c1', lines: [{ ingredient: 'Gin', amount: null, phg_product_id: 'p1' }], method: null, glass: null, garnish: null, est_abv: null };
const changed: ChangedCocktail = { recipe, bartender_card: 'card', home_recipe: 'home', change_types: ['smokier'], ai_used: true };

/** fetch mock: routes by action. Records parsed bodies. */
function mockServer(handler: (action: string, body: any) => Response | Promise<Response>) {
  const calls: { url: string; init: any; body: any }[] = [];
  const f = vi.fn(async (url: string, init: any) => { const body = JSON.parse(init.body); calls.push({ url, init, body }); return handler(body.action, body); });
  vi.stubGlobal('fetch', f);
  return { f, calls };
}

beforeEach(() => {
  store.clear(); _resetExploreMemory(); resetMockJourneys(); session.anonymous = false;
  vi.stubEnv('EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK', '');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://p.example');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pub');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('server calls', () => {
  it('every action is a POST to /functions/v1/discover-explore with auth headers and the right fields', async () => {
    const { calls } = mockServer(a => json(a === 'link_menu' ? { lines: [] } : a === 'journey' ? readyReply() : a === 'save_version' ? { ok: true, id: SID } : a === 'list_versions' ? { versions: [] } : a === 'change_cocktail' ? { recipe, bartender_card: 'c', home_recipe: 'h', change_types: ['smokier'], ai_used: true } : { ok: true }));
    await getMenuLinks(OBS);
    await getJourneyTimed('spirit', 'p1', 'A');
    await changeCocktail({ cocktail_id: 'c1', recipe, button: 'less_sweet', observation_id: OBS });
    recordTap({ observation_id: OBS, line_id: LINE, item_kind: 'spirit', item_ref: 'p1' });
    await saveMyVersion(changed, { observation_id: OBS });
    await listMyVersions();
    await deleteMyVersion((await listMyVersions())[0].id);
    await flush();
    expect(calls.map(c => c.body.action)).toEqual(['link_menu', 'journey', 'change_cocktail', 'tap', 'save_version', 'list_versions', 'list_versions', 'delete_version']);
    for (const c of calls) {
      expect(c.url).toBe(URL);
      expect(c.init.method).toBe('POST');
      expect(c.init.headers).toMatchObject({ authorization: 'Bearer tok', apikey: 'pub', 'content-type': 'application/json' });
    }
    const by = (a: string) => calls.find(c => c.body.action === a)!.body;
    expect(by('link_menu')).toEqual({ action: 'link_menu', observation_id: OBS });
    expect(by('journey')).toEqual({ action: 'journey', item_kind: 'spirit', item_ref: 'p1', peek: true });
    expect(by('change_cocktail')).toMatchObject({ cocktail_id: 'c1', recipe, changes: [{ type: 'drier', value: null }], observation_id: OBS });
    expect(by('save_version')).toMatchObject({ name: 'Negroni', recipe, bartender_card: 'card', home_recipe: 'home', base_cocktail_id: 'c1', change_types: ['smokier'], observation_id: OBS });
    expect(by('delete_version')).toEqual({ action: 'delete_version', id: SID });
  });

  it('has no PLACEHOLDER or discover-api left in src/services/menuExplore', () => {
    const dir = join(__dirname, '../src/services/menuExplore');
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/PLACEHOLDER|discover-api/);
    }
  });

  it('remembers menu lines for findMenuLine', async () => {
    const line = { line_id: LINE, status: 'linked', kind: 'cocktail', cocktail: { id: 'c1', name: 'N' }, items: [], confidence: 1 } as MenuLineLink;
    mockServer(() => json({ lines: [line] }));
    await getMenuLinks(OBS);
    expect(findMenuLine(LINE)).toEqual({ observation_id: OBS, line });
    expect(findMenuLine('nope')).toBeNull();
  });

  it('startingRecipe uses names only', () => {
    const r = startingRecipe({ id: 'c1', name: 'N' }, [{ kind: 'spirit', phg_product_id: 'p1', name: 'Gin', role: 'base' }]);
    expect(r).toMatchObject({ name: 'N', base_cocktail_id: 'c1', lines: [{ ingredient: 'Gin', amount: null, phg_product_id: 'p1' }] });
  });
});

describe('errors', () => {
  it('429 daily_limit_reached -> ExploreLimitError guest_daily with the server message', async () => {
    mockServer(() => json({ error: 'daily_limit_reached', limit: 'guest', message: 'Sign in please' }, 429));
    const err = await changeCocktail({ cocktail_id: 'c1', recipe, button: 'smokier' }).catch(e => e);
    expect(err).toBeInstanceOf(ExploreLimitError);
    expect(err).toMatchObject({ reason: 'guest_daily', message: 'Sign in please', status: 429 });
  });
  it('409 versions_full -> ExploreLimitError versions_full; phone copy is kept', async () => {
    mockServer(() => json({ error: 'versions_full', message: 'Full!' }, 409));
    const err = await saveMyVersion(changed).catch(e => e);
    expect(err).toMatchObject({ reason: 'versions_full', message: 'Full!' });
    expect((await readLocal()).length).toBe(1);
  });
});
const readLocal = async () => JSON.parse(store.get('@harmony/explore/my-versions/v2') ?? '[]') as any[];

describe('journey', () => {
  it('maps free-form journey keys and serves the second call from cache with no network', async () => {
    const { f } = mockServer(() => json(readyReply('Gin story')));
    const first = await getJourneyTimed('spirit', 'p1', 'Gin');
    expect(first.source).toBe('network');
    expect(first.journey).toMatchObject({ status: 'ready', title: 'Gin story', intro: 'S', sections: [{ heading: 'h', body: 'b' }] });
    const hit = await getJourneyTimed('spirit', 'p1', 'Gin');
    expect(hit.source).toBe('memory');
    _resetExploreMemory();
    expect((await getJourneyTimed('spirit', 'p1', 'Gin')).source).toBe('storage');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does not cache building, none or empty results', async () => {
    const { f } = mockServer(() => json({ ok: true, status: 'building', built_now: false, from_cache: false, journey: null }));
    await getJourneyTimed('spirit', 'p2', 'B');
    await getJourneyTimed('spirit', 'p2', 'B');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("maps 'limit' with its message", async () => {
    mockServer(() => json({ ok: true, status: 'limit', built_now: false, from_cache: false, journey: null, message: 'Limit msg' }));
    const { journey } = await getJourneyTimed('cocktail', 'c9', 'X');
    expect(journey).toMatchObject({ status: 'limit', message: 'Limit msg', sections: [] });
  });

  it('polls building -> ready, then stops', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { f } = mockServer(() => json(++n < 3 ? { status: 'building', journey: null } : readyReply()));
    const seen: string[] = [];
    pollJourney('spirit', 'p3', 'C', j => seen.push(j.status), { intervalMs: 100, timeoutMs: 10000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual(['building', 'building', 'ready']);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('poll defaults are 5s interval and 3 min timeout', () => {
    expect(JOURNEY_POLL_INTERVAL_MS).toBe(5000);
    expect(JOURNEY_POLL_TIMEOUT_MS).toBe(180000);
  });

  it('default poll waits 5s between checks and ends with still_building after 3 min', async () => {
    vi.useFakeTimers();
    const { f } = mockServer(() => json({ status: 'building', journey: null }));
    const seen: string[] = [];
    pollJourney('spirit', 'p5', 'E', j => seen.push(j.status));
    await vi.advanceTimersByTimeAsync(4900);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200000);
    expect(seen.at(-1)).toBe('still_building');
    expect(f.mock.calls.length).toBeLessThanOrEqual(37);
  });

  it('poll keeps going after transient errors', async () => {
    vi.useFakeTimers();
    let n = 0;
    mockServer(() => (++n < 3 ? json({ error: 'x' }, 500) : json(readyReply())));
    const seen: string[] = [];
    pollJourney('spirit', 'p6', 'F', j => seen.push(j.status), { intervalMs: 100, timeoutMs: 10000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual(['ready']);
  });

  it('poll timeout gives a synthetic still_building journey', async () => {
    vi.useFakeTimers();
    mockServer(() => json({ status: 'building', journey: null }));
    const seen: string[] = [];
    pollJourney('spirit', 'p4', 'D', j => seen.push(j.status), { intervalMs: 100, timeoutMs: 350 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.at(-1)).toBe('still_building');
  });
});

describe('prefetchVisibleLines', () => {
  const links: MenuLineLink[] = [1, 2, 3, 4, 5, 6].map(i => ({
    line_id: `l${i}`, status: 'linked', kind: 'spirit', cocktail: null, confidence: 1,
    items: [{ kind: 'spirit', phg_product_id: i === 6 ? null : `p${i % 5}`, name: `P${i}`, role: 'base' }], // p1..p4,p0; i=6 -> null
  }));
  it('dedupes, skips null product ids, and never has more than 1 in flight', async () => {
    let active = 0, peak = 0;
    const { f } = mockServer(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return json(readyReply()); });
    await prefetchVisibleLines([...links, links[0]]);
    expect(f).toHaveBeenCalledTimes(5);
    expect(peak).toBe(1);
  });
  it('overlapping calls stay serial and do not repeat items', async () => {
    let active = 0, peak = 0;
    const { f } = mockServer(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return json(readyReply()); });
    await Promise.all([prefetchVisibleLines(links), prefetchVisibleLines(links.slice(2)), prefetchVisibleLines(links)]);
    expect(f).toHaveBeenCalledTimes(5);
    expect(peak).toBe(1);
  });
  it('for an anonymous guest sends only peek:true calls and caches ready results', async () => {
    session.anonymous = true;
    const { calls } = mockServer(() => json(readyReply()));
    await prefetchVisibleLines(links);
    expect(calls.length).toBe(5);
    for (const c of calls) expect(c.body).toMatchObject({ action: 'journey', peek: true });
    expect((await getJourneyTimed('spirit', 'p1', 'P')).source).toBe('memory');
  });
  it('skips cached items and items peeked in the last 5 minutes, then re-peeks after', async () => {
    vi.useFakeTimers();
    const { f } = mockServer((_a, b) => json(b.item_ref === 'p1' ? readyReply() : { ok: true, peek: true, status: 'none', journey: null }));
    await prefetchVisibleLines(links);
    expect(f).toHaveBeenCalledTimes(5);
    await prefetchVisibleLines(links);
    expect(f).toHaveBeenCalledTimes(5); // p1 cached, others recently peeked
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    await prefetchVisibleLines(links);
    expect(f).toHaveBeenCalledTimes(9); // 4 uncached re-peeked, p1 still cached
  });
  it('never throws when the server fails', async () => {
    mockServer(() => json({ error: 'boom' }, 500));
    await expect(prefetchVisibleLines(links)).resolves.toBeUndefined();
  });
});

describe('get_recipe', () => {
  const full: Recipe = { ...recipe, lines: [{ ingredient: 'Gin', amount: '1 oz', phg_product_id: 'p1' }] };
  it('sends exactly action + cocktail_id and returns amounts and cards', async () => {
    const { calls } = mockServer(() => json({ ok: true, cocktail_id: 'c1', recipe: full, bartender_card: ' card ', home_recipe: 'home' }));
    const r = await getRecipe('c1');
    expect(calls[0].body).toEqual({ action: 'get_recipe', cocktail_id: 'c1' });
    expect(r).toEqual({ recipe: full, bartender_card: 'card', home_recipe: 'home' });
    expect(r.recipe.lines[0].amount).toBe('1 oz');
  });
  it('rejects a bad reply', async () => {
    mockServer(() => json({ ok: true, recipe: { name: 'x' }, bartender_card: 'c' }));
    await expect(getRecipe('c1')).rejects.toMatchObject({ code: 'recipe_missing' });
  });
});

describe('peek', () => {
  const peekReply = (status: string, journey: unknown = null) => json({ ok: true, peek: true, status, from_cache: false, journey });
  const readyJ = { title: 'T', summary: 'S', chapters: [{ title: 'h', text: 'b' }] };
  it("opening a 'none' Journey = one peek then one build call", async () => {
    const { calls } = mockServer((_a, b) => (b.peek ? peekReply('none') : json(readyReply())));
    const { journey } = await getJourneyTimed('spirit', 'n1', 'N');
    expect(calls.map(c => c.body)).toEqual([
      { action: 'journey', item_kind: 'spirit', item_ref: 'n1', peek: true },
      { action: 'journey', item_kind: 'spirit', item_ref: 'n1' },
    ]);
    expect(journey.status).toBe('ready');
  });
  it("opening a 'ready' or 'building' Journey = peek only", async () => {
    const { calls } = mockServer((_a, b) => (b.item_ref === 'r1' ? peekReply('ready', readyJ) : peekReply('building')));
    expect((await getJourneyTimed('spirit', 'r1', 'R')).journey.status).toBe('ready');
    expect((await getJourneyTimed('spirit', 'b1', 'B')).journey.status).toBe('building');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.body.peek).toBe(true);
  });
  it('polling sends peek:true every time and never builds; a none answer stops it', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { calls } = mockServer(() => (++n < 3 ? peekReply('building') : peekReply('none')));
    const seen: string[] = [];
    pollJourney('spirit', 'q1', 'Q', j => seen.push(j.status), { intervalMs: 100, timeoutMs: 10000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toEqual(['building', 'building', 'none']);
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.body).toEqual({ action: 'journey', item_kind: 'spirit', item_ref: 'q1', peek: true });
  });
});

describe('tap', () => {
  it('sends exactly the 4 fields and never throws', async () => {
    const { calls, f } = mockServer(() => json({ ok: true }));
    recordTap({ observation_id: OBS, line_id: LINE, item_kind: 'spirit', item_ref: 'p1', extra: 'x' } as any);
    await flush();
    expect(calls[0].body).toEqual({ action: 'tap', observation_id: OBS, line_id: LINE, item_kind: 'spirit', item_ref: 'p1' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(() => recordTap({ observation_id: OBS, line_id: LINE, item_kind: 'spirit', item_ref: 'p1' })).not.toThrow();
    await flush();
    recordTap({ observation_id: OBS, line_id: 'not-a-uuid', item_kind: 'spirit', item_ref: 'p1' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('is skipped in mock mode', async () => {
    vi.stubEnv('EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK', '1');
    const { f } = mockServer(() => json({ ok: true }));
    recordTap({ observation_id: OBS, line_id: LINE, item_kind: 'spirit', item_ref: 'p1' });
    await flush();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('my versions', () => {
  it('keeps the phone copy when the server fails', async () => {
    mockServer(() => json({ error: 'save_unavailable' }, 503));
    const v = await saveMyVersion(changed);
    expect(v.server_id).toBeNull();
    expect((await listMyVersions()).map(x => x.id)).toEqual([v.id]);
  });

  it('stores server_id from the reply and uses it for delete', async () => {
    const { calls } = mockServer(a => json(a === 'save_version' ? { ok: true, id: SID } : { ok: true }));
    const v = await saveMyVersion(changed, { name: ' Mine ' });
    expect(v).toMatchObject({ server_id: SID, name: 'Mine' });
    expect((await readLocal())[0].server_id).toBe(SID);
    await deleteMyVersion(v.id);
    expect(calls.at(-1)!.body).toEqual({ action: 'delete_version', id: SID });
    expect(await readLocal()).toEqual([]);
  });

  it('does not call the server to delete a phone-only version; tombstones failed server deletes', async () => {
    mockServer(() => json({ error: 'x' }, 503));
    const local = await saveMyVersion(changed);
    const { f } = mockServer(() => json({ ok: true }));
    await deleteMyVersion(local.id);
    expect(f).not.toHaveBeenCalled();

    const server = mockServer(a => json(a === 'save_version' ? { ok: true, id: SID } : { error: 'delete_unavailable' }, a === 'save_version' ? 200 : 503));
    const v = await saveMyVersion(changed);
    await deleteMyVersion(v.id);
    expect(server.calls.at(-1)!.body.action).toBe('delete_version');
    // server still lists it, but the tombstone hides it
    mockServer(() => json({ versions: [{ id: SID, name: 'N', recipe, bartender_card: 'c', home_recipe: 'h', base_cocktail_id: 'c1', change_types: [], created_at: '2026-01-01T00:00:00Z' }] }));
    expect(await listMyVersions()).toEqual([]);
  });

  it('merges server versions once, mapped with server_id', async () => {
    const sv = { id: SID, name: 'Srv', recipe, bartender_card: 'c', home_recipe: 'h', base_cocktail_id: 'c1', change_types: ['smokier'], created_at: '2026-01-01T00:00:00Z' };
    mockServer(() => json({ versions: [sv] }));
    const list = await listMyVersions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: SID, server_id: SID, name: 'Srv', bartender_card: 'c' });
    expect(await listMyVersions()).toHaveLength(1);
  });
});
