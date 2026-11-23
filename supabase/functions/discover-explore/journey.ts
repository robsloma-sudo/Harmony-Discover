// Journey decision logic (pure: every outside effect is injected, so it is testable without a server).
// Why: a guest has 5 builds a day. A build can take longer than one request, and the app re-polls a "building" Journey
// every 2 s. Reserving a build per poll burned the whole day on one tap. Now one in-flight marker per Journey
// (global, no person id) lets exactly one caller reserve + build; everyone else only looks (fetch-only, no reservation).
import type { ItemKind, JourneyPeekStatus, JourneyResult } from "./contract.ts";

export interface JourneyDeps {
  /** Fresh (not expired) Discover cache copy, or null. */
  cacheGet(kind: ItemKind, ref: string): Promise<Record<string, unknown> | null>;
  cachePut(kind: ItemKind, ref: string, status: "ready" | "built", journey: Record<string, unknown>): Promise<void>;
  /** Is a fresh build marker present? (read only, used by peek) */
  buildRunning(kind: ItemKind, ref: string): Promise<boolean>;
  /** Atomic: true = you hold the marker now; false = a fresh marker exists. */
  claim(kind: ItemKind, ref: string): Promise<boolean>;
  /** Best effort; an unreleased marker expires by itself after the hold. */
  release(kind: ItemKind, ref: string): Promise<void>;
  /** Guest daily build reservation. null = go ahead (members always). Otherwise the refusal to send. */
  reserve(): Promise<{ status: number; body: Record<string, unknown> } | null>;
  /** PHG call. build:false = fetch only. Throws Error("phg_unavailable" | "phg_timeout"). */
  phgFetch(kind: ItemKind, ref: string, build: boolean): Promise<JourneyResult>;
  /** journey_open event (consent checked inside). */
  record(kind: ItemKind, ref: string): Promise<void>;
}

export interface JourneyReply { status: number; body: Record<string, unknown> }

const isReady = (r: JourneyResult) => (r.status === "ready" || r.status === "built") && !!r.journey;

export async function runJourney(
  deps: JourneyDeps, a: { kind: ItemKind; ref: string; peek: boolean; limitMessage?: string },
): Promise<JourneyReply> {
  const { kind, ref } = a;
  const ok = (body: Record<string, unknown>): JourneyReply => ({ status: 200, body: { ok: true, ...body } });
  const releaseQuiet = async () => { try { await deps.release(kind, ref); } catch { /* marker expires by itself */ } };

  const cached = await deps.cacheGet(kind, ref);
  if (a.peek) {
    if (cached) return ok({ peek: true, status: "ready" satisfies JourneyPeekStatus, from_cache: true, journey: cached });
    if (await deps.buildRunning(kind, ref)) return ok({ peek: true, status: "building" satisfies JourneyPeekStatus, from_cache: false, journey: null });
    const res = await deps.phgFetch(kind, ref, false);
    if (isReady(res)) {
      await deps.cachePut(kind, ref, res.status as "ready" | "built", res.journey!);
      return ok({ peek: true, status: "ready", from_cache: false, journey: res.journey });
    }
    const status: JourneyPeekStatus = res.status === "building" ? "building" : "none";
    return ok({ peek: true, status, from_cache: false, journey: null });
  }

  if (cached) {
    await deps.record(kind, ref);
    return ok({ status: "ready", built_now: false, from_cache: true, journey: cached });
  }

  const readyReply = async (res: JourneyResult, builtNow: boolean) => {
    await deps.cachePut(kind, ref, res.status as "ready" | "built", res.journey!);
    await releaseQuiet();
    await deps.record(kind, ref);
    return ok({ status: res.status, built_now: builtNow && res.built_now, from_cache: false, journey: res.journey });
  };
  const building = () => ok({ status: "building", built_now: false, from_cache: false, journey: null });

  const mine = await deps.claim(kind, ref);
  if (!mine) {
    // Someone's build is running: look only, never reserve. Never "limit" / "none" while the marker is fresh.
    const res = await deps.phgFetch(kind, ref, false);
    if (isReady(res)) return await readyReply(res, false);
    return building();
  }

  // We hold the marker. Any early exit below must release it.
  try {
    const g = await deps.reserve();
    if (g) {
      await releaseQuiet();
      if (g.status !== 429) return { status: g.status, body: g.body };
      const res = await deps.phgFetch(kind, ref, false);
      if (isReady(res)) return await readyReply(res, false);
      if (res.status === "none") {
        return ok({ status: "limit", built_now: false, from_cache: false, journey: null, message: a.limitMessage });
      }
      return building();
    }
    let res: JourneyResult;
    try { res = await deps.phgFetch(kind, ref, true); }
    catch (e) {
      // A build that outlasts our wait is most likely still running on PHG: keep the marker (it expires after the hold)
      // so the app's re-polls look only instead of reserving another build.
      if ((e as Error)?.message === "phg_timeout") return building();
      throw e;
    }
    if (isReady(res)) return await readyReply(res, true);
    if (res.status === "building") return building(); // keep the marker: the build is still running
    await releaseQuiet();
    return ok({ status: "none", built_now: false, from_cache: false, journey: null });
  } catch (e) {
    await releaseQuiet();
    throw e;
  }
}
