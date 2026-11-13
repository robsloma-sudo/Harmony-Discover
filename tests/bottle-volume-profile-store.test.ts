import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key,value); }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBottleCalibrationKey, getCachedBottleVolumeProfile, loadBottleVolumeProfiles, parseBottleCalibrationSamples, saveBottleVolumeProfileForIdentity } from '../src/services/bottleVolumeProfileStore';

beforeEach(() => store.clear());

describe('bottle volume profile store', () => {
  it('requires a high-confidence catalog-matched identity', () => {
    expect(getBottleCalibrationKey({id:'sku-1',score:0.95},'matched','750 ml')).toBe('sku-1::750 ml');
    expect(getBottleCalibrationKey({id:'sku-1',score:0.89},'matched','750 ml')).toBeNull();
    expect(getBottleCalibrationKey({id:'sku-1',score:0.99},'reported','750 ml')).toBeNull();
    expect(getBottleCalibrationKey(null,'unsure','750 ml')).toBeNull();
  });

  it('parses measured height-to-volume pairs', () => {
    expect(parseBottleCalibrationSamples('0:0, 0.5:350, 1:750')).toEqual([
      {heightFraction:0,measuredMilliliters:0},
      {heightFraction:0.5,measuredMilliliters:350},
      {heightFraction:1,measuredMilliliters:750},
    ]);
    expect(() => parseBottleCalibrationSamples('half:350')).toThrow();
  });


  it('does not let a stale async profile read overwrite a newer calibration save', async () => {
    const identityKey = 'sku-race::750 ml';
    const profile = {
      id: identityKey, capacityMl: 750,
      points: [
        { heightFraction: 0, volumeFraction: 0 },
        { heightFraction: 0.5, volumeFraction: 0.45 },
        { heightFraction: 0.82, volumeFraction: 1 },
      ],
    };
    let resolveStaleRead!: (value: string | null) => void;
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(() =>
      new Promise<string | null>(resolve => { resolveStaleRead = resolve; }),
    );
    const staleLoad = loadBottleVolumeProfiles();
    await saveBottleVolumeProfileForIdentity(identityKey, profile);
    resolveStaleRead(null);
    await staleLoad;
    expect(getCachedBottleVolumeProfile(identityKey)).toEqual(profile);
  });
\n  it('persists and reloads a profile only under its verified identity key', async () => {
    const profile = {
      id:'sku-1',
      capacityMl:750,
      points:[
        {heightFraction:0,volumeFraction:0},
        {heightFraction:0.5,volumeFraction:0.47},
        {heightFraction:0.82,volumeFraction:1},
      ],
    };
    const identityKey = getBottleCalibrationKey({id:'sku-1',score:0.95},'matched','750 ml')!;
    await saveBottleVolumeProfileForIdentity(identityKey,profile);
    const registry = await loadBottleVolumeProfiles();
    expect(registry.profiles[identityKey]).toEqual(profile);
    expect(getCachedBottleVolumeProfile(identityKey)).toEqual(profile);
    expect(registry.profiles['other']).toBeUndefined();
    await Promise.all([
      saveBottleVolumeProfileForIdentity('sku-2::750 ml', { ...profile, id:'sku-2' }),
      saveBottleVolumeProfileForIdentity('sku-3::750 ml', { ...profile, id:'sku-3' }),
    ]);
    const afterConcurrentWrites = await loadBottleVolumeProfiles();
    expect(afterConcurrentWrites.profiles['sku-2::750 ml']?.id).toBe('sku-2');
    expect(afterConcurrentWrites.profiles['sku-3::750 ml']?.id).toBe('sku-3');
  });
});
