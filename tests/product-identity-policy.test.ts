import { describe, expect, it } from 'vitest';
import {
  assessProductIdentity,
  canAggregateProductRecords,
  packagingSimilarityIsIdentityEvidence,
} from '../src/services/productIdentityPolicy';

describe('conservative product identity aggregation', () => {
  it('does not identify products from matching bottle, label design, or closure', () => {
    const a = assessProductIdentity({ packagingSimilarity: 1, bottleShapeSimilarity: 1, closureSimilarity: 1 });
    const b = assessProductIdentity({ packagingSimilarity: 1, bottleShapeSimilarity: 1, closureSimilarity: 1 });
    expect(a.status).toBe('unresolved');
    expect(canAggregateProductRecords(a, b)).toBe(false);
    expect(packagingSimilarityIsIdentityEvidence()).toBe(false);
  });

  it('keeps partial or low-confidence label reads unresolved', () => {
    expect(assessProductIdentity({
      partialLabelRead: true,
      labelConfidence: 0.99,
      normalizedFullLabel: 'Producer Reserve',
      catalogProductId: 'sku-1',
    }).status).toBe('unresolved');

    expect(assessProductIdentity({
      fullLabelRead: true,
      labelConfidence: 0.72,
      normalizedFullLabel: 'Producer Reserve',
      catalogProductId: 'sku-1',
    }).status).toBe('unresolved');
  });

  it('verifies a complete high-confidence label tied to a catalog product', () => {
    expect(assessProductIdentity({
      fullLabelRead: true,
      labelConfidence: 0.97,
      normalizedFullLabel: 'Producer Reserve 12 Year',
      catalogProductId: 'sku-12',
    })).toEqual({ status: 'verified', productId: 'sku-12', reason: 'complete_label' });
  });

  it('verifies a catalog-backed barcode', () => {
    expect(assessProductIdentity({
      verifiedBarcode: '0123456789012',
      catalogProductId: 'sku-1',
    })).toEqual({ status: 'verified', productId: 'sku-1', reason: 'catalog_barcode' });
  });

  it('aggregates only records with the same verified catalog identity', () => {
    const one = assessProductIdentity({ verifiedBarcode: '111', catalogProductId: 'sku-1' });
    const same = assessProductIdentity({ verifiedBarcode: '222', catalogProductId: 'sku-1' });
    const other = assessProductIdentity({ verifiedBarcode: '333', catalogProductId: 'sku-2' });
    expect(canAggregateProductRecords(one, same)).toBe(true);
    expect(canAggregateProductRecords(one, other)).toBe(false);
  });

  it('blocks aggregation when evidence conflicts', () => {
    const conflict = assessProductIdentity({
      verifiedBarcode: '111',
      catalogProductId: 'sku-1',
      conflictingLabelEvidence: true,
    });
    const verified = assessProductIdentity({ verifiedBarcode: '111', catalogProductId: 'sku-1' });
    expect(conflict.status).toBe('conflict');
    expect(canAggregateProductRecords(conflict, verified)).toBe(false);
  });
});
