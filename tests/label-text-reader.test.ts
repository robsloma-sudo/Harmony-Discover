import { describe, expect, it } from 'vitest';
import * as workerModule from '../scripts/ocr-worker.mjs';
import { LabelTextReader, cylinderForCrop, textReaderEnabled, type TextWorkerLike } from '../src/live/labelTextReader';

type Box = { x0: number; y0: number; x1: number; y1: number; score?: number };
const w = workerModule as unknown as {
  detSize(width: number, height: number, longSide?: number): { width: number; height: number };
  detInput(rgba: Uint8ClampedArray, width: number, height: number, longSide?: number): { data: Float32Array; width: number; height: number };
  boxesFromProbability(prob: Float32Array, mapWidth: number, mapHeight: number, width: number, height: number, options?: Record<string, number>): Box[];
  largestBoxes(boxes: Box[], count?: number): Box[];
  recInput(rgba: Uint8ClampedArray, width: number, height: number, box: Box): { data: Float32Array; width: number; height: number } | null;
  ctcDecode(logits: Float32Array, steps: number, classes: number, chars: string[]): { text: string; confidence: number };
  recogniserChars(dictionary: string): string[];
  keepWord(text: string, confidence: number): boolean;
  unrollCylinder(rgba: Uint8ClampedArray, width: number, height: number, cylinder: { centerX: number; radius: number }, maxSin?: number): { rgba: Uint8ClampedArray; width: number; height: number; toUnrolled(x: number): number } | null;
  edgeness(box: Box, cylinder: { centerX: number; radius: number }): number;
};

function solid(width: number, height: number, value = 200) {
  const data = new Uint8ClampedArray(width * height * 4).fill(value);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return data;
}

describe('label text reader worker helpers', () => {
  it('sizes the detector input to multiples of 32 around 480 px', () => {
    expect(w.detSize(896, 600)).toEqual({ width: 480, height: 320 });
    expect(w.detSize(300, 900)).toEqual({ width: 160, height: 480 });
    const input = w.detInput(solid(64, 32), 64, 32, 64);
    expect(input.width).toBe(64);
    expect(input.data.length).toBe(3 * 64 * 32);
  });

  it('turns a blob of text probability into one grown word box in crop pixels', () => {
    const mapWidth = 40, mapHeight = 20, prob = new Float32Array(mapWidth * mapHeight);
    for (let y = 8; y < 12; y++) for (let x = 10; x < 30; x++) prob[y * mapWidth + x] = 0.9;
    prob[0] = 0.9; // a single speck is ignored
    const boxes = w.boxesFromProbability(prob, mapWidth, mapHeight, 400, 200);
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect(box.x0).toBeLessThan(100);
    expect(box.x1).toBeGreaterThan(300);
    expect(box.y0).toBeLessThan(80);
    expect(box.y1).toBeGreaterThan(120);
  });

  it('puts the biggest print first', () => {
    const small = { x0: 0, y0: 0, x1: 100, y1: 10 }, big = { x0: 0, y0: 20, x1: 100, y1: 60 };
    expect(w.largestBoxes([small, big], 1)).toEqual([big]);
  });

  it('prepares a 48 px high recogniser strip and turns tall boxes', () => {
    const rgba = solid(200, 200);
    const wide = w.recInput(rgba, 200, 200, { x0: 10, y0: 10, x1: 110, y1: 30 })!;
    expect(wide.height).toBe(48);
    expect(wide.width).toBe(240);
    const tall = w.recInput(rgba, 200, 200, { x0: 10, y0: 10, x1: 30, y1: 110 })!;
    expect(tall.width).toBe(240);
  });

  it('decodes CTC output: repeats merge, blanks split', () => {
    const chars = w.recogniserChars('A\nB\n');
    expect(chars).toEqual(['', 'A', 'B', ' ']);
    const steps = [1, 1, 0, 1, 2, 0];
    const logits = new Float32Array(steps.length * 4);
    steps.forEach((k, t) => { logits[t * 4 + k] = 0.9; });
    expect(w.ctcDecode(logits, steps.length, 4, chars).text).toBe('AAB');
  });

  it('keeps confident reads with at least two letters', () => {
    expect(w.keepWord('JAMESON', 0.9)).toBe(true);
    expect(w.keepWord('7%', 0.9)).toBe(false);
    expect(w.keepWord('JAMESON', 0.3)).toBe(false);
  });
});

describe('round bottles', () => {
  it('unrolls the label: edge columns get their real width back', () => {
    const width = 220, height = 4, rgba = solid(width, height);
    const cylinder = { centerX: 110, radius: 100 };
    const unrolled = w.unrollCylinder(rgba, width, height, cylinder, 0.999)!;
    // Half the circumference shown flat: about pi x radius wide.
    expect(unrolled.width).toBeGreaterThan(300);
    expect(unrolled.width).toBeLessThan(320);
    // The centre barely moves; a column near the edge moves out a lot.
    const mid = unrolled.toUnrolled(110), edge = unrolled.toUnrolled(200), farEdge = unrolled.toUnrolled(209);
    expect(Math.abs(mid - unrolled.width / 2)).toBeLessThan(2);
    expect(farEdge - edge).toBeGreaterThan(9 * 2);
  });

  it('knows which words sit towards the edge', () => {
    const cylinder = { centerX: 100, radius: 100 };
    expect(w.edgeness({ x0: 80, y0: 0, x1: 120, y1: 10 }, cylinder)).toBeCloseTo(0.2);
    expect(w.edgeness({ x0: 150, y0: 0, x1: 195, y1: 10 }, cylinder)).toBeCloseTo(0.95);
  });

  it('places the bottle in the label crop', () => {
    const crop = { sx: 100, sy: 0, sw: 400, sh: 600, outputWidth: 800, outputHeight: 1200 };
    const cylinder = cylinderForCrop({ x: 0.1, width: 0.2 }, crop, 1000)!;
    expect(cylinder.radius).toBe(200);
    expect(cylinder.centerX).toBe(200);
    expect(cylinderForCrop({ x: 0.1, width: 0 }, crop, 1000)).toBeNull();
  });
});

class FakeWorker implements TextWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  posted: Array<Record<string, unknown>> = [];
  terminated = false;
  constructor(private readonly behaviour: 'ok' | 'fail') {}
  postMessage(message: unknown) {
    const m = message as Record<string, unknown>;
    this.posted.push(m);
    queueMicrotask(() => {
      if (m.type === 'init') this.onmessage?.({ data: this.behaviour === 'ok' ? { type: 'ready', id: 0 } : { type: 'error', id: 0, message: 'no' } } as MessageEvent);
      if (m.type === 'read') this.onmessage?.({ data: { type: 'result', id: m.id, words: [{ text: 'JAMESON', confidence: 0.95, height: 40 }], detMs: 80, totalMs: 160, unrolledReads: 1 } } as MessageEvent);
    });
  }
  terminate() { this.terminated = true; }
}

const image = { width: 4, height: 2, data: new Uint8ClampedArray(32), colorSpace: 'srgb' } as ImageData;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('label text reader', () => {
  it('starts on first use, then reads', async () => {
    const fake = new FakeWorker('ok');
    const reader = new LabelTextReader(() => fake);
    expect(await reader.read(image, null)).toBeNull(); // still loading: the cloud read carries on
    await tick();
    const read = await reader.read(image, { centerX: 2, radius: 2 });
    expect(read?.words[0]?.text).toBe('JAMESON');
    expect(fake.posted.find(m => m.type === 'init')).toMatchObject({ detUrl: '/models/ocr/ppocr_v3_det.onnx' });
    reader.dispose();
    expect(fake.terminated).toBe(true);
  });

  it('gives up quietly when the reader cannot start', async () => {
    const reader = new LabelTextReader(() => new FakeWorker('fail'));
    reader.warmUp();
    await tick(); await tick();
    expect(reader.available).toBe(false);
    expect(await reader.read(image, null)).toBeNull();
  });
});

describe('where the phone text reader runs', () => {
  it('is off by default on phones and on by default on computers', () => {
    expect(textReaderEnabled('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe(false);
    expect(textReaderEnabled('Mozilla/5.0 (Linux; Android 14) Mobile Safari')).toBe(false);
    expect(textReaderEnabled('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15')).toBe(true);
  });
});
