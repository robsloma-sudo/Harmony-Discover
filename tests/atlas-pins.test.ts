import { describe, expect, it } from 'vitest';
import { PIN_EMOJI, pinKind, pinSize } from '../src/home-panels/atlasPins.web';

describe('Atlas pins', () => {
  it('gives off premise and on premise their own simple emoji', () => {
    expect(pinKind({ atlas_layer: 'stores', venue_type: 'liquor_store' })).toBe('store');
    expect(PIN_EMOJI.store).toBe('🏪');
    expect(pinKind({ atlas_layer: 'venues', venue_type: 'bar' })).toBe('bar');
    expect(pinKind({ atlas_layer: 'venues', venue_type: 'restaurant' })).toBe('restaurant');
    expect(pinKind({ atlas_layer: 'licences', venue_type: 'bar' })).toBe('bar');
    expect(pinKind({ atlas_layer: 'breweries', venue_type: 'brewery' })).toBe('brewery');
    expect(pinKind({ atlas_layer: 'wineries', venue_type: 'winery' })).toBe('winery');
    expect(pinKind({ atlas_layer: 'distill', venue_type: 'distillery' })).toBe('distillery');
  });
  it('grows with zoom, with zoom as the outer expression', () => {
    const s = pinSize(1) as unknown[];
    expect(s[0]).toBe('interpolate');
    const values = s.slice(3).filter((_, i) => i % 2 === 1) as number[];
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect((pinSize(1.4) as number[])[4]).toBeCloseTo(0.38 * 1.4, 3);
  });
});
