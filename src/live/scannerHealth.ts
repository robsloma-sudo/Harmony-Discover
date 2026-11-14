/**
 * Crash guard for the live scanner.
 *
 * When a phone runs out of memory it kills the page (blank screen) without
 * any event we can catch. So while the scanner runs it keeps a small
 * "running" record; a clean stop removes it. If the next visit finds the
 * record still there, the last session crashed, and the scanner steps down:
 * first off the GPU, then into a lighter (slower) mode. Step-downs expire
 * after a day so a fixed browser gets the faster path back.
 */
export type ScannerHealthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type Running = { backend: string; at: number };
type Crashes = { gpu: number; cpu: number; at: number };

const RUNNING_KEY = 'discover.scanner.running';
const CRASHES_KEY = 'discover.scanner.crashes';
const STEP_DOWN_MS = 24 * 60 * 60_000;

export type ScannerMode = { allowGpu: boolean; lite: boolean; crashes: { gpu: number; cpu: number } };

function safeStorage(storage?: ScannerHealthStorage | null): ScannerHealthStorage | null {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function readJson<T>(storage: ScannerHealthStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

/** Call once when the scanner starts: counts an unclean previous exit as a crash. */
export function checkPreviousScannerExit(now = Date.now(), storage?: ScannerHealthStorage | null): ScannerMode {
  const store = safeStorage(storage);
  if (!store) return { allowGpu: true, lite: false, crashes: { gpu: 0, cpu: 0 } };
  let crashes = readJson<Crashes>(store, CRASHES_KEY) ?? { gpu: 0, cpu: 0, at: 0 };
  if (now - crashes.at > STEP_DOWN_MS) crashes = { gpu: 0, cpu: 0, at: 0 };
  const running = readJson<Running>(store, RUNNING_KEY);
  if (running) {
    crashes = running.backend === 'webgpu'
      ? { ...crashes, gpu: crashes.gpu + 1, at: now }
      : { ...crashes, cpu: crashes.cpu + 1, at: now };
    try {
      store.setItem(CRASHES_KEY, JSON.stringify(crashes));
      store.removeItem(RUNNING_KEY);
    } catch { /* storage full or blocked */ }
  }
  return { allowGpu: crashes.gpu === 0, lite: crashes.cpu > 0, crashes: { gpu: crashes.gpu, cpu: crashes.cpu } };
}

/** Heartbeat while the scanner is running. */
export function markScannerRunning(backend: string, now = Date.now(), storage?: ScannerHealthStorage | null): void {
  const store = safeStorage(storage);
  try { store?.setItem(RUNNING_KEY, JSON.stringify({ backend, at: now } satisfies Running)); } catch { /* ignore */ }
}

/** Clean stop (scanner closed, page hidden, recognition off). */
export function markScannerStopped(storage?: ScannerHealthStorage | null): void {
  const store = safeStorage(storage);
  try { store?.removeItem(RUNNING_KEY); } catch { /* ignore */ }
}
