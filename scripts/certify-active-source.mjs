import {writeFile} from "node:fs/promises";
import {configuredFreeStorefronts,searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

// One isolated source per CI job. This tests its real extraction path, not
// an in-memory fixture or a count of registry entries.
const [id,...queries]=process.argv.slice(2);
const active=configuredFreeStorefronts();
if(!id || queries.length!==2 || !active.some(s=>s.id===id)) {
  console.error("invalid_source_or_queries"); process.exit(2);
}
const negative="nawaa-unfindable-943271-20261003";
const cases=[...queries,negative];
const report={source:id,observedAt:new Date().toISOString(),cases:[],passed:false};
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
    const pass=query===negative ? offers.length===0 : valid.length>0;
    const diagnostic=result?.diagnostics || {};
    const extraction=diagnostic.searchPage || {};
    const failureKind=pass?null:
      query===negative?"NEGATIVE_FALSE_POSITIVE":
      Number(result?.candidates||0)>0?"CANDIDATES_WITHOUT_VALID_OFFERS":
      diagnostic.primarySearchError?"SEARCH_TRANSPORT_OR_API_FAILED":"NO_PRODUCT_CANDIDATES";
    report.cases.push({query,pass,offerCount:offers.length,validCount:valid.length,
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
report.passed=report.cases.every(c=>c.pass);
await writeFile("active-source-"+id+".json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
