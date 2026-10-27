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

export function summarizePdpFieldEvidence(pdp){
  return {
    hasTitle:typeof pdp?.title==="string"&&pdp.title.trim().length>0,
    hasImage:typeof pdp?.image==="string"&&/^https:\/\//i.test(pdp.image),
    hasVariantIdentity:Boolean(pdp?.sku||pdp?.variantId),
    hasPrice:Number.isFinite(pdp?.productPrice)&&pdp.productPrice>0 &&
      Number.isFinite(pdp?.originalProductPrice)&&pdp.originalProductPrice>0,
    hasSARCurrency:pdp?.currency==="SAR"&&pdp?.originalCurrency==="SAR",
    hasExplicitConflicts:Array.isArray(pdp?.extraction?.conflicts)&&pdp.extraction.conflicts.length>0,
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
  if(!pdp.title?.trim()||!pdp.image||!/^https:\/\//i.test(pdp.image))
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

const defaultPdp=(url,signal)=>resolveProductUrl(url,{signal});
const defaultSearch=(query,signal)=>
  searchFreeStorefrontById(SOURCE,query,{perStore:3,signal});

function queryFromVerifiedPage(pdp){
  // A short one-merchant query is an experimental coverage probe only.
  // Avoid reusing URLs, user inputs, dynamic query parameters or descriptions.
  const clean=String(pdp?.title||"").normalize("NFKC")
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
  let priceConflicts=0,accessFailures=0;
  const statuses=[];
  if(["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(sitemap.status)){
    return {
      schemaVersion:"nawaa.sitemap-pdp-coverage.v1",sourceId:SOURCE,
      sitemapStatus:sitemap.status,sitemapRequests:sitemap.requests,
      sitemapProductCandidates:sitemap.productCandidates,
      catalogCompleteness:false,sampledPdp:0,pdpIdentityAndPriceObserved:0,
      searchQueries:0,notObservedInSampledSearch:0,searchPriceMatches:0,
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
    if(!check.priceObserved){
      statuses.push({pdp:check.status,search:"NOT_RUN",
        fields:summarizePdpFieldEvidence(pdp)});continue;
    }
    observed++;
    const query=queryFromVerifiedPage(pdp);
    if(!query||searchQueries>=SEARCH_LIMIT){
      statuses.push({pdp:check.status,search:"NOT_RUN",
        fields:summarizePdpFieldEvidence(pdp)});continue;
    }
    searchQueries++;
    let searchResult;
    try{
      searchResult=await searchStore(query,requestSignal);
    }catch{statuses.push({pdp:check.status,search:"SEARCH_UNAVAILABLE",
      fields:summarizePdpFieldEvidence(pdp)});accessFailures++;continue;}
    const match=compareSitemapWithStoreSearch(candidateUrl,pdp,searchResult);
    if(match.status==="NOT_FOUND_IN_THIS_SEARCH")notObserved++;
    if(match.status==="SEARCH_SAME_ITEM_PRICE_MATCH")searchMatches++;
    if(match.status==="SEARCH_PRICE_CONFLICT"||match.status==="SEARCH_VARIANT_CONFLICT")
      priceConflicts++;
    statuses.push({pdp:check.status,search:match.status,
      fields:summarizePdpFieldEvidence(pdp)});
  }
  return {
    schemaVersion:"nawaa.sitemap-pdp-coverage.v1",sourceId:SOURCE,
    sitemapStatus:sitemap.status,sitemapRequests:sitemap.requests,
    sitemapProductCandidates:sitemap.productCandidates,
    catalogCompleteness:sitemap.complete,
    sampledPdp,pdpIdentityAndPriceObserved:observed,
    searchQueries,notObservedInSampledSearch:notObserved,
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
