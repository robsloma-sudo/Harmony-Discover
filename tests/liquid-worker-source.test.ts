import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiquidLevelWorker } from '../src/services/liquidLevelDetector';

class FakeWorker {
  listeners: Record<string, Function> = {};
  addEventListener(name: string, listener: Function) { this.listeners[name] = listener; }
  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('self-contained liquid worker source', () => {
  it('builds a worker entrypoint with no imports or main-thread fallback', async () => {
    let captured: Blob | null = null;
    vi.stubGlobal('Worker', FakeWorker);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob) => {
      captured = blob;
      return 'blob:liquid-worker-test';
    });
    const worker = createLiquidLevelWorker();
    expect(worker).not.toBeNull();
    expect(captured).not.toBeNull();
    const source = await captured!.text();
    expect(source).toContain('self.onmessage');
    expect(source).toContain('multi_column_lab_transition');
    expect(source).toContain('severe_specular_glare');
    expect(source).not.toContain('import ');
  });
});
