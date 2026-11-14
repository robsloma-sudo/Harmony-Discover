/**
 * Diagnostics for testing on real phones: page starts (a tab that silently
 * reloads loses its found chips), chips added and uncaught errors go to a
 * DEV log function. No images, label text or user ids are sent.
 */
const base = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const startedAt = Date.now();
let starts = 0;

type LogEvent = { evt: 'page_start' | 'found_added' | 'client_error' | 'camera_start'; chips?: number; conf?: number; msg?: string; stack?: string };

export function clientLog(event: LogEvent): void {
  if (typeof window === 'undefined' || !base || !/\.netlify\.app$/.test(window.location.hostname)) return;
  try {
    void fetch(`${base}/functions/v1/discover-client-log`, {
      method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json', apikey: key },
      body: JSON.stringify({ ...event, page: window.location.pathname.slice(0, 40), starts, uptime_s: (Date.now() - startedAt) / 1000 }),
    }).catch(() => undefined);
  } catch { /* diagnostics never break the app */ }
}

let installed = false;
export function installClientLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    starts = Number(window.sessionStorage.getItem('discover.pageStarts') || '0') + 1;
    window.sessionStorage.setItem('discover.pageStarts', String(starts));
  } catch { starts = -1; }
  clientLog({ evt: 'page_start' });
  window.addEventListener('error', event => clientLog({ evt: 'client_error', msg: String(event.message || 'error'), stack: String((event.error as Error | undefined)?.stack || '') }));
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason as Error | undefined;
    clientLog({ evt: 'client_error', msg: 'unhandled: ' + String(reason?.message || reason || ''), stack: String(reason?.stack || '') });
  });
}
