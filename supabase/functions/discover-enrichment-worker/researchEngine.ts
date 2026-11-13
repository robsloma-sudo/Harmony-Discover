import { collectSearchResultSources, validateResearchEvidence, type ProposedResearchSource, type VerifiedResearchSource } from "./researchEvidence.ts";

export const RESEARCH_DETAIL_FIELDS = [
  "producer","vintage","region","appellation","country","grapes","classification","age_statement",
  "cask_finish","flavor","batch","importer","subcategory","package_type","package_size","sku","barcode",
  "style","distillery","winery","bottler","brand_owner","bottling_location","state_or_province",
  "subregion","vineyard","estate","mash_bill","grain","agave_type","production_method","distillation",
  "cask_type","barrel_number","bottled_on","distilled_on","harvested_on","disgorged_on","dosage",
  "residual_sugar","lot_code","upc_ean","label_designation","appellation_level","organic_claim",
  "awards","alcohol_statement","net_contents","package_material",
] as const;

export type ResearchResult = {
  details: Record<string,string>;
  scores: Record<string,number>;
  sources: VerifiedResearchSource[];
};

const clean = (value: unknown, max: number) =>
  String(value ?? "").replace(/\s+/g," ").trim().slice(0,max);
const unit = (value: unknown) => {
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
};

const ENRICHMENT_TOOL = {
  name: "bottle_enrichment",
  description: "Return only missing beverage-product facts explicitly supported by the web search results for this exact product expression.",
  input_schema: {
    type: "object",
    required: ["fields","field_confidence","sources"],
    properties: {
      fields: { type: "object", additionalProperties: { type: "string" } },
      field_confidence: { type: "object", additionalProperties: { type: "number" } },
      sources: {
        type: "array", maxItems: 8,
        items: {
          type: "object", required: ["url","title","supports"],
          properties: {
            url: { type: "string" }, title: { type: "string" },
            supports: { type: "array", items: { type: "string" } },
            source_type: { type: "string", enum: ["manufacturer","distillery","winery","brand_owner","regulator","gs1","retailer","reference"] },
          },
        },
      },
    },
  },
};

export async function researchBottleDetails(
  apiKey: string,
  model: string,
  identity: Record<string,unknown>,
  missing: string[],
  profilePrompt: string,
  searchUses: number,
): Promise<ResearchResult> {
  if (!apiKey) throw new Error("research_provider_not_configured");
  if (!clean(identity.brand,120) || !clean(identity.product,160) || !missing.length) {
    return {details:{},scores:{},sources:[]};
  }
  const messages: Array<Record<string,unknown>> = [{
    role:"user",
    content:"Research only missing facts for this exact beverage expression.\nIDENTITY: "+
      JSON.stringify({
        brand:identity.brand,product:identity.product,category:identity.category,
        proof:identity.proof,size:identity.size,details:identity.details,
      })+"\nMISSING FIELDS: "+missing.join(", ")+"\n"+profilePrompt+
      "\nSearch the exact brand and product expression. Prefer official producer, distillery, winery, brand-owner, regulator and GS1 sources. Use retailers only as secondary corroboration. Never guess, infer, or overwrite printed label facts. Return only facts explicitly supported for this exact expression and map every field to URLs returned by web search. Call bottle_enrichment once after searching.",
  }];
  const allContent: Array<Record<string,unknown>> = [];
  let finalInput: Record<string,unknown> = {};
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),35_000);
  try {
    for(let turn=0;turn<3;turn++){
      const response=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",signal:controller.signal,
        headers:{"x-api-key":apiKey,"anthropic-version":"2023-06-01","content-type":"application/json"},
        body:JSON.stringify({
          model,max_tokens:2600,
          system:"You are a rigorous beverage product researcher. Search the exact brand and product expression, not merely the brand or a similar SKU. Prefer official producer, distillery, winery, brand-owner, regulator and GS1 sources. Never invent facts. Do not treat a similar vintage, package size, age statement, cask finish, flavor or other variant as the same expression. Only return fields supported by sources actually returned by web search. Marketing copy is not technical fact.",
          tools:[{type:"web_search_20250305",name:"web_search",max_uses:Math.max(1,Math.min(2,searchUses))},ENRICHMENT_TOOL],
          tool_choice:{type:"auto"},messages,
        }),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error("anthropic_http_"+response.status);
      const blocks=Array.isArray(payload.content)?payload.content as Array<Record<string,unknown>>:[];
      allContent.push(...blocks);
      const tool=blocks.find(item=>item.type==="tool_use"&&item.name==="bottle_enrichment");
      if(tool&&tool.input&&typeof tool.input==="object"){
        finalInput=tool.input as Record<string,unknown>;
        break;
      }
      if(payload.stop_reason!=="pause_turn"||turn===2) break;
      messages.push({role:"assistant",content:blocks});
    }
  } finally {
    clearTimeout(timeout);
  }

  const rawFields=(finalInput.fields&&typeof finalInput.fields==="object"?finalInput.fields:{}) as Record<string,unknown>;
  const rawScores=(finalInput.field_confidence&&typeof finalInput.field_confidence==="object"?finalInput.field_confidence:{}) as Record<string,unknown>;
  const evidence=validateResearchEvidence(
    (Array.isArray(finalInput.sources)?finalInput.sources:[]) as ProposedResearchSource[],
    collectSearchResultSources(allContent),
    new Set(missing),
  );
  const details:Record<string,string>={},scores:Record<string,number>={};
  for(const [field,value] of Object.entries(rawFields)){
    const score=unit(rawScores[field]),v=clean(value,240);
    if(missing.includes(field)&&(RESEARCH_DETAIL_FIELDS as readonly string[]).includes(field)
      &&evidence.supportedFields.has(field)&&v&&score>=0.78){
      details[field]=v;scores[field]=score;
    }
  }
  const sources=evidence.sources.filter(source=>source.supports.some(field=>Object.prototype.hasOwnProperty.call(details,field)));
  return {details,scores,sources};
}
