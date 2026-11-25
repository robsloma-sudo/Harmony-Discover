// Pure screen logic for the Journey screen (no React Native imports, so it is unit-testable).
import type { Journey } from '../services/menuExplore/types';

export type JourneyView =
  | { kind: 'loading' }
  | { kind: 'building'; title: string; sub: string; watching: boolean }
  | { kind: 'still_building'; title: string; sub: string }
  | { kind: 'limit' }
  | { kind: 'error' }
  | { kind: 'ready' };

/** Warm words for a Journey that is not written yet (server said 'none' or 'building'). Never an error look. */
export const JOURNEY_BUILDING_TITLE = "We're building this Journey for you";
export const JOURNEY_BUILDING_SUB_WATCHING = "Check back soon. We'll open it here as soon as it's ready, or you can keep browsing.";
export const JOURNEY_BUILDING_SUB = 'Check back soon. Each new Journey we write is saved, so it will be here for you next time.';
export const JOURNEY_STILL_BUILDING_TITLE = 'Still writing this Journey';
export const JOURNEY_STILL_BUILDING_SUB = 'It is taking a little longer than usual. Check back soon.';

/** Which state the Journey screen shows. failed = network error or the server call threw. */
export function journeyView(journey: Journey | null, failed: boolean): JourneyView {
  if (failed || journey?.status === 'failed') return { kind: 'error' };
  if (!journey) return { kind: 'loading' };
  switch (journey.status) {
    case 'ready':
    case 'built': return { kind: 'ready' };
    case 'limit': return { kind: 'limit' };
    case 'building': return { kind: 'building', title: JOURNEY_BUILDING_TITLE, sub: JOURNEY_BUILDING_SUB_WATCHING, watching: true };
    case 'none': return { kind: 'building', title: JOURNEY_BUILDING_TITLE, sub: JOURNEY_BUILDING_SUB, watching: false };
    case 'still_building': return { kind: 'still_building', title: JOURNEY_STILL_BUILDING_TITLE, sub: JOURNEY_STILL_BUILDING_SUB };
    default: return { kind: 'error' };
  }
}
