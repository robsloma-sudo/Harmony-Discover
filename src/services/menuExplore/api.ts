import AsyncStorage from '@react-native-async-storage/async-storage';
import { callExplore, EXPLORE_ACTIONS as A, ExploreLimitError, ExploreRequestError } from './endpoints';
import { isMockMode, mockChangeCocktail, mockGetRecipe, mockJourney, mockMenuLinks } from './mock';
import { MAKER_BUTTON_CHANGE } from './types';
import type {
  ChangedCocktail, ChangeType, CocktailRecipe, ExploreKind, Journey, JourneySection, JourneyStatus, JourneyTimed, LinkedItem, MakerButton,
  MenuLineLink, MyVersion, PollOptions, Recipe, TapInput,
} from './types';

export { ExploreLimitError, ExploreRequestError };

// ---- storage helpers (never throw) ----
async function storeGet(key: string): Promise<string | null> { try { return await AsyncStorage.getItem(key); } catch { return null; } }
async function storeSet(key: string, v: string) { try { await AsyncStorage.setItem(key, v); } catch { /* best effort */ } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const firstStr = (o: Record<string, any>, keys: string[]): string => { for (const k of keys) { const s = str(o[k]); if (s) return s; } return ''; };

// ---- Menu links ----
const lineIndex = new Map<string, { observation_id: string; line: MenuLineLink }>();
function remember(observationId: string, lines: MenuLineLink[]) { for (const l of lines) lineIndex.set(l.line_id, { observation_id: observationId, line: l }); }

/** In mock mode, pass the scanned items so the sample links attach to the real item ids. */
export async function getMenuLinks(observationId: string, items?: { id: string; name: string }[]): Promise<MenuLineLink[]> {
  if (isMockMode()) { const lines = mockMenuLinks(items); remember(observationId, lines); return lines; }
  const r = await callExplore(A.linkMenu, { observation_id: observationId });
  const lines = Array.isArray(r?.lines) ? r.lines as MenuLineLink[] : [];
  remember(observationId, lines);
  return lines;
}
/** Looks up a line from the last getMenuLinks (in memory only). */
export function findMenuLine(lineId: string): { observation_id: string; line: MenuLineLink } | null {
  return lineIndex.get(lineId) ?? null;
}

// ---- Journey: mapping ----
function mapSections(raw: unknown): JourneySection[] {
  if (!Array.isArray(raw)) return [];
  const out: JourneySection[] = [];
  for (const s of raw) {
    if (typeof s === 'string') { if (s.trim()) out.push({ heading: '', body: s.trim() }); continue; }
    if (!isObj(s)) continue;
    const heading = firstStr(s, ['heading', 'title', 'name']);
    const body = firstStr(s, ['body', 'text', 'content']);
    if (!heading && !body) continue;
    const evidence = firstStr(s, ['evidence', 'source']);
    out.push({ heading, body, ...(evidence ? { evidence } : {}) });
  }
  return out;
}
function looksLikeRecipe(r: unknown): r is Recipe {
  return isObj(r) && typeof r.name === 'string' && Array.isArray(r.lines);
}
function mapJourneyObject(kind: ExploreKind, ref: string, status: JourneyStatus, raw: unknown, name: string, built_now?: boolean): Journey {
  const o = isObj(raw) ? raw : {};
  let sections: JourneySection[] = [];
  for (const k of ['sections', 'chapters', 'steps']) { sections = mapSections(o[k]); if (sections.length) break; }
  const intro = firstStr(o, ['intro', 'summary', 'subtitle']);
  const j: Journey = { kind, ref, status, title: firstStr(o, ['title', 'name']) || name, intro: intro || null, sections, built_now };
  if (looksLikeRecipe(o.recipe)) j.recipe = o.recipe;
  return j;
}
function mapJourneyReply(kind: ExploreKind, ref: string, name: string, r: any): Journey {
  const s = str(r?.status);
  const status: JourneyStatus = (['ready', 'built', 'building', 'none', 'limit'] as const).find(x => x === s) ?? 'none';
  if (status === 'limit') {
    return { kind, ref, status, title: name, sections: [], message: str(r?.message) || null, built_now: false };
  }
  return mapJourneyObject(kind, ref, status, r?.journey, name, !!r?.built_now);
}

// ---- Journey cache (7 days; only ready/built with content) ----
export const JOURNEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JOURNEY_PREFIX = '@harmony/explore/journey/v2/';
type CacheEntry = { journey: Journey; cachedAt: number };
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Journey>>();
const keyOf = (kind: ExploreKind, ref: string) => `${kind}:${ref}`;
const hasContent = (j: Journey) => j.sections.length > 0 || !!j.intro;
const cacheable = (j: Journey) => (j.status === 'ready' || j.status === 'built') && hasContent(j);
const fresh = (e: CacheEntry | undefined) => !!e && cacheable(e.journey) && Date.now() - e.cachedAt < JOURNEY_TTL_MS;

/** Test helper: clears in-memory state only. */
export function _resetExploreMemory() { memory.clear(); inflight.clear(); lineIndex.clear(); }

async function cacheJourney(journey: Journey) {
  if (!cacheable(journey)) return;
  const entry: CacheEntry = { journey, cachedAt: Date.now() };
  memory.set(keyOf(journey.kind, journey.ref), entry);
  await storeSet(JOURNEY_PREFIX + keyOf(journey.kind, journey.ref), JSON.stringify(entry));
}

/** peek:true is look-only on the server (ready / building / none; never spends a guest build). Without peek it may start a build. */
async function fetchJourney(kind: ExploreKind, ref: string, name: string, peek: boolean): Promise<Journey> {
  if (isMockMode()) return mockJourney(kind, ref, name);
  const r = await callExplore(A.journey, { item_kind: kind, item_ref: ref, ...(peek ? { peek: true } : {}) });
  return mapJourneyReply(kind, ref, name, r);
}

/** Deduped network fetch (Map<key,Promise>, cleared in finally) that also caches ready/built results. */
function fetchJourneyShared(kind: ExploreKind, ref: string, name: string, peek: boolean): Promise<Journey> {
  const key = `${peek ? 'peek' : 'build'}:${keyOf(kind, ref)}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const j = await fetchJourney(kind, ref, name, peek);
    await cacheJourney(j);
    return j;
  })().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

async function readJourneyCache(key: string): Promise<{ journey: Journey; source: 'memory' | 'storage' } | null> {
  const mem = memory.get(key);
  if (fresh(mem)) return { journey: mem!.journey, source: 'memory' };
  const raw = await storeGet(JOURNEY_PREFIX + key);
  if (raw) {
    try {
      const e = JSON.parse(raw) as CacheEntry;
      if (fresh(e)) { memory.set(key, e); return { journey: e.journey, source: 'storage' }; }
    } catch { /* ignore corrupt cache */ }
  }
  return null;
}

/** Guest opens a Journey: cache, then a free peek; only a 'none' answer triggers one build call (no peek). */
export async function getJourneyTimed(kind: ExploreKind, ref: string, name: string): Promise<JourneyTimed> {
  const t0 = Date.now();
  const hit = await readJourneyCache(keyOf(kind, ref));
  if (hit) return { journey: hit.journey, source: hit.source, ms: Date.now() - t0 };
  let journey: Journey;
  if (isMockMode()) journey = await fetchJourneyShared(kind, ref, name, false);
  else {
    journey = await fetchJourneyShared(kind, ref, name, true);
    if (journey.status === 'none') journey = await fetchJourneyShared(kind, ref, name, false);
  }
  return { journey, source: isMockMode() ? 'mock' : 'network', ms: Date.now() - t0 };
}
export async function getJourney(kind: ExploreKind, ref: string, name: string): Promise<Journey> {
  return (await getJourneyTimed(kind, ref, name)).journey;
}

/** Polls (peek only, never builds) while 'building'; stops on any other status, including 'none'. On timeout onUpdate receives a synthetic 'failed' Journey. Returns cancel(). */
export function pollJourney(kind: ExploreKind, ref: string, name: string, onUpdate: (j: Journey) => void, opts: PollOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const started = Date.now();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { cancelled = true; if (timer) clearTimeout(timer); };
  const tick = async () => {
    if (cancelled) return;
    try {
      const j = await fetchJourneyShared(kind, ref, name, true);
      if (cancelled) return;
      onUpdate(j);
      if (j.status !== 'building') return stop();
    } catch { /* transient: keep polling until timeout */ }
    if (cancelled) return;
    if (Date.now() - started + intervalMs > timeoutMs) {
      stop();
      onUpdate({ kind, ref, status: 'failed', title: name, sections: [] });
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return stop;
}

/** Pre-load Journeys for linked lines using peek only (free, never builds, so fine for guests). Caches ready results. Concurrency 3, deduped, never throws. */
export async function prefetchJourneys(links: MenuLineLink[], concurrency = 3): Promise<void> {
  try {
    const jobs = new Map<string, { kind: ExploreKind; ref: string; name: string }>();
    for (const l of links) {
      if (l.cocktail?.id) jobs.set(keyOf('cocktail', l.cocktail.id), { kind: 'cocktail', ref: l.cocktail.id, name: l.cocktail.name });
      for (const it of l.items) if (it.phg_product_id) jobs.set(keyOf(it.kind, it.phg_product_id), { kind: it.kind, ref: it.phg_product_id, name: it.name });
    }
    const queue = [...jobs.values()];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try { if (!(await readJourneyCache(keyOf(job.kind, job.ref)))) await fetchJourneyShared(job.kind, job.ref, job.name, true); } catch { /* best effort */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  } catch { /* never throws */ }
}

// ---- Cocktail change ----
/** Unchanged recipe with amounts plus both cards (no AI, no guest limit). */
export async function getRecipe(cocktailId: string): Promise<CocktailRecipe> {
  if (isMockMode()) return mockGetRecipe(cocktailId);
  const r = await callExplore(A.getRecipe, { cocktail_id: cocktailId });
  if (!looksLikeRecipe(r?.recipe) || r.recipe.lines.length === 0) throw new ExploreRequestError('Recipe unavailable.', 0, 'recipe_missing');
  return { recipe: r.recipe, bartender_card: str(r.bartender_card), home_recipe: str(r.home_recipe) };
}

/** Fallback only, used when get_recipe fails: names-only starting recipe; amounts are unknown (null). */
export function startingRecipe(cocktail: { id: string; name: string }, items: LinkedItem[]): Recipe {
  return {
    name: cocktail.name, base_cocktail_id: cocktail.id,
    lines: items.map(i => ({ ingredient: i.name, amount: null, phg_product_id: i.phg_product_id })),
    method: null, glass: null, garnish: null, est_abv: null,
  };
}

export async function changeCocktail(input: { cocktail_id: string | null; recipe: Recipe; button: MakerButton; value?: string | null; observation_id?: string | null }): Promise<ChangedCocktail> {
  const change = { type: MAKER_BUTTON_CHANGE[input.button], value: input.value ?? null };
  if (isMockMode()) return mockChangeCocktail(input.recipe, [change]);
  const r = await callExplore(A.changeCocktail, {
    cocktail_id: input.cocktail_id, recipe: input.recipe, changes: [change],
    ...(input.observation_id ? { observation_id: input.observation_id } : {}),
  });
  return {
    recipe: r.recipe as Recipe, bartender_card: str(r.bartender_card), home_recipe: str(r.home_recipe),
    change_types: Array.isArray(r.change_types) ? r.change_types as ChangeType[] : [change.type], ai_used: r.ai_used === true,
  };
}

// ---- Tap: best effort, never throws ----
export function recordTap(input: TapInput): void {
  try {
    if (isMockMode() || !input || !UUID.test(String(input.line_id))) return;
    const body = { observation_id: input.observation_id, line_id: input.line_id, item_kind: input.item_kind, item_ref: input.item_ref };
    void callExplore(A.tap, body).catch(() => {});
  } catch { /* never throws */ }
}

// ---- My versions: phone first, server best effort ----
const VERSIONS_KEY = '@harmony/explore/my-versions/v2';
const DELETED_KEY = '@harmony/explore/my-versions-deleted/v2';
async function readList<T>(key: string): Promise<T[]> {
  const raw = await storeGet(key);
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v as T[] : []; } catch { return []; }
}
const sortNewest = (v: MyVersion[]) => [...v].sort((a, b) => b.created_at.localeCompare(a.created_at));

function mapServerVersion(v: any): MyVersion | null {
  if (!isObj(v) || typeof v.id !== 'string' || !isObj(v.recipe)) return null;
  return {
    id: v.id, server_id: v.id, name: str(v.name) || str(v.recipe.name) || 'My version', recipe: v.recipe as Recipe,
    bartender_card: str(v.bartender_card), home_recipe: str(v.home_recipe),
    base_cocktail_id: typeof v.base_cocktail_id === 'string' ? v.base_cocktail_id : null,
    change_types: Array.isArray(v.change_types) ? v.change_types as ChangeType[] : [],
    created_at: str(v.created_at) || new Date().toISOString(),
  };
}

export async function listMyVersions(): Promise<MyVersion[]> {
  let local = await readList<MyVersion>(VERSIONS_KEY);
  if (!isMockMode()) {
    try {
      const r = await callExplore(A.listVersions);
      const deleted = new Set(await readList<string>(DELETED_KEY));
      const have = new Set(local.flatMap(v => [v.id, v.server_id].filter(Boolean) as string[]));
      const extra = (Array.isArray(r?.versions) ? r.versions : []).map(mapServerVersion)
        .filter((v: MyVersion | null): v is MyVersion => !!v && !have.has(v.server_id!) && !deleted.has(v.server_id!));
      if (extra.length) { local = [...local, ...extra]; await storeSet(VERSIONS_KEY, JSON.stringify(local)); }
    } catch { /* offline or no account: phone list stands */ }
  }
  return sortNewest(local);
}

/** Saves on the phone first (authoritative). Server save is best effort; a full server list (versions_full) is rethrown AFTER the phone copy is kept. */
export async function saveMyVersion(changed: ChangedCocktail, opts: { name?: string; observation_id?: string | null } = {}): Promise<MyVersion> {
  let version: MyVersion = {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, server_id: null,
    name: opts.name?.trim() || changed.recipe.name, recipe: changed.recipe, bartender_card: changed.bartender_card, home_recipe: changed.home_recipe,
    base_cocktail_id: changed.recipe.base_cocktail_id ?? null, change_types: changed.change_types, created_at: new Date().toISOString(),
  };
  const local = await readList<MyVersion>(VERSIONS_KEY);
  await storeSet(VERSIONS_KEY, JSON.stringify([...local, version])); // phone first: never lost
  if (!isMockMode()) {
    try {
      const r = await callExplore(A.saveVersion, {
        name: version.name, recipe: version.recipe, bartender_card: version.bartender_card, home_recipe: version.home_recipe,
        base_cocktail_id: version.base_cocktail_id, change_types: version.change_types,
        ...(opts.observation_id ? { observation_id: opts.observation_id } : {}),
      });
      if (typeof r?.id === 'string' && r.id) {
        version = { ...version, server_id: r.id };
        const now = await readList<MyVersion>(VERSIONS_KEY);
        await storeSet(VERSIONS_KEY, JSON.stringify(now.map(v => (v.id === version.id ? version : v))));
      }
    } catch (e) {
      if (e instanceof ExploreLimitError) throw e; // phone copy is kept; screen shows the server message
      /* other errors: sync later */
    }
  }
  return version;
}

export async function deleteMyVersion(id: string): Promise<void> {
  const local = await readList<MyVersion>(VERSIONS_KEY);
  const target = local.find(v => v.id === id || v.server_id === id);
  await storeSet(VERSIONS_KEY, JSON.stringify(local.filter(v => v !== target)));
  const serverId = target?.server_id ?? null;
  if (!isMockMode() && serverId) {
    try { await callExplore(A.deleteVersion, { id: serverId }); }
    catch { await storeSet(DELETED_KEY, JSON.stringify([...(await readList<string>(DELETED_KEY)), serverId])); }
  }
}
