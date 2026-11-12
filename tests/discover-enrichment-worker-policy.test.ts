import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_CODE_MAP,
  DEFERRED_JOB_TYPES,
  SUPPORTED_JOB_TYPES,
  filterResearchFields,
  getIdentityJobRetryPlan,
  getSupportedJobTypes,
  isUuid,
  mapResearchSourceType,
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
  it("only enables source lookup when the API key and daily budget are available", () => {
    expect(SUPPORTED_JOB_TYPES).toEqual(["identity_match", "official_source_lookup"]);
    expect(DEFERRED_JOB_TYPES).not.toContain("official_source_lookup");
    expect(getSupportedJobTypes(false, false)).toEqual(["identity_match"]);
    expect(getSupportedJobTypes(true, true)).toEqual(["identity_match"]);
    expect(getSupportedJobTypes(true, false)).toEqual(["identity_match", "official_source_lookup"]);
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

  it("maps only supported HTTPS source types into the evidence schema", () => {
    expect(mapResearchSourceType("manufacturer", "https://producer.example/products/x")).toBe("official_producer");
    expect(mapResearchSourceType("regulator", "https://www.ttb.gov/labeling")).toBe("ttb_cola");
    expect(mapResearchSourceType("regulator", "https://agency.gov/registry")).toBe("government_registry");
    expect(mapResearchSourceType("gs1", "https://www.gs1.org/services")).toBe("barcode_registry");
    expect(mapResearchSourceType("retailer", "https://shop.example/product")).toBeNull();
    expect(mapResearchSourceType("reference", "https://reference.example/page")).toBeNull();
    expect(mapResearchSourceType("manufacturer", "http://producer.example")).toBeNull();
    expect(mapResearchSourceType("unknown", "https://example.com")).toBeNull();
  });

  it("accepts only missing high-confidence facts with a source that explicitly supports the field", () => {
    const result = filterResearchFields({
      fields: {
        package_size: "750 mL",
        region: "Jalisco",
        grapes: "Chardonnay",
        awards: "Gold medal",
      },
      field_confidence: { package_size: 0.94, region: 0.72, grapes: 0.99, awards: 0.99 },
      sources: [
        { url: "https://producer.example/package", title: "Producer package page", source_type: "manufacturer", supports: ["package_size"] },
        { url: "https://region.example/page", title: "Region reference", source_type: "reference", supports: ["region"] },
        { url: "http://bad.example", title: "Insecure source", source_type: "reference", supports: ["grapes"] },
        { url: "https://unrelated.example", title: "Unrelated", source_type: "reference", supports: ["not_awards"] },
      ],
    }, ["package_size", "region", "grapes", "awards"]);
    expect(result).toEqual([{
      code: "package_size",
      value: "750 mL",
      confidence: 0.94,
      source: {
        url: "https://producer.example/package",
        title: "Producer package page",
        source_type: "official_producer",
      },
    }]);
  });

  it("does not overwrite fields that are already known or outside the research allowlist", () => {
    const result = filterResearchFields({
      fields: { package_size: "750 mL", invented_field: "made up" },
      field_confidence: { package_size: 0.99, invented_field: 0.99 },
      sources: [{ url: "https://producer.example", title: "Producer", source_type: "manufacturer", supports: ["package_size", "invented_field"] }],
    }, ["invented_field"]);
    expect(result).toEqual([]);
  });

  it("maps only semantically exact research fields into PHG attribute dimensions", () => {
    expect(ATTRIBUTE_CODE_MAP.package_size).toBe("package_size");
    expect(ATTRIBUTE_CODE_MAP.package_material).toBe("container_material");
    expect(ATTRIBUTE_CODE_MAP.flavoring).toBe("flavouring");
    expect(ATTRIBUTE_CODE_MAP.cask_finish).toBeUndefined();
    expect(ATTRIBUTE_CODE_MAP.region).toBeUndefined();
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
