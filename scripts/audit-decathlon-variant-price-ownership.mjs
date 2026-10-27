// NAWAA v22.01 — one-shot source-owned live sample; no stored prices,
// customer offers, inventory, URLs or SKU/variant identifiers.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {auditDecathlonSitemap} from "../scripts/audit-sitemap-discovery.mjs";
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {attestDecathlonVariantPrice} from "../server/decathlon-variant-price-ownership.mjs";

const productPath=raw=>{
  try{const u=new URL(raw);return u.protocol==="https:"&&u.hostname==="decathlon.com.sa"&&
    !u.search&&!u.hash&&!u.username&&!u.password&&
    /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname);}
  catch{return false;}
};
const noPromotion=()=>({trustedOffersCreated:0,inventoryVerified:false,
  shippingVerified:false,publishedToSearch:false,priceAmountLogged:false});

export async function auditDecathlonVariantPriceOwnership({
  fetchSitemap=fetch,fetchPdp=fetchHtmlSafe,signal,
}={}){
  const urls=[];
  const sitemap=await auditDecathlonSitemap({
    fetchPage:fetchSitemap,signal,onProductSample:sample=>{
      for(const u of sample.slice(0,2))if(productPath(u))urls.push(u);
    },
  });
  const report={
    schemaVersion:"nawaa.decathlon.variant-price-ownership.v1",
    sourceId:"decathlon-sa",
    sitemapStatus:sitemap.status,sitemapRequests:sitemap.requests,
    sitemapCandidates:sitemap.productCandidates,catalogComplete:sitemap.complete,
    sampleSize:0,variantPriceOwnedCount:0,
    statuses:[],...noPromotion(),
  };
  if(["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(sitemap.status))
    return report;
  for(const u of urls.slice(0,2)){
    report.sampleSize++;
    try{
      const timeout=AbortSignal.timeout(5500);
      const combined=signal?AbortSignal.any([signal,timeout]):timeout;
      const fetched=await fetchPdp(u,0,{signal:combined});
      if(!productPath(fetched.finalUrl) ||
         new URL(fetched.finalUrl).pathname.replace(/\/+$/,"")!==
         new URL(u).pathname.replace(/\/+$/,"")){
        report.statuses.push({status:"PDP_URL_IDENTITY_CONFLICT"});
        continue;
      }
      const result=attestDecathlonVariantPrice(fetched.html,u);
      report.statuses.push(result);
      if(result.variantPriceOwned)report.variantPriceOwnedCount++;
    }catch{report.statuses.push({status:"PDP_NOT_ACCESSIBLE"});}
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditDecathlonVariantPriceOwnership();
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
}
