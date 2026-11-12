export const SUPPORTED_JOB_TYPES = ["identity_match", "official_source_lookup"] as const;
export const DEFERRED_JOB_TYPES = [
  "barcode_lookup",
  "cola_lookup",
  "field_extraction",
  "conflict_resolution",
  "refresh",
] as const;

export const RESEARCH_FIELD_KEYS = [
  "producer", "region", "appellation", "country", "grapes", "classification",
  "age_statement", "cask_finish", "flavoring", "sweetness", "colour", "peat",
  "trade_region", "agave_sourcing", "farming_practice", "harvest_method",
  "harvest_timing", "yeast_regime", "carbonation", "juice_source", "cask_fill",
  "vine_age", "additive_disclosure", "package_type", "package_size",
  "package_material", "closure", "still_material", "still_heating",
  "rum_classification", "sake_fraction", "sake_pressing", "water", "aspect",
  "climate_type", "elevation_band", "slope", "soil_type", "training_system",
  "producer_type", "dispense", "lot_code", "upc_ean", "bottled_on",
  "distilled_on", "harvested_on", "disgorged_on", "dosage", "residual_sugar",
  "net_contents", "importer", "awards", "organic_claim", "mash_bill", "grain",
  "agave_type", "production_method", "distillation", "cask_type", "barrel_number",
  "bottling_location", "state_or_province", "subregion", "vineyard", "estate",
  "bottler", "brand_owner", "label_designation", "appellation_level",
  "alcohol_statement",
] as const;

export const ATTRIBUTE_CODE_MAP: Record<string, string> = {
  package_size: "package_size",
  package_type: "package_type",
  package_material: "container_material",
  closure: "closure",
  flavoring: "flavouring",
  sweetness: "sweetness",
  colour: "colour",
  peat: "peat",
  trade_region: "trade_region",
  agave_sourcing: "agave_sourcing",
  farming_practice: "farming_practice",
  harvest_method: "harvest_method",
  harvest_timing: "harvest_timing",
  yeast_regime: "yeast_regime",
  carbonation: "carbonation",
  juice_source: "juice_source",
  cask_fill: "cask_fill",
  vine_age: "vine_age",
  additive_disclosure: "additive_disclosure",
  still_material: "still_material",
  still_heating: "still_heating",
  rum_classification: "rum_classification",
  sake_fraction: "sake_fraction",
  sake_pressing: "sake_pressing",
  water: "water",
  aspect: "aspect",
  climate_type: "climate_type",
  elevation_band: "elevation_band",
  slope: "slope",
  soil_type: "soil_type",
  training_system: "training_system",
  producer_type: "producer_type",
  dispense: "dispense",
};

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
  brand_name?: string | null;
  product_name?: string | null;
  product_class?: string | null;
  status?: string | null;
};

export type IdentitySighting = {
  id: string;
  discover_product_id: string | null;
  product_index_id: string | null;
  read_brand?: string | null;
  read_product?: string | null;
  read_category?: string | null;
  read_proof?: string | null;
  read_size?: string | null;
  read_vintage?: number | null;
  label_details?: unknown;
};

export type ResearchSource = {
  url: string;
  title: string;
  source_type: string;
  supports: string[];
};

export type ResearchField = {
  code: string;
  value: string;
  confidence: number;
  source: { url: string; title: string; source_type: string };
};

export function getSupportedJobTypes(hasAnthropicKey: boolean, dailyCapReached: boolean) {
  return hasAnthropicKey && !dailyCapReached
    ? ["identity_match", "official_source_lookup"] as const
    : ["identity_match"] as const;
}

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

export function mapResearchSourceType(rawValue: unknown, rawUrl: unknown): string | null {
  const raw = String(rawValue ?? "").toLowerCase();
  let url: URL;
  try {
    url = new URL(String(rawUrl ?? ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  const host = url.hostname.toLowerCase();
  if (host === "ttb.gov" || host.endsWith(".ttb.gov") || host === "ttbonline.gov" || host.endsWith(".ttbonline.gov")) {
    return "ttb_cola";
  }
  if (raw === "regulator" && host.endsWith(".gov")) return "government_registry";
  if (raw === "gs1") return "barcode_registry";
  if (["manufacturer", "distillery", "winery", "brand_owner"].includes(raw)) return "official_producer";
  return null;
}

const SOURCE_RANK: Record<string, number> = {
  manufacturer: 0,
  distillery: 0,
  winery: 0,
  brand_owner: 0,
  regulator: 1,
  gs1: 1,
};

export function filterResearchFields(
  raw: unknown,
  missingFields: readonly string[],
  minimumConfidence = 0.78,
): ResearchField[] {
  if (!raw || typeof raw !== "object") return [];
  const input = raw as Record<string, unknown>;
  const fields = input.fields && typeof input.fields === "object"
    ? input.fields as Record<string, unknown> : {};
  const scores = input.field_confidence && typeof input.field_confidence === "object"
    ? input.field_confidence as Record<string, unknown> : {};
  const sources = (Array.isArray(input.sources) ? input.sources : [])
    .filter((source): source is ResearchSource => !!source && typeof source === "object")
    .sort((a, b) => (SOURCE_RANK[String(a.source_type)] ?? 99) - (SOURCE_RANK[String(b.source_type)] ?? 99));
  const allowed = new Set(RESEARCH_FIELD_KEYS as readonly string[]);
  const missing = new Set(missingFields);
  const output: ResearchField[] = [];

  for (const [code, rawValue] of Object.entries(fields)) {
    if (!allowed.has(code) || !missing.has(code)) continue;
    if (typeof rawValue !== "string") continue;
    const value = rawValue.replace(/\s+/g, " ").trim().slice(0, 240);
    const score = Number(scores[code]);
    if (!value || !Number.isFinite(score) || score < minimumConfidence || score > 1) continue;
    for (const source of sources) {
      const supports = Array.isArray(source.supports) ? source.supports.map(String) : [];
      if (!supports.includes(code)) continue;
      const url = String(source.url ?? "").trim().slice(0, 500);
      const title = String(source.title ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
      const sourceType = mapResearchSourceType(source.source_type, url);
      if (!sourceType || !title) continue;
      output.push({
        code,
        value,
        confidence: score,
        source: {
          url,
          title,
          source_type: sourceType,
        },
      });
      break;
    }
  }
  return output;
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
