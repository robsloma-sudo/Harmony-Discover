// Progress numbers for the green-box stages (see BoxStage.tsx). Pure, so it can be tested without React Native.
export type BoxStageName = 'scanning' | 'recognizing' | 'identifying' | 'researching' | 'found';

export const LABEL: Record<BoxStageName, string> = {
  scanning: 'SCANNING', recognizing: 'RECOGNIZING', identifying: 'IDENTIFYING', researching: 'RESEARCHING', found: '',
};
// Typical durations: progress eases toward 95% over them and never claims 100% before the stage really ends.
export const TYPICAL_MS: Partial<Record<BoxStageName, number>> = { recognizing: 1_400, researching: 14_000 };

export function stagePercent(stage: BoxStageName, value: number | undefined, since: number | undefined, now: number): number {
  if (stage === 'found') return 100;
  const typical = TYPICAL_MS[stage];
  if (typical && since) return Math.min(95, Math.round(95 * (1 - Math.exp(-Math.max(0, now - since) / typical))));
  return Math.max(0, Math.min(99, Math.round((value ?? 0) * 100)));
}

