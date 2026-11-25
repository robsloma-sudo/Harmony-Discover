import { describe, expect, it } from 'vitest';
import {
  BASE_ZONE_FRACTION, EDGE_CUT_OFF_MARGIN, carryLiquidState, describeLiquidLevel, isCutOffAtFrameEdge,
  screenLiquidObservation, statusFromConsensus, statusFromOptical, type LiquidReadStatus,
} from '../src/services/liquidReadStatus';
import { assessLiquidInterface } from '../src/services/liquidInterface';

const box = { x: 0.3, y: 0.2, width: 0.2, height: 0.6 };
const good = { status: 'observable', score: 0.9, reason: 'usable_optical_signal' };
const candidate = (normalizedHeight: number, over = {}) => ({ status: 'candidate' as const, normalizedHeight, confidence: 0.9, boundaryShape: 'flat', ...over });
const reasonOf = (s: LiquidReadStatus | null) => (s && s.state === 'unreadable' ? s.reason : null);

describe('reason mapping', () => {
  it('dark glass', () => {
    const s = statusFromOptical({ status: 'unobservable', score: 0.1, reason: 'underexposed_or_opaque_crop' });
    expect(s).toMatchObject({ state: 'unreadable', reason: 'glass_too_dark', message: 'glass too dark' });
  });
  it('glare', () => {
    expect(statusFromOptical({ status: 'unobservable', score: 0.1, reason: 'severe_specular_glare' })).toMatchObject({ reason: 'glare', message: 'glare' });
  });
  it('native score-only optical reject', () => {
    expect(reasonOf(statusFromOptical({ score: 0.3 }))).toBe('glare_or_dark');
    expect(statusFromOptical({ score: 0.8 })).toBeNull();
  });
  it('limited optical signal means line not clear', () => {
    expect(reasonOf(statusFromOptical({ status: 'limited', score: 0.35, reason: 'insufficient_local_optical_variation' }))).toBe('line_not_clear');
  });
  it('no candidate: line not clear, or label/hand when bands were found', () => {
    const base = { box, optical: good, result: { status: 'insufficient_evidence' as const }, hasMeasuredRecord: false };
    expect(reasonOf(screenLiquidObservation(base))).toBe('line_not_clear');
    expect(reasonOf(screenLiquidObservation({ ...base, hadOcclusion: true }))).toBe('label_or_hand');
  });
  it('low confidence and irregular shape: line not clear', () => {
    const base = { box, optical: good, hasMeasuredRecord: false };
    expect(reasonOf(screenLiquidObservation({ ...base, result: candidate(0.5, { confidence: 0.5 }) }))).toBe('line_not_clear');
    expect(reasonOf(screenLiquidObservation({ ...base, result: candidate(0.5, { boundaryShape: 'irregular' }) }))).toBe('line_not_clear');
  });
  it('a clear line passes', () => {
    expect(screenLiquidObservation({ box, optical: good, result: candidate(0.5), hasMeasuredRecord: false })).toBeNull();
  });
  it('consensus results map to statuses', () => {
    const o = (id: string, h: number, extra = {}) => ({ frameId: id, normalizedHeight: h, confidence: 0.9, ...extra });
    expect(statusFromConsensus(assessLiquidInterface([o('a', 0.5), o('b', 0.5), o('c', 0.5)]))).toEqual({ state: 'reading' });
    // Warm-up (fewer than 3 frames): 'checking', never a number and never an alarm.
    expect(statusFromConsensus(assessLiquidInterface([o('a', 0.5)]))).toEqual({ state: 'checking' });
    expect(describeLiquidLevel(undefined, { state: 'checking' })).toMatchObject({ kind: 'checking', headline: 'Checking the level…' });
    // Three frames but too few confident ones: can't read.
    expect(reasonOf(statusFromConsensus(assessLiquidInterface([o('a', 0.5, { confidence: 0.2 }), o('b', 0.5, { confidence: 0.2 }), o('c', 0.5)])))).toBe('not_enough_frames');
    expect(reasonOf(statusFromConsensus(assessLiquidInterface([o('a', 0.5, { occluded: true }), o('b', 0.5, { occluded: true }), o('c', 0.5, { occluded: true })])))).toBe('label_or_hand');
    expect(reasonOf(statusFromConsensus(assessLiquidInterface([o('a', 0.3), o('b', 0.5), o('c', 0.7)])))).toBe('line_not_clear');
  });
});

describe('frame-edge cut-off', () => {
  it('flags a box touching or within the margin of any edge', () => {
    expect(EDGE_CUT_OFF_MARGIN).toBe(0.015);
    expect(isCutOffAtFrameEdge({ x: 0.3, y: 0, width: 0.2, height: 0.5 })).toBe(true);
    expect(isCutOffAtFrameEdge({ x: 0.3, y: 0.5, width: 0.2, height: 0.5 })).toBe(true);
    expect(isCutOffAtFrameEdge({ x: 0.3, y: 0.01, width: 0.2, height: 0.5 })).toBe(true);
    expect(isCutOffAtFrameEdge({ x: 0, y: 0.2, width: 0.2, height: 0.5 })).toBe(true);
    expect(isCutOffAtFrameEdge({ x: 0.8, y: 0.2, width: 0.2, height: 0.5 })).toBe(true);
    expect(isCutOffAtFrameEdge(box)).toBe(false);
  });
  it('gives no reading for a cut-off bottle even with a perfect line, and wins over a measured record', () => {
    const cut = { x: 0.3, y: 0, width: 0.2, height: 0.6 };
    for (const measured of [false, true]) {
      const s = screenLiquidObservation({ box: cut, optical: good, result: candidate(0.5), hasMeasuredRecord: measured });
      expect(s).toMatchObject({ state: 'unreadable', reason: 'edge_cut_off', message: 'bottle cut off at frame edge' });
    }
  });
});

describe('base zone', () => {
  it('ignores a line in the bottom 12% without a measured record', () => {
    expect(BASE_ZONE_FRACTION).toBe(0.12);
    const s = screenLiquidObservation({ box, optical: good, result: candidate(0.08), hasMeasuredRecord: false });
    expect(s).toMatchObject({ reason: 'near_base', message: 'line too close to the base' });
    expect(screenLiquidObservation({ box, optical: good, result: candidate(0.12), hasMeasuredRecord: false })).toBeNull();
  });
  it('keeps the line with a measured record', () => {
    expect(screenLiquidObservation({ box, optical: good, result: candidate(0.08), hasMeasuredRecord: true })).toBeNull();
  });
});

describe('stale reading cleared (web carry-over)', () => {
  const level = { heightPercent: 52, confidence: 0.9 };
  it('carries a fresh reading', () => {
    const out = carryLiquidState({ liquidLevel: level, liquidStatus: { state: 'reading', at: 1000 } }, box, 2000);
    expect(out.liquidLevel).toBe(level);
  });
  it('drops a reading that is no longer refreshed', () => {
    expect(carryLiquidState({ liquidLevel: level, liquidStatus: { state: 'reading', at: 1000 } }, box, 5000)).toEqual({});
  });
  it('drops the % and says cut off once the box reaches the frame edge', () => {
    const out = carryLiquidState({ liquidLevel: level, liquidStatus: { state: 'reading', at: 1000 } }, { ...box, y: 0 }, 1500);
    expect(out.liquidLevel).toBeUndefined();
    expect(reasonOf(out.liquidStatus ?? null)).toBe('edge_cut_off');
  });
  it('an unreadable frame replaces the reading: nothing carried but the reason', () => {
    const rejected = screenLiquidObservation({ box, optical: { status: 'unobservable', score: 0.1, reason: 'severe_specular_glare' }, result: candidate(0.5), hasMeasuredRecord: false, at: 1600 });
    expect(rejected).not.toBeNull();
    const out = carryLiquidState({ liquidLevel: undefined, liquidStatus: rejected! }, box, 1700);
    expect(out.liquidLevel).toBeUndefined();
    expect(reasonOf(out.liquidStatus ?? null)).toBe('glare');
  });
});

describe('label text', () => {
  it('without a measured record', () => {
    expect(describeLiquidLevel({ heightPercent: 52, confidence: 0.9 }, { state: 'reading' })?.headline)
      .toBe('Liquid line at 52% of bottle height (not an amount)');
  });
  it('with a measured record keeps the amount', () => {
    const d = describeLiquidLevel({ heightPercent: 52, confidence: 0.9, calibratedVolume: { milliliters: 350, fluidOunces: 11.8 } }, { state: 'reading' });
    expect(d?.headline).toBe('FILL HEIGHT ~52%');
    expect(d?.detail).toContain('350 ml / 11.8 fl oz');
  });
  it('unreadable shows the reason; not tried shows nothing; stale level is not shown when unreadable', () => {
    const s = statusFromOptical({ status: 'unobservable', score: 0.1, reason: 'severe_specular_glare' })!;
    const d = describeLiquidLevel({ heightPercent: 52, confidence: 0.9 }, s);
    expect(d).toMatchObject({ kind: 'unreadable', headline: "Can't read the level", reason: 'glare' });
    expect(describeLiquidLevel(undefined, undefined)).toBeNull();
    expect(describeLiquidLevel(undefined, { state: 'none' })).toBeNull();
  });
});
