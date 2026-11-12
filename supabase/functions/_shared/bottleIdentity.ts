/**
 * Conservative catalog identity gate shared by the live scanner and tests.
 * Physical-object tracking and catalog identity are intentionally separate.
 */
export type BottleIdentityMatch = {
  id: string | null;
  brand: string | null;
  product: string | null;
  category: string | null;
  score: number | null;
};

const clean = (value: unknown, max = 120) =>
  String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, max);
const unit = (value: unknown) => {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
};

export function normalizeBottleIdentity(value: unknown): string {
  return clean(value).toLowerCase().normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function hasUnmodeledSkuDifferentiator(bottle: Record<string, unknown>): boolean {
  const details = (bottle.details && typeof bottle.details === "object"
    ? bottle.details : {}) as Record<string, unknown>;
  // Current product_index cannot reliably disambiguate package/release variants.
  return [
    bottle.proof, bottle.size, details.vintage, details.package_size,
    details.sku, details.barcode, details.upc_ean, details.batch, details.lot_code,
  ].some(value => clean(value, 80).length > 0);
}

export function hasStrongProductIdentity(
  bottle: Record<string, unknown>,
  match: BottleIdentityMatch | undefined,
): boolean {
  const confidence = (bottle.fieldConfidence && typeof bottle.fieldConfidence === "object"
    ? bottle.fieldConfidence
    : bottle.field_confidence && typeof bottle.field_confidence === "object"
      ? bottle.field_confidence : {}) as Record<string, unknown>;
  return !!match?.id && !!match.brand && !!match.product && !!match.category &&
    (match.score ?? 0) >= 0.90 &&
    unit(confidence.brand) >= 0.90 && unit(confidence.product) >= 0.90 &&
    normalizeBottleIdentity(match.brand) === normalizeBottleIdentity(bottle.brand) &&
    normalizeBottleIdentity(match.product) === normalizeBottleIdentity(bottle.product) &&
    !hasUnmodeledSkuDifferentiator(bottle);
}
