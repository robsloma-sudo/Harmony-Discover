import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { collectSearchResultSources, validateResearchEvidence, type ProposedResearchSource } from "./researchEvidence.ts";

const PROJECT = "lqqmwqrffelgnbngrkep";
const MODEL = Deno.env.get("DISCOVER_BOTTLE_RESEARCH_MODEL") || "claude-haiku-5-5";
const FIELDS = ["producer","vintage","region","appellation","country","grapes","classification","age_statement","cask_finish","flavor","batch","importer","subcategory","package_type","package_size","sku","barcode","style","distillery","winery","bottler","brand_owner","bottling_location","state_or_province","subregion","vineyard","estate","mash_bill","grain","agave_type","production_method","distillation","cask_type","barrel_number","bottled_on","distilled_on","harvested_on","disgorged_on","dosage","residual_sugar","lot_code","upc_ean","label_designation","appellation_level","organic_claim","awards","alcohol_statement","net_contents","package_material"];
const DETAIL_KEYS = new Set(FIELDS);
const ENRICHMENT_TOOL = {
  name: "bottle_enrichment", description: "Return missing exact-product facts supported by web search results.",
  input_schema: { type: "object", required: ["fields","sources"], properties: {
    fields: { type: "object", additionalProperties: { type: "string" } },
    field_confidence: { type: "object", additionalProperties: { type: "number" } },
    sources: { type: "array", maxItems: 8, items: { type: "object", required: ["url","supports"], properties: {
      url: { type: "string" }, title: { type: "string" }, supports: { type: "array", items: { type: "string" } },
      source_type: { type: "string", enum: ["manufacturer","distillery","winery","brand_owner","regulator","gs1","retailer","reference"] }
    } } }
  } }
};
const clean=(v:unknown,n:number)=>String(v??"").replace(/\\s+/g," ").trim().slice(0,n);
const unit=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;};

async function research(key:string,bottle:Record<string,unknown>){
  const details=(bottle.label_details&&typeof bottle.label_details==="object"?bottle.label_details:{}) as Record<string,unknown>;
  const known={brand:bottle.read_brand,product:bottle.read_product,category:bottle.read_category,proof:bottle.read_proof,size:bottle.read_size,...details};
  const missing=FIELDS.filter(field=>!clean(details[field],80));
  if(!clean(bottle.read_brand,80)||!missing.length)return {details:{},scores:{},sources:[]};
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),35_000);
  try{
    const messages:Array<Record<string,unknown>>=[{role:"user",content:"Research missing facts for this exact beverage expression.\\nIDENTITY: "+JSON.stringify(known)+"\\nMISSING: "+missing.join(", ")+"\\nSearch exact brand, expression, category, proof and size. Use official producer/regulator/GS1 sources first. Use web search, then call bottle_enrichment once. Map each field to source URLs. Never guess or overwrite label facts."}];
    const allContent:Array<Record<string,unknown>>=[];let result:Record<string,unknown>={};
    for(let turn=0;turn<3;turn++){
      const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",signal:controller.signal,
        headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},
        body:JSON.stringify({model:MODEL,max_tokens:2600,system:"You are a rigorous beverage product researcher. Search the exact product expression, not merely the brand. Never invent facts. Only return exact-expression claims supported by the search results. Prefer official producer, distillery, winery, brand-owner, regulator and GS1 sources.",tools:[{type:"web_search_20250305",name:"web_search",max_uses:4},ENRICHMENT_TOOL],tool_choice:{type:"auto"},messages})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error("anthropic_http_"+response.status);
      const blocks=Array.isArray(payload.content)?payload.content as Array<Record<string,unknown>>:[];
      allContent.push(...blocks);
      const tool=blocks.find(x=>x.type==="tool_use"&&x.name==="bottle_enrichment");
      if(tool&&tool.input&&typeof tool.input==="object"){result=tool.input as Record<string,unknown>;break;}
      if(payload.stop_reason!=="pause_turn"||turn===2)break;
      messages.push({role:"assistant",content:blocks});
    }
    const evidence=validateResearchEvidence((Array.isArray(result.sources)?result.sources:[]) as ProposedResearchSource[],collectSearchResultSources(allContent),new Set(missing));
    const raw=(result.fields&&typeof result.fields==="object"?result.fields:{}) as Record<string,unknown>;
    const scoresRaw=(result.field_confidence&&typeof result.field_confidence==="object"?result.field_confidence:{}) as Record<string,unknown>;
    const values:Record<string,string>={},scores:Record<string,number>={};
    for(const [field,value] of Object.entries(raw)){const score=unit(scoresRaw[field]),v=clean(value,240);if(missing.includes(field)&&DETAIL_KEYS.has(field)&&evidence.supportedFields.has(field)&&v&&score>=0.78){values[field]=v;scores[field]=score;}}
    const sources=evidence.sources.filter(s=>s.supports.some(f=>Object.prototype.hasOwnProperty.call(values,f)));
    return {details:values,scores,sources};
  }finally{clearTimeout(timeout);}
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204});
  if(req.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});
  const secret=Deno.env.get("DISCOVER_RESEARCH_WORKER_SECRET");
  if(!secret||req.headers.get("x-discover-worker-secret")!==secret)return Response.json({error:"unauthorized"},{status:401});
  const url=Deno.env.get("SUPABASE_URL")||"";
  const project=(url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)||[])[1];
  if(project!==PROJECT)return Response.json({error:"wrong_project"},{status:503});
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),anthropic=Deno.env.get("ANTHROPIC_API_KEY");
  if(!service||!anthropic)return Response.json({error:"worker_not_configured"},{status:503});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const workerId=crypto.randomUUID();
  const {data:jobs,error}=await db.rpc("discover_claim_bottle_research_jobs",{p_worker:workerId,p_limit:2});
  if(error)return Response.json({error:"queue_claim_failed"},{status:503});
  let completed=0,failed=0,empty=0;
  for(const job of jobs||[]){
    try{
      const {data:sighting,error:readError}=await db.from("bottle_sightings").select("*").eq("id",job.sighting_id).single();
      if(readError||!sighting)throw new Error("sighting_not_found");
      const result=await research(anthropic,sighting);
      if(Object.keys(result.details).length){
        const current=(sighting.label_details&&typeof sighting.label_details==="object"?sighting.label_details:{}) as Record<string,unknown>;
        const merged={...current,...result.details,_research_field_confidence:{...((current._research_field_confidence&&typeof current._research_field_confidence==="object"?current._research_field_confidence:{}) as Record<string,unknown>),...result.scores},_research_sources:[...((Array.isArray(current._research_sources)?current._research_sources:[])),...result.sources]};
        const {error:updateError}=await db.from("bottle_sightings").update({label_details:merged,read_vintage:/^(18|19|20)\\d{2}$/.test(String(merged.vintage||""))?Number(merged.vintage):sighting.read_vintage}).eq("id",sighting.id);
        if(updateError)throw new Error("sighting_update_failed");
      }else empty++;
      const {error:finishError}=await db.rpc("discover_finish_bottle_research_job",{p_job:job.id,p_worker:workerId,p_status:"completed",p_error:null});
      if(finishError)throw new Error("job_finish_failed");
      completed++;
    }catch(error){
      failed++;
      await db.rpc("discover_finish_bottle_research_job",{p_job:job.id,p_worker:workerId,p_status:"failed",p_error:clean(error instanceof Error?error.message:"research_failed",300)});
    }
  }
  // Drain a larger save batch in bounded invocations rather than risking a long-running Edge request.
  if ((jobs || []).length === 2) {
    const workerUrl = url.replace(/\\/$/, "") + "/functions/v1/discover-research-worker";
    EdgeRuntime.waitUntil(fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-discover-worker-secret": secret },
      body: JSON.stringify({ trigger: "queue_drain" }),
    }).catch(() => undefined));
  }
  return Response.json({ok:true,claimed:(jobs||[]).length,completed,failed,empty});
});
