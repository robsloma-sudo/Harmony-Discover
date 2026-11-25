import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key,value); }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { estimateCalibratedBottleVolume } from '../src/services/bottleVolumeCalibration';
import { getBottleCalibrationKey, getCachedBottleVolumeProfile, loadBottleVolumeProfiles, parseBottleCalibrationSamples, saveBottleVolumeProfileForIdentity } from '../src/services/bottleVolumeProfileStore';

beforeEach(() => store.clear());

describe('bottle volume profile store', () => {
  it('requires a high-confidence catalog-matched identity', () => {
    expect(getBottleCalibrationKey({id:'sku-1',score:0.95},'matched','750 ml')).toBe('sku-1::750 ml');
    expect(getBottleCalibrationKey({id:'sku-1',score:0.89},'matched','750 ml')).toBeNull();
    expect(getBottleCalibrationKey({id:'sku-1',score:0.99},'reported','750 ml')).toBeNull();
    expect(getBottleCalibrationKey(null,'unsure','750 ml')).toBeNull();
  });

  describe('the one volume rule: strong match required, shape only picks the calibration', () => {
    const shape = { shapeKey: 'colonel e h taylor jr|barrel proof|750ml', flags: [] as string[] };
    const noShape = { shapeKey: null, flags: [] as string[] };
    it('strong match + known shape -> shape calibration (shared across releases)', () => {
      expect(getBottleCalibrationKey({id:'sku-1',score:0.95}, 'matched', '750 ml', shape)).toBe('shape:colonel e h taylor jr|barrel proof|750ml');
    });
    it('strong match only -> product + size calibration', () => {
      expect(getBottleCalibrationKey({id:'sku-1',score:0.95}, 'matched', '750 ml', noShape)).toBe('sku-1::750 ml');
      expect(getBottleCalibrationKey({id:'sku-1',score:0.95}, 'matched', '750 ml')).toBe('sku-1::750 ml');
    });
    it('known shape without a strong match -> no volume', () => {
      expect(getBottleCalibrationKey(null, 'unsure', '', shape)).toBeNull();
      expect(getBottleCalibrationKey({id:'sku-1',score:0.89}, 'matched', '750 ml', shape)).toBeNull();
      expect(getBottleCalibrationKey({id:'sku-1',score:0.99}, 'reported', '750 ml', shape)).toBeNull();
    });
    it('neither -> no volume', () => {
      expect(getBottleCalibrationKey(null, 'unsure', '750 ml', noShape)).toBeNull();
      expect(getBottleCalibrationKey({id:'sku-1',score:0.5}, 'unsure', '750 ml')).toBeNull();
    });
    it('barcode disagreeing with the label words -> no volume, even with a strong match and a shape', () => {
      expect(getBottleCalibrationKey({id:'sku-1',score:0.99}, 'matched', '750 ml', { shapeKey: 'a|b|750ml', flags: ['barcode_and_label_words_disagree'] })).toBeNull();
    });
    it('end to end: a saved shape calibration gives ml only when the match is strong', () => {
      const profile = { id: 'shape:a|b|750ml', capacityMl: 750, points: [
        { heightFraction: 0, volumeFraction: 0 }, { heightFraction: 0.5, volumeFraction: 0.45 }, { heightFraction: 0.9, volumeFraction: 1 } ] };
      const profiles: Record<string, typeof profile> = { 'shape:a|b|750ml': profile };
      const volumeFor = (match: {id:string;score:number}|null, state: string) => {
        const key = getBottleCalibrationKey(match, state, '750 ml', { shapeKey: 'a|b|750ml', flags: [] });
        return estimateCalibratedBottleVolume(0.5, key ? profiles[key] : undefined).status;
      };
      expect(volumeFor({id:'sku-1',score:0.95}, 'matched')).toBe('calibrated');
      expect(volumeFor({id:'sku-1',score:0.6}, 'unsure')).toBe('unavailable');
      expect(volumeFor(null, 'unsure')).toBe('unavailable');
    });
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
