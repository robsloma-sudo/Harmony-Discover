export const SUPPORTED_JOB_TYPES = ["identity_match"] as const;
export const DEFERRED_JOB_TYPES = [
  "official_source_lookup",
  "barcode_lookup",
  "cola_lookup",
  "field_extraction",
  "conflict_resolution",
  "refresh",
] as const;

export type IdentityJob = {
  id: string;
  discover_product_id: string;
  input_payload?: unknown;
  attempts?: number;
  max_attempts?: number;
};

export type IdentityProduct = {
  id: string;
  identity_payload?: unknown;
};

export type IdentitySighting = {
  id: string;
  discover_product_id: string | null;
  product_index_id: string | null;
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function validateIdentityJobReferences(
  job: IdentityJob,
  product: IdentityProduct | null,
  sighting: IdentitySighting | null,
) {
  const input = job.input_payload && typeof job.input_payload === "object"
    ? job.input_payload as Record<string, unknown> : {};
  const sightingId = input.sighting_id;
  if (!isUuid(job.id) || !isUuid(job.discover_product_id) || !isUuid(sightingId)) {
    throw new Error("job_missing_product_or_sighting_reference");
  }
  if (!product || product.id !== job.discover_product_id) {
    throw new Error("discover_product_not_found");
  }
  if (!sighting || sighting.id !== sightingId || sighting.discover_product_id !== product.id) {
    throw new Error("sighting_product_link_mismatch");
  }
  const identity = product.identity_payload && typeof product.identity_payload === "object"
    ? product.identity_payload as Record<string, unknown> : {};
  const identityStatus = String(identity.identity_status ?? "candidate");
  if (identityStatus === "catalog_exact" && !sighting.product_index_id) {
    throw new Error("catalog_identity_missing_product_index_link");
  }
  return {
    identity_status: identityStatus,
    discover_product_id: product.id,
    sighting_id: sighting.id,
    catalog_linked: !!sighting.product_index_id,
  };
}

export function getIdentityJobRetryPlan(attemptsValue: unknown, maxAttemptsValue: unknown, nowMs = Date.now()) {
  const attempts = Number(attemptsValue ?? 1);
  const maxAttempts = Number(maxAttemptsValue ?? 4);
  const safeAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  const safeMaxAttempts = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : 4;
  const terminal = safeAttempts >= safeMaxAttempts;
  const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, safeAttempts - 1)));
  return {
    status: terminal ? "failed" as const : "retry" as const,
    delaySeconds,
    availableAt: new Date(nowMs + delaySeconds * 1000).toISOString(),
  };
}
