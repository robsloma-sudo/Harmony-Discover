import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateBottleVolumeProfile, type BottleVolumeProfile } from './bottleVolumeCalibration';

const STORAGE_KEY = 'harmony-discover:bottle-volume-profiles:v1';
let cachedProfiles: Record<string, BottleVolumeProfile> = {};
let profileCacheVersion = 0;
let profileWriteQueue: Promise<void> = Promise.resolve();

export function getCachedBottleVolumeProfile(identityKey: string): BottleVolumeProfile | undefined {
  return cachedProfiles[identityKey];
}

type ProfileRegistry = { version: 1; profiles: Record<string, BottleVolumeProfile> };

export function getBottleCalibrationKey(match: { id: string; score: number } | null | undefined, state: string, size?: string): string | null {
  if (state !== 'matched' || !match || typeof match.id !== 'string' || !match.id.trim() ||
      !Number.isFinite(match.score) || match.score < 0.9) return null;
  const sizeKey = String(size ?? '').toLowerCase().replace(/([0-9])([a-z])/g, '$1 $2').replace(/([a-z])([0-9])/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim() || 'unspecified-size';
  return `${match.id.trim()}::${sizeKey}`;
}

export async function loadBottleVolumeProfiles(): Promise<ProfileRegistry> {
  const cacheVersionAtStart = profileCacheVersion;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) { if (profileCacheVersion === cacheVersionAtStart) cachedProfiles = {}; return { version: 1, profiles: {} }; }
    const parsed = JSON.parse(raw) as Partial<ProfileRegistry>;
    if (parsed.version !== 1 || !parsed.profiles || typeof parsed.profiles !== 'object') { if (profileCacheVersion === cacheVersionAtStart) cachedProfiles = {}; return { version: 1, profiles: {} }; }
    const profiles: Record<string, BottleVolumeProfile> = {};
    for (const [key, profile] of Object.entries(parsed.profiles)) {
      if (key && profile && validateBottleVolumeProfile(profile)) profiles[key] = profile;
    }
    if (profileCacheVersion === cacheVersionAtStart) cachedProfiles = profiles;
    return { version: 1, profiles };
  } catch {
    if (profileCacheVersion === cacheVersionAtStart) cachedProfiles = {};
    return { version: 1, profiles: {} };
  }
}

export function saveBottleVolumeProfileForIdentity(identityKey: string, profile: BottleVolumeProfile): Promise<void> {
  if (!identityKey.trim() || !validateBottleVolumeProfile(profile)) {
    return Promise.reject(new Error('A verified bottle identity and valid calibration profile are required.'));
  }
  const task = profileWriteQueue.then(async () => {
    const registry = await loadBottleVolumeProfiles();
    registry.profiles[identityKey] = profile;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
    cachedProfiles[identityKey] = profile;
    profileCacheVersion += 1;
  });
  profileWriteQueue = task.catch(() => undefined);
  return task;
}

export async function getBottleVolumeProfileForIdentity(identityKey: string): Promise<BottleVolumeProfile | null> {
  const registry = await loadBottleVolumeProfiles();
  return registry.profiles[identityKey] ?? null;
}

export function parseBottleCalibrationSamples(input: string): Array<{ heightFraction: number; measuredMilliliters: number }> {
  return input.split(',').map(pair => {
    const [heightRaw, volumeRaw, extra] = pair.trim().split(':');
    if (extra !== undefined || heightRaw === undefined || volumeRaw === undefined) throw new Error('Use height:milliliters pairs separated by commas.');
    const height = Number(heightRaw.trim());
    const milliliters = Number(volumeRaw.trim());
    if (!Number.isFinite(height) || !Number.isFinite(milliliters)) throw new Error('Calibration samples must be numeric.');
    return { heightFraction: height, measuredMilliliters: milliliters };
  });
}
