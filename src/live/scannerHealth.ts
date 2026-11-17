/**
 * Crash guard for the live scanner.
 *
 * When a phone runs out of memory it kills the page (blank screen) without
 * any event we can catch. So while the scanner runs it keeps a small
 * "running" record; a clean stop removes it. If the next visit finds the
 * record still there, the last session crashed, and the scanner steps down:
 * first off the GPU, then into a lighter (slower) mode. Step-downs expire
 * after a day so a fixed browser gets the faster path back.
 *
 * If the phone text reader (Quick Guess) was running when the page died, the reader is the likely cause
 * (it adds a second model engine): Quick Guess is switched off and the detector keeps its fast path.
 * Storage keys are versioned (v2, 17 Nov 2026) so step-downs that today's Quick Guess crashes wrongly
 * charged to the detector are forgotten.
 */
export type ScannerHealthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type Running = { backend: string; at: number };
type Crashes = { gpu: number; cpu: number; at: number };

const RUNNING_KEY = 'discover.scanner.running.v2';
const CRASHES_KEY = 'discover.scanner.crashes.v2';
const TEXT_READER_KEY = 'discover.scanner.textreader.v2';
/** Same key as Settings > Quick Guess and ?ocr=on/off. */
const QUICK_GUESS_KEY = 'discover.ocr';
const STEP_DOWN_MS = 24 * 60 * 60_000;

export type ScannerMode = { allowGpu: boolean; lite: boolean; crashes: { gpu: number; cpu: number }; quickGuessTurnedOff?: boolean };

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
  const readerWasOn = (() => { try { return store.getItem(TEXT_READER_KEY) === '1'; } catch { return false; } })();
  try { store.removeItem(TEXT_READER_KEY); } catch { /* ignore */ }
  if (running && readerWasOn) {
    // The page died with the text reader running: turn Quick Guess off, keep the detector on its fast path.
    try {
      store.setItem(QUICK_GUESS_KEY, 'off');
      store.removeItem(RUNNING_KEY);
    } catch { /* storage full or blocked */ }
    return { allowGpu: crashes.gpu === 0, lite: crashes.cpu > 0, crashes: { gpu: crashes.gpu, cpu: crashes.cpu }, quickGuessTurnedOff: true };
  }
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

/** Quick Guess text reader started (true) or stopped (false), so a crash while it runs is charged to it. */
export function markTextReaderRunning(on: boolean, storage?: ScannerHealthStorage | null): void {
  const store = safeStorage(storage);
  try { if (on) store?.setItem(TEXT_READER_KEY, '1'); else store?.removeItem(TEXT_READER_KEY); } catch { /* ignore */ }
}
