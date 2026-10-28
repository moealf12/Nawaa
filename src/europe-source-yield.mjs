import {observedSourceHttpStatus} from "./source-http-profile.mjs";
import {retiredSourceRecord} from "./source-retirement.mjs";
// Evidence-only probe configuration. Not an activation or merchant certification.
export const EUROPE_SOURCES = Object.freeze({
  "amazon-uk": {query:"iphone 17",host:"www.amazon.co.uk",country:"GB",currency:"GBP",path:/\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i},
  "amazon-de": {query:"iphone 17",host:"www.amazon.de",country:"DE",currency:"EUR",path:/\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i},
  "mediamarkt-de": {query:"iphone 17",host:"www.mediamarkt.de",country:"DE",currency:"EUR",path:/^\/de\/product\/_?[^/?#]+\.html$/i,noDirect:true},
  "pccomponentes-es": {query:"iphone 17",host:"www.pccomponentes.com",country:"ES",currency:"EUR",path:/^\/(?!buscar(?:\/|$)|search(?:\/|$)|category(?:\/|$)|configurador(?:\/|$))[a-z0-9-]{18,}\/?$/i,noDirect:true},
  "thomann-de": {query:"superlux hd 662",host:"www.thomann.de",country:"DE",currency:"EUR",path:/^\/(?:de|gb|intl)\/[^/?#]+\.htm$/i},
});
const integer = value => Number.isFinite(Number(value)) ? Math.max(0,Math.floor(Number(value))) : 0;
const positive = value => typeof value==="number" && Number.isFinite(value) && value>0;
const validHttpUrl = (raw,httpsOnly=true) => {
  try {
    const url=new URL(raw);
    if(!["https:",...(httpsOnly?[]:["http:"])].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {return null}
};

// This is only a structural/provenance check; its result cannot enable trust badges.
export function inspectEuropeanOffer(storeId, offer) {
  const spec=EUROPE_SOURCES[storeId];
  if(!spec) throw Error("UNKNOWN_EUROPE_SOURCE");
  const issues=[];
  if(offer?.providerMarket!==storeId || offer?.merchantCountryCode!==spec.country || offer?.dataKind!=="live")
    issues.push("SOURCE_IDENTITY");
  if(typeof offer?.title!=="string" || offer.title.trim().length<3) issues.push("TITLE_MISSING");
  const url=validHttpUrl(offer?.sourceUrl);
  if(!url || url.hostname.toLowerCase()!==spec.host || (url.port && url.port!=="443") || !spec.path.test(url.pathname))
    issues.push("PRODUCT_URL_PROVENANCE");
  if(!validHttpUrl(offer?.image)) issues.push("IMAGE_MISSING_OR_INVALID");
  if(!positive(offer?.productPrice) || offer?.currency!=="SAR") issues.push("SAR_PRICE_INVALID");
  if(!positive(offer?.originalProductPrice) || offer?.originalCurrency!==spec.currency)
    issues.push("ORIGINAL_PRICE_OR_CURRENCY_INVALID");
  if(!positive(offer?.fx?.rate) || !offer?.fx?.source ||
     !Number.isFinite(Date.parse(offer?.fx?.observedAt||"")))
    issues.push("FX_PROVENANCE_MISSING");
  // Non-Saudi catalog membership does not prove delivery eligibility for this offer.
  if(offer?.canShipToSaudi===true || (spec.noDirect && offer?.canShipToSaudi!==false))
    issues.push("UNSUPPORTED_SAUDI_DELIVERY_CLAIM");
  return {fieldsPass:issues.length===0,issues};
}

export function sourceErrorClass(error) {
  const value=String(error?.message||error||"");
  if(/\b(?:403|429)\b|access.denied|rate.limit|blocked/i.test(value))return "ACCESS_DENIED_OR_LIMITED";
  if(/\b5\d\d\b|unavailable/i.test(value))return "REMOTE_SERVICE_ERROR";
  if(/timed? ?out|timeout|abort/i.test(value))return "TIMEOUT";
  if(!value)return null;
  return "OTHER_SOURCE_FAILURE";
}

// Do not store raw HTML, PII, arbitrary merchant URL query strings or prices in CI evidence.
export function summarizeEuropeanProbe(storeId, result, error=null, durationMs=0) {
  const retired=retiredSourceRecord(storeId);
  if(retired)return {
    storeId,query:null,status:retired.status,sourceCatalogCode:retired.catalogCode,
    candidates:0,offersReturned:0,fieldsPass:0,unpricedSamples:0,
    errors:null,httpStatus:null,rejectionReasons:{},durationMs:0,
    merchantAttested:false,saudiDeliveryVerified:false,activationApproved:false,
  };
  const spec=EUROPE_SOURCES[storeId];
  if(!spec)throw Error("UNKNOWN_EUROPE_SOURCE");
  const offers=Array.isArray(result?.offers)?result.offers:[];
  const reasons={};
  let fieldsPass=0;
  for(const offer of offers){
    const inspected=inspectEuropeanOffer(storeId,offer);
    if(inspected.fieldsPass)fieldsPass++;
    for(const reason of inspected.issues)reasons[reason]=(reasons[reason]||0)+1;
  }
  // Preserve the distinction between field completeness and independent price
  // parity. Only an exact search/PDP match may occupy the parity bucket.
  const priceEvidenceCounts={searchPdpParity:0,pdpObservedOnly:0,searchCardOnly:0,unknown:0};
  for(const offer of offers){
    const level=offer?.sourceMeta?.priceEvidence;
    if(level==="SEARCH_PDP_PRICE_PARITY")priceEvidenceCounts.searchPdpParity++;
    else if(level==="PDP_OBSERVED_ONLY")priceEvidenceCounts.pdpObservedOnly++;
    else if(level==="SEARCH_CARD_ONLY")priceEvidenceCounts.searchCardOnly++;
    else priceEvidenceCounts.unknown++;
  }
  const amazonDiagnostic=storeId==="amazon-de"?result?.diagnostics?.amazonDeAcquisition:null;
  const allowedAmazonClasses=new Set([
    "HTML_NOT_OBSERVED","CHALLENGE_PAGE_SUSPECTED","NO_ASIN_MARKERS",
    "EXTRACTED_PRICED_CARDS","ASIN_MARKERS_WITHOUT_PRICE_MARKERS",
    "ASIN_MARKERS_WITH_UNEXTRACTED_PRICES",
  ]);
  const zeroYieldReason=storeId==="amazon-de" &&
    allowedAmazonClasses.has(amazonDiagnostic?.classification)
      ? amazonDiagnostic.classification:null;
  const publicationHeld=storeId==="amazon-de" &&
    result?.diagnostics?.customerPublicationGate?.status===
      "BUYBOX_SAME_OFFER_PARITY_UNVERIFIED";
  const candidates=integer(result?.candidates);
  const unpriced=integer(result?.diagnostics?.unpricedSamples?.length);
  const sourceFailure=error||result?.diagnostics?.primarySearchError||
    (result?.diagnostics?.sourceObservation==="HTTP_200_JS_SHELL"?"js shell":"");
  const failure=sourceErrorClass(sourceFailure);
  const httpStatus=observedSourceHttpStatus(sourceFailure);
  const status=fieldsPass>0?"FIELD_COMPLETE_NOT_ATTESTED":
    failure==="ACCESS_DENIED_OR_LIMITED"?"ACCESS_DENIED_OR_LIMITED":
    failure?"SOURCE_REQUEST_FAILED":
    unpriced>0?"PRODUCTS_FOUND_PRICE_MISSING":
    offers.length>0?"OFFERS_REJECTED_BY_PROVENANCE":
    (publicationHeld&&candidates>0)?"PRICE_PUBLICATION_HELD":
    candidates>0?"CANDIDATES_WITHOUT_VALID_OFFER":
    (zeroYieldReason==="NO_ASIN_MARKERS" ||
      zeroYieldReason==="ASIN_MARKERS_WITHOUT_PRICE_MARKERS" ||
      zeroYieldReason==="ASIN_MARKERS_WITH_UNEXTRACTED_PRICES")
      ?"SEARCH_HTML_UNPARSED":
    "NO_CANDIDATES";
  return {
    storeId,query:spec.query,status,candidates,offersReturned:offers.length,fieldsPass,
    unpricedSamples:unpriced,errors:failure,httpStatus,rejectionReasons:reasons,
    zeroYieldReason,priceEvidenceCounts,
    durationMs:integer(durationMs),merchantAttested:false,saudiDeliveryVerified:false,
    activationApproved:false
  };
}
