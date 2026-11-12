import { describe, expect, it } from "vitest";
import { collectSearchResultSources, normalizeResearchUrl, validateResearchEvidence } from "../supabase/functions/discover-live-read/researchEvidence";

describe("research evidence provenance", () => {
  it("normalizes URL variants and rejects non-HTTPS URLs", () => {
    expect(normalizeResearchUrl("https://producer.example/spec?ref=search#facts")).toBe("https://producer.example/spec");
    expect(normalizeResearchUrl("http://producer.example/spec")).toBe("");
  });
  it("collects only URLs from actual web search result blocks", () => {
    const found = collectSearchResultSources([{type:"text",text:"https://invented.example"},{type:"web_search_tool_result",content:[{url:"https://producer.example/tech-sheet",title:"Technical sheet"}]}]);
    expect(found.size).toBe(1);
    expect(found.has("https://producer.example/tech-sheet")).toBe(true);
    expect(found.has("https://invented.example")).toBe(false);
  });
  it("rejects fabricated URLs and unsupported field mappings", () => {
    const found = new Map([["https://producer.example/spec","Producer specification"]]);
    const result = validateResearchEvidence([
      {url:"https://fabricated.example/spec",supports:["age_statement"]},
      {url:"https://producer.example/spec",supports:["age_statement","mash_bill","unknown_field"]},
    ],found,new Set(["age_statement","mash_bill","vintage"]));
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].supports).toEqual(["age_statement","mash_bill"]);
    expect(result.supportedFields.has("age_statement")).toBe(true);
    expect(result.supportedFields.has("vintage")).toBe(false);
  });
});
