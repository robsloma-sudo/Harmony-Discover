export type SearchResultSource = { url: string; title: string };
export type ProposedResearchSource = { url: string; title?: string; supports?: string[]; source_type?: string };
export type VerifiedResearchSource = { url: string; title: string; supports: string[]; source_type: string };

export function normalizeResearchUrl(value: unknown): string {
  try {
    const parsed = new URL(String(value ?? ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    parsed.hash = ""; parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch { return ""; }
}

export function collectSearchResultSources(content: unknown[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as Record<string, unknown>;
    if (item.type !== "web_search_tool_result" || !Array.isArray(item.content)) continue;
    for (const result of item.content) {
      if (!result || typeof result !== "object") continue;
      const row = result as Record<string, unknown>;
      const url = normalizeResearchUrl(row.url);
      if (url) found.set(url, String(row.title ?? "").replace(/\s+/g, " ").trim().slice(0, 180));
    }
  }
  return found;
}

export function validateResearchEvidence(proposedSources: ProposedResearchSource[], searchResults: Map<string, string>, allowedFields: Set<string>) {
  const sources: VerifiedResearchSource[] = [];
  const supportedFields = new Set<string>();
  const seen = new Set<string>();
  for (const source of proposedSources.slice(0, 8)) {
    const url = normalizeResearchUrl(source.url);
    if (!url || !searchResults.has(url) || seen.has(url)) continue;
    const supports = [...new Set((Array.isArray(source.supports) ? source.supports : [])
      .map(value => String(value).trim()).filter(value => allowedFields.has(value)))];
    if (!supports.length) continue;
    seen.add(url);
    for (const field of supports) supportedFields.add(field);
    sources.push({ url, title: searchResults.get(url) || String(source.title ?? "").slice(0, 180), supports,
      source_type: ["manufacturer","distillery","winery","brand_owner","regulator","gs1","retailer","reference"].includes(String(source.source_type)) ? String(source.source_type) : "reference" });
  }
  return { sources, supportedFields };
}
