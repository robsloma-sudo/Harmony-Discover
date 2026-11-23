import AsyncStorage from '@react-native-async-storage/async-storage';
import { DISCOVER_API_URL, ensureDiscoverSession } from '../supabase';
import { EXPLORE_ENDPOINTS as EP } from './endpoints';
import { isMockMode, mockJourney, mockMenuLinks, mockModify, MOCK_RECIPES } from './mock';
import type {
  CocktailRecipe, ExploreEventInput, ExploreKind, Journey, JourneyTimed, MenuLineLink, ModifyAction, MyVersion, PollOptions,
} from './types';

// ---- request (same pattern as discoverObservationApi.ts) ----
async function authHeaders() {
  const session = await ensureDiscoverSession();
  return { authorization: `Bearer ${session.access_token}`, apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '' };
}
export class ExploreRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request(path: string, init: RequestInit = {}) {
  if (!DISCOVER_API_URL) throw new Error('Discover API is not configured.');
  const headers = await authHeaders();
  const response = await fetch(`${DISCOVER_API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ExploreRequestError(body.error || `Discover request failed (${response.status}).`, response.status);
  return body;
}
const JSON_HEADERS = { 'content-type': 'application/json' };
const q = (o: Record<string, string>) => '?' + new URLSearchParams(o).toString();

// ---- storage helpers (never throw) ----
async function storeGet(key: string): Promise<string | null> { try { return await AsyncStorage.getItem(key); } catch { return null; } }
async function storeSet(key: string, v: string) { try { await AsyncStorage.setItem(key, v); } catch { /* best effort */ } }

// ---- Journey cache ----
export const JOURNEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JOURNEY_PREFIX = '@harmony/explore/journey/v1/';
type CacheEntry = { journey: Journey; cachedAt: number };
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Journey>>();
const keyOf = (kind: ExploreKind, refId: string) => `${kind}:${refId}`;
const fresh = (e: CacheEntry | undefined) => !!e && e.journey.status === 'ready' && Date.now() - e.cachedAt < JOURNEY_TTL_MS;

/** Test helper: clears in-memory state only. */
export function _resetExploreMemory() { memory.clear(); inflight.clear(); eventQueue.length = 0; flushing = false; }

async function cacheReady(journey: Journey) {
  if (journey.status !== 'ready') return; // building/failed is never final
  const entry: CacheEntry = { journey, cachedAt: Date.now() };
  memory.set(keyOf(journey.kind, journey.refId), entry);
  await storeSet(JOURNEY_PREFIX + keyOf(journey.kind, journey.refId), JSON.stringify(entry));
}

/** One network (or mock) fetch; if the server has none (404) asks it to build. Never cached unless ready. */
async function fetchJourney(kind: ExploreKind, refId: string, name: string): Promise<Journey> {
  if (isMockMode()) return mockJourney(kind, refId, name);
  let journey: Journey;
  try {
    journey = await request(EP.journey + q({ kind, ref: refId })) as Journey;
  } catch (e) {
    if (!(e instanceof ExploreRequestError) || e.status !== 404) throw e;
    journey = await request(EP.journeyBuild, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind, refId, name }) }) as Journey;
  }
  return journey;
}

/** Deduped network fetch that also caches ready results. */
function fetchJourneyShared(kind: ExploreKind, refId: string, name: string): Promise<Journey> {
  const key = keyOf(kind, refId);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const j = await fetchJourney(kind, refId, name);
    await cacheReady(j);
    return j;
  })().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export async function getJourneyTimed(kind: ExploreKind, refId: string, name: string): Promise<JourneyTimed> {
  const t0 = Date.now();
  const key = keyOf(kind, refId);
  const mem = memory.get(key);
  if (fresh(mem)) return { journey: mem!.journey, source: 'memory', ms: Date.now() - t0 };
  const raw = await storeGet(JOURNEY_PREFIX + key);
  if (raw) {
    try {
      const e = JSON.parse(raw) as CacheEntry;
      if (fresh(e)) { memory.set(key, e); return { journey: e.journey, source: 'storage', ms: Date.now() - t0 }; }
    } catch { /* ignore corrupt cache */ }
  }
  const journey = await fetchJourneyShared(kind, refId, name);
  return { journey, source: isMockMode() ? 'mock' : 'network', ms: Date.now() - t0 };
}
export async function getJourney(kind: ExploreKind, refId: string, name: string): Promise<Journey> {
  return (await getJourneyTimed(kind, refId, name)).journey;
}

/** Polls until ready/failed/timeout. On timeout onUpdate receives a synthetic 'failed' Journey. Returns cancel(). */
export function pollJourney(kind: ExploreKind, refId: string, name: string, onUpdate: (j: Journey) => void, opts: PollOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const started = Date.now();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { cancelled = true; if (timer) clearTimeout(timer); };
  const tick = async () => {
    if (cancelled) return;
    try {
      const j = await fetchJourneyShared(kind, refId, name);
      if (cancelled) return;
      onUpdate(j);
      if (j.status !== 'building') return stop();
    } catch { /* transient: keep polling until timeout */ }
    if (cancelled) return;
    if (Date.now() - started + intervalMs > timeoutMs) {
      stop();
      onUpdate({ kind, refId, status: 'failed', title: name, sections: [] });
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return stop;
}

/** Pre-load Journeys for linked lines. Concurrency 3, deduped, never throws. */
export async function prefetchJourneys(links: MenuLineLink[], concurrency = 3): Promise<void> {
  const jobs = new Map<string, { kind: ExploreKind; refId: string; name: string }>();
  for (const l of links) {
    if (l.cocktail) jobs.set(keyOf('cocktail', l.cocktail.refId), { kind: 'cocktail', refId: l.cocktail.refId, name: l.cocktail.name });
    for (const c of l.components) jobs.set(keyOf(c.kind, c.refId), { kind: c.kind, refId: c.refId, name: c.name });
  }
  const queue = [...jobs.values()];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try { await getJourneyTimed(job.kind, job.refId, job.name); } catch { /* best effort */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

// ---- Menu links / recipes / modify ----
/** In mock mode, pass the scanned items so the sample links attach to the real item ids. */
export async function getMenuLinks(observationId: string, items?: { id: string; name: string }[]): Promise<MenuLineLink[]> {
  if (isMockMode()) return mockMenuLinks(items);
  const r = await request(EP.menuLinks + q({ observation: observationId }));
  return Array.isArray(r.links) ? r.links as MenuLineLink[] : [];
}
export async function getCocktailRecipe(refId: string): Promise<CocktailRecipe> {
  if (isMockMode()) {
    const r = MOCK_RECIPES[refId];
    if (!r) throw new Error('No sample recipe for this cocktail.');
    return JSON.parse(JSON.stringify(r));
  }
  const r = await request(EP.cocktail + q({ ref: refId }));
  return (r.recipe ?? r) as CocktailRecipe;
}
export async function modifyCocktail(recipe: CocktailRecipe, action: ModifyAction, option?: string | null): Promise<CocktailRecipe> {
  if (isMockMode()) return mockModify(recipe, action, option);
  const r = await request(EP.cocktailModify, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ recipe, action, ...(option ? { option } : {}) }) });
  return r.recipe as CocktailRecipe;
}

// ---- My versions: local first, server best effort ----
const VERSIONS_KEY = '@harmony/explore/my-versions/v1';
const DELETED_KEY = '@harmony/explore/my-versions-deleted/v1';
async function readList<T>(key: string): Promise<T[]> {
  const raw = await storeGet(key);
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v as T[] : []; } catch { return []; }
}
const sortNewest = (v: MyVersion[]) => [...v].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export async function listMyVersions(): Promise<MyVersion[]> {
  let local = await readList<MyVersion>(VERSIONS_KEY);
  if (!isMockMode()) {
    try {
      const r = await request(EP.myVersions);
      const deleted = new Set(await readList<string>(DELETED_KEY));
      const have = new Set(local.map(v => v.id));
      const extra = (Array.isArray(r.versions) ? r.versions as MyVersion[] : []).filter(v => v?.id && !have.has(v.id) && !deleted.has(v.id));
      if (extra.length) { local = [...local, ...extra]; await storeSet(VERSIONS_KEY, JSON.stringify(local)); }
    } catch { /* offline or no account: local list stands */ }
  }
  return sortNewest(local);
}
export async function saveMyVersion(recipe: CocktailRecipe, originalName: string, name?: string): Promise<MyVersion> {
  const version: MyVersion = {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || recipe.name, recipe, originalName, createdAt: new Date().toISOString(),
  };
  const local = await readList<MyVersion>(VERSIONS_KEY);
  await storeSet(VERSIONS_KEY, JSON.stringify([...local, version])); // local first: never lost
  if (!isMockMode()) {
    try { await request(EP.myVersions, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ version }) }); } catch { /* sync later */ }
  }
  return version;
}
export async function deleteMyVersion(id: string): Promise<void> {
  const local = await readList<MyVersion>(VERSIONS_KEY);
  await storeSet(VERSIONS_KEY, JSON.stringify(local.filter(v => v.id !== id)));
  if (!isMockMode()) {
    try { await request(EP.myVersions + q({ id }), { method: 'DELETE' }); }
    catch { await storeSet(DELETED_KEY, JSON.stringify([...(await readList<string>(DELETED_KEY)), id])); }
  }
}

// ---- Anonymous events: best effort, never throws ----
type WireEvent = { type: string; itemKind: string; refId?: string; action?: string; at: string };
const eventQueue: WireEvent[] = [];
let flushing = false;
const MAX_QUEUE = 50;
const clip = (s: unknown) => (typeof s === 'string' ? s.slice(0, 120) : undefined);

async function flushEvents() {
  if (flushing) return;
  flushing = true;
  try {
    while (eventQueue.length) {
      const ev = eventQueue[0];
      try { await request(EP.event, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(ev) }); eventQueue.shift(); }
      catch { break; } // keep queued; retried on the next event
    }
  } finally { flushing = false; }
}

/** Only type/itemKind/refId/action/at are sent. No names, emails or device ids. */
export function recordExploreEvent(input: ExploreEventInput): void {
  try {
    const ev: WireEvent = { type: clip(input.type) || 'unknown', itemKind: clip(input.itemKind) || 'unknown', at: new Date().toISOString() };
    const refId = clip(input.refId); if (refId) ev.refId = refId;
    const action = clip(input.action); if (action) ev.action = action;
    if (isMockMode()) return;
    eventQueue.push(ev);
    if (eventQueue.length > MAX_QUEUE) eventQueue.shift();
    void flushEvents().catch(() => {});
  } catch { /* never throws */ }
}
