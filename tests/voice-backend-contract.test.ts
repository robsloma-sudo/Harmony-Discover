/**
 * Proves the app's Marty fields match the Discover backend (PR #131, P-20261124-2352 part 1) by name.
 * The names below are copied from supabase/functions/discover-voice-session/README.md on #131.
 * Once #131 is on main, the second block also runs the backend's own cleaner over the app's output.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_CONTEXT_LIMITS, SCREEN_KINDS, normalizeScreenContext, screenContextFromSources, withCapturedAt, type ScreenContext } from '../src/voice/screenContext';
import { validateVoiceSessionGrant } from '../src/voice/sessionContract';
import { requestVoiceSession } from '../src/voice/voiceSessionClient';

const BACKEND = {
  screens: ['menu', 'bottle', 'journey', 'recipe', 'other'],
  screenContextKeys: ['screen', 'title', 'menuLines', 'bottle', 'journey', 'recipe', 'capturedAt'],
  bottleKeys: ['name', 'brand', 'category', 'abvPercent'],
  journeyKeys: ['name', 'stepTitle'],
  recipeKeys: ['name', 'ingredients'],
  requestKeys: ['consentVersion', 'mode', 'screenContext'],
  grantKeys: ['sessionId', 'provider', 'ephemeralToken', 'expiresAt', 'transport', 'model', 'voice', 'mode'],
};

const full: ScreenContext = withCapturedAt({
  screen: 'recipe', title: 'Paper Plane', menuLines: ['Paper Plane $15'],
  bottle: { name: 'Old Forester 1920', brand: 'Old Forester', category: 'bourbon', abvPercent: 57.5 },
  journey: { name: 'Bourbon basics', stepTitle: 'Step 2' },
  recipe: { name: 'Paper Plane', ingredients: ['bourbon', 'Aperol'] },
}, new Date('2026-11-25T12:00:00Z'));

const backendFile = resolve(__dirname, '../supabase/functions/discover-voice-session/_shared/screenContext.ts');

describe('Marty app fields match the backend by name', () => {
  it('screenContext and its nested objects use exactly the backend names', () => {
    expect([...SCREEN_KINDS]).toEqual(BACKEND.screens);
    const ctx = normalizeScreenContext(full)!;
    expect(Object.keys(ctx).sort()).toEqual([...BACKEND.screenContextKeys].sort());
    expect(Object.keys(ctx.bottle!).sort()).toEqual([...BACKEND.bottleKeys].sort());
    expect(Object.keys(ctx.journey!).sort()).toEqual([...BACKEND.journeyKeys].sort());
    expect(Object.keys(ctx.recipe!).sort()).toEqual([...BACKEND.recipeKeys].sort());
    expect(SCREEN_CONTEXT_LIMITS.menuLines).toBe(25);
  });

  it('session request sends only consentVersion, mode and screenContext', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({
        sessionId: 's', provider: 'openai_realtime', ephemeralToken: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
        transport: 'webrtc', model: 'm', voice: 'cedar', mode: 'push_to_talk',
      }) };
    }) as unknown as typeof fetch;
    const result = await requestVoiceSession({
      supabaseUrl: 'https://lqqmwqrffelgnbngrkep.supabase.co', accessToken: 'a', consentVersion: 'v',
      screenContext: screenContextFromSources({ menu: { lines: [{ name: 'Last Word', price: '$16' }] } }), fetchImpl,
    });
    expect(Object.keys(body).sort()).toEqual([...BACKEND.requestKeys].sort());
    expect(body.mode).toBe('hands_free');
    expect(body.screenContext).toEqual({ screen: 'menu', menuLines: ['Last Word $16'] });
    // Server stop switch on: a push-to-talk grant is still run (hidden hold-to-talk fallback).
    expect(result.ok && result.grant.mode).toBe('push_to_talk');
  });

  it('grant carries mode; a hands_free grant is accepted', async () => {
    const grant = { sessionId: 's', provider: 'openai_realtime', ephemeralToken: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(), transport: 'webrtc', model: 'm', voice: 'cedar', mode: 'hands_free' };
    const v = validateVoiceSessionGrant(grant);
    expect(v.ok && Object.keys(v.grant).sort()).toEqual([...BACKEND.grantKeys].sort());
    expect(validateVoiceSessionGrant({ ...grant, mode: 'always_on' }).ok).toBe(false);
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => grant })) as unknown as typeof fetch;
    const r = await requestVoiceSession({ supabaseUrl: 'https://lqqmwqrffelgnbngrkep.supabase.co', accessToken: 'a', consentVersion: 'v', fetchImpl });
    expect(r.ok && r.grant.mode).toBe('hands_free');
  });

  it.runIf(existsSync(backendFile))('backend cleaner keeps the app output unchanged (runs once #131 is on main)', async () => {
    const backend = await import(/* @vite-ignore */ backendFile);
    expect([...backend.SCREEN_KINDS]).toEqual([...SCREEN_KINDS]);
    expect(backend.SCREEN_CONTEXT_LIMITS).toEqual(SCREEN_CONTEXT_LIMITS);
    expect(backend.sanitizeScreenContext(full)).toEqual(normalizeScreenContext(full));
    const appCtx = normalizeScreenContext(full)!;
    expect(backend.formatScreenContextUpdateText(appCtx)).toBe(
      (await import('../src/voice/screenContext')).formatScreenContextUpdateText(appCtx));
  });
});
