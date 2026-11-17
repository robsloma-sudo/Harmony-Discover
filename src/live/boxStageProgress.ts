// Progress numbers for the green-box stages (see BoxStage.tsx). Pure, so it can be tested without React Native.
export type BoxStageName = 'scanning' | 'zoom' | 'recognizing' | 'identifying' | 'researching' | 'found';

export const LABEL: Record<BoxStageName, string> = {
  scanning: 'SCANNING', zoom: 'ZOOM IN', recognizing: 'RECOGNIZING', identifying: 'IDENTIFYING', researching: 'RESEARCHING', found: '',
};
// Typical durations: progress eases toward 95% over them and never claims 100% before the stage really ends.
export const TYPICAL_MS: Partial<Record<BoxStageName, number>> = { recognizing: 1_400, researching: 14_000 };

export function stagePercent(stage: BoxStageName, value: number | undefined, since: number | undefined, now: number): number {
  if (stage === 'found') return 100;
  const typical = TYPICAL_MS[stage];
  if (typical && since) return Math.min(95, Math.round(95 * (1 - Math.exp(-Math.max(0, now - since) / typical))));
  return Math.max(0, Math.min(99, Math.round((value ?? 0) * 100)));
}


/**
 * The four steps always run forward (Rob, 15 Nov 2026): 1 SCANNING (or ZOOM IN), 2 RECOGNIZING, 3 IDENTIFYING,
 * 4 RESEARCHING, then ✓ name. A box never shows an earlier step again: when the scanner re-reads a label it is
 * already identifying, the box keeps showing step 3 with its last percentage instead of jumping back to step 2.
 */
export const STAGE_STEP: Record<BoxStageName, number> = { scanning: 1, zoom: 1, recognizing: 2, identifying: 3, researching: 4, found: 5 };
export type ShownStage = { stage: BoxStageName; since?: number; value?: number };
export type StageMemory = { step: number; stage: BoxStageName; pct: number };

export function forwardOnlyStage(memory: StageMemory | undefined, current: ShownStage, now: number): { shown: ShownStage; memory: StageMemory } {
  const step = STAGE_STEP[current.stage];
  if (!memory || step >= memory.step) {
    return { shown: current, memory: { step, stage: current.stage, pct: stagePercent(current.stage, current.value, current.since, now) } };
  }
  // An earlier step came back: hold the furthest step reached, at its last percentage.
  return { shown: { stage: memory.stage, value: memory.pct / 100 }, memory };
}
