import { describe, expect, it } from "vitest";
import {
  hasStrongProductIdentity,
  hasUnmodeledSkuDifferentiator,
  normalizeBottleIdentity,
  type BottleIdentityMatch,
} from "../supabase/functions/_shared/bottleIdentity";

const match: BottleIdentityMatch = {
  id: "catalog-1", brand: "Example Spirits", product: "Reposado",
  category: "tequila", score: 0.96,
};
const bottle = (overrides: Record<string, unknown> = {}) => ({
  brand: "Example Spirits",
  product: "Reposado",
  fieldConfidence: { brand: 0.97, product: 0.96 },
  details: {},
  ...overrides,
});

describe("shared conservative bottle identity gate", () => {
  it("normalizes accents and punctuation without changing expression words", () => {
    expect(normalizeBottleIdentity("  Café—Del Mar! ")).toBe("cafe del mar");
  });

  it("accepts exact high-confidence brand and expression evidence", () => {
    expect(hasStrongProductIdentity(bottle(), match)).toBe(true);
  });

  it("rejects brand-only matches and low field confidence", () => {
    expect(hasStrongProductIdentity(bottle({ product: "" }), match)).toBe(false);
    expect(hasStrongProductIdentity(bottle({ fieldConfidence: { brand: 0.99, product: 0.89 } }), match)).toBe(false);
    expect(hasStrongProductIdentity(bottle({ fieldConfidence: { brand: 0.99 } }), match)).toBe(false);
  });

  it("rejects fuzzy expression matches even when the brand matches", () => {
    expect(hasStrongProductIdentity(bottle({ product: "Blanco" }), match)).toBe(false);
    expect(hasStrongProductIdentity(bottle(), { ...match, score: 0.89 })).toBe(false);
  });

  it("withholds catalog identity when package or release differentiators are read", () => {
    for (const details of [
      { vintage: "2022" }, { package_size: "750 ml" }, { sku: "ABC-123" },
      { barcode: "0123456789012" }, { batch: "B-04" }, { lot_code: "L-9" },
      { age_statement: "12 Years Old" }, { cask_finish: "Sherry Cask" },
      { cask_type: "French Oak" }, { barrel_number: "42" }, { flavor: "Peach" },
      { style: "Single Barrel" }, { appellation: "Barolo DOCG" },
      { appellation_level: "DOCG" }, { classification: "Grand Cru" },
      { dosage: "Brut Nature" }, { residual_sugar: "2 g/L" },
    ]) {
      expect(hasUnmodeledSkuDifferentiator(bottle({ details }))).toBe(true);
      expect(hasStrongProductIdentity(bottle({ details }), match)).toBe(false);
    }
    expect(hasStrongProductIdentity(bottle({ proof: "80 proof" }), match)).toBe(false);
    expect(hasStrongProductIdentity(bottle({ size: "750 ml" }), match)).toBe(false);
  });

  it("supports the save-path snake_case field confidence shape", () => {
    expect(hasStrongProductIdentity(
      bottle({ fieldConfidence: undefined, field_confidence: { brand: 0.95, product: 0.95 } }),
      match,
    )).toBe(true);
  });
});
