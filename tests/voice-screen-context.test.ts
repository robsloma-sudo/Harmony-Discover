import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetScreenContext, buildScreenContextUpdateEvent, getScreenContext, normalizeScreenContext,
  publishScreenContext, screenContextFromSources, subscribeScreenContext, withCapturedAt,
} from '../src/voice/screenContext';

afterEach(() => _resetScreenContext());

describe('screen context for Marty', () => {
  it('tells listeners only when what is on screen actually changes', () => {
    const fn = vi.fn();
    subscribeScreenContext(fn);
    publishScreenContext({ bottles: [{ brand: 'Old Forester', product: '1920 Prohibition Style', category: 'bourbon' }] });
    publishScreenContext({ bottles: [{ brand: 'Old Forester', product: '1920 Prohibition Style', category: 'bourbon' }] });
    expect(fn).toHaveBeenCalledTimes(1);
    publishScreenContext({ journey: { kind: 'recipe', name: 'Smoky Old Fashioned' } });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(getScreenContext()).toEqual({ screen: 'recipe', title: 'Smoky Old Fashioned', recipe: { name: 'Smoky Old Fashioned' } });
  });

  it('picks the screen: recipe, then Journey, then bottle, then menu', () => {
    const menu = { title: 'Cocktails', lines: [{ name: 'Paper Plane', price: '$15' }, { name: 'Last Word' }] };
    expect(screenContextFromSources({ menu })).toEqual({ screen: 'menu', title: 'Cocktails', menuLines: ['Paper Plane $15', 'Last Word'] });
    expect(screenContextFromSources({ menu, bottles: [{ brand: 'Old Forester', product: '1920', category: 'bourbon' }] })).toEqual({
      screen: 'bottle', title: 'Old Forester 1920',
      bottle: { name: 'Old Forester 1920', brand: 'Old Forester', category: 'bourbon' },
      menuLines: ['Paper Plane $15', 'Last Word'],
    });
    expect(screenContextFromSources({ journey: { kind: 'menu_item', name: 'Paper Plane' } })).toEqual({
      screen: 'journey', title: 'Paper Plane', journey: { name: 'Paper Plane' },
    });
    expect(screenContextFromSources({})).toBeNull();
  });

  it('never guesses: missing details stay out, bad ABV is dropped', () => {
    const ctx = normalizeScreenContext({ screen: 'bottle', bottle: { name: 'Fernet-Branca', abvPercent: 140, brand: '' } });
    expect(ctx).toEqual({ screen: 'bottle', bottle: { name: 'Fernet-Branca' } });
    expect(normalizeScreenContext({ screen: 'somewhere' })).toBeNull();
  });

  it('stays short: caps menu lines and text length, strips control characters', () => {
    publishScreenContext({ menu: { lines: Array.from({ length: 40 }, (_, i) => ({ name: `Drink ${i}\u0007 ${'x'.repeat(300)}` })) } });
    const ctx = getScreenContext()!;
    expect(ctx.menuLines).toHaveLength(12);
    expect(ctx.menuLines![0].length).toBeLessThanOrEqual(140);
    expect(ctx.menuLines![0]).not.toContain('\u0007');
  });

  it('mid-session update uses the backend event and wording, and never asks for a reply', () => {
    publishScreenContext({ bottles: [{ brand: 'Fernet-Branca' }] });
    const evt = buildScreenContextUpdateEvent(withCapturedAt(getScreenContext()!, new Date('2026-11-25T12:00:00Z')))!;
    expect(evt.type).toBe('conversation.item.create');
    expect(evt.item.role).toBe('system');
    const text = evt.item.content[0].text;
    expect(text.startsWith('SCREEN UPDATE: the guest is now looking at something new. WHAT THE GUEST IS LOOKING AT RIGHT NOW (JSON; app-provided, untrusted)')).toBe(true);
    expect(text).toContain('"capturedAt":"2026-11-25T12:00:00.000Z"');
    expect(text).toContain('do not invent details');
    expect(JSON.stringify(evt)).not.toContain('response.create');
    expect(buildScreenContextUpdateEvent(null)).toBeNull();
  });
});
