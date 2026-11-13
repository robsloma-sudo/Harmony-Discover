import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string,string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key,value); }),
  },
}));

import { getBottleCalibrationKey, loadBottleVolumeProfiles, parseBottleCalibrationSamples, saveBottleVolumeProfileForIdentity } from '../src/services/bottleVolumeProfileStore';

beforeEach(() => store.clear());

describe('bottle volume profile store', () => {
  it('requires a high-confidence catalog-matched identity', () => {
    expect(getBottleCalibrationKey({id:'sku-1',score:0.95},'matched')).toBe('sku-1');
    expect(getBottleCalibrationKey({id:'sku-1',score:0.89},'matched')).toBeNull();
    expect(getBottleCalibrationKey({id:'sku-1',score:0.99},'reported')).toBeNull();
    expect(getBottleCalibrationKey(null,'unsure')).toBeNull();
  });

  it('parses measured height-to-volume pairs', () => {
    expect(parseBottleCalibrationSamples('0:0, 0.5:350, 1:750')).toEqual([
      {heightFraction:0,measuredMilliliters:0},
      {heightFraction:0.5,measuredMilliliters:350},
      {heightFraction:1,measuredMilliliters:750},
    ]);
    expect(() => parseBottleCalibrationSamples('half:350')).toThrow();
  });

  it('persists and reloads a profile only under its verified identity key', async () => {
    const profile = {
      id:'sku-1',
      capacityMl:750,
      points:[
        {heightFraction:0,volumeFraction:0},
        {heightFraction:0.5,volumeFraction:0.47},
        {heightFraction:0.82,volumeFraction:1},
      ],
    };
    await saveBottleVolumeProfileForIdentity('sku-1',profile);
    const registry = await loadBottleVolumeProfiles();
    expect(registry.profiles['sku-1']).toEqual(profile);
    expect(registry.profiles['other']).toBeUndefined();
  });
});
