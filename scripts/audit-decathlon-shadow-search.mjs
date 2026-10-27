// Exact-head read-only acceptance for v22.02.
// Observations are private and aggregate; never emit product identities,
// raw URLs, prices, inventory, checkout state or HTML.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {auditDecathlonSitemap} from "./audit-sitemap-discovery.mjs";
import {fetchHtmlSafe,inspectFetchedDecathlonDocumentShadow} from "../server/url-resolver.mjs";

const validCandidate=u=>{
  try{const p=new URL(u);return p.protocol==="https:"&&p.hostname==="decathlon.com.sa"&&
    !p.username&&!p.password&&!p.search&&!p.hash&&
    /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(p.pathname);}
  catch{return false;}
};
const matchingPath=(a,b)=>{
  try{const x=new URL(a),y=new URL(b);
    return validCandidate(a)&&validCandidate(b)&&x.pathname.replace(/\/+$/,"")===y.pathname.replace(/\/+$/,"");
  }catch{return false;}
};
export async function auditDecathlonShadowSearch({
  fetchSitemap=fetch,
  fetchPdp=fetchHtmlSafe,
  inspect=inspectFetchedDecathlonDocumentShadow,
  signal,
}={}){
  const candidates=[];
  const sitemap=await auditDecathlonSitemap({
    fetchPage:fetchSitemap,signal,onProductSample:values=>{
      for(const value of values.slice(0,2))if(validCandidate(value))candidates.push(value);
    },
  });
  const report={
    schemaVersion:"nawaa.decathlon.search-shadow.v1",
    sourceId:"decathlon-sa",
    sitemapStatus:sitemap.status,sitemapRequests:sitemap.requests,
    catalogComplete:sitemap.complete,
    sampledPdp:0,observations:0,variantPriceOwnedCount:0,
    missingObservationCount:0,sourceFreshnessCertified:0,
    trustedOffersCreated:0,publicOfferChanges:0,
    inventoryVerified:false,shippingVerified:false,
    statuses:[],
  };
  if(["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(sitemap.status))
    return report;
  for(const url of candidates.slice(0,2)){
    report.sampledPdp++;
    try{
      const controller=AbortSignal.timeout(5500);
      const querySignal=signal?AbortSignal.any([signal,controller]):controller;
      const fetched=await fetchPdp(url,0,{signal:querySignal});
      if(!matchingPath(url,fetched.finalUrl)){
        report.statuses.push("PDP_URL_IDENTITY_CONFLICT");continue;
      }
      let got=null;
      await inspect(fetched,url,{
        fetchedAtMs:Date.now(),onDecathlonShadow:observation=>{got=observation;},
      });
      if(got){
        report.observations++;
        if(got.variantPriceOwned===true)report.variantPriceOwnedCount++;
        report.statuses.push(got.status);
      }else{
        report.missingObservationCount++;
        report.statuses.push("SHADOW_NOT_ENABLED_OR_NOT_OBSERVED");
      }
    }catch{
      report.statuses.push("PDP_UNAVAILABLE");
    }
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditDecathlonShadowSearch(),null,2)+"\n");
}
