// NAWAA v21.99. Isolated, bounded merchant-URL / PDP / search evidence.
// NOT an ingestion pipeline, NOT an offer publisher, NOT a price database writer.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditDecathlonSitemap } from "./audit-sitemap-discovery.mjs";
import { resolveProductUrl } from "../server/url-resolver.mjs";
import { searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";

const SOURCE="decathlon-sa";
const HOST="decathlon.com.sa";
const PDP_LIMIT=2;
const SEARCH_LIMIT=2;

function exactSourceProductPath(url){
  try{
    const u=new URL(url);
    if(u.protocol!=="https:"||u.hostname!==HOST||u.username||u.password||
       (u.port&&u.port!=="443")||u.hash||
       !/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname))return null;
    if([...u.searchParams.keys()].some(k=>k!=="variant"))return null;
    const variant=u.searchParams.get("variant");
    if(variant!==null&&!/^\d{1,20}$/.test(variant))return null;
    return u.pathname.replace(/\/+$/,"");
  }catch{return null;}
}

function isPlaceholderTitle(title){
  const s=String(title||"").trim().toLowerCase();
  return s==="منتج من رابط خارجي"||s==="product from external url";
}

export function summarizePdpFieldEvidence(pdp){
  const strategy=String(pdp?.extraction?.strategy||"none");
  const allowedStrategies=new Set(["jsonld","embedded_json","hydrated_state",
    "storefront_data","domain_adapter","meta","none"]);
  return {
    hasTitle:typeof pdp?.title==="string"&&pdp.title.trim().length>0 &&
      !isPlaceholderTitle(pdp.title),
    isPlaceholderTitle:isPlaceholderTitle(pdp?.title),
    hasImage:typeof pdp?.image==="string"&&/^https:\/\//i.test(pdp.image),
    hasVariantIdentity:Boolean(pdp?.sku||pdp?.variantId),
    hasPrice:Number.isFinite(pdp?.productPrice)&&pdp.productPrice>0 &&
      Number.isFinite(pdp?.originalProductPrice)&&pdp.originalProductPrice>0,
    hasSARCurrency:pdp?.currency==="SAR"&&pdp?.originalCurrency==="SAR",
    hasExplicitConflicts:Array.isArray(pdp?.extraction?.conflicts)&&pdp.extraction.conflicts.length>0,
    extractionStrategy:allowedStrategies.has(strategy)?strategy:"unknown",
  };
}

export function validateDecathlonPdpEvidence(candidateUrl,pdp){
  const decision=(status,priceObserved=false)=>({
    status,priceObserved,priceCorroboratedBySearch:false,trustedOfferEligible:false,
  });
  const original=exactSourceProductPath(candidateUrl);
  if(!original||!pdp||!pdp.sourceUrl||!pdp.resolvedPageUrl)return decision("PDP_IDENTITY_MISMATCH");
  if(exactSourceProductPath(pdp.sourceUrl)!==original||
     exactSourceProductPath(pdp.resolvedPageUrl)!==original)return decision("PDP_IDENTITY_MISMATCH");
  // Even a same-path explicit different variant may change the quoted price.
  for(const url of [pdp.sourceUrl,pdp.resolvedPageUrl]){
    const selected=new URL(url).searchParams.get("variant");
    if(selected!==null&&String(pdp.variantId||"")!==selected)
      return decision("PDP_IDENTITY_MISMATCH");
  }
  if(!pdp.title?.trim()||isPlaceholderTitle(pdp.title)||!pdp.image||!/^https:\/\//i.test(pdp.image))
    return decision("PDP_SUBJECT_UNCERTAIN");
  if(!pdp.sku&&!pdp.variantId)return decision("PDP_VARIANT_UNCERTAIN");
  if(Array.isArray(pdp.extraction?.conflicts)&&pdp.extraction.conflicts.length)
    return decision("PDP_PRICE_CONFLICT");
  if(!Number.isFinite(pdp.productPrice)||pdp.productPrice<=0||
     !Number.isFinite(pdp.originalProductPrice)||pdp.originalProductPrice<=0||
     pdp.currency!=="SAR"||pdp.originalCurrency!=="SAR")
    return decision("PDP_PRICE_UNAVAILABLE");
  return decision("PDP_IDENTIFIED_PRICE_OBSERVED",true);
}

export function compareSitemapWithStoreSearch(candidateUrl,pdp,searchResult){
  const decision=status=>({status,offerEligibleForPromotion:false,inventoryVerified:false});
  if(validateDecathlonPdpEvidence(candidateUrl,pdp).status!=="PDP_IDENTIFIED_PRICE_OBSERVED")
    return decision("PDP_EVIDENCE_INSUFFICIENT");
  if(!searchResult||searchResult.diagnostics?.primarySearchError||
     searchResult.diagnostics?.searchPage?.blockedReason)
    return decision("SEARCH_UNAVAILABLE");
  if(!Array.isArray(searchResult.offers))return decision("SEARCH_UNAVAILABLE");
  const path=exactSourceProductPath(candidateUrl);
  const matches=searchResult.offers.filter(offer=>exactSourceProductPath(offer.sourceUrl)===path);
  if(!matches.length)return decision("NOT_FOUND_IN_THIS_SEARCH");
  const variantConflicts=matches.some(offer=>
    (offer.sku&&pdp.sku&&String(offer.sku)!==String(pdp.sku))||
    (offer.variantId&&pdp.variantId&&String(offer.variantId)!==String(pdp.variantId)));
  if(variantConflicts)return decision("SEARCH_VARIANT_CONFLICT");
  if(matches.some(offer=>Number.isFinite(offer.productPrice)&&offer.productPrice===pdp.productPrice&&
    offer.currency==="SAR"))return decision("SEARCH_SAME_ITEM_PRICE_MATCH");
  return decision("SEARCH_PRICE_CONFLICT");
}

// Weak URL-only coverage observation. Never calls a listing price corroborated.
export function compareSitemapUrlPresence(candidateUrl,searchResult){
  const decision=status=>({
    status,trustedOfferEligible:false,productPriceCorroborated:false,
  });
  const path=exactSourceProductPath(candidateUrl);
  if(!path)return decision("INVALID_SITEMAP_URL");
  if(!searchResult||searchResult.diagnostics?.primarySearchError||
     searchResult.diagnostics?.searchPage?.blockedReason||
     !Array.isArray(searchResult.offers))
    return decision("SEARCH_UNAVAILABLE");
  return decision(searchResult.offers.some(x=>exactSourceProductPath(x.sourceUrl)===path)
    ?"URL_PRESENT_IN_SEARCH_OFFERS":"URL_NOT_OBSERVED_IN_SEARCH_OFFERS");
}

const defaultPdp=(url,signal)=>resolveProductUrl(url,{signal});
const defaultSearch=(query,signal)=>
  searchFreeStorefrontById(SOURCE,query,{perStore:3,signal});

function queryFromVerifiedPage(pdp,candidateUrl){
  // A placeholder cannot become query evidence. Source-owned slug provides
  // a bounded, weak discovery query instead (never identity/price evidence).
  const slug=exactSourceProductPath(candidateUrl)?.split("/").at(-1)||"";
  const input=isPlaceholderTitle(pdp?.title)||!String(pdp?.title||"").trim()
    ?slug.replace(/-/g," "):pdp.title;
  const clean=String(input||"").normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s-]/gu," ").replace(/\s+/g," ").trim();
  if(clean.length<6)return null;
  return clean.split(" ").slice(0,7).join(" ").slice(0,90);
}

export async function auditSitemapPdpRecall({
  fetchPage=fetch,resolvePdp=defaultPdp,searchStore=defaultSearch,signal,
}={}){
  const candidates=[];
  // Existing scanner: maximum two sitemap GETs and two source-owned URLs.
  const sitemap=await auditDecathlonSitemap({
    fetchPage,signal,onProductSample:urls=>{
      for(const url of urls.slice(0,PDP_LIMIT)){
        if(exactSourceProductPath(url)&&!candidates.includes(url))
          candidates.push(url);
      }
    }
  });
  let sampledPdp=0,observed=0,searchQueries=0,notObserved=0,searchMatches=0;
  let priceConflicts=0,accessFailures=0,urlNotObserved=0;
  const statuses=[];
  if(["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(sitemap.status)){
    return {
      schemaVersion:"nawaa.sitemap-pdp-coverage.v1",sourceId:SOURCE,
      sitemapStatus:sitemap.status,sitemapRequests:sitemap.requests,
      sitemapProductCandidates:sitemap.productCandidates,
      catalogCompleteness:false,sampledPdp:0,pdpIdentityAndPriceObserved:0,
      searchQueries:0,notObservedInSampledSearch:0,urlNotObservedInSearchOffers:0,searchPriceMatches:0,
      searchPriceConflicts:0,accessFailures:0,statuses:[],
      trustedOffersCreated:0,inventoryVerified:false,verifiedGlobalRecallUplift:false,
    };
  }
  for(const candidateUrl of candidates.slice(0,PDP_LIMIT)){
    signal?.throwIfAborted();
    sampledPdp++;
    const controller=AbortSignal.timeout(6500);
    const requestSignal=signal?AbortSignal.any([signal,controller]):controller;
    let pdp;
    try{pdp=await resolvePdp(candidateUrl,requestSignal);}
    catch{statuses.push({pdp:"PDP_UNAVAILABLE",search:"NOT_RUN"});accessFailures++;continue;}
    const check=validateDecathlonPdpEvidence(candidateUrl,pdp);
    const fields=summarizePdpFieldEvidence(pdp);
    // Even without SKU or image, the same-path URL can be compared with
    // merchant search as *weak discovery evidence*, never as a price claim.
    // Cross-product redirects, however, cannot launch another source query.
    if(check.status==="PDP_IDENTITY_MISMATCH"){
      statuses.push({pdp:check.status,search:"NOT_RUN",fields});continue;
    }
    if(check.priceObserved)observed++;
    const query=queryFromVerifiedPage(pdp,candidateUrl);
    if(!query||searchQueries>=SEARCH_LIMIT){
      statuses.push({pdp:check.status,search:"NOT_RUN",fields});continue;
    }
    searchQueries++;
    let searchResult;
    try{
      searchResult=await searchStore(query,requestSignal);
    }catch{statuses.push({pdp:check.status,search:"SEARCH_UNAVAILABLE",fields});
      accessFailures++;continue;}
    const linkCheck=compareSitemapUrlPresence(candidateUrl,searchResult);
    if(linkCheck.status==="URL_NOT_OBSERVED_IN_SEARCH_OFFERS")urlNotObserved++;
    const match=check.priceObserved
      ?compareSitemapWithStoreSearch(candidateUrl,pdp,searchResult)
      :{status:linkCheck.status};
    if(match.status==="NOT_FOUND_IN_THIS_SEARCH")notObserved++;
    if(match.status==="SEARCH_SAME_ITEM_PRICE_MATCH")searchMatches++;
    if(match.status==="SEARCH_PRICE_CONFLICT"||match.status==="SEARCH_VARIANT_CONFLICT")
      priceConflicts++;
    statuses.push({pdp:check.status,search:match.status,fields});
  }
  return {
    schemaVersion:"nawaa.sitemap-pdp-coverage.v1",sourceId:SOURCE,
    sitemapStatus:sitemap.status,sitemapRequests:sitemap.requests,
    sitemapProductCandidates:sitemap.productCandidates,
    catalogCompleteness:sitemap.complete,
    sampledPdp,pdpIdentityAndPriceObserved:observed,
    searchQueries,notObservedInSampledSearch:notObserved,
    urlNotObservedInSearchOffers:urlNotObserved,
    searchPriceMatches:searchMatches,searchPriceConflicts:priceConflicts,
    accessFailures,statuses,
    trustedOffersCreated:0,inventoryVerified:false,
    verifiedGlobalRecallUplift:false,
    interpretation:"Absence in one sampled query is not catalog-wide or global recall proof; PDP-observed price is not an independently trusted delivered offer.",
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditSitemapPdpRecall();
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
}
