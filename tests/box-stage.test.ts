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

import { forwardOnlyStage, type StageMemory } from '../src/live/boxStageProgress';
describe('steps only move forward', () => {
  it('a re-read never sends a box back from identifying to recognizing', () => {
    let memory: StageMemory | undefined;
    const t0 = 1_000_000;
    let r = forwardOnlyStage(memory, { stage: 'scanning', value: 0.6 }, t0); memory = r.memory;
    r = forwardOnlyStage(memory, { stage: 'recognizing', since: t0 }, t0 + 900); memory = r.memory;
    expect(r.shown.stage).toBe('recognizing');
    r = forwardOnlyStage(memory, { stage: 'identifying', value: 0.55 }, t0 + 1500); memory = r.memory;
    expect(r.shown.stage).toBe('identifying');
    r = forwardOnlyStage(memory, { stage: 'recognizing', since: t0 + 5000 }, t0 + 5200); memory = r.memory;
    expect(r.shown).toEqual({ stage: 'identifying', value: 0.55 });
    r = forwardOnlyStage(memory, { stage: 'scanning', value: 0.7 }, t0 + 6000);
    expect(r.shown.stage).toBe('identifying');
    r = forwardOnlyStage(r.memory, { stage: 'found' }, t0 + 7000);
    expect(r.shown.stage).toBe('found');
  });
});
