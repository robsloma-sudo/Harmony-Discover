import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUICK_GUESS_DATA_NOTICE, QUICK_GUESS_DESCRIPTION, QUICK_GUESS_MAX_WORDS_SENT } from '../src/live/quickGuessCopy';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('Settings > Quick Guess data notice (P-20261121-1600)', () => {
  it('says plainly what is sent, why, and that no photos are sent', () => {
    expect(QUICK_GUESS_DATA_NOTICE).toContain(`up to ${QUICK_GUESS_MAX_WORDS_SENT} words`);
    expect(QUICK_GUESS_DATA_NOTICE).toContain("Harmony's servers");
    expect(QUICK_GUESS_DATA_NOTICE).toMatch(/timing details/);
    expect(QUICK_GUESS_DATA_NOTICE).toMatch(/account ID/);
    expect(QUICK_GUESS_DATA_NOTICE).toMatch(/faster and more accurate/);
    expect(QUICK_GUESS_DATA_NOTICE).toMatch(/sends no photos/);
    expect(QUICK_GUESS_DESCRIPTION).toContain('Probably …');
  });

  it('is shown in the Settings Quick Guess row', () => {
    const home = read('app/index.tsx');
    const row = home.split('\n').find(line => line.includes("'Turn on quick guess'")) ?? '';
    expect(row).toContain('{QUICK_GUESS_DESCRIPTION}');
    expect(row).toContain('{QUICK_GUESS_DATA_NOTICE}');
  });

  it('matches what the code actually sends', () => {
    const surface = read('src/live/DiscoverARSurface.tsx');
    // Words kept for the timing record: capped at the number the notice states.
    expect(surface).toContain(`read.words.map(word => word.text).slice(0, ${QUICK_GUESS_MAX_WORDS_SENT})`);
    const api = read('src/services/discoverLetterApi.ts');
    // Brand lookups: capped at the same number of words.
    expect(api).toContain(`p_words: words.slice(0, ${QUICK_GUESS_MAX_WORDS_SENT})`);
    expect(api).toContain(`p_fragments: fragments.slice(0, ${QUICK_GUESS_MAX_WORDS_SENT})`);
    // The timing record carries no image field.
    const row = api.slice(api.indexOf('export type ScanTimingRow'), api.indexOf('};', api.indexOf('export type ScanTimingRow')));
    expect(row).not.toMatch(/image|photo|jpeg|base64/i);
    for (const field of ['ms_to_name', 'label_px', 'zoom', 'device', 'guess_brand', 'brand', 'ocr_words']) expect(row).toContain(field);
  });
});
