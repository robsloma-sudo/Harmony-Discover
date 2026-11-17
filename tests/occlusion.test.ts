import { describe, expect, it } from 'vitest';
import { isNearer, occlusionForAll, occlusionOf } from '../src/live/occlusion';

// Boxes are fractions of the picture. A bottle further back stands higher (its base is higher up).
const knobCreek = { trackId: -1, x: 0.40, y: 0.30, width: 0.20, height: 0.60 };   // in front, base at 0.90

describe('labels partly hidden behind a nearer bottle, or cut off at the edge', () => {
  it('a canister standing behind and overlapping the front bottle is partial; the front one is not', () => {
    const canister = { trackId: -2, x: 0.30, y: 0.20, width: 0.18, height: 0.62 };  // base at 0.82
    expect(isNearer(knobCreek, canister)).toBe(true);
    const all = occlusionForAll([knobCreek, canister]);
    expect(all.get(-2)).toMatchObject({ partial: true, occluderId: -1 });
    expect(all.get(-1)?.partial).toBe(false);
  });

  it('a box that only touches the front bottle (the rest is hidden behind it) is partial', () => {
    const behind = { trackId: -3, x: 0.33, y: 0.22, width: 0.065, height: 0.58 };    // ends just left of the front bottle
    expect(occlusionOf(behind, [knobCreek, behind])).toMatchObject({ partial: true, occluderId: -1 });
  });

  it('bottles side by side on one shelf are not partial, whatever their size', () => {
    const tall = { trackId: -4, x: 0.10, y: 0.20, width: 0.12, height: 0.70 };        // base at 0.90
    const short = { trackId: -5, x: 0.225, y: 0.55, width: 0.12, height: 0.35 };      // base at 0.90, touching
    const all = occlusionForAll([tall, short]);
    expect(all.get(-4)?.partial).toBe(false);
    expect(all.get(-5)?.partial).toBe(false);
  });

  it('a label running into the side or bottom of the picture is cut off', () => {
    expect(occlusionOf({ trackId: -6, x: 0, y: 0.2, width: 0.1, height: 0.5 }, []).edgeCut).toBe(true);
    expect(occlusionOf({ trackId: -7, x: 0.4, y: 0.5, width: 0.1, height: 0.5 }, []).edgeCut).toBe(true);
    expect(occlusionOf({ trackId: -8, x: 0.4, y: 0.2, width: 0.1, height: 0.5 }, [])).toMatchObject({ partial: false, edgeCut: false });
  });
});
