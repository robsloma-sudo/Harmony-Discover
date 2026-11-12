/**
 * Conservative product identity policy.
 *
 * Packaging resemblance is useful for candidate retrieval, never sufficient
 * evidence to merge distinct beverage SKUs. Physical-object tracking and
 * product-catalog identity are deliberately separate concepts.
 */
export type ProductIdentityEvidence = {
  fullLabelRead?: boolean;
  labelConfidence?: number;
  normalizedFullLabel?: string;
  verifiedBarcode?: string;
  catalogProductId?: string;
  conflictingLabelEvidence?: boolean;
  packagingSimilarity?: number;
  bottleShapeSimilarity?: number;
  closureSimilarity?: number;
  partialLabelRead?: boolean;
};

export type ProductIdentityDecision =
  | { status: 'verified'; productId: string; reason: 'catalog_barcode' | 'complete_label' }
  | { status: 'conflict'; reason: 'conflicting_evidence' }
  | { status: 'unresolved'; reason: 'insufficient_product_evidence' };

const MIN_LABEL_CONFIDENCE = 0.9;

/**
 * Only a catalog-backed barcode or a high-confidence complete label can
 * establish a product identity. Shape, closure, packaging, and partial-label
 * similarity are intentionally excluded from this decision.
 */
export function assessProductIdentity(evidence: ProductIdentityEvidence): ProductIdentityDecision {
  if (evidence.conflictingLabelEvidence) {
    return { status: 'conflict', reason: 'conflicting_evidence' };
  }

  if (evidence.verifiedBarcode && evidence.catalogProductId) {
    return { status: 'verified', productId: evidence.catalogProductId, reason: 'catalog_barcode' };
  }

  const label = evidence.normalizedFullLabel?.trim();
  if (
    evidence.fullLabelRead === true &&
    typeof evidence.labelConfidence === 'number' &&
    evidence.labelConfidence >= MIN_LABEL_CONFIDENCE &&
    !!label &&
    !!evidence.catalogProductId
  ) {
    return { status: 'verified', productId: evidence.catalogProductId, reason: 'complete_label' };
  }

  return { status: 'unresolved', reason: 'insufficient_product_evidence' };
}

/** Product aggregation is allowed only for the same verified catalog identity. */
export function canAggregateProductRecords(
  left: ProductIdentityDecision,
  right: ProductIdentityDecision,
): boolean {
  return left.status === 'verified' &&
    right.status === 'verified' &&
    left.productId === right.productId;
}

/**
 * Packaging resemblance may rank candidates for further OCR, but must never
 * be promoted into product identity evidence by this helper.
 */
export function packagingSimilarityIsIdentityEvidence(): false {
  return false;
}
