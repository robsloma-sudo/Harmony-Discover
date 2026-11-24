import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetScreenContext, buildScreenContextEvent, getScreenContext, publishScreenContext,
  subscribeScreenContext, summarizeScreenContext,
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
    expect(getScreenContext().bottles).toHaveLength(1);
  });

  it('summary names the open bottle, the menu lines and the Journey so Marty can react to them', () => {
    publishScreenContext({
      menu: { title: 'Cocktails', lines: [{ name: 'Paper Plane', price: '$15' }, { name: 'Last Word', price: '$16' }] },
      bottles: [{ brand: 'Old Forester', product: '1920', category: 'bourbon' }],
      journey: { kind: 'menu_item', name: 'Paper Plane' },
    });
    const text = summarizeScreenContext(getScreenContext());
    expect(text).toContain('Old Forester 1920 (bourbon)');
    expect(text).toContain('Paper Plane $15');
    expect(text).toContain('Last Word $16');
    expect(text).toContain('menu item Journey "Paper Plane"');
    expect(text.length).toBeLessThanOrEqual(900);
  });

  it('stays small: caps menu lines, bottles and text length', () => {
    publishScreenContext({
      menu: { lines: Array.from({ length: 40 }, (_, i) => ({ name: `Drink ${i} ${'x'.repeat(200)}` })) },
      bottles: Array.from({ length: 10 }, (_, i) => ({ brand: `B${i}` })),
    });
    const ctx = getScreenContext();
    expect(ctx.menu?.lines).toHaveLength(12);
    expect(ctx.bottles).toHaveLength(3);
    expect(ctx.menu!.lines[0].name.length).toBeLessThanOrEqual(80);
  });

  it('sends as one system message item (placeholder until the backend names its fields)', () => {
    publishScreenContext({ bottles: [{ brand: 'Fernet-Branca' }] });
    const evt = buildScreenContextEvent(getScreenContext()) as { type: string; item: { role: string; content: Array<{ text: string }> } };
    expect(evt.type).toBe('conversation.item.create');
    expect(evt.item.role).toBe('system');
    expect(evt.item.content[0].text).toContain('Fernet-Branca');
  });
});
