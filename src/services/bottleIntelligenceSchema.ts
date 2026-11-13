/**
 * Category-aware bottle intelligence.
 *
 * Shared identity/label fields are universal. Production and provenance fields
 * are selected by beverage family and subtype; absent facts remain unknown.
 * This is a display/research schema, not a source of inferred product facts.
 */
export type BeverageFamily =
  | "armagnac" | "cognac" | "other_brandy" | "pisco"
  | "rye_whiskey" | "bourbon" | "single_malt_scotch" | "single_malt_whiskey" | "other_whiskey"
  | "wine_red" | "wine_white" | "wine_rose" | "wine_unknown" | "sparkling_wine"
  | "tequila" | "mezcal" | "rum" | "gin" | "vodka" | "liqueur" | "other";

export type IntelligenceField = {
  key: string;
  label: string;
  description: string;
};

export type IntelligenceSection = {
  id: string;
  title: string;
  description: string;
  fields: IntelligenceField[];
};

const field = (key: string, label: string, description: string): IntelligenceField =>
  ({ key, label, description });

const COMMON: IntelligenceSection[] = [
  { id: "identity", title: "Bottle identity", description: "What this exact product and package are.", fields: [
    field("brand", "Brand", "Brand printed on the bottle"),
    field("product", "Expression", "Exact product or expression"),
    field("producer", "Producer", "Distillery, winery, estate or producer"),
    field("bottler", "Bottler", "Bottler or independent bottler"),
    field("size", "Bottle size", "Net contents and package format"),
    field("proof", "ABV / proof", "Alcohol strength as stated"),
    field("classification", "Classification", "Legal or producer classification"),
    field("vintage", "Vintage / release", "Vintage, batch or release year"),
  ]},
  { id: "origin", title: "Origin & provenance", description: "Where the raw materials and finished product come from.", fields: [
    field("country", "Country", "Country of production or origin"),
    field("region", "Region", "Recognized production region"),
    field("subregion", "Subregion", "District, island, AVA or subregion"),
    field("appellation", "Appellation", "Protected geographical designation"),
    field("estate", "Estate", "Estate, château or property"),
    field("vineyard", "Vineyard", "Named vineyard or source site"),
  ]},
  { id: "label", title: "Label & verification", description: "Facts read from the physical label, kept separate from researched claims.", fields: [
    field("label_text", "Full label transcription", "All legible front, back and neck label text"),
    field("age_statement", "Age statement", "Age or maturation statement"),
    field("awards", "Awards", "Awards printed on the package"),
    field("certifications", "Certifications", "Organic, biodynamic, appellation and other claims"),
  ]},
];

const FAMILY: Record<BeverageFamily, IntelligenceSection[]> = {
  armagnac: [
    { id:"agriculture", title:"Viticulture & agriculture", description:"The grapes and growing conditions behind the eau-de-vie.", fields:[
      field("grapes","Grape varieties","Ugni Blanc, Baco, Folle Blanche, Colombard and other permitted varieties"),
      field("vineyard_practices","Vineyard practices","Organic, biodynamic, regenerative or conventional practices when documented"),
      field("harvest","Harvest","Harvest date, maturity and sourcing"),
      field("terroir","Terroir","Soils, climate and growing area"),
    ]},
    { id:"production", title:"Distillation & production", description:"Armagnac-specific production choices.", fields:[
      field("armagnac_appellation","Armagnac appellation","Bas-Armagnac, Armagnac-Ténarèze, Haut-Armagnac or other designation"),
      field("distillation_method","Distillation method","Traditional continuous Armagnac still or double distillation"),
      field("distillation_date","Distillation date","Distillation year or date"),
      field("producer_site","Producer / estate","Estate, négociant or producer"),
    ]},
    { id:"maturation", title:"Maturation & cask", description:"How the spirit developed after distillation.", fields:[
      field("age_statement","Age / vintage","Vintage Armagnac or age category"),
      field("cask_type","Cask type","Gascon or other oak and prior contents"),
      field("cask_finish","Cask finish","Finishing cask and duration"),
      field("cellar","Cellar conditions","Cellar location and maturation conditions"),
    ]},
  ],
  cognac: [
    { id:"production",title:"Cognac production",description:"Appellation, cru and distillation.",fields:[
      field("cognac_cru","Cognac cru","Grande Champagne, Petite Champagne, Borderies, Fins Bois, Bons Bois or Bois Ordinaires"),
      field("grapes","Grape varieties","Ugni Blanc and other permitted grapes"),
      field("distillation_method","Distillation","Charentais double distillation and producer-specific practice"),
      field("lees_policy","Lees policy","Whether and how lees are retained"),
    ]},
    { id:"maturation",title:"Maturation & blending",description:"Cognac age category and cask program.",fields:[
      field("age_statement","Age category","VS, VSOP, XO, XXO or vintage details"),
      field("cask_type","Cask type","French oak origin and toast"),
      field("blend_composition","Blend composition","Cru and age composition when disclosed"),
    ]},
  ],
  other_brandy: [
    { id:"production",title:"Fruit & distillation",description:"The fruit source and brandy-making tradition.",fields:[
      field("fruit_source","Fruit source","Grape, apple, pear, plum or other fruit"),
      field("fermentation","Fermentation","Fermentation method and duration"),
      field("distillation_method","Distillation","Pot, column or other still and number of runs"),
    ]},
    { id:"maturation",title:"Maturation",description:"Aging and finishing.",fields:[
      field("age_statement","Age statement","Declared age or category"),
      field("cask_type","Cask type","Wood species, origin and previous contents"),
      field("cask_finish","Cask finish","Secondary maturation"),
    ]},
  ],
  pisco: [
    { id:"agriculture",title:"Grape growing",description:"Pisco begins with specific grape varieties and growing regions.",fields:[
      field("grapes","Pisco grape varieties","Named aromatic or non-aromatic grape varieties"),
      field("growing_region","Growing region","Country, valley and recognized production zone"),
      field("vineyard_practices","Agricultural practices","Irrigation, farming and harvest practices when documented"),
    ]},
    { id:"production",title:"Pisco production rules",description:"Country-specific denomination and production method matter.",fields:[
      field("pisco_country_style","Pisco denomination","Peruvian or Chilean Pisco; applicable denomination"),
      field("must_type","Must / wine base","Fresh must, fermented wine or other permitted base"),
      field("distillation_method","Distillation","Still type, batch method and distillation details"),
      field("distillation_strength","Distillation strength","Whether distilled to proof or diluted, where documented"),
      field("resting_vessel","Resting vessel","Neutral vessel, stainless steel or permitted wood"),
      field("aging","Resting / aging","Required or voluntary resting period"),
      field("sweetening","Additions","Sweetening, water or additives only when verified"),
    ]},
  ],
  rye_whiskey: [
    { id:"agriculture",title:"Grain & sourcing",description:"The grain recipe and agricultural origin.",fields:[
      field("mash_bill","Mash bill","Rye percentage and other grains"),
      field("grain_origin","Grain origin","Farm, region and grain sourcing"),
      field("grain_practices","Agricultural practices","Growing practices when disclosed"),
    ]},
    { id:"production",title:"Whiskey production",description:"Fermentation, distillation and legal style.",fields:[
      field("jurisdiction","Legal jurisdiction","Country and applicable whiskey standard"),
      field("fermentation","Fermentation","Yeast, fermentation and sour-mash practices"),
      field("distillation_method","Distillation","Still type and distillation approach"),
      field("barrel_entry_proof","Barrel entry proof","Proof at filling"),
      field("age_statement","Age statement","Declared age or sourced whiskey age"),
    ]},
    { id:"maturation",title:"Barrel & finishing",description:"Oak, warehouse and finishing details.",fields:[
      field("cask_type","Barrel type","New charred oak or other barrel type"),
      field("char_level","Char / toast","Char level and toast where disclosed"),
      field("warehouse","Warehouse","Warehouse location and maturation conditions"),
      field("cask_finish","Cask finish","Secondary cask, prior contents and finish duration"),
      field("batch","Batch / barrel","Single barrel, batch and bottle identifiers"),
    ]},
  ],
  bourbon: [
    { id:"production",title:"Bourbon production",description:"Mash bill, legal standards and distillation.",fields:[
      field("mash_bill","Mash bill","Corn, rye, wheat, malted barley percentages"),
      field("jurisdiction","Legal standard","Bourbon requirements and any additional designation"),
      field("fermentation","Fermentation","Yeast and fermentation approach"),
      field("distillation_method","Distillation","Still type and proof"),
      field("barrel_entry_proof","Barrel entry proof","Proof when filled into new charred oak"),
    ]},
    { id:"maturation",title:"Barrel & maturation",description:"Oak, warehouse and finishing.",fields:[
      field("cask_type","Barrel type","New charred oak and barrel details"),
      field("age_statement","Age statement","Age and age composition"),
      field("warehouse","Warehouse","Location, floor and conditions"),
      field("cask_finish","Cask finish","Finishing cask and duration"),
    ]},
  ],
  single_malt_scotch: [
    { id:"agriculture",title:"Barley & malt",description:"Barley sourcing and malting.",fields:[
      field("barley_origin","Barley origin","Barley variety, farm and region"),
      field("malting","Malting","Floor malted or commercial malt; maltster"),
      field("peat_level","Peat level","Peat specification in ppm and where measured"),
    ]},
    { id:"production",title:"Distillery & production",description:"Scotch region, distillery and still practice.",fields:[
      field("scotch_region","Scotch region","Highlands, Speyside, Islay, Lowlands, Campbeltown or Islands"),
      field("distillery","Distillery","Producing distillery and site history"),
      field("fermentation","Fermentation","Washback type and fermentation duration"),
      field("still_type","Still type","Pot still shape, size and configuration"),
      field("distillation_method","Distillation","Cut points and distillation practice when disclosed"),
    ]},
    { id:"maturation",title:"Cask maturation",description:"Scotch maturation is shaped by cask history and warehouse conditions.",fields:[
      field("cask_type","Cask type","Ex-bourbon, sherry, wine, refill or other cask"),
      field("cask_finish","Cask finish","Finish type and duration"),
      field("age_statement","Age statement","Age statement or no-age-statement release"),
      field("warehouse","Warehouse","Dunnage, racked or palletized warehouse"),
      field("bottling_strength","Bottling strength","Cask strength, natural colour or chill filtration"),
    ]},
  ],
  single_malt_whiskey: [
    { id:"agriculture",title:"Barley & malt",description:"The agricultural and malting choices behind this single malt.",fields:[
      field("barley_origin","Barley origin","Barley variety, farm, region and sourcing"),
      field("malting","Malting","Floor malted or commercial malt; maltster"),
      field("peat_level","Peat level","Peat specification and where measured"),
    ]},
    { id:"production",title:"Distillery & production",description:"Single-malt distillery, fermentation and distillation practice.",fields:[
      field("jurisdiction","Legal jurisdiction","Country and applicable single-malt whiskey standard"),
      field("distillery","Distillery","Producing distillery and site history"),
      field("fermentation","Fermentation","Washback type, yeast and fermentation duration"),
      field("still_type","Still type","Pot still shape, size and configuration"),
      field("distillation_method","Distillation","Distillation approach and cut points when disclosed"),
    ]},
    { id:"maturation",title:"Cask maturation",description:"Oak, warehouse and finishing choices.",fields:[
      field("cask_type","Cask type","Ex-bourbon, sherry, wine, virgin oak or other cask"),
      field("cask_finish","Cask finish","Finish type and duration"),
      field("age_statement","Age statement","Declared age or no-age-statement release"),
      field("warehouse","Warehouse","Warehouse location and maturation conditions"),
      field("bottling_strength","Bottling strength","Cask strength, natural colour or chill filtration"),
    ]},
  ],
  other_whiskey: [
    { id:"production",title:"Grain & distillation",description:"Whiskey style and production choices.",fields:[
      field("mash_bill","Mash bill","Grain composition"),
      field("grain_origin","Grain origin","Agricultural source"),
      field("fermentation","Fermentation","Fermentation and yeast"),
      field("distillation_method","Distillation","Still type and process"),
    ]},
    { id:"maturation",title:"Maturation",description:"Barrel and finishing program.",fields:[
      field("cask_type","Cask type","Wood and previous contents"),
      field("age_statement","Age statement","Declared age"),
      field("cask_finish","Cask finish","Secondary maturation"),
    ]},
  ],
  wine_red: [
    { id:"agriculture",title:"Vineyard & agriculture",description:"The site, grapes and farming behind the wine.",fields:[
      field("grapes","Grape varieties","Varieties and blend percentages"),
      field("vineyard","Vineyard","Named vineyard and parcel"),
      field("terroir","Terroir","Soils, aspect, altitude and climate"),
      field("farming","Farming practices","Organic, biodynamic, regenerative or conventional; certification status"),
      field("harvest","Harvest","Harvest date, picking method and selection"),
      field("yield","Yield","Vineyard yield where disclosed"),
    ]},
    { id:"winemaking",title:"Winemaking",description:"How the red wine was fermented and raised.",fields:[
      field("fermentation","Fermentation","Whole cluster, maceration, vessel, yeast and temperature"),
      field("extraction","Extraction","Punchdowns, pumpovers and maceration length"),
      field("malolactic","Malolactic fermentation","Whether and where malolactic fermentation occurred"),
      field("elevage","Élevage","Vessel, duration and lees management"),
      field("oak_regime","Oak regime","French/American oak, new-oak percentage, size and toast"),
      field("bottling","Bottling","Filtration, fining and bottling date"),
    ]},
  ],
  wine_white: [
    { id:"agriculture",title:"Vineyard & agriculture",description:"Grape source, site and farming.",fields:[
      field("grapes","Grape varieties","Varieties and blend percentages"),
      field("vineyard","Vineyard","Named vineyard and parcel"),
      field("terroir","Terroir","Soils, climate, altitude and exposure"),
      field("farming","Farming practices","Organic, biodynamic, regenerative or conventional"),
      field("harvest","Harvest","Picking date and method"),
    ]},
    { id:"winemaking",title:"White winemaking",description:"Pressing, fermentation and élevage.",fields:[
      field("pressing","Pressing","Whole-bunch pressing, press type and juice handling"),
      field("fermentation","Fermentation","Vessel, yeast, temperature and fermentation"),
      field("malolactic","Malolactic fermentation","Whether malolactic fermentation occurred"),
      field("lees","Lees aging","Lees contact and bâtonnage"),
      field("oak_regime","Oak regime","Oak type, new-oak percentage and vessel"),
      field("residual_sugar","Residual sugar","Measured residual sugar"),
    ]},
  ],
  wine_rose: [
    { id:"agriculture",title:"Vineyard & agriculture",description:"Grapes, site and farming.",fields:[
      field("grapes","Grape varieties","Varieties and blend percentages"),
      field("vineyard","Vineyard","Vineyard or estate"),
      field("terroir","Terroir","Soils and climate"),
      field("farming","Farming practices","Organic, biodynamic or other verified practices"),
      field("harvest","Harvest","Harvest date and method"),
    ]},
    { id:"winemaking",title:"Rosé winemaking",description:"Colour extraction and fermentation choices.",fields:[
      field("rose_method","Rosé method","Direct press, short maceration, saignée or blending where legal"),
      field("pressing","Pressing","Pressing and juice handling"),
      field("fermentation","Fermentation","Vessel, yeast and temperature"),
      field("elevage","Élevage","Vessel and lees contact"),
      field("oak_regime","Oak regime","Oak use, if any"),
    ]},
  ],
  wine_unknown: [
    { id:"agriculture",title:"Vineyard & origin",description:"Wine-specific origin and agricultural facts without assuming colour or style.",fields:[
      field("style","Wine style","Red, white, rosé, orange or another style once confirmed"),
      field("grapes","Grape varieties","Varieties and blend percentages"),
      field("vineyard","Vineyard","Named vineyard, parcel or estate"),
      field("terroir","Terroir","Soils, climate, altitude and exposure"),
      field("farming","Farming practices","Organic, biodynamic, regenerative or conventional; certification status"),
      field("harvest","Harvest","Harvest date, picking method and selection"),
    ]},
    { id:"winemaking",title:"Winemaking & élevage",description:"Production details that can be documented without presuming a wine colour.",fields:[
      field("pressing","Pressing","Press type, whole-cluster handling and juice handling"),
      field("fermentation","Fermentation","Vessel, yeast, temperature and duration"),
      field("malolactic","Malolactic fermentation","Whether and where malolactic fermentation occurred"),
      field("elevage","Élevage","Vessel, duration and lees management"),
      field("oak_regime","Oak regime","Oak type, new-oak percentage, vessel and duration"),
      field("residual_sugar","Residual sugar","Measured residual sugar"),
      field("bottling","Bottling","Filtration, fining and bottling date"),
    ]},
  ],
  sparkling_wine: [
    { id:"agriculture",title:"Vineyard & agriculture",description:"Grapes, site and farming.",fields:[
      field("grapes","Grape varieties","Varieties and blend percentages"),
      field("vineyard","Vineyard","Named vineyard or grower"),
      field("terroir","Terroir","Soils and climate"),
      field("farming","Farming practices","Organic, biodynamic or other verified practices"),
      field("harvest","Harvest","Harvest date and picking method"),
    ]},
    { id:"production",title:"Sparkling method",description:"The method that creates the bubbles.",fields:[
      field("sparkling_method","Production method","Traditional method, tank method, ancestral/Pét-Nat or other"),
      field("base_wine","Base wine","Base wine composition and reserve wine"),
      field("secondary_fermentation","Secondary fermentation","Bottle or tank fermentation"),
      field("lees_aging","Lees aging","Lees aging duration and riddling"),
      field("disgorgement","Disgorgement","Disgorgement date and dosage"),
      field("dosage","Dosage","Brut Nature, Extra Brut, Brut and dosage in g/L"),
    ]},
  ],
  tequila: [
    {id:"agriculture",title:"Agave & agriculture",description:"Agave species, fields and maturation.",fields:[
      field("agave_type","Agave species","Blue Weber or other species"),
      field("agave_origin","Agave origin","Estate, field, region and altitude"),
      field("harvest","Harvest","Plant age and harvest practice"),
      field("farming","Agricultural practices","Cultivation and sustainability"),
    ]},
    {id:"production",title:"Agave production",description:"Cooking, extraction, fermentation and distillation.",fields:[
      field("cooking","Cooking","Oven, autoclave or diffuser"),
      field("extraction","Extraction","Tahona, roller mill or other"),
      field("fermentation","Fermentation","Yeast, vessel and duration"),
      field("distillation_method","Distillation","Still type and number of distillations"),
      field("additives","Additives","Verified additive disclosures"),
    ]},
    {id:"maturation",title:"Maturation",description:"Tequila class and oak program.",fields:[
      field("classification","Tequila class","Blanco, reposado, añejo, extra añejo or cristalino"),
      field("cask_type","Cask type","Oak species, previous contents and size"),
      field("age_statement","Aging duration","Time in wood where applicable"),
    ]},
  ],
  mezcal: [
    {id:"agriculture",title:"Agave & terroir",description:"Species, wild or cultivated source and region.",fields:[
      field("agave_type","Agave species","Espadín, Tobalá, Tepeztate and other species"),
      field("agave_origin","Agave source","Wild/cultivated, region, altitude and harvest age"),
      field("farming","Agricultural practices","Cultivation and biodiversity practices"),
    ]},
    {id:"production",title:"Mezcal production",description:"Traditional production details.",fields:[
      field("cooking","Cooking","Pit oven, masonry oven or other"),
      field("milling","Milling","Tahona, mallet, shredder or other"),
      field("fermentation","Fermentation","Open/closed vessel, wild/cultured yeast and duration"),
      field("distillation_method","Distillation","Copper, clay or other still; number of distillations"),
      field("water_source","Water source","Source and treatment"),
    ]},
  ],
  rum: [
    {id:"agriculture",title:"Sugarcane source",description:"Raw material and agricultural origin.",fields:[
      field("sugarcane_source","Sugarcane source","Molasses, cane juice, syrup and origin"),
      field("farming","Agricultural practices","Farm and growing practices"),
    ]},
    {id:"production",title:"Fermentation & distillation",description:"Rum production style.",fields:[
      field("fermentation","Fermentation","Yeast, duration and fermentation type"),
      field("distillation_method","Distillation","Pot, column or hybrid still"),
      field("origin_style","Regional style","Country and local rum tradition"),
    ]},
    {id:"maturation",title:"Maturation & blending",description:"Tropical/continental aging and blending.",fields:[
      field("cask_type","Cask type","Oak and prior contents"),
      field("age_statement","Age statement","Age and age system"),
      field("tropical_aging","Tropical aging","Time in tropical versus continental climate"),
      field("dosage","Additions","Sugar, colouring or other additions when verified"),
    ]},
  ],
  gin: [{id:"production",title:"Botanicals & distillation",description:"The botanical recipe and extraction method.",fields:[
    field("botanicals","Botanicals","Juniper and other botanicals"),
    field("base_spirit","Base spirit","Base alcohol source"),
    field("distillation_method","Distillation","Maceration, vapour infusion or compound method"),
  ]}],
  vodka: [{id:"production",title:"Raw material & production",description:"Base ingredient and distillation/filtration.",fields:[
    field("base_material","Base material","Grain, potato, grape or other source"),
    field("distillation_method","Distillation","Still type and number of distillations"),
    field("filtration","Filtration","Charcoal or other filtration"),
    field("water_source","Water source","Water origin and mineral profile"),
  ]}],
  liqueur: [{id:"production",title:"Ingredients & production",description:"The ingredients and method that define the liqueur.",fields:[
    field("base_spirit","Base spirit","Base alcohol"),
    field("botanicals","Ingredients","Fruit, herbs, spices, botanicals and other ingredients"),
    field("sweetening","Sweetening","Sugar source and level"),
    field("production_method","Production method","Maceration, infusion, distillation or blending"),
  ]}],
  other: [{id:"production",title:"Production details",description:"Category-specific production facts when known.",fields:[
    field("ingredients","Ingredients","Primary ingredients"),
    field("production_method","Production method","Production process"),
  ]}],
};

export function resolveBeverageFamily(category: string, details: Record<string, unknown> = {}): BeverageFamily {
  const normalize = (value: unknown) => String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const categoryKey = normalize(category);
  const hint = [category, details.subcategory, details.classification, details.style, details.appellation]
    .map(normalize).filter(Boolean).join(" ");

  if (/armagnac/.test(hint)) return "armagnac";
  if (/cognac/.test(hint)) return "cognac";
  if (/pisco/.test(hint)) return "pisco";
  if (/\brye\b/.test(hint)) return "rye_whiskey";
  if (/bourbon/.test(hint)) return "bourbon";
  if (/single malt/.test(hint) && /scotch|islay|speyside|highlands?|lowlands?|campbeltown|islands/.test(hint)) return "single_malt_scotch";
  if (/single malt/.test(hint)) return "single_malt_whiskey";
  if (/brandy|calvados|eau de vie/.test(hint) || categoryKey === "brandy") return "other_brandy";
  if (/sparkling|champagne|cremant|prosecco|cava/.test(hint) || categoryKey === "sparkling") return "sparkling_wine";
  if (/\brose\b/.test(hint)) return "wine_rose";
  if (categoryKey === "wine" && /\bwhite\b/.test(hint)) return "wine_white";
  if (categoryKey === "wine" && /\bred\b/.test(hint)) return "wine_red";
  if (categoryKey === "wine") return "wine_unknown"; // Never assume red, white or rosé without evidence.
  if (categoryKey === "whiskey" || categoryKey === "whisky") return "other_whiskey";
  if (categoryKey === "tequila") return "tequila";
  if (categoryKey === "mezcal") return "mezcal";
  if (categoryKey === "rum") return "rum";
  if (categoryKey === "gin") return "gin";
  if (categoryKey === "vodka") return "vodka";
  if (categoryKey === "liqueur" || categoryKey === "amaro aperitivo" || categoryKey === "vermouth") return "liqueur";
  return "other";
}

export function getBottleIntelligenceSections(category: string, details: Record<string, unknown> = {}): IntelligenceSection[] {
  const family = resolveBeverageFamily(category, details);
  return [...COMMON, ...FAMILY[family]];
}

export function getBottleFamilyLabel(category: string, details: Record<string, unknown> = {}): string {
  const labels: Record<BeverageFamily, string> = {
    armagnac:"Armagnac", cognac:"Cognac", other_brandy:"Brandy", pisco:"Pisco",
    rye_whiskey:"Rye whiskey", bourbon:"Bourbon", single_malt_scotch:"Single malt Scotch",
    other_whiskey:"Whiskey", single_malt_whiskey:"Single malt whiskey", wine_red:"Red wine", wine_white:"White wine", wine_rose:"Rosé wine", wine_unknown:"Wine · style unconfirmed",
    sparkling_wine:"Sparkling wine", tequila:"Tequila", mezcal:"Mezcal", rum:"Rum", gin:"Gin",
    vodka:"Vodka", liqueur:"Liqueur / aperitif", other:"Beverage",
  };
  return labels[resolveBeverageFamily(category, details)];
}
