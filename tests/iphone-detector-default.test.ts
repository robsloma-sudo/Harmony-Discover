import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectorBackendPreference, isAppleMobileDevice } from '../src/live/dfineWorkerProvider';

const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('which phones use the processor detector by default', () => {
  it('iPhones (any browser) and iPads, including iPad desktop mode', () => {
    expect(isAppleMobileDevice(IPHONE_CHROME, 5)).toBe(true);
    expect(isAppleMobileDevice(IPAD_DESKTOP_MODE, 5)).toBe(true);
  });
  it('not Macs, Windows PCs or Android phones', () => {
    expect(isAppleMobileDevice(IPAD_DESKTOP_MODE, 0)).toBe(false); // a real Mac has no touch screen
    expect(isAppleMobileDevice(WINDOWS, 0)).toBe(false);
    expect(isAppleMobileDevice(ANDROID, 5)).toBe(false);
  });
});

describe('detector engine choice', () => {
  let search = '';
  let stored: string | null = null;
  beforeEach(() => {
    search = ''; stored = null;
    vi.stubGlobal('location', { get search() { return search; } });
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: () => undefined, removeItem: () => undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('iPhone/iPad: processor by default (steady boxes, label reading keeps up)', () => {
    expect(detectorBackendPreference(true)).toBe('wasm');
  });
  it('computers: automatic (graphics chip when it passes its check)', () => {
    expect(detectorBackendPreference(false)).toBe('auto');
  });
  it('?detector=webgpu still forces the graphics chip on an iPhone for testing', () => {
    search = '?detector=webgpu';
    expect(detectorBackendPreference(true)).toBe('webgpu');
  });
  it('?detector=wasm forces the processor on a computer', () => {
    search = '?detector=wasm';
    expect(detectorBackendPreference(false)).toBe('wasm');
  });
});
