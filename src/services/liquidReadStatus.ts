/**
 * Plain-words status for the liquid-level reader.
 *
 * Pure logic only (no React Native imports) so vitest can load it. It maps the
 * reject reasons from liquidOptics, liquidLevelDetector and liquidInterface into
 * one status the scan screen can show, so the app says "Can't read the level"
 * and why, instead of guessing or going blank.
 */

export type LiquidUnreadableReason =
  | 'glass_too_dark'
  | 'glare'
  | 'glare_or_dark'
  | 'line_not_clear'
  | 'label_or_hand'
  | 'edge_cut_off'
  | 'near_base'
  | 'not_enough_frames';

export type LiquidReadStatus =
  | { state: 'none' }
  /** Warming up: fewer than 3 good frames so far. Shows "Checking the level…", never a number. */
  | { state: 'checking'; at?: number }
  | { state: 'reading'; at?: number }
  | { state: 'unreadable'; reason: LiquidUnreadableReason; message: string; at?: number };

export const LIQUID_REASON_MESSAGES: Record<LiquidUnreadableReason, string> = {
  glass_too_dark: 'glass too dark',
  glare: 'glare',
  glare_or_dark: 'glare or glass too dark',
  line_not_clear: 'line not clear',
  label_or_hand: 'label or hand in the way',
  edge_cut_off: 'bottle cut off at frame edge',
  near_base: 'line too close to the base',
  not_enough_frames: 'not enough steady frames',
};

/**
 * A box (normalised 0..1) that touches or sits within this fraction of any frame
 * edge counts as cut off. 1.5% is about 10 px on a 640 px frame: the trackers clamp
 * boxes to 0..1, so a cut-off bottle lands exactly on the edge, and the margin
 * absorbs a few pixels of box jitter without rejecting bottles that merely sit near the edge.
 */
export const EDGE_CUT_OFF_MARGIN = 0.015;

/**
 * A line found in the bottom 12% of the box height is ignored unless the bottle has a
 * hand-measured record. Thick glass bases and punts on spirits bottles usually fill the
 * lowest 5-10% of the bottle; their inner/outer glass edge looks exactly like a liquid line.
 * 12% covers that with a little margin and still leaves nearly all real fill levels readable.
 * The detector already ignores the bottom 4%, so this removes the 4-12% band.
 */
export const BASE_ZONE_FRACTION = 0.12;

/** Frames the multi-frame check needs before it can agree (liquidInterface minFrames). */
export const LIQUID_WARMUP_FRAMES = 3;

/** A shown reading is dropped if it has not been refreshed for this long (ms). */
export const LIQUID_READING_MAX_AGE_MS = 3000;

export type NormalizedBox = { x: number; y: number; width: number; height: number };

const unreadable = (reason: LiquidUnreadableReason, at?: number): LiquidReadStatus =>
  ({ state: 'unreadable', reason, message: LIQUID_REASON_MESSAGES[reason], ...(at !== undefined ? { at } : {}) });

export function isCutOffAtFrameEdge(box: NormalizedBox, margin: number = EDGE_CUT_OFF_MARGIN): boolean {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return true;
  return box.y <= margin || box.y + box.height >= 1 - margin
    || box.x <= margin || box.x + box.width >= 1 - margin;
}

export function isInBaseZone(normalizedHeight: number): boolean {
  return normalizedHeight < BASE_ZONE_FRACTION;
}

/** Maps the optical-quality gate (web worker gives a reason string; native gives only a score). */
export function statusFromOptical(optical: { status?: string; score?: number; reason?: string }, at?: number): LiquidReadStatus | null {
  if (optical.reason === 'underexposed_or_opaque_crop') return unreadable('glass_too_dark', at);
  if (optical.reason === 'severe_specular_glare') return unreadable('glare', at);
  if (optical.status === 'observable' && (optical.score ?? 1) >= 0.55) return null;
  if (optical.status === undefined && (optical.score ?? 0) >= 0.55) return null;
  // Native gives only a score, so dark and glare cannot be told apart there.
  if (optical.reason === undefined) return unreadable('glare_or_dark', at);
  return unreadable('line_not_clear', at);
}

export type LiquidScreenInput = {
  box: NormalizedBox;
  optical: { status?: string; score?: number; reason?: string };
  result:
    | { status: 'candidate'; normalizedHeight: number; confidence: number; boundaryShape: string }
    | { status: 'insufficient_evidence' };
  /** True when label/hand suspicion bands were found on this bottle in this frame. */
  hadOcclusion?: boolean;
  /** True when this bottle has a valid hand-measured volume record. */
  hasMeasuredRecord: boolean;
  at?: number;
};

/**
 * Decides whether one frame's observation may be added to the bottle's history.
 * Returns null when it may; otherwise the unreadable status to show (and the
 * caller must clear the old reading and the history).
 */
export function screenLiquidObservation(input: LiquidScreenInput): LiquidReadStatus | null {
  const { at } = input;
  if (isCutOffAtFrameEdge(input.box)) return unreadable('edge_cut_off', at);
  const optical = statusFromOptical(input.optical, at);
  if (optical) return optical;
  const result = input.result;
  if (result.status !== 'candidate') return unreadable(input.hadOcclusion ? 'label_or_hand' : 'line_not_clear', at);
  if (result.confidence < 0.7 || result.boundaryShape === 'irregular') return unreadable('line_not_clear', at);
  if (!input.hasMeasuredRecord && isInBaseZone(result.normalizedHeight)) return unreadable('near_base', at);
  return null;
}

/** Maps the multi-frame consensus result (liquidInterface) to a status. */
export function statusFromConsensus(
  consensus: { status: 'visible' } | { status: 'insufficient_evidence' | 'occluded' | 'ambiguous'; frameIds: string[] },
  at?: number,
): LiquidReadStatus {
  if (consensus.status === 'visible') return { state: 'reading', ...(at !== undefined ? { at } : {}) };
  if (consensus.status === 'occluded') return unreadable('label_or_hand', at);
  if (consensus.status === 'ambiguous') return unreadable('line_not_clear', at);
  // insufficient_evidence with fewer than 3 frames so far is just warm-up (no reading, no alarm);
  // otherwise there were frames but too few confident, unblocked ones.
  if (consensus.frameIds.length < LIQUID_WARMUP_FRAMES) return { state: 'checking', ...(at !== undefined ? { at } : {}) };
  return unreadable('not_enough_frames', at);
}

type CarriedLiquid<L> = { liquidLevel?: L; liquidStatus?: LiquidReadStatus };

/**
 * What a bottle keeps from the previous frame when its box moves (web local tracker).
 * A reading is carried only while it is fresh and the box is not cut off at the
 * frame edge; an unreadable status is carried so the screen keeps explaining.
 */
export function carryLiquidState<L>(
  previous: CarriedLiquid<L> | undefined,
  box: NormalizedBox,
  now: number,
): CarriedLiquid<L> {
  if (!previous || !previous.liquidStatus) return {};
  if (isCutOffAtFrameEdge(box)) return { liquidStatus: unreadable('edge_cut_off', now) };
  const status = previous.liquidStatus;
  if (status.state === 'reading') {
    if (status.at !== undefined && now - status.at > LIQUID_READING_MAX_AGE_MS) return {};
    return { liquidLevel: previous.liquidLevel, liquidStatus: status };
  }
  return { liquidStatus: status };
}

export type LiquidLevelLike = { heightPercent: number; confidence: number; calibratedVolume?: { milliliters: number; fluidOunces: number } };

/** The words shown beside a bottle. Returns null when nothing was tried yet. */
export function describeLiquidLevel(
  level: LiquidLevelLike | undefined,
  status: LiquidReadStatus | undefined,
): { headline: string; detail: string; kind: 'amount' | 'line' | 'unreadable' | 'checking'; reason?: string } | null {
  if (level && (!status || status.state === 'reading')) {
    const signal = `${Math.round(level.confidence * 100)}% signal confidence.`;
    if (level.calibratedVolume) {
      return {
        kind: 'amount',
        headline: `FILL HEIGHT ~${level.heightPercent}%`,
        detail: `Visual fill height relative to the detected bottle bounds · ${signal} Calibrated volume: ${Math.round(level.calibratedVolume.milliliters)} ml / ${level.calibratedVolume.fluidOunces.toFixed(1)} fl oz.`,
      };
    }
    return {
      kind: 'line',
      headline: `Liquid line at ${level.heightPercent}% of bottle height (not an amount)`,
      detail: `${signal} No hand-measured amount applies to this reading.`,
    };
  }
  if (status && status.state === 'unreadable') {
    return { kind: 'unreadable', reason: status.message, headline: "Can't read the level", detail: `Can't read the level: ${status.message}.` };
  }
  if (status && status.state === 'checking') {
    return { kind: 'checking', headline: 'Checking the level…', detail: 'Checking the level: holding steady for a few frames before showing anything.' };
  }
  return null;
}
