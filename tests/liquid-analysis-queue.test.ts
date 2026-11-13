import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiquidAnalysisQueue } from '../src/services/liquidAnalysisQueue';

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  posted: Array<{ message: any; transfer: Transferable[] }> = [];
  terminated = false;
  postMessage(message: any, transfer: Transferable[] = []) { this.posted.push({ message, transfer }); }
  terminate() { this.terminated = true; }
}

function frame(): ImageData {
  return { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) } as ImageData;
}
function track(trackId: number) {
  return { trackId, bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.7 } };
}

afterEach(() => vi.restoreAllMocks());

describe('LiquidAnalysisQueue', () => {
  it('keeps one job in flight and replaces queued work with the newest frame', () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const worker = new FakeWorker();
    const queue = new LiquidAnalysisQueue(() => undefined, () => worker as unknown as Worker);

    queue.submit(frame(), now, [track(1)]);
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0].message.tracks[0].trackId).toBe(1);

    now += 700;
    queue.submit(frame(), now, [track(2)]);
    now += 700;
    queue.submit(frame(), now, [track(3)]);
    expect(worker.posted).toHaveLength(1);

    worker.onmessage?.({ data: { id: 1, timestamp: 10_000, results: [] } } as MessageEvent);
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1].message.tracks[0].trackId).toBe(3);
    queue.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('discards stale pending frames rather than processing old pixels', () => {
    let now = 20_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const worker = new FakeWorker();
    const queue = new LiquidAnalysisQueue(() => undefined, () => worker as unknown as Worker);
    queue.submit(frame(), now, [track(1)]);
    now += 700;
    queue.submit(frame(), now, [track(2)]);
    now += 1500;
    worker.onmessage?.({ data: { id: 1, timestamp: 20_000, results: [] } } as MessageEvent);
    expect(worker.posted).toHaveLength(1);
    queue.dispose();
  });
});
