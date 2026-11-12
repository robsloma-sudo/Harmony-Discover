import { describe, expect, it } from "vitest";
import { buildProfilePrompt, selectResearchProfile } from "../supabase/functions/discover-research-worker/researchProfiles";

describe("category research profiles", () => {
  it("routes whiskey subtypes to distinct research profiles", () => {
    expect(selectResearchProfile("whiskey",{product:"Kentucky Straight Bourbon"}).key).toBe("american_whiskey");
    expect(selectResearchProfile("whiskey",{product:"Islay Single Malt Scotch"}).key).toBe("scotch_irish");
    expect(selectResearchProfile("whiskey",{product:"Japanese Single Malt"}).key).toBe("world_whisky");
  });
  it("uses wine and sparkling-specific questions", () => {
    expect(selectResearchProfile("wine",{product:"Pinot Noir"}).key).toBe("wine");
    expect(selectResearchProfile("sparkling",{product:"Traditional Method Brut"}).key).toBe("sparkling");
  });
  it("bounds search use and includes only high-priority profile groups", () => {
    const result=buildProfilePrompt("beer",{brand:"Example",product:"IPA"},["hops","mash_bill"]);
    expect(result.searchUses).toBeLessThanOrEqual(2);
    expect(result.prompt).toContain("ingredients");
    expect(result.prompt).toContain("hops");
    expect(result.prompt).toContain("MISSING FIELDS: hops, mash_bill");
  });
});
