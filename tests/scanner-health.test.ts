import { describe, expect, it } from 'vitest';
import { checkPreviousScannerExit, markScannerRunning, markScannerStopped } from '../src/live/scannerHealth';

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
};

describe('scanner crash guard', () => {
  it('stays on the fast path after clean exits', () => {
    const store = memory();
    expect(checkPreviousScannerExit(1000, store)).toMatchObject({ allowGpu: true, lite: false });
    markScannerRunning('webgpu', 2000, store);
    markScannerStopped(store);
    expect(checkPreviousScannerExit(3000, store)).toMatchObject({ allowGpu: true, lite: false });
  });

  it('turns the GPU off after a crash while it was in use', () => {
    const store = memory();
    markScannerRunning('webgpu', 1000, store);
    // page killed: no stop recorded
    expect(checkPreviousScannerExit(5000, store)).toMatchObject({ allowGpu: false, lite: false });
    // the step-down persists across clean sessions
    markScannerRunning('wasm', 6000, store);
    markScannerStopped(store);
    expect(checkPreviousScannerExit(7000, store)).toMatchObject({ allowGpu: false, lite: false });
  });

  it('switches to the light mode after a crash on the CPU path', () => {
    const store = memory();
    markScannerRunning('wasm', 1000, store);
    expect(checkPreviousScannerExit(2000, store)).toMatchObject({ lite: true });
  });

  it('tries the fast path again after a day', () => {
    const store = memory();
    markScannerRunning('webgpu', 1000, store);
    checkPreviousScannerExit(2000, store);
    expect(checkPreviousScannerExit(2000 + 25 * 60 * 60_000, store)).toMatchObject({ allowGpu: true, lite: false });
  });
});
