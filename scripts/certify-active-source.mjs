import {writeFile} from "node:fs/promises";
import {configuredFreeStorefronts,searchFreeStorefrontById,routeFreeStorefronts} from "../server/providers/free-storefronts.mjs";
import {certifyModelTitleMatch} from "../server/tooling/source-model-evidence.mjs";

// One isolated source per CI job. This tests its real extraction path, not
// an in-memory fixture or a count of registry entries.
const [id,...queries]=process.argv.slice(2);
const active=configuredFreeStorefronts();
if(!id || queries.length!==2 || !active.some(s=>s.id===id)) {
  console.error("invalid_source_or_queries"); process.exit(2);
}
const negative="nawaa-unfindable-943271-20261003";
const cases=[...queries,negative];
const routeCoverage=queries.map(query=>({
  query,
  routed:routeFreeStorefronts(query,Infinity,{stable:true}).some(route=>route.store.id===id),
}));
const report={source:id,observedAt:new Date().toISOString(),routeCoverage,cases:[],passed:false};
for(const query of cases){
  const started=Date.now();
  try{
    const result=await searchFreeStorefrontById(id,query,{perStore:10});
    const offers=Array.isArray(result?.offers)?result.offers:[];
    const valid=offers.filter(o=>
      typeof o.title==="string" && o.title.trim().length>=3 &&
      typeof o.sourceUrl==="string" && /^https:\/\//i.test(o.sourceUrl) &&
      typeof o.image==="string" && /^https?:\/\//i.test(o.image) &&
      Number.isFinite(o.productPrice) && o.productPrice>0 &&
      o.currency==="SAR");
    const invalid=offers.filter(o=>!valid.includes(o));
    const invalidSamples=invalid.slice(0,3).map(o=>({
      title:String(o.title||"").slice(0,120),sourceUrl:String(o.sourceUrl||"").slice(0,240),
      imagePresent:typeof o.image==="string"&&/^https?:\/\//i.test(o.image),
      imageType:typeof o.image,
      priceSAR:Number(o.productPrice)||null,
      currency:o.currency||null,
    }));
    // For explicit model searches, structural validity cannot substitute for
    // product-model relevance. EarPods are NOT AirPods; Galaxy S26 is NOT S25.
    // This is an offline CI gate only, not a change to /api/search.
    const modelRule=certifyModelTitleMatch(query,"");
    const modelMatches=modelRule.restricted?
      valid.filter(o=>certifyModelTitleMatch(query,o.title).matches):valid;
    const pass=query===negative?offers.length===0:modelMatches.length>0;
    const diagnostic=result?.diagnostics || {};
    const extraction=diagnostic.searchPage || {};
    const failureKind=pass?null:
      query===negative?"NEGATIVE_FALSE_POSITIVE":
      modelRule.restricted&&valid.length>0&&modelMatches.length===0?"QUERY_MODEL_MISMATCH":
      offers.length>0 && invalid.every(o=>typeof o.image!=="string" || !/^https?:\/\//i.test(o.image))?"RETURNED_OFFERS_MISSING_IMAGES":
      Number(result?.candidates||0)>0?"CANDIDATES_WITHOUT_VALID_OFFERS":
      diagnostic.primarySearchError?"SEARCH_TRANSPORT_OR_API_FAILED":"NO_PRODUCT_CANDIDATES";
    report.cases.push({query,pass,offerCount:offers.length,validCount:valid.length,
      modelMatchRequired:modelRule.restricted,modelMatchedCount:modelMatches.length,invalidSamples,
      candidates:result?.candidates??null,failedProductPages:result?.failures??null,
      failureKind,ms:Date.now()-started,error:diagnostic.primarySearchError||null,
      acquisitionFallback:extraction.acquisitionFallback||null,
      searchDiagnostics:extraction,
      candidateSamples:(diagnostic.candidateSamples||[]).slice(0,3),
      failureSamples:(diagnostic.failureSamples||[]).slice(0,3),
      priceRejectedSamples:(diagnostic.priceRejectedSamples||[]).slice(0,3),
      examples:valid.slice(0,2).map(o=>({title:o.title,price:o.productPrice,url:o.sourceUrl}))});
  }catch(error){
    report.cases.push({query,pass:false,ms:Date.now()-started,error:error?.message||String(error)});
  }
}
report.passed=report.cases.every(c=>c.pass) && routeCoverage.some(item=>item.routed);
await writeFile("active-source-"+id+".json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
