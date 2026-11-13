import { describe, expect, it } from "vitest";
import {
  getBottleFamilyLabel,
  getBottleIntelligenceSections,
  resolveBeverageFamily,
} from "../src/services/bottleIntelligenceSchema";

describe("category-aware bottle intelligence families", () => {
  it("distinguishes Armagnac and Cognac from generic brandy", () => {
    expect(resolveBeverageFamily("brandy", { subcategory: "Armagnac" })).toBe("armagnac");
    expect(resolveBeverageFamily("brandy", { subcategory: "Cognac" })).toBe("cognac");
    expect(resolveBeverageFamily("brandy")).toBe("other_brandy");
  });

  it("recognizes Pisco and rye whiskey as distinct traditions", () => {
    expect(resolveBeverageFamily("pisco")).toBe("pisco");
    expect(resolveBeverageFamily("whiskey", { subcategory: "rye_whiskey" })).toBe("rye_whiskey");
  });

  it("separates single malt whiskey from Scotch single malt", () => {
    expect(resolveBeverageFamily("whiskey", { style: "single_malt" })).toBe("single_malt_whiskey");
    expect(resolveBeverageFamily("whisky", { style: "Single Malt Scotch" })).toBe("single_malt_scotch");
    expect(resolveBeverageFamily("whisky", { style: "Blended Scotch" })).toBe("other_whiskey");
    expect(getBottleFamilyLabel("whiskey", { style: "single malt" })).toBe("Single malt whiskey");
  });

  it("does not assume wine colour or style when the label does not establish it", () => {
    expect(resolveBeverageFamily("wine")).toBe("wine_unknown");
    expect(resolveBeverageFamily("wine", { style: "red" })).toBe("wine_red");
    expect(resolveBeverageFamily("wine", { style: "white" })).toBe("wine_white");
    expect(resolveBeverageFamily("wine", { style: "rosé" })).toBe("wine_rose");
    expect(resolveBeverageFamily("wine", { style: "Champagne" })).toBe("sparkling_wine");
  });

  it("normalizes category and subtype values from OCR", () => {
    expect(resolveBeverageFamily("AMARO_APERITIVO")).toBe("liqueur");
    expect(resolveBeverageFamily("whisky", { classification: "Single-Malt" })).toBe("single_malt_whiskey");
  });

  it("provides dedicated production fields for every resolved family", () => {
    const families = [
      ["brandy", { subcategory: "Armagnac" }],
      ["pisco", {}],
      ["whiskey", { style: "rye" }],
      ["whiskey", { style: "single malt" }],
      ["whisky", { style: "Scotch" }],
      ["wine", {}],
      ["wine", { style: "white" }],
    ] as const;
    for (const [category, details] of families) {
      const sections = getBottleIntelligenceSections(category, details);
      expect(sections.length).toBeGreaterThan(0);
      expect(sections.some(section => section.fields.length > 0)).toBe(true);
    }
  });
});
