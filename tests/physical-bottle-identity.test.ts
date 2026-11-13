import { describe, expect, it } from 'vitest';
import { PhysicalBottleIdentityRegistry } from '../src/live/physicalBottleIdentity';

const evidence = (overrides: Partial<Parameters<PhysicalBottleIdentityRegistry['lock']>[1]> = {}) => ({
  catalogId: 'catalog-buffalo-trace',
  brand: 'Buffalo Trace',
  product: 'Kentucky Straight Bourbon',
  confidence: 0.96,
  matchScore: 0.97,
  matched: true,
  ...overrides,
});

describe('physical bottle identity registry', () => {
  it('locks a catalog-verified identity to one physical bottle ID', () => {
    const registry = new PhysicalBottleIdentityRegistry();
    const result = registry.lock('physical-1', evidence(), 1000);
    expect(result.locked).toBe(true);
    expect(registry.get('physical-1')?.catalogId).toBe('catalog-buffalo-trace');
  });

  it('does not lock uncertain or unmatched reads', () => {
    const registry = new PhysicalBottleIdentityRegistry();
    expect(registry.lock('physical-1', evidence({ confidence: 0.7 }), 1000))
      .toEqual({ locked: false, reason: 'insufficient_evidence' });
    expect(registry.lock('physical-1', evidence({ matched: false }), 1000))
      .toEqual({ locked: false, reason: 'insufficient_evidence' });
    expect(registry.size).toBe(0);
  });

  it('preserves a verified identity when later observations contain no identity', () => {
    const registry = new PhysicalBottleIdentityRegistry();
    registry.lock('physical-1', evidence(), 1000);
    expect(registry.get('physical-1')?.brand).toBe('Buffalo Trace');
    expect(registry.get('physical-1')?.product).toBe('Kentucky Straight Bourbon');
  });

  it('rejects a conflicting catalog identity instead of silently overwriting it', () => {
    const registry = new PhysicalBottleIdentityRegistry();
    registry.lock('physical-1', evidence(), 1000);
    const conflict = registry.lock('physical-1', evidence({
      catalogId: 'catalog-makers-mark', brand: "Maker's Mark", product: 'Bourbon',
    }), 2000);
    expect(conflict).toEqual({ locked: false, reason: 'identity_conflict' });
    expect(registry.get('physical-1')?.catalogId).toBe('catalog-buffalo-trace');
  });

  it('keeps identical SKUs separate when they belong to different physical bottles', () => {
    const registry = new PhysicalBottleIdentityRegistry();
    registry.lock('physical-1', evidence(), 1000);
    registry.lock('physical-2', evidence(), 1000);
    expect(registry.get('physical-1')?.catalogId).toBe(registry.get('physical-2')?.catalogId);
    expect(registry.size).toBe(2);
  });

  it('supports explicit invalidation and session reset', () => {
    const registry = new PhysicalBottleIdentityRegistry();
    registry.lock('physical-1', evidence(), 1000);
    expect(registry.forget('physical-1')).toBe(true);
    registry.lock('physical-2', evidence(), 2000);
    registry.clear();
    expect(registry.size).toBe(0);
  });
});
