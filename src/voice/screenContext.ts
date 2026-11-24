/**
 * "What's on screen" for Marty: a tiny in-memory store that screens publish to and the
 * Marty panel listens to, plus the short summary that is sent into the voice session
 * whenever it changes, so Marty can react to the menu, bottle or Journey/recipe in front of you.
 *
 * Only names, categories and prices are kept. No account, location or personal data.
 */

export interface ScreenMenuLine { name: string; price?: string; type?: string }
export interface ScreenBottle { brand?: string; product?: string; category?: string }
export interface ScreenJourney { kind: 'bottle' | 'menu_item' | 'recipe'; name: string; subtitle?: string }

export interface ScreenContext {
  menu: { title?: string; lines: ScreenMenuLine[] } | null;
  bottles: ScreenBottle[];
  journey: ScreenJourney | null;
}

export const EMPTY_SCREEN_CONTEXT: ScreenContext = { menu: null, bottles: [], journey: null };

const MAX_MENU_LINES = 12;
const MAX_BOTTLES = 3;
const MAX_TEXT = 80;
const MAX_SUMMARY = 900;

const clip = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

let current: ScreenContext = EMPTY_SCREEN_CONTEXT;
const listeners = new Set<(ctx: ScreenContext) => void>();

/** Screens call this with the parts they own; other parts are kept. */
export function publishScreenContext(part: Partial<ScreenContext>): void {
  const next = normalizeScreenContext({ ...current, ...part });
  if (screenContextKey(next) === screenContextKey(current)) return;
  current = next;
  listeners.forEach(fn => fn(current));
}

export function getScreenContext(): ScreenContext { return current; }

export function subscribeScreenContext(fn: (ctx: ScreenContext) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests only. */
export function _resetScreenContext(): void { current = EMPTY_SCREEN_CONTEXT; listeners.clear(); }

export function normalizeScreenContext(ctx: ScreenContext): ScreenContext {
  const lines = (ctx.menu?.lines ?? [])
    .map(l => ({ name: clip(l.name), price: clip(l.price), type: clip(l.type) }))
    .filter(l => l.name)
    .slice(0, MAX_MENU_LINES);
  const bottles = (ctx.bottles ?? [])
    .map(b => ({ brand: clip(b.brand), product: clip(b.product), category: clip(b.category) }))
    .filter(b => b.brand || b.product)
    .slice(0, MAX_BOTTLES);
  const journey = ctx.journey && clip(ctx.journey.name)
    ? { kind: ctx.journey.kind, name: clip(ctx.journey.name), subtitle: clip(ctx.journey.subtitle) }
    : null;
  return { menu: lines.length ? { title: clip(ctx.menu?.title), lines } : null, bottles, journey };
}

export function screenContextKey(ctx: ScreenContext): string { return JSON.stringify(ctx); }

export function isScreenContextEmpty(ctx: ScreenContext): boolean {
  return !ctx.menu && ctx.bottles.length === 0 && !ctx.journey;
}

/** Plain-language summary Marty reads. Kept short so it never crowds the conversation. */
export function summarizeScreenContext(ctx: ScreenContext): string {
  if (isScreenContextEmpty(ctx)) return 'On screen now: nothing scanned or open.';
  const parts: string[] = [];
  if (ctx.journey) {
    const what = ctx.journey.kind === 'recipe' ? 'recipe' : ctx.journey.kind === 'bottle' ? 'bottle Journey' : 'menu item Journey';
    parts.push(`Open now: the ${what} "${ctx.journey.name}"${ctx.journey.subtitle ? ` (${ctx.journey.subtitle})` : ''}.`);
  }
  if (ctx.bottles.length) {
    parts.push(`Bottle${ctx.bottles.length > 1 ? 's' : ''} in view: ${ctx.bottles.map(b => [b.brand, b.product].filter(Boolean).join(' ') + (b.category ? ` (${b.category})` : '')).join('; ')}.`);
  }
  if (ctx.menu) {
    parts.push(`Menu scanned${ctx.menu.title ? ` "${ctx.menu.title}"` : ''}: ${ctx.menu.lines.map(l => l.price ? `${l.name} ${l.price}` : l.name).join('; ')}.`);
  }
  return `On screen now (from the app, not said by the guest): ${parts.join(' ')}`.slice(0, MAX_SUMMARY);
}

/**
 * >>> PLACEHOLDER (P-20261124-2352 part 2): screen-context wire format. <<<
 * The Discover backend (part 1) will publish the exact field names for sending screen context.
 * Until its pull request lands, this sends the summary as a standard Realtime system message,
 * which needs no server change. When the backend names its fields, change ONLY this function.
 */
export function buildScreenContextEvent(ctx: ScreenContext): Record<string, unknown> & { type: string } {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: summarizeScreenContext(ctx) }] },
  };
}
