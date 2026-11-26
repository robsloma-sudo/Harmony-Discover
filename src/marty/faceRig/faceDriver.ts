/**
 * Option A face driver (web): reads Marty's voice audio and words and runs the FaceEngine once per animation frame.
 * Light on phones: one AnalyserNode (1024 samples), two small reads per frame, no React re-render (LiveFace listens).
 */
import type { FacePose } from './facePose';
import { FaceEngine, type EngineFaceState } from './faceEngine';
import { moodFromText, type MoodRead } from './expression';
import { featuresFrom, mouthAt, scriptFromText, visemesForWord, type AudioFeatures, type VisemeKey } from './visemes';

/*
 * TODO(P-20261126-0028 backend contract): the Discover backend PR will name the fields for the voice service's own
 * sound/word timing. Map them to SpeechMark below and call FaceDriver.pushSpeechMarks() as they arrive; until then
 * the face works from the audio alone. Times are ms from the start of that reply's audio.
 */
export interface SpeechMark { kind: 'word' | 'viseme'; value: string; startMs: number; endMs?: number }

export interface FaceDriver {
  /** Analyse a voice stream that is already playing elsewhere (never routed to the speakers here). */
  attachStream(stream: MediaStream): void;
  /** Analyse an AnalyserNode the caller wires into its own playback graph. */
  attachAnalyser(node: AnalyserNode): void;
  detachAudio(): void;
  /** Marty's words as they arrive (transcript deltas); used for mood (annoyed, sarcastic) and emphasis. */
  pushMartyText(delta: string): void;
  /** A mood tag from the server, if it ever sends one; wins over the word rules. */
  pushMood(read: MoodRead): void;
  /** Word/sound timing for the reply now playing (see SpeechMark). */
  pushSpeechMarks(marks: SpeechMark[]): void;
  /** Marty finished a reply (or was cut off). */
  endMartyTurn(): void;
  /** Idle / listening / thinking from the session (talking is worked out from the voice). */
  setFaceState(s: EngineFaceState): void;
  /** Demo: perform a line. speak=true uses the browser's own speech voice when it has one. */
  playScript(text: string, opts?: { speak?: boolean }): Promise<void>;
  stopScript(): void;
  /** Latest pose; subscribers get one per animation frame. */
  current(): FacePose;
  subscribe(fn: (pose: FacePose) => void): () => void;
  dispose(): void;
}

type Ctx = typeof AudioContext;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createFaceDriver(): FaceDriver {
  const engine = new FaceEngine(Math.random, now());
  const subs = new Set<(p: FacePose) => void>();
  let raf: number | null = null;
  let last = now();
  let analyser: AnalyserNode | null = null;
  let ownCtx: AudioContext | null = null;
  let freq: Uint8Array | null = null;
  let time: Uint8Array | null = null;
  let replyText = '';
  let script: { keys: VisemeKey[]; t0: number; end: number } | null = null;
  let marks: { keys: VisemeKey[]; t0: number; end: number } | null = null;
  let scriptDone: (() => void) | null = null;
  let disposed = false;

  const hasRaf = typeof requestAnimationFrame === 'function';

  function readAudio(): AudioFeatures | null {
    if (!analyser || !freq || !time) return null;
    try {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);
      return featuresFrom(freq, time, analyser.context.sampleRate, analyser.fftSize);
    } catch { return null; }
  }

  function frame() {
    raf = null;
    if (disposed) return;
    const t = now();
    const dt = t - last; last = t;
    let scriptMouth = null;
    const timed = script ?? marks;
    if (timed) {
      const local = t - timed.t0;
      if (local > timed.end) {
        if (timed === script) { script = null; const done = scriptDone; scriptDone = null; engine.endTurn(t); done?.(); } else marks = null;
      } else scriptMouth = mouthAt(timed.keys, local);
    }
    const pose = engine.step(dt, t, { audio: readAudio(), scriptMouth });
    subs.forEach(fn => { try { fn(pose); } catch { /* a bad listener never stops the face */ } });
    schedule();
  }
  function schedule() { if (hasRaf && raf === null && subs.size && !disposed) raf = requestAnimationFrame(frame); }

  function useAnalyser(node: AnalyserNode) {
    analyser = node;
    freq = new Uint8Array(node.frequencyBinCount);
    time = new Uint8Array(node.fftSize);
  }

  function stopSpeech() {
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* none */ }
  }

  const driver: FaceDriver = {
    attachStream(stream) {
      driver.detachAudio();
      const C = (globalThis as { AudioContext?: Ctx; webkitAudioContext?: Ctx }).AudioContext ?? (globalThis as { webkitAudioContext?: Ctx }).webkitAudioContext;
      if (!C) return;
      try {
        const ctx = new C(); ownCtx = ctx;
        const node = ctx.createAnalyser(); node.fftSize = 1024; node.smoothingTimeConstant = 0.3;
        ctx.createMediaStreamSource(stream).connect(node); // analysis only, not to the speakers
        void ctx.resume?.().catch(() => undefined);
        useAnalyser(node);
      } catch { driver.detachAudio(); }
    },
    attachAnalyser(node) { driver.detachAudio(); useAnalyser(node); },
    detachAudio() {
      analyser = null; freq = null; time = null;
      if (ownCtx) { void ownCtx.close().catch(() => undefined); ownCtx = null; }
    },
    pushMartyText(delta) {
      if (!delta) return;
      replyText = (replyText + delta).slice(-400);
      engine.setMood(moodFromText(replyText), now());
    },
    pushMood(read) { engine.setMood(read, now()); },
    pushSpeechMarks(list) {
      const keys: VisemeKey[] = [];
      for (const m of list) {
        if (m.kind === 'word') keys.push(...visemesForWord(m.value, m.startMs, Math.max(80, (m.endMs ?? m.startMs + 250) - m.startMs)));
        // TODO(P-20261126-0028 backend contract): map the voice service's own viseme names here when they are known.
      }
      if (!keys.length) return;
      keys.sort((a, b) => a.at - b.at);
      const end = Math.max(...list.map(m => m.endMs ?? m.startMs + 250));
      marks = marks && now() - marks.t0 < marks.end ? { ...marks, keys: [...marks.keys, ...keys].sort((a, b) => a.at - b.at), end: Math.max(marks.end, end) } : { keys, t0: now(), end };
    },
    endMartyTurn() { engine.endTurn(now()); replyText = ''; },
    setFaceState(s) { engine.setFaceState(s); },
    playScript(text, opts) {
      driver.stopScript();
      engine.setMood(moodFromText(text), now());
      const plan = scriptFromText(text);
      return new Promise<void>(resolve => {
        scriptDone = resolve;
        const startClock = () => { script = { keys: plan.keys, t0: now(), end: plan.endMs }; schedule(); };
        const synth = opts?.speak && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined' ? speechSynthesis : null;
        if (!synth) { startClock(); return; }
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 0.95; u.pitch = 0.75;
          let started = false;
          u.onstart = () => { started = true; startClock(); };
          // Word timing from the browser voice: re-align the mouth to each word as it is spoken.
          u.onboundary = e => {
            if (!script || e.name === 'sentence') return;
            const before = text.slice(0, e.charIndex).split(/\s+/).filter(Boolean).length;
            const w = plan.words[before];
            if (w) script.t0 = now() - w.at;
          };
          u.onend = () => { if (script) script.end = Math.min(script.end, now() - script.t0 + 1); };
          u.onerror = () => { if (!started) startClock(); };
          synth.speak(u);
          // Some phones never fire onstart without a voice: fall back to the clock.
          setTimeout(() => { if (!started && scriptDone === resolve) { started = true; startClock(); } }, 700);
        } catch { startClock(); }
      });
    },
    stopScript() {
      stopSpeech();
      script = null;
      const done = scriptDone; scriptDone = null; done?.();
    },
    current: () => engine.current(),
    subscribe(fn) {
      subs.add(fn);
      last = now();
      schedule();
      return () => { subs.delete(fn); if (!subs.size && raf !== null && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(raf); raf = null; } };
    },
    dispose() {
      disposed = true;
      driver.stopScript();
      driver.detachAudio();
      subs.clear();
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = null;
    },
  };
  return driver;
}
