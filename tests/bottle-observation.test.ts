import { describe, expect, it } from 'vitest';
import { assessBottleObservation } from '../src/services/bottleObservation';
import type { BottleVolumeProfile } from '../src/services/bottleInventory';

const profile: BottleVolumeProfile = {
  profileId: 'test-cylinder', calibrationSource: 'synthetic test geometry',
  samples: [{ heightMm: 0, internalRadiusMm: 10 }, { heightMm: 100, internalRadiusMm: 10 }],
};
const classification = ['1','2','3'].map(frameId => ({ frameId, classification: 'bottle' as const, confidence: 0.92 }));
const masks = ['1','2','3'].map(frameId => ({ frameId, confidence: 0.9, maskQuality: 0.9, bodyTop: 0.1, bodyBottom: 0.9 }));
const liquidLines = [
  { frameId: '1', normalizedHeight: 0.5, confidence: 0.9 },
  { frameId: '2', normalizedHeight: 0.505, confidence: 0.9 },
  { frameId: '3', normalizedHeight: 0.495, confidence: 0.9 },
];

describe('assessBottleObservation', () => {
  it('joins bottle, mask and liquid evidence without inventing SKU identity', () => {
    const result = assessBottleObservation({ classification, masks, liquidLines, profile, nominalCapacityMl: 750 });
    expect(result.status).toBe('estimated');
    if (result.status === 'estimated') {
      expect(result.identityStatus).toBe('unverified');
      expect(result.skuId).toBeUndefined();
      expect(result.fill.remainingMl).toBeCloseTo(Math.PI * 100 * 50 / 1000, 5);
    }
  });

  it('requires a verified SKU to report identity as verified', () => {
    const result = assessBottleObservation({ classification, masks, liquidLines, profile, nominalCapacityMl: 750, verifiedSkuId: 'sku-750-clear' });
    expect(result.status).toBe('estimated');
    if (result.status === 'estimated') expect(result.identityStatus).toBe('verified');
  });

  it('abstains when the bottle classifier has not confirmed a bottle', () => {
    const result = assessBottleObservation({
      classification: [{ frameId: '1', classification: 'unknown', confidence: 0.99 }],
      masks, liquidLines, profile, nominalCapacityMl: 750,
    });
    expect(result.status).toBe('needs_review');
  });

  it('abstains without three distinct high-quality instance masks', () => {
    const result = assessBottleObservation({
      classification, masks: [masks[0], masks[0], masks[1]], liquidLines, profile, nominalCapacityMl: 750,
    });
    expect(result.status).toBe('needs_review');
  });

  it('rejects a confirmed non-bottle object', () => {
    const result = assessBottleObservation({
      classification: ['1','2','3'].map(frameId => ({ frameId, classification: 'non_bottle' as const, confidence: 0.9 })),
      masks, liquidLines, profile, nominalCapacityMl: 750,
    });
    expect(result.status).toBe('not_a_bottle');
  });

  it('abstains when liquid-line evidence is not stable', () => {
    const result = assessBottleObservation({
      classification, masks,
      liquidLines: liquidLines.map((item, i) => ({ ...item, normalizedHeight: i * 0.3 })),
      profile, nominalCapacityMl: 750,
    });
    expect(result.status).toBe('needs_review');
  });
});
