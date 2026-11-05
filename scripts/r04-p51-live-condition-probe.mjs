// Exact-SHA REAL public merchant probe; no fixtures, proxies or extra retries.
// This is observability, not evidence of exhaustive retailer coverage.
import {writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const cases=[
  ["niceone-sa","dior perfume"],
  ["bestbuy-us","apple airpods 4"],
  ["thomann-de","studio headphones"],
];
const knownConditions=new Set(["new","used","refurbished","open_box","unknown"]);
const provenFromOffer=new Set(["SELECTED_PRICED_OFFER","PRODUCT_AND_SELECTED_OFFER"]);
const allowedEvidence=new Set([
  "PRODUCT","SELECTED_PRICED_OFFER","PRODUCT_AND_SELECTED_OFFER",
  "CONFLICTING_OR_UNVERIFIED","UNVERIFIED","ABSENT",
]);
const rows=[];
for(const [storeId,query] of cases){
  const started=Date.now();
  try{
    const response=await searchFreeStorefrontById(storeId,query,{
      perStore:2,signal:AbortSignal.timeout(11000),
    });
    const offers=Array.isArray(response?.offers)?response.offers:[];
    const counts={new:0,used:0,refurbished:0,open_box:0,unknown:0};
    const evidence={product:0,offer:0,concordant:0,conflict:0,
      unverified:0,absent:0,unobserved:0};
    let priced=0;
    for(const offer of offers.slice(0,24)){
      const condition=offer?.condition;
      if(!knownConditions.has(condition))throw Error("INVALID_OFFER_CONDITION");
      counts[condition]++;
      if(Number.isFinite(offer?.productPrice)&&offer.productPrice>0)priced++;
      const type=offer?.extraction?.conditionEvidence;
      if(type===undefined)evidence.unobserved++;
      else{
        if(!allowedEvidence.has(type))throw Error("INVALID_CONDITION_PROVENANCE");
        const key={
          PRODUCT:"product",SELECTED_PRICED_OFFER:"offer",
          PRODUCT_AND_SELECTED_OFFER:"concordant",
          CONFLICTING_OR_UNVERIFIED:"conflict",UNVERIFIED:"unverified",
          ABSENT:"absent",
        }[type];
        evidence[key]++;
        if(type==="CONFLICTING_OR_UNVERIFIED"&&condition!=="unknown")
          throw Error("CONFLICTING_CONDITION_PUBLISHED");
        if(provenFromOffer.has(type)&&condition==="unknown")
          throw Error("UNVERIFIED_OFFER_PROVENANCE");
      }
    }
    rows.push({storeId,outcome:priced>0?"VERIFIED_PRICED_OFFERS":"NO_VERIFIED_OFFERS",
      ms:Date.now()-started,candidates:response?.candidates??null,
      offers:offers.length,priced,conditions:counts,evidence,
      sourceFailed:Boolean(response?.diagnostics?.primarySearchError)});
  }catch{
    rows.push({storeId,outcome:"SOURCE_PROBE_FAILED",
      ms:Date.now()-started,offers:0,priced:0,sourceFailed:true});
  }
}
const validPriced=rows.reduce((n,r)=>n+(r.priced||0),0);
const sourceSuccess=rows.filter(r=>r.priced>0).length;
const report={schemaVersion:"nawaa.r04.p51.live-condition.v1",
  exactCandidateSha:sha,evidenceMode:"REAL_PUBLIC_MERCHANT_HTTP_NO_MOCKS",
  attemptedStores:rows.length,storeSuccesses:sourceSuccess,
  verifiedPricedOffers:validPriced,rows,
  caveat:"One small live source sample; no global stock, total-cost or query-recall claims."};
writeFileSync("r04-p51-live-condition-evidence.json",JSON.stringify(report,null,2));
console.log("NAWAA_P51_LIVE_CONDITION "+JSON.stringify(report));
if(sourceSuccess===0){
  console.error("P51_LIVE_SOURCE_GATE_FAILED: No real priced merchant offers observed.");
  process.exitCode=2;
}
