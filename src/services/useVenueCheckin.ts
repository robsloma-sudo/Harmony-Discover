import { useCallback, useRef, useState } from 'react';
import { decideCheckin, checkinSearchRadiusM, shouldPromptCheckin, type CheckinDecision, type DeviceFix } from './venueCheckin';
import { findCheckinVenues, recordVenueCheckin, withdrawVenueCheckin, type CheckinSelection, type CheckinTrigger, type DiscoverVenue, type VenueCheckin } from './discoverVenueApi';

export type ActiveCheckin = VenueCheckin & { venue: { latitude: number; longitude: number }; checkedInAt: number };
export type CheckinPromptState = { decision: Extract<CheckinDecision<DiscoverVenue>, { status: 'suggest' | 'choose' }>; fix: DeviceFix; trigger: CheckinTrigger };

/** One-shot device fix. Web only today (navigator.geolocation); native returns null until expo-location is added. */
export function getDeviceFix(timeoutMs = 10000): Promise<DeviceFix | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyM: p.coords.accuracy, timestamp: p.timestamp || Date.now() }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

/**
 * After a scan: find the closest venue and ASK. Never checks in without a tap.
 * Declining is remembered for this place for the session, so the person is not nagged on every scan.
 */
export function useVenueCheckin() {
  const [active, setActive] = useState<ActiveCheckin | null>(null);
  const [prompt, setPrompt] = useState<CheckinPromptState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const declinedAt = useRef<{ fix: DeviceFix; at: number } | null>(null);
  const inFlight = useRef(false);

  const afterScan = useCallback(async (trigger: CheckinTrigger) => {
    if (inFlight.current || prompt) return;
    inFlight.current = true;
    try {
      const fix = await getDeviceFix();
      if (!fix) return;
      const now = Date.now();
      if (!shouldPromptCheckin(active ? { venue: active.venue, checkedInAt: active.checkedInAt } : null, fix, now)) return;
      const declined = declinedAt.current;
      if (declined && !shouldPromptCheckin({ venue: declined.fix, checkedInAt: declined.at }, fix, now, 30 * 60 * 1000)) return;
      const venues = await findCheckinVenues(fix.latitude, fix.longitude, checkinSearchRadiusM(fix.accuracyM));
      const decision = decideCheckin(fix, venues, Date.now());
      if (decision.status === 'suggest' || decision.status === 'choose') { setError(''); setPrompt({ decision, fix, trigger }); }
    } catch { /* a failed lookup never blocks scanning */ } finally { inFlight.current = false; }
  }, [active, prompt]);

  const confirm = useCallback(async (venue: DiscoverVenue, selection: CheckinSelection, shareScans: boolean) => {
    if (!prompt) return;
    setBusy(true); setError('');
    try {
      const fresh = (await getDeviceFix(6000)) ?? prompt.fix;
      const result = await recordVenueCheckin({
        venueRef: venue.id, trigger: prompt.trigger, selection, shareScans,
        device: { latitude: fresh.latitude, longitude: fresh.longitude, accuracyM: fresh.accuracyM },
      });
      setActive({ ...result, venue: { latitude: venue.latitude, longitude: venue.longitude }, checkedInAt: Date.now() });
      setPrompt(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Check-in failed.'); }
    finally { setBusy(false); }
  }, [prompt]);

  const dismiss = useCallback(() => {
    if (prompt) declinedAt.current = { fix: prompt.fix, at: Date.now() };
    setPrompt(null); setError('');
  }, [prompt]);

  const undo = useCallback(async () => {
    if (!active) return;
    try { await withdrawVenueCheckin(active.checkinId); setActive(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not undo the check-in.'); }
  }, [active]);

  return { active, prompt, busy, error, afterScan, confirm, dismiss, undo, startManual: setPrompt };
}
