import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// P-20261126-0102 round 2: guests are told both voice companies before the first chat.
const guestSrc = readFileSync('src/voice/martyGuest.ts', 'utf8');
const MARTY_VOICE_PARTNERS_NOTE = /MARTY_VOICE_PARTNERS_NOTE =\s*'([^']+)'/.exec(guestSrc)?.[1] ?? '';

describe('Marty voice partners line', () => {
  it('names ElevenLabs and OpenAI and what is sent', () => {
    expect(MARTY_VOICE_PARTNERS_NOTE).toMatch(/ElevenLabs/);
    expect(MARTY_VOICE_PARTNERS_NOTE).toMatch(/OpenAI/);
    expect(MARTY_VOICE_PARTNERS_NOTE).toMatch(/say or type/);
    expect(MARTY_VOICE_PARTNERS_NOTE).toMatch(/screen/);
    expect(MARTY_VOICE_PARTNERS_NOTE).toMatch(/memories/);
  });
  it('is shown on the consent step before Enable voice and in the privacy controls', () => {
    const overlay = readFileSync('src/marty/MartyOverlay.tsx', 'utf8');
    const partners = overlay.indexOf('{MARTY_VOICE_PARTNERS_NOTE}');
    expect(partners).toBeGreaterThan(overlay.indexOf('Tapping Enable voice is your consent'));
    expect(partners).toBeLessThan(overlay.indexOf('testID="marty-enable-voice"'));
    const panel = readFileSync('src/home-panels/MartyConsentPanel.tsx', 'utf8');
    expect(panel).toContain('{MARTY_VOICE_PARTNERS_NOTE}');
  });
});
