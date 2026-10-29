import {queryMatchReasons} from "./search-query.mjs";
export function selectSearchStreamResult(latestSnapshot,latestWithOffers){
  if(!latestWithOffers)return latestSnapshot||null;
  if(!latestSnapshot)return latestWithOffers;
  return {...latestSnapshot,offers:latestWithOffers.offers};
}

const EXTRA_INDEX_URL=/^https:\/\/www\.extra\.com\/en-sa\/p\/(\d{5,12})$/;

export function needsExtraSourceRecovery(data){
  if(!Array.isArray(data?.offers)||data.offers.some(o=>o?.merchant==="eXtra"))return false;
  return Array.isArray(data?.errors)&&data.errors.some(e=>
    (e?.sourceId==="extra-unbxd"||e?.provider==="extra-unbxd")&&
    /timeout|aborted|abort|deadline/i.test(String(e?.error||""))
  );
}

// Recovery is a fresh, normal first-party customer API response, not a guessed
// merchant price or a scraper fallback. Preserve previous merchant offers,
// never copy unrelated JSON merchants, and never grant trust/verification flags.
export function mergeExtraSourceRecovery(original,refreshed){
  if(!needsExtraSourceRecovery(original)||!Array.isArray(refreshed?.offers))return original;
  const fresh=refreshed.offers.filter(o=>{
    if(o?.provider!=="extra-unbxd"||o?.providerMarket!=="extra-sa"||
      o?.merchant!=="eXtra"||o?.currency!=="SAR"||
      !Number.isFinite(Number(o.productPrice))||Number(o.productPrice)<=0)return false;
    const sku=String(o.sourceMeta?.productId||"");
    return EXTRA_INDEX_URL.exec(String(o.sourceUrl||""))?.[1]===sku;
  });
  if(!fresh.length)return original;
  const merged=[...original.offers],seen=new Set(merged.map(o=>o?.sourceUrl));
  for(const offer of fresh){
    if(!seen.has(offer.sourceUrl)){
      seen.add(offer.sourceUrl);
      merged.push(offer);
    }
  }
  const added=merged.length-original.offers.length;
  if(!added)return original;
  return {...original,offers:merged,
    recovery:{sourceId:"extra-unbxd",type:"fresh-json",addedOffers:added},
    coverage:{...original.coverage,returnedOffers:merged.length},
  };
}


// Recover the shopper's first-page offers only if a known primary merchant timed
// out and the SSE feed ended empty/partial. The single follow-up request is made
// by search-page.mjs against the existing first-party /api/search endpoint.
// This is not source re-crawling or a second trusted attestation.
const CORE_RECOVERABLE_PROVIDERS=new Set(["jarir-direct","extra-unbxd"]);
const TRANSIENT_SOURCE_FAILURE=/\b(?:timeout|timed out|abort(?:ed)?|deadline)\b/i;
const PERMANENT_SOURCE_DENIAL=/\b(?:403|429|forbidden|denied|rate.limit|robots)\b/i;

export function needsEmptyPartialRecovery(data){
  if(!Array.isArray(data?.offers)||data.offers.length!==0)return false;
  if(!data?.coverage || !(data.coverage.partial===true ||
      data.coverage.complete===false || data.coverage.deadlineExceeded===true))return false;
  if(!Array.isArray(data.errors)||data.errors.length===0)return false;
  const coreErrors=data.errors.filter(error=>
    CORE_RECOVERABLE_PROVIDERS.has(error?.sourceId||error?.provider));
  const reason=error=>String(error?.error||error?.message||error?.failureClass||"").slice(0,300);
  // An explicit 403/429 from either core source bars the full-source recovery:
  // do not send another ordinary search that could immediately revisit a denial.
  if(coreErrors.some(error=>PERMANENT_SOURCE_DENIAL.test(reason(error))))return false;
  return coreErrors.some(error=>TRANSIENT_SOURCE_FAILURE.test(reason(error)));
}

function eligibleRecoveryOffer(offer,query){
  if(!offer || typeof offer!=="object" || typeof offer.title!=="string" ||
      !offer.title.trim() || !Number.isFinite(Number(offer.productPrice)) ||
      Number(offer.productPrice)<=0 || offer.currency!=="SAR")return false;
  let url;
  try{url=new URL(offer.sourceUrl);}
  catch{return false;}
  if(url.protocol!=="https:" || url.username || url.password ||
      url.searchParams.has("url"))return false;
  const host=url.hostname.toLowerCase();
  if(offer.provider==="jarir-direct" && offer.providerMarket==="jarir-sa" &&
      offer.merchant==="Jarir"){
    if(!(host==="www.jarir.com"||host==="jarir.com")||
        !/^\/sa-(?:en|ar)\//.test(url.pathname))return false;
  }else if(offer.provider==="extra-unbxd" && offer.providerMarket==="extra-sa" &&
      offer.merchant==="eXtra"){
    if(host!=="www.extra.com"||!/^\/en-sa\/p\/\d{5,12}$/.test(url.pathname))return false;
    const productId=offer.sourceMeta?.productId;
    if(productId!=null && String(productId)!==url.pathname.split("/").at(-1))return false;
  }else return false; // no guessed source ownership for unrelated merchants
  return queryMatchReasons(query,offer).length===0;
}

export function mergeEmptyPartialRecovery(original,refreshed,query){
  if(!needsEmptyPartialRecovery(original) ||
      String(refreshed?.query||"").trim()!==String(query||"").trim() ||
      !Array.isArray(refreshed?.offers))return original;
  const seen=new Set();
  const recovered=[];
  for(const offer of refreshed.offers){
    if(!eligibleRecoveryOffer(offer,query))continue;
    const key=offer.provider+"|"+offer.sourceUrl;
    if(seen.has(key))continue;
    seen.add(key);recovered.push(offer);
    if(recovered.length>=120)break;
  }
  if(!recovered.length)return original;
  // Never rewrite source evidence, price, merchant identity or verification flags.
  // Retain the original partial outcome; the JSON request is another observation,
  // not proof that every source has completed successfully.
  return {...original,offers:recovered,
    nextCursor:refreshed.nextCursor??original.nextCursor,
    coverage:{...original.coverage,partial:true,complete:false,
      returnedOffers:recovered.length,availableOffers:recovered.length,
      returnedMerchants:new Set(recovered.map(o=>o.merchant)).size},
    recovery:{type:"fresh-json-empty-partial",addedOffers:recovered.length},
  };
}
