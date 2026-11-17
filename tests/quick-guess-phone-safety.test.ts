import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPhoneUserAgent, textReaderEnabled } from '../src/live/labelTextReader';
import { checkPreviousScannerExit, markScannerRunning, markScannerStopped, markTextReaderRunning } from '../src/live/scannerHealth';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15';

const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
};

describe('Quick Guess on phones', () => {
  let store: ReturnType<typeof memory>;
  let search = '';
  beforeEach(() => {
    store = memory(); search = '';
    vi.stubGlobal('localStorage', store);
    vi.stubGlobal('location', { get search() { return search; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('recognises phones and computers', () => {
    expect(isPhoneUserAgent(IPHONE)).toBe(true);
    expect(isPhoneUserAgent(MAC)).toBe(false);
  });

  it('ignores a remembered Settings "on" on a phone (it ran iPhones out of memory)', () => {
    store.setItem('discover.ocr', 'on');
    expect(textReaderEnabled(IPHONE)).toBe(false);
    expect(textReaderEnabled(MAC)).toBe(true);
  });

  it('lets a phone test it for one visit with ?ocr=on, without remembering it', () => {
    search = '?ocr=on';
    expect(textReaderEnabled(IPHONE)).toBe(true);
    expect(store.getItem('discover.ocr')).toBeNull();
    search = '';
    expect(textReaderEnabled(IPHONE)).toBe(false);
  });

  it('keeps computers unchanged: on by default, Settings "off" respected', () => {
    expect(textReaderEnabled(MAC)).toBe(true);
    store.setItem('discover.ocr', 'off');
    expect(textReaderEnabled(MAC)).toBe(false);
  });
});

describe('crash guard blames the text reader, not the detector', () => {
  it('turns Quick Guess off and keeps the graphics chip after a crash while the reader ran', () => {
    const store = memory();
    markScannerRunning('webgpu', 1000, store);
    markTextReaderRunning(true, store);
    // page killed: no clean stop
    const mode = checkPreviousScannerExit(5000, store);
    expect(mode).toMatchObject({ allowGpu: true, lite: false, quickGuessTurnedOff: true });
    expect(store.getItem('discover.ocr')).toBe('off');
    // the next clean visit is back to normal, still on the fast path
    expect(checkPreviousScannerExit(6000, store)).toMatchObject({ allowGpu: true, lite: false });
  });

  it('still steps the detector down for a crash without the reader', () => {
    const store = memory();
    markScannerRunning('webgpu', 1000, store);
    markTextReaderRunning(true, store);
    markTextReaderRunning(false, store);
    expect(checkPreviousScannerExit(5000, store)).toMatchObject({ allowGpu: false });
  });

  it('a clean stop with the reader on is not a crash', () => {
    const store = memory();
    markScannerRunning('webgpu', 1000, store);
    markTextReaderRunning(true, store);
    markScannerStopped(store);
    expect(checkPreviousScannerExit(5000, store)).toMatchObject({ allowGpu: true, lite: false });
  });

  it('forgets step-downs recorded under the old storage names (today\'s Quick Guess crashes)', () => {
    const store = memory();
    store.setItem('discover.scanner.crashes', JSON.stringify({ gpu: 1, cpu: 1, at: 4000 }));
    store.setItem('discover.scanner.running', JSON.stringify({ backend: 'wasm', at: 4500 }));
    expect(checkPreviousScannerExit(5000, store)).toMatchObject({ allowGpu: true, lite: false });
  });
});
