import reference from "../../../docs/research/journeys-research-profiles.reference.json" with { type: "json" };

type Group = { group: string; weight: number; topics: string[]; ask: string };
type Profile = { label: string; groups: Group[] };
const profiles = (reference as { profiles: Record<string, Profile> }).profiles;

const CATEGORY_PROFILE: Record<string,string> = {
  tequila:"agave", mezcal:"agave", whiskey:"american_whiskey", gin:"gin", rum:"rum",
  beer:"beer", non_alcoholic_beer:"beer", cider:"cider", wine:"wine", sparkling:"sparkling",
  brandy:"brandy", pisco:"brandy", vodka:"vodka", liqueur:"liqueur",
  amaro_aperitivo:"amaro", vermouth:"vermouth", aperitivo:"aperitivo",
  fortified_wine:"fortified", asian_spirit:"asian_spirit", other:"spirit"
};

export function selectResearchProfile(category: string, identity: Record<string, unknown>) {
  const words = [identity.brand, identity.product, identity.category].map(v=>String(v??"")).join(" ").toLowerCase();
  let key = CATEGORY_PROFILE[category] || "spirit";
  if (category === "whiskey" || category === "whisky") {
    if (/bourbon|rye|tennessee|american whiskey/.test(words)) key="american_whiskey";
    else if (/scotch|irish|islay|speyside|highland|lowland/.test(words)) key="scotch_irish";
    else key="world_whisky";
    if (/12\s*(year|yr)|15\s*(year|yr)|18\s*(year|yr)|21\s*(year|yr)|25\s*(year|yr)|30\s*(year|yr)/.test(words)) key="spirit_aged";
  }
  if (category === "brandy" && /cognac|armagnac|calvados|pisco|grappa/.test(words)) key="brandy";
  if (/chartreuse|benedictine|monastic|herbal liqueur/.test(words)) key="heritage_herbal";
  const profile = profiles[key] || profiles.spirit;
  return { key, label: profile.label, groups: profile.groups };
}

export function buildProfilePrompt(category: string, identity: Record<string, unknown>, missing: string[]) {
  const profile=selectResearchProfile(category,identity);
  const groups=[...profile.groups].sort((a,b)=>b.weight-a.weight).slice(0,3);
  const weighted = groups.map(g=>`- ${g.group} (priority ${g.weight}): ${g.ask} Topics: ${g.topics.join(", ")}`).join("\\n");
  return {
    key: profile.key,
    label: profile.label,
    searchUses: profile.key === "spirit" ? 1 : 2,
    prompt: `CATEGORY RESEARCH PROFILE: ${profile.label} (Discover adaptation of Harmony Journeys profile ${profile.key}).\\nPrioritize these research dimensions, in order:\\n${weighted}\\nOnly research the missing fields listed below. These are product-identification facts, not editorial storytelling. Never spend searches on founding stories unless the missing field specifically asks for producer history.\\nMISSING FIELDS: ${missing.join(", ")}`
  };
}
