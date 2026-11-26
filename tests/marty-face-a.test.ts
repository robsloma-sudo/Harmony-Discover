// P-20261126-0028 part 2: option A face rig (sound-shaped mouth, mood brows/eyes, head, blinks). Pure parts only.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOUTH_SHAPES, emptyMouth, restPose } from '../src/marty/faceRig/facePose';
import { featuresFrom, mouthAt, mouthFromAudio, openingFromRms, scriptFromText, visemesForWord, type AudioFeatures } from '../src/marty/faceRig/visemes';
import { expressionFor, moodFromText } from '../src/marty/faceRig/expression';
import { FaceEngine } from '../src/marty/faceRig/faceEngine';
import { headMove, layerOpacities, mouthOpacities } from '../src/marty/faceRig/rigLayout';

const vowel = (rms: number, mix: Partial<AudioFeatures>): AudioFeatures => ({ rms, low: 0.25, mid: 0.35, high: 0.3, hiss: 0.1, ...mix });
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];

describe('mouth from the sound of his voice', () => {
  it('stays shut on hiss-level noise and opens with loudness', () => {
    expect(openingFromRms(0.005)).toBe(0);
    expect(openingFromRms(0.05)).toBeGreaterThan(0.2);
    expect(openingFromRms(0.3)).toBe(1);
    expect(sum(mouthFromAudio(vowel(0.004, {})))).toBe(0);
  });
  it('picks different lip shapes for different sounds, not just open/close', () => {
    expect(top(mouthFromAudio(vowel(0.2, { low: 0.15, mid: 0.6, high: 0.2, hiss: 0.05 })))).toBe('wide'); // loud "ah"
    expect(['round', 'pucker']).toContain(top(mouthFromAudio(vowel(0.09, { low: 0.8, mid: 0.12, high: 0.05, hiss: 0.03 })))); // "oo/oh"
    expect(top(mouthFromAudio(vowel(0.05, { low: 0.1, mid: 0.15, high: 0.65, hiss: 0.1 })))).toBe('ee'); // "ee"
    expect(top(mouthFromAudio(vowel(0.06, { low: 0.05, mid: 0.05, high: 0.2, hiss: 0.7 })))).toBe('teeth'); // "s"
  });
  it('presses the lips in a short dip inside a phrase', () => {
    expect(mouthFromAudio(vowel(0.004, {}), true).press).toBeGreaterThan(0.5);
  });
  it('weights never add up past 1', () => {
    for (const rms of [0.02, 0.06, 0.12, 0.3]) for (const low of [0, 0.5, 0.9]) expect(sum(mouthFromAudio(vowel(rms, { low, mid: (1 - low) / 2, high: (1 - low) / 2, hiss: 0 })))).toBeLessThanOrEqual(1.0001);
  });
  it('reads bands from analyser bytes', () => {
    const freq = new Uint8Array(512); for (let i = 0; i < 11; i += 1) freq[i] = 255; // 0-500 Hz at 48 kHz / 1024
    const time = new Uint8Array(1024).map((_, i) => 128 + Math.round(40 * Math.sin(i / 5)));
    const f = featuresFrom(freq, time, 48000, 1024);
    expect(f.low).toBeGreaterThan(0.9);
    expect(f.rms).toBeGreaterThan(0.1);
  });
});

describe('mouth from words with timing', () => {
  it('m/b/p press, f/v bite, oo puckers, ee widens', () => {
    expect(visemesForWord('mob', 0, 300).map(k => k.shape)).toEqual(['press', 'round', 'press']);
    expect(visemesForWord('five', 0, 300)[0].shape).toBe('fv');
    expect(visemesForWord('food', 0, 300).map(k => k.shape)).toContain('pucker');
    expect(visemesForWord('see', 0, 300).map(k => k.shape)).toContain('ee');
  });
  it('a line becomes timed keys with pauses at punctuation', () => {
    const plan = scriptFromText("No. Absolutely not.");
    expect(plan.words.map(w => w.word)).toEqual(['No.', 'Absolutely', 'not.']);
    expect(plan.endMs).toBeGreaterThan(1200);
    const mid = mouthAt(plan.keys, plan.words[1].at + 60);
    expect(sum(mid)).toBeGreaterThan(0);
  });
});

describe('mood from his words', () => {
  it('annoyed, sarcastic, warm, neutral, question', () => {
    expect(moodFromText("No. Absolutely not. You don't put ice in a forty-dollar single malt.").mood).toBe('annoyed');
    expect(moodFromText('Oh, a vodka soda. Bold choice. Really pushing the boundaries tonight, huh?').mood).toBe('sarcastic');
    expect(moodFromText('Cheers, my friend. Lovely pour.').mood).toBe('warm');
    expect(moodFromText('That one is a rye from Kentucky.').mood).toBe('neutral');
    expect(moodFromText('What are you drinking tonight?').question).toBe(true);
  });
  it('annoyed scowls and squints; sarcastic raises one brow and tilts', () => {
    const an = expressionFor('annoyed', 1, 'talking');
    expect(an.scowl).toBeGreaterThan(0.8); expect(an.squint).toBeGreaterThan(0.8); expect(an.browOne).toBe(0);
    const sa = expressionFor('sarcastic', 1, 'talking');
    expect(sa.browOne).toBeGreaterThan(0.9); expect(sa.tilt).toBeGreaterThan(2); expect(sa.scowl).toBeLessThan(0.1);
  });
});

describe('engine', () => {
  const run = (e: FaceEngine, from: number, ms: number, input: Parameters<FaceEngine['step']>[2]) => { let p = e.current(); for (let t = from; t < from + ms; t += 16) p = e.step(16, t, input); return p; };
  it('opens within about 3 frames of loud speech (no visible lag) and closes after', () => {
    const e = new FaceEngine(() => 0.5, 0);
    const p = run(e, 0, 50, { audio: vowel(0.2, { mid: 0.6, low: 0.15 }) });
    expect(p.jaw).toBeGreaterThan(0.6);
    expect(p.talking).toBe(true);
    const q = run(e, 50, 600, { audio: vowel(0.001, {}) });
    expect(q.jaw).toBeLessThan(0.05);
    expect(q.talking).toBe(false);
  });
  it('angry words bring the scowl and squint; sarcastic words the one-brow raise', () => {
    const e = new FaceEngine(() => 0.5, 0);
    e.setMood(moodFromText("No. Absolutely not. Don't do that."), 0);
    const p = run(e, 0, 800, { audio: vowel(0.1, {}) });
    expect(p.scowl).toBeGreaterThan(0.6); expect(p.squint).toBeGreaterThan(0.5);
    const f = new FaceEngine(() => 0.5, 0);
    f.setMood(moodFromText('Oh, sure. Bold choice.'), 0);
    const r = run(f, 0, 800, { audio: vowel(0.1, {}) });
    expect(r.browOne).toBeGreaterThan(0.6); expect(r.tilt).toBeGreaterThan(1);
  });
  it('a loud stressed word nods the head', () => {
    const e = new FaceEngine(() => 0.5, 0);
    run(e, 0, 600, { audio: vowel(0.03, {}) });
    let maxNod = 0; let t = 600;
    for (; t < 900; t += 16) maxNod = Math.max(maxNod, e.step(16, t, { audio: vowel(0.25, { mid: 0.6, low: 0.15 }) }).nod);
    expect(maxNod).toBeGreaterThan(0.4);
  });
  it('blinks on its own and breathes', () => {
    const e = new FaceEngine(Math.random, 0);
    let blinked = false; let b0 = 1; let b1 = 0;
    for (let t = 0; t < 9000; t += 16) { const p = e.step(16, t, {}); if (p.blink > 0.9) blinked = true; b0 = Math.min(b0, p.breath); b1 = Math.max(b1, p.breath); }
    expect(blinked).toBe(true);
    expect(b1 - b0).toBeGreaterThan(0.9);
  });
  it('a demo line drives the mouth from its words', () => {
    const e = new FaceEngine(() => 0.5, 0);
    const w = emptyMouth(); w.round = 1;
    const p = run(e, 0, 120, { scriptMouth: w });
    expect(p.mouth.round).toBeGreaterThan(0.9); expect(p.talking).toBe(true);
  });
});

describe('rig layout', () => {
  it('stacked opacities give the exact weighted mix', () => {
    const ws = [0.2, 0.5, 0.1];
    const ops = layerOpacities(ws);
    // composite: start with base, each layer i blends op_i over what is below
    const contrib = [1, 0, 0, 0];
    ops.forEach((o, i) => { for (let k = 0; k <= i; k += 1) contrib[k] *= 1 - o; contrib[i + 1] = o; });
    expect(contrib[0]).toBeCloseTo(0.2); expect(contrib[1]).toBeCloseTo(0.2); expect(contrib[2]).toBeCloseTo(0.5); expect(contrib[3]).toBeCloseTo(0.1);
    expect(layerOpacities([0, 0])).toEqual([0, 0]);
  });
  it('mouth opacities cover all shapes; head moves stay small', () => {
    const p = restPose(); p.mouth.open = 0.6; p.mouth.ee = 0.4;
    const m = mouthOpacities(p);
    expect(Object.keys(m).sort()).toEqual([...MOUTH_SHAPES].sort());
    expect(m.ee).toBeCloseTo(1); // last non-zero layer fully on when the weights fill to 1
    p.nod = 1; p.tilt = 30; p.turn = 1;
    const h = headMove(p, 176);
    expect(h.rotateDeg).toBe(8); expect(Math.abs(h.translateY)).toBeLessThan(5); expect(Math.abs(h.translateX)).toBeLessThan(3);
  });
});

describe('guests keep today\'s face; pieces stay light', () => {
  it('MartyFace still uses PhotoFace and LiveFace is only on the hidden listening test', () => {
    expect(readFileSync('src/marty/MartyFace.tsx', 'utf8')).toMatch(/= PhotoFace;/);
    expect(readFileSync('src/marty/MartyOverlay.tsx', 'utf8')).not.toMatch(/LiveFace/);
    expect(readFileSync('app/listening-test.tsx', 'utf8')).toMatch(/<LiveFace/);
  });
  it('all rig pieces exist and stay under 100 KB together', () => {
    const names = [...MOUTH_SHAPES.map(k => `mouth-${k}`), 'scowl', 'brows-up', 'brow-one', 'squint'];
    let total = 0;
    for (const n of names) { const f = `assets/marty/rig/${n}.webp`; expect(existsSync(f)).toBe(true); total += statSync(f).size; }
    expect(total).toBeLessThan(100_000);
  });
});
