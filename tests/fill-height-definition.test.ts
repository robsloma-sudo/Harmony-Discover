import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

// One fill-height definition everywhere: fraction of the detected bottle box height, from its bottom edge.
describe('fill height has one definition', () => {
  it('the removed millimetre helpers are gone and nothing imports them', () => {
    expect(existsSync('src/services/bottleInventory.ts')).toBe(false);
    expect(existsSync('src/services/bottleObservation.ts')).toBe(false);
  });

  it('web detector, iOS detector, calibration, consensus and notes all state the same definition', () => {
    const swift = readFileSync('modules/discover-arkit/ios/DiscoverARKitModule.swift', 'utf8');
    expect(swift).toContain('Double(bottom - medianY) / Double(cropHeight)');
    expect(readFileSync('src/services/liquidLevelDetector.ts', 'utf8')).toContain('(bottom - medianY) / height');
    for (const file of ['src/services/bottleVolumeCalibration.ts', 'src/services/liquidInterface.ts', 'src/services/liquidLevelDetector.ts']) {
      expect(readFileSync(file, 'utf8')).toMatch(/bottle box height, from its bottom edge/);
    }
    expect(readFileSync('docs/liquid-level-analysis.md', 'utf8')).toContain('bottom edge of the detected bottle box');
  });
});
