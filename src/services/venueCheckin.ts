/**
 * Venue check-in matching (pure, no I/O).
 *
 * Given the person's current device fix and nearby venues from the Atlas
 * (bars, restaurants, liquor stores, breweries, wineries, distilleries), decide
 * which venue to suggest after they scan a bottle or a menu.
 *
 * Rules:
 * - Never check anyone in silently. The result is a SUGGESTION; the UI must ask.
 * - A stale or very inaccurate fix never produces a pre-selected venue.
 * - When two venues are about equally close (shared building, food hall,
 *   strip mall) the person chooses; we do not guess.
 * - Raw coordinates are never part of the result, so callers cannot persist
 *   them by accident. Only rounded distance and accuracy leave this module.
 */

export type LatLng = { latitude: number; longitude: number };

export type DeviceFix = LatLng & {
  /** Horizontal accuracy radius in metres reported by the device (68% confidence). */
  accuracyM: number;
  /** Epoch ms when the fix was taken. */
  timestamp: number;
};

export type CheckinVenue = LatLng & {
  id: string;
  name: string;
  venue_type: string;
};

export type CheckinCandidate<V extends CheckinVenue = CheckinVenue> = {
  venue: V;
  /** Rounded great-circle distance from the device fix to the venue point. */
  distanceM: number;
};

export type CheckinDecision<V extends CheckinVenue = CheckinVenue> =
  | { status: 'suggest'; suggested: CheckinCandidate<V>; alternatives: CheckinCandidate<V>[]; searchRadiusM: number; accuracyM: number }
  | { status: 'choose'; alternatives: CheckinCandidate<V>[]; searchRadiusM: number; accuracyM: number; reason: 'ambiguous' | 'low_accuracy' }
  | { status: 'none'; searchRadiusM: number; accuracyM: number }
  | { status: 'stale_location' | 'invalid_location' };

export const CHECKIN_POLICY = {
  /** A fix older than this is not used for a check-in suggestion. */
  maxFixAgeMs: 2 * 60 * 1000,
  /** Above this accuracy we list venues but do not pre-select one. */
  maxSuggestAccuracyM: 120,
  /** Above this accuracy we do not offer venues at all. */
  maxUsableAccuracyM: 400,
  /** Venue points are licence/geocode points, not building outlines; allow for that. */
  venuePointSlackM: 60,
  minSearchRadiusM: 75,
  maxSearchRadiusM: 300,
  /** The runner-up must be this much farther (ratio AND metres) for a clear suggestion. */
  clearRatio: 1.6,
  clearGapM: 35,
  maxAlternatives: 4,
} as const;

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => d * Math.PI / 180;

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && (p.latitude as number) >= -90 && (p.latitude as number) <= 90
    && (p.longitude as number) >= -180 && (p.longitude as number) <= 180;
}

/** Great-circle distance in metres (haversine; numerically stable at short range). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const metersToMiles = (m: number) => m / 1609.344;

/** Search radius grows with the reported GPS uncertainty, within fixed bounds. */
export function checkinSearchRadiusM(accuracyM: number): number {
  const r = Math.max(0, accuracyM) * 1.5 + CHECKIN_POLICY.venuePointSlackM;
  return Math.round(Math.min(CHECKIN_POLICY.maxSearchRadiusM, Math.max(CHECKIN_POLICY.minSearchRadiusM, r)));
}

/** Small bounding box (degrees) around a point, for the Atlas bounds-only query. */
export function boundsAround(p: LatLng, radiusM: number) {
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(Math.cos(toRad(p.latitude)), 0.15));
  return {
    minLat: Math.max(-90, p.latitude - latDelta), maxLat: Math.min(90, p.latitude + latDelta),
    minLng: Math.max(-180, p.longitude - lngDelta), maxLng: Math.min(180, p.longitude + lngDelta),
  };
}

export function decideCheckin<V extends CheckinVenue>(fix: DeviceFix | null, venues: V[], now: number = Date.now()): CheckinDecision<V> {
  if (!fix || !isValidLatLng(fix) || !Number.isFinite(fix.accuracyM) || fix.accuracyM < 0 || !Number.isFinite(fix.timestamp)) return { status: 'invalid_location' };
  if (now - fix.timestamp > CHECKIN_POLICY.maxFixAgeMs || fix.timestamp - now > 30_000) return { status: 'stale_location' };
  const accuracyM = Math.round(fix.accuracyM);
  const searchRadiusM = checkinSearchRadiusM(fix.accuracyM);
  if (fix.accuracyM > CHECKIN_POLICY.maxUsableAccuracyM) return { status: 'none', searchRadiusM, accuracyM };

  const seen = new Set<string>();
  const ranked: CheckinCandidate<V>[] = [];
  for (const venue of venues) {
    if (!venue || !venue.id || seen.has(venue.id) || !isValidLatLng(venue)) continue;
    seen.add(venue.id);
    const d = haversineMeters(fix, venue);
    if (d <= searchRadiusM) ranked.push({ venue, distanceM: Math.round(d) });
  }
  ranked.sort((a, b) => a.distanceM - b.distanceM || a.venue.name.localeCompare(b.venue.name));
  const alternatives = ranked.slice(0, CHECKIN_POLICY.maxAlternatives);
  if (!alternatives.length) return { status: 'none', searchRadiusM, accuracyM };
  if (fix.accuracyM > CHECKIN_POLICY.maxSuggestAccuracyM) return { status: 'choose', alternatives, searchRadiusM, accuracyM, reason: 'low_accuracy' };

  const [first, second] = alternatives;
  const clear = !second || (
    second.distanceM >= Math.max(1, first.distanceM) * CHECKIN_POLICY.clearRatio
    && second.distanceM - first.distanceM >= CHECKIN_POLICY.clearGapM
  );
  if (!clear) return { status: 'choose', alternatives, searchRadiusM, accuracyM, reason: 'ambiguous' };
  return { status: 'suggest', suggested: first, alternatives: alternatives.slice(1), searchRadiusM, accuracyM };
}

/**
 * Should a new scan prompt again? Re-prompt only when there is no current
 * check-in, it has expired, or the person has clearly moved away from it.
 */
export function shouldPromptCheckin(
  current: { venue: LatLng; checkedInAt: number } | null,
  fix: DeviceFix | null,
  now: number = Date.now(),
  ttlMs = 90 * 60 * 1000,
): boolean {
  if (!current) return true;
  if (now - current.checkedInAt > ttlMs) return true;
  if (!fix || !isValidLatLng(fix)) return false;
  const leaveM = Math.max(200, fix.accuracyM * 2);
  return haversineMeters(fix, current.venue) > leaveM;
}
