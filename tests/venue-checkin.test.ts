import { describe, expect, it } from 'vitest';
import {
  boundsAround, checkinSearchRadiusM, decideCheckin, haversineMeters, metersToMiles, shouldPromptCheckin,
  type CheckinVenue, type DeviceFix,
} from '../src/services/venueCheckin';

const NOW = 1_800_000_000_000;
// Des Moines, East Village area (illustrative coordinates).
const here = { latitude: 41.5868, longitude: -93.6110 };
const fix = (over: Partial<DeviceFix> = {}): DeviceFix => ({ ...here, accuracyM: 15, timestamp: NOW - 5_000, ...over });
// ~1 m of latitude = 1/111_320 degrees.
const north = (m: number) => ({ latitude: here.latitude + m / 111_320, longitude: here.longitude });
const venue = (id: string, m: number, type = 'bar'): CheckinVenue => ({ id, name: id, venue_type: type, ...north(m) });

describe('haversineMeters', () => {
  it('measures short and long distances correctly', () => {
    expect(haversineMeters(here, north(100))).toBeGreaterThan(99);
    expect(haversineMeters(here, north(100))).toBeLessThan(101);
    // Des Moines -> Chicago is roughly 500 km.
    const km = haversineMeters(here, { latitude: 41.8781, longitude: -87.6298 }) / 1000;
    expect(km).toBeGreaterThan(490);
    expect(km).toBeLessThan(510);
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
  });
});

describe('decideCheckin', () => {
  it('suggests the clearly nearest venue', () => {
    const d = decideCheckin(fix(), [venue('Store', 160, 'liquor_store'), venue('Bar', 20), venue('Far', 5000)], NOW);
    expect(d.status).toBe('suggest');
    if (d.status !== 'suggest') return;
    expect(d.suggested.venue.id).toBe('Bar');
    expect(d.suggested.distanceM).toBe(20);
    expect(d.alternatives.map(a => a.venue.id)).toEqual([]); // 160 m is outside the 83 m search radius
  });

  it('asks the person to choose when two venues are about equally close', () => {
    const d = decideCheckin(fix(), [venue('A', 18), venue('B', 30)], NOW);
    expect(d.status).toBe('choose');
    if (d.status === 'choose') { expect(d.reason).toBe('ambiguous'); expect(d.alternatives.map(a => a.venue.id)).toEqual(['A', 'B']); }
  });

  it('never pre-selects with a poor fix, and offers nothing with a very poor fix', () => {
    const poor = decideCheckin(fix({ accuracyM: 150 }), [venue('A', 40)], NOW);
    expect(poor.status).toBe('choose');
    if (poor.status === 'choose') expect(poor.reason).toBe('low_accuracy');
    expect(decideCheckin(fix({ accuracyM: 900 }), [venue('A', 40)], NOW).status).toBe('none');
  });

  it('rejects stale, future and invalid fixes', () => {
    expect(decideCheckin(fix({ timestamp: NOW - 10 * 60_000 }), [venue('A', 5)], NOW).status).toBe('stale_location');
    expect(decideCheckin(fix({ timestamp: NOW + 5 * 60_000 }), [venue('A', 5)], NOW).status).toBe('stale_location');
    expect(decideCheckin(fix({ latitude: 95 }), [venue('A', 5)], NOW).status).toBe('invalid_location');
    expect(decideCheckin(null, [venue('A', 5)], NOW).status).toBe('invalid_location');
  });

  it('returns none when nothing is within the search radius', () => {
    expect(decideCheckin(fix(), [venue('A', 2000)], NOW).status).toBe('none');
  });

  it('ignores duplicate ids and invalid venue points', () => {
    const bad = { id: 'X', name: 'X', venue_type: 'bar', latitude: Number.NaN, longitude: 0 };
    const d = decideCheckin(fix(), [venue('A', 10), venue('A', 11), bad], NOW);
    expect(d.status).toBe('suggest');
    if (d.status === 'suggest') expect(d.alternatives).toHaveLength(0);
  });

  it('never returns the raw device coordinates', () => {
    const device = { latitude: 41.5868123, longitude: -93.6110456 };
    const v: CheckinVenue = { id: 'A', name: 'A', venue_type: 'bar', latitude: 41.58690, longitude: -93.61100 };
    const d = decideCheckin({ ...device, accuracyM: 15, timestamp: NOW }, [v], NOW);
    expect(d.status).toBe('suggest');
    const text = JSON.stringify(d);
    expect(text).not.toContain('41.5868123');
    expect(text).not.toContain('-93.6110456');
  });
});

describe('search radius and bounds', () => {
  it('grows with GPS uncertainty within fixed bounds', () => {
    expect(checkinSearchRadiusM(0)).toBe(75);
    expect(checkinSearchRadiusM(40)).toBe(120);
    expect(checkinSearchRadiusM(1000)).toBe(300);
  });
  it('builds a box that contains the radius', () => {
    const b = boundsAround(here, 300);
    expect(haversineMeters(here, { latitude: b.maxLat, longitude: here.longitude })).toBeGreaterThanOrEqual(299);
    expect(haversineMeters(here, { latitude: here.latitude, longitude: b.maxLng })).toBeGreaterThanOrEqual(299);
  });
});

describe('shouldPromptCheckin', () => {
  const current = { venue: north(0), checkedInAt: NOW - 10 * 60_000 };
  it('prompts with no check-in, after expiry, or after moving away', () => {
    expect(shouldPromptCheckin(null, fix(), NOW)).toBe(true);
    expect(shouldPromptCheckin({ ...current, checkedInAt: NOW - 3 * 3600_000 }, fix(), NOW)).toBe(true);
    expect(shouldPromptCheckin(current, fix({ ...north(800) }), NOW)).toBe(true);
  });
  it('does not re-prompt while the person stays at the venue', () => {
    expect(shouldPromptCheckin(current, fix({ ...north(30) }), NOW)).toBe(false);
    expect(shouldPromptCheckin(current, null, NOW)).toBe(false);
  });
});
