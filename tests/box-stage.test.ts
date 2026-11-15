import { describe, expect, it } from 'vitest';
import { stagePercent } from '../src/live/boxStageProgress';

describe('box stage progress', () => {
  it('scanning and identifying show the confidence', () => {
    expect(stagePercent('scanning', 0.59, undefined, 0)).toBe(59);
    expect(stagePercent('identifying', 0.734, undefined, 0)).toBe(73);
  });
  it('timed stages grow with time and never claim 100% early', () => {
    const t0 = 1_000_000;
    const early = stagePercent('recognizing', undefined, t0, t0 + 300);
    const later = stagePercent('recognizing', undefined, t0, t0 + 2_000);
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
    expect(stagePercent('researching', undefined, t0, t0 + 600_000)).toBe(95);
  });
  it('found is complete', () => expect(stagePercent('found', undefined, undefined, 0)).toBe(100));
});
