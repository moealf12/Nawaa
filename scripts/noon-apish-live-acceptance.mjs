#!/usr/bin/env node
// End-to-end *live* first-party-network-alternative probe. Never serves users.
// One credit/query when API.SH runs; account/key must have 1000/month free cap.
import {writeFile} from "node:fs/promises";
import {fetchNoonSaudiApish,fetchNoonSaudiApishOfferParity} from "../server/providers/noon-apish-staged.mjs";

const REPORT="noon-apish-live-acceptance.json";
const key=process.env.APISH_KEY||"";
const report={
  schema:"nawaa.noon-apish.live-probe.v1",
  observedAt:new Date().toISOString(),
  branchSha:process.env.GITHUB_SHA||null,
  source:"noon-sa",upstream:"API.SH",
  noCache:true,fresh:true,offlineData:false,
  pricesCustomerPublishable:false,
  independentNoonPdpVerified:false,
  cases:[],status:"NOT_RUN",
};
try{
  if(!key){
    // Public handshake does not consume credits; confirms this runner can
    // reach the documented API origin. Not an authenticated merchant result.
    const ctl=new AbortController();
    const timeout=setTimeout(()=>ctl.abort(),10000);
    try{
      const url="https://api.api.sh/noon/v1/search?q=laptop&country=sa&language=en&limit=1&fresh=1&raw=0";
      const response=await fetch(url,{method:"GET",redirect:"error",signal:ctl.signal,
        headers:{accept:"application/json"}});
      report.cases.push({query:"laptop",statusCode:response.status,
        status:response.status===401?"UPSTREAM_REACHABLE_AUTH_REQUIRED":
          "UNEXPECTED_ANONYMOUS_STATUS",accepted:0});
      report.status=response.status===401?"UPSTREAM_REACHABLE_AUTH_REQUIRED":"NO_API_KEY";
    }catch(error){
      report.cases.push({query:"laptop",status:"UPSTREAM_UNREACHABLE",
        errorCode:String(error?.cause?.code||error?.name||"UNKNOWN").slice(0,80),
        accepted:0});
      report.status="UPSTREAM_UNREACHABLE";
    }finally{clearTimeout(timeout);}
  }else{
    for(const query of ["iPhone 17 256GB","laptop","سماعات بلوتوث"]){
      const start=Date.now();
      try{
        const response=await fetchNoonSaudiApish(query,{apiKey:key,limit:40,
          deadlineMs:45000});
        const parity=response.candidates[0]
          ? await fetchNoonSaudiApishOfferParity(response.candidates[0],{
              apiKey:key,deadlineMs:45000})
          : null;
        report.cases.push({
          query,status:response.status,latencyMs:Date.now()-start,
          exactOfferParity:parity?.status||"NO_CANDIDATES",
          accepted:response.candidates.length,rejected:response.rejected,
          conflicts:response.conflicts,creditsUsed:response.creditsUsed,
          sourceCached:response.sourceCached??null,
          sample:response.candidates.slice(0,2).map(c=>({
            sku:c.productId,offerCode:c.offerCode,price:c.price,
            currency:c.currency,sourceUrl:c.sourceUrl, evidence:c.evidence,
            customerPublishable:false,
          })),
        });
        if(response.status!=="THIRD_PARTY_SEARCH_OBSERVED" ||
           response.candidates.length===0 ||
           parity?.status!=="THIRD_PARTY_SEARCH_PRODUCT_OFFER_PARITY"){
          report.status="INTEGRITY_PARITY_OR_COVERAGE_REJECTED";
          break;
        }
      }catch(error){
        report.cases.push({query,status:"UPSTREAM_FAILURE",
          errorCode:String(error?.code||error?.name||"UNKNOWN").slice(0,80),
          latencyMs:Date.now()-start,accepted:0});
        report.status="UPSTREAM_FAILURE";
        break;
      }
    }
    if(report.status==="NOT_RUN")
      report.status=report.cases.length===3?
        "THIRD_PARTY_LIVE_SEARCH_PASSED_CUSTOMER_PUBLICATION_HELD":
        "LIVE_INCOMPLETE";
  }
}finally{
  await writeFile(REPORT,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if(report.status!=="THIRD_PARTY_LIVE_SEARCH_PASSED_CUSTOMER_PUBLICATION_HELD")
    process.exitCode=1;
}
