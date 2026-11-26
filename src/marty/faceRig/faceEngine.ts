/**
 * Option A face engine: turns voice frames, words and the session state into a smooth FacePose, one step per frame.
 * Pure (time and randomness are passed in), so vitest can drive it frame by frame.
 */
import { emptyMouth, MOUTH_SHAPES, restPose, type FacePose, type Mood, type MouthWeights } from './facePose';
import { GATE, jawFromMouth, mouthFromAudio, openingFromRms, type AudioFeatures } from './visemes';
import { expressionFor, type MoodRead } from './expression';

export type EngineFaceState = 'idle' | 'listening' | 'thinking' | 'talking';
export interface EngineInput {
  /** This frame's voice features, or null when no audio is attached. */
  audio?: AudioFeatures | null;
  /** Mouth from timed words (demo line or the voice service's timing); wins over audio when given. */
  scriptMouth?: MouthWeights | null;
}

const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1, tau));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class FaceEngine {
  private pose: FacePose = restPose();
  private faceState: EngineFaceState = 'idle';
  private mood: Mood = 'neutral';
  private moodStrength = 0;
  private question = false;
  private lastTextAt = -1e9;
  private turnEndedAt = -1e9;
  private lastVoiceAt = -1e9;
  private voicedSince = -1e9;
  private slowOpen = 0;
  private emphasisAt = -1e9;
  private nextBlinkAt: number;
  private blinkStartedAt = -1e9;
  private doubleBlink = false;
  private wasTalking = false;
  private readonly phase: number[];

  constructor(private readonly rand: () => number = Math.random, now = 0) {
    this.nextBlinkAt = now + 1500 + rand() * 2500;
    this.phase = [rand(), rand(), rand(), rand()].map(v => v * Math.PI * 2);
  }

  setFaceState(s: EngineFaceState) { this.faceState = s; }

  /** Mood from Marty's words (or, later, from the server's own tag). */
  setMood(read: MoodRead, now: number) {
    this.lastTextAt = now;
    this.question = read.question;
    if (read.mood !== 'neutral') { this.mood = read.mood; this.moodStrength = Math.max(this.moodStrength * 0.6, read.strength); }
  }

  endTurn(now: number) { this.turnEndedAt = now; }

  current(): FacePose { return this.pose; }

  step(dt: number, now: number, input: EngineInput = {}): FacePose {
    const d = Math.max(0, Math.min(100, dt));
    const p = this.pose;
    const audio = input.audio ?? null;

    // --- voice: talking, short dips (lips press), emphasis
    const open = audio ? openingFromRms(audio.rms) : 0;
    const voiced = !!audio && audio.rms > GATE;
    if (voiced) { if (now - this.lastVoiceAt > 300) this.voicedSince = now; this.lastVoiceAt = now; }
    const scripted = !!input.scriptMouth;
    const talking = scripted || now - this.lastVoiceAt < 260;
    const pressing = !voiced && now - this.lastVoiceAt < 120 && now - this.voicedSince > 150;
    const target: MouthWeights = scripted ? input.scriptMouth! : audio ? mouthFromAudio(audio, pressing) : emptyMouth();
    const openNow = scripted ? jawFromMouth(target) : open;
    this.slowOpen = lerp(this.slowOpen, openNow, ease(d, 650));
    if (openNow > 0.55 && openNow > this.slowOpen * 1.5 + 0.08 && now - this.emphasisAt > 450) this.emphasisAt = now;

    // Mouth: fast to open, a touch slower to close, so it never flickers and never lags the voice.
    for (const k of MOUTH_SHAPES) {
      const cur = p.mouth[k]; const to = target[k];
      p.mouth[k] = lerp(cur, to, ease(d, to > cur ? 24 : 55));
      if (p.mouth[k] < 0.004) p.mouth[k] = 0;
    }
    p.jaw = jawFromMouth(p.mouth);

    // --- mood fades a few seconds after he stops talking
    if (now - Math.max(this.lastTextAt, this.turnEndedAt) > 3500 && !talking) {
      this.moodStrength = lerp(this.moodStrength, 0, ease(d, 1500));
      if (this.moodStrength < 0.05) { this.mood = 'neutral'; this.moodStrength = 0; }
    }
    if (now - this.turnEndedAt > 2500 && this.turnEndedAt > this.lastTextAt) this.question = false;
    p.mood = this.mood;

    // --- expression (brows, eyes, head) toward the mood's look, plus a flick on emphasis
    const ex = expressionFor(this.mood, this.moodStrength, talking ? 'talking' : this.faceState);
    const since = now - this.emphasisAt;
    const flick = since >= 0 && since < 420 ? Math.sin((Math.PI * since) / 420) : 0;
    const annoyed = this.mood === 'annoyed';
    const browUpT = ex.browUp + (this.question ? 0.45 : 0) + (annoyed ? 0 : 0.35 * flick);
    const scowlT = Math.min(1, ex.scowl + (annoyed ? 0.2 * flick : 0));
    const squintT = Math.min(1, ex.squint + (annoyed ? 0.12 * flick : 0));
    const browOneT = Math.min(1, ex.browOne + (this.mood === 'sarcastic' ? 0.15 * flick : 0));
    const exK = ease(d, 160);
    p.scowl = lerp(p.scowl, scowlT, exK);
    p.browUp = lerp(p.browUp, Math.min(1, browUpT) * (1 - p.scowl * 0.8), exK);
    p.browOne = lerp(p.browOne, browOneT, exK);
    p.squint = lerp(p.squint, squintT, exK);

    // --- head: slow idle drift, lively while talking, a small nod on each emphasis
    const t = now / 1000;
    const drift = Math.sin(t * 0.33 * Math.PI * 2 + this.phase[0]) * 0.7 + Math.sin(t * 0.71 * Math.PI * 2 + this.phase[1]) * 0.3;
    const lively = talking ? Math.sin(t * 1.15 * Math.PI * 2 + this.phase[2]) * (0.4 + this.slowOpen) : 0;
    const nodTarget = flick * 0.9 + (talking ? this.slowOpen * 0.18 : 0) + Math.sin(t * 0.27 * Math.PI * 2 + this.phase[3]) * 0.08;
    p.tilt = lerp(p.tilt, ex.tilt + drift * 0.8 + lively * 1.1, ease(d, 220));
    p.turn = lerp(p.turn, ex.turn + Math.sin(t * 0.19 * Math.PI * 2 + this.phase[1]) * 0.12 + lively * 0.1, ease(d, 260));
    p.nod = lerp(p.nod, nodTarget, ease(d, 70));
    p.breath = (Math.sin(t * (Math.PI * 2) / 4.2) + 1) / 2;

    // --- blinks: every 2-6 s, sometimes double, often right after a phrase ends; fewer while thinking
    if (this.wasTalking && !talking && this.rand() < 0.5) this.nextBlinkAt = Math.min(this.nextBlinkAt, now + 120 + this.rand() * 200);
    this.wasTalking = talking;
    if (now >= this.nextBlinkAt && now - this.blinkStartedAt > 300) {
      this.blinkStartedAt = now;
      this.doubleBlink = this.rand() < 0.15;
      const thinking = this.faceState === 'thinking';
      this.nextBlinkAt = now + (thinking ? 4000 : 2200) + this.rand() * (thinking ? 3000 : 3300);
    }
    const b = now - this.blinkStartedAt;
    const one = (x: number) => (x < 0 ? 0 : x < 60 ? x / 60 : x < 150 ? 1 - (x - 60) / 90 : 0);
    p.blink = Math.max(one(b), this.doubleBlink ? one(b - 190) : 0);

    p.talking = talking;
    return p;
  }
}
