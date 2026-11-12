import { describe, expect, it } from "vitest";
import {
  DEFERRED_JOB_TYPES,
  SUPPORTED_JOB_TYPES,
  getIdentityJobRetryPlan,
  isUuid,
  validateIdentityJobReferences,
} from "../supabase/functions/discover-enrichment-worker/workerPolicy";

const job = {
  id: "30000000-0000-0000-0000-000000000001",
  discover_product_id: "20000000-0000-0000-0000-000000000001",
  input_payload: { sighting_id: "10000000-0000-0000-0000-000000000001" },
  attempts: 1,
  max_attempts: 4,
};
const product = {
  id: job.discover_product_id,
  identity_payload: { identity_status: "catalog_exact" },
};
const sighting = {
  id: "10000000-0000-0000-0000-000000000001",
  discover_product_id: job.discover_product_id,
  product_index_id: "40000000-0000-0000-0000-000000000001",
};

describe("Discover enrichment worker policy", () => {
  it("only enables the implemented identity job and explicitly defers source lookup", () => {
    expect(SUPPORTED_JOB_TYPES).toEqual(["identity_match"]);
    expect(DEFERRED_JOB_TYPES).toContain("official_source_lookup");
    expect(SUPPORTED_JOB_TYPES).not.toContain("official_source_lookup");
  });

  it("accepts UUIDs and rejects malformed job references", () => {
    expect(isUuid(job.id)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(() => validateIdentityJobReferences(
      { ...job, input_payload: { sighting_id: "bad" } }, product, sighting,
    )).toThrow("job_missing_product_or_sighting_reference");
  });

  it("requires the sighting to belong to the claimed Discover product", () => {
    expect(() => validateIdentityJobReferences(
      job, product, { ...sighting, discover_product_id: "50000000-0000-0000-0000-000000000001" },
    )).toThrow("sighting_product_link_mismatch");
  });

  it("requires the legacy catalog link for a catalog-exact identity", () => {
    expect(() => validateIdentityJobReferences(job, product, { ...sighting, product_index_id: null }))
      .toThrow("catalog_identity_missing_product_index_link");
  });

  it("returns a checked result for a consistent sighting and product", () => {
    expect(validateIdentityJobReferences(job, product, sighting)).toEqual({
      identity_status: "catalog_exact",
      discover_product_id: product.id,
      sighting_id: sighting.id,
      catalog_linked: true,
    });
  });

  it("backs off exponentially and dead-letters at the attempt limit", () => {
    const now = Date.UTC(2026, 10, 12);
    expect(getIdentityJobRetryPlan(1, 4, now)).toEqual({
      status: "retry",
      delaySeconds: 30,
      availableAt: new Date(now + 30_000).toISOString(),
    });
    expect(getIdentityJobRetryPlan(4, 4, now).status).toBe("failed");
    expect(getIdentityJobRetryPlan(20, 4, now).delaySeconds).toBe(3600);
  });
});
