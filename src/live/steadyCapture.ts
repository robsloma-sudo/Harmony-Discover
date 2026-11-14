/**
 * Label pictures were being taken while the phone was moving: on a real
 * iPhone most label crops came back "blurry" and no name was ever confirmed.
 * Labels are now captured only at a steady, sharp moment.
 *
 * Every optical-flow tick (the small grey frame it already makes) gives a
 * sharpness score and the camera motion. A moment is steady when the camera
 * has been nearly still for a short while and the picture is about as sharp as
 * the sharpest frame of the last two seconds. Sharpness is compared only with
 * recent frames of the same scene, so no fixed threshold is needed.
 */

/** Mean absolute Laplacian over the central part of a grey frame (higher = sharper). */
export function frameSharpness(gray: ArrayLike<number>, width: number, height: number): number {
  const x0 = Math.max(1, Math.floor(width * 0.15)), x1 = Math.min(width - 1, Math.ceil(width * 0.85));
  const y0 = Math.max(1, Math.floor(height * 0.15)), y1 = Math.min(height - 1, Math.ceil(height * 0.85));
  let sum = 0, count = 0;
  for (let y = y0; y < y1; y += 2) {
    const row = y * width;
    for (let x = x0; x < x1; x += 2) {
      const i = row + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - width]! - gray[i + width]!;
      sum += lap < 0 ? -lap : lap;
      count++;
    }
  }
  return count ? sum / count : 0;
}

export type MotionSample = { tx: number; ty: number; scale: number };

/** Per-tick camera movement (fraction of the view) at which text starts to smear. */
export const STILL_MOTION = 0.003;
/** How long the camera must stay still before a capture. */
export const STILL_FOR_MS = 120;
/** A capture must be at least this sharp compared with the sharpest recent frame. */
export const SHARP_RATIO = 0.8;
const WINDOW_MS = 2000;

export class SteadyGate {
  private samples: Array<{ t: number; sharp: number }> = [];
  private stillSince: number | null = null;

  observe(t: number, sharpness: number, motion: MotionSample | null): void {
    const moving = !motion || Math.hypot(motion.tx, motion.ty) + Math.abs(motion.scale - 1) > STILL_MOTION;
    if (moving) this.stillSince = null;
    else if (this.stillSince === null) this.stillSince = t;
    this.samples.push({ t, sharp: sharpness });
    while (this.samples.length && t - this.samples[0]!.t > WINDOW_MS) this.samples.shift();
  }

  /** Current sharpness compared with the sharpest frame of the last two seconds (0..1). */
  sharpRatio(): number {
    const last = this.samples[this.samples.length - 1];
    if (!last) return 0;
    let best = 0;
    for (const sample of this.samples) best = Math.max(best, sample.sharp);
    return best > 0 ? last.sharp / best : 0;
  }

  steady(t: number): boolean {
    return this.stillSince !== null && t - this.stillSince >= STILL_FOR_MS && this.sharpRatio() >= SHARP_RATIO;
  }

  reset(): void { this.samples = []; this.stillSince = null; }
}
