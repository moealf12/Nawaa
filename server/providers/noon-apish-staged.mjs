// Alternative staging-only transport for Noon Saudi after direct Azure HTTP 403.
// Data is supplied by API.SH, NOT first-party Noon evidence. Nothing here is
// registered in customer routing, and no prices are customer-publishable.
// Requires an API.SH key with a HARD monthly cap <= free allowance (1000).
import {noonSaudiProductIdentity} from "../../src/noon-sa-catalog.mjs";
import {normalizeSearchQuery,parseSearchIntent} from "../../src/search-query.mjs";

const ENDPOINT="https://api.api.sh/noon/v1/search";
const OFFER_CODE=/^[a-z0-9-]{1,100}$/i;
const MAX_BYTES=2_000_000;
const MAX_AGE_MS=10*60_000;
const DEFAULT_DEADLINE_MS=40_000;

// Third-party locale URLs sometimes use an alternate Saudi prefix. Normalize
// only for SKU validation, retain the actual source-owned path in diagnostics.
function sourceSaudiIdentity(raw){
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:" ||
       !["www.noon.com","noon.com"].includes(url.hostname.toLowerCase()) ||
       url.username||url.password||(url.port&&url.port!=="443"))return null;
    const normalized=url.pathname.replace(
      /^\/(?:saudi-ar|en-sa|ar-sa)\//i,"/saudi-en/");
    const checked=new URL(url.href);
    checked.pathname=normalized;
    const match=noonSaudiProductIdentity(checked.href);
    return match?{...match,canonicalUrl:"https://www.noon.com"+url.pathname}:null;
  }catch{return null;}
}

function price(raw){
  if(typeof raw!=="number"||!Number.isFinite(raw)||raw<=0||raw>10_000_000)return null;
  if(Math.abs(raw*100-Math.round(raw*100))>1e-6)return null;
  return raw;
}
function validImage(raw){
  if(typeof raw!=="string")return null;
  try{
    const u=new URL(raw);
    return u.protocol==="https:" &&
      (u.hostname==="f.nooncdn.com"||u.hostname.endsWith(".nooncdn.com")) &&
      u.pathname.startsWith("/p/")?u.href:null;
  }catch{return null;}
}
function candidate(hit,intent){
  if(!hit || typeof hit!=="object" || Array.isArray(hit))return null;
  const identity=sourceSaudiIdentity(hit.url);
  if(!identity || String(hit.sku||"").toUpperCase()!==identity.sku ||
     (hit.currency!=null&&hit.currency!=="SAR") ||
     (hit.country!=null&&hit.country!=="sa"))return null;
  const code=String(hit.offer_code||"");
  if(!OFFER_CODE.test(code))return null;
  let u;
  try{u=new URL(hit.url);}catch{return null;}
  // The upstream must name the exact offer. Strip all tracking parameters.
  if(u.searchParams.getAll("o").length!==1||u.searchParams.get("o")!==code)return null;
  const title=typeof hit.name==="string"?hit.name.trim():"";
  if(title.length<4||title.length>350)return null;
  const titleIntent=parseSearchIntent(title);
  if(intent.model && titleIntent.model!==intent.model)return null;
  if(intent.storage && titleIntent.storage!==intent.storage)return null;
  if(intent.color && titleIntent.color!==intent.color)return null;
  const slug=new URL(identity.canonicalUrl).pathname
    .replace(/^\/(?:saudi-(?:en|ar)|(?:en|ar)-sa)\//,"").split("/")[0].replace(/-/g," ");
  const slugIntent=parseSearchIntent(slug);
  if((titleIntent.model&&slugIntent.model&&titleIntent.model!==slugIntent.model)||
     (titleIntent.storage&&slugIntent.storage&&titleIntent.storage!==slugIntent.storage)||
     (titleIntent.color&&slugIntent.color&&titleIntent.color!==slugIntent.color))return null;

  const observedPrice=price(hit.price);
  const sale=hit.sale_price==null?null:price(hit.sale_price);
  if(observedPrice===null||(hit.sale_price!=null && (sale===null||sale!==observedPrice)))return null;
  const regular=hit.regular_price==null?null:price(hit.regular_price);
  if(hit.regular_price!=null && (regular===null||regular<observedPrice))return null;
  const image=validImage(hit.image) ||
    (Array.isArray(hit.images)?hit.images.map(validImage).find(Boolean):null);
  if(!image)return null;
  return {
    productId:identity.sku,offerCode:code,title,
    sourceUrl:identity.canonicalUrl+"?o="+encodeURIComponent(code),
    image,price:observedPrice,currency:"SAR",
    // Independent Noon first-party price and buybox parity remain UNKNOWN.
    evidence:"THIRD_PARTY_LIVE_SEARCH_OBSERVED",
    pdpVerified:false,checkoutVerified:false,saudiDeliveryVerified:false,
    customerPublishable:false,
  };
}

export function parseNoonApishSearch(payload,query,{maxResults=50,now=Date.now()}={}){
  if(!payload || typeof payload!=="object"||payload.success===false||
     payload.country!=="sa"||!Array.isArray(payload.products)||
     payload.cached!==false)
    return {status:"UPSTREAM_SOURCE_UNATTESTED",candidates:[],rejected:0,conflicts:0};
  const fetched=Date.parse(payload.fetched_at);
  if(!Number.isFinite(fetched)||Math.abs(now-fetched)>MAX_AGE_MS)
    return {status:"UPSTREAM_FRESHNESS_UNATTESTED",candidates:[],rejected:0,conflicts:0};
  const intent=parseSearchIntent(query);
  const tokens=normalizeSearchQuery(query).split(" ").filter(Boolean);
  if(!tokens.length)return {status:"INVALID_QUERY",candidates:[],rejected:0,conflicts:0};
  const byKey=new Map();
  let rejected=0,conflicts=0;
  for(const hit of payload.products.slice(0,100)){
    const record=candidate(hit,intent);
    if(!record){rejected++;continue;}
    const normalized=normalizeSearchQuery(record.title);
    if(!tokens.some(t=>normalized.includes(t))){rejected++;continue;}
    const key=record.productId+"|"+record.offerCode;
    if(byKey.has(key)){
      const prior=byKey.get(key);
      if(prior && (prior.price!==record.price||prior.title!==record.title)){
        byKey.set(key,null);conflicts++;
      }
    }else byKey.set(key,record);
  }
  return {
    status:"THIRD_PARTY_SEARCH_OBSERVED",
    candidates:[...byKey.values()].filter(Boolean)
      .slice(0,Math.max(1,Math.min(100,maxResults))),
    rejected,conflicts,
    fetchedAt:new Date(fetched).toISOString(),
    sourceCached:false,
    country:"sa",priceCurrency:"SAR",customerPublishable:false,
  };
}

export async function fetchNoonSaudiApish(query,{
  apiKey=process.env.APISH_KEY,
  limit=50,signal,deadlineMs=DEFAULT_DEADLINE_MS,
}={}){
  if(typeof apiKey!=="string"||!apiKey.trim())
    throw Object.assign(new Error("NOON_APISH_KEY_REQUIRED"),{code:"CONFIG_REQUIRED"});
  const text=String(query||"").trim();
  if(!text||text.length>160)
    throw Object.assign(new Error("INVALID_NOON_QUERY"),{code:"INVALID_QUERY"});
  const url=new URL(ENDPOINT);
  url.searchParams.set("q",text);
  url.searchParams.set("country","sa");
  url.searchParams.set("language",/[\u0600-\u06FF]/.test(text)?"ar":"en");
  url.searchParams.set("page","1");
  url.searchParams.set("limit",String(Math.max(1,Math.min(100,Number(limit)||50))));
  url.searchParams.set("fresh","1"); // No 24h API.SH cache acceptance
  url.searchParams.set("raw","0");
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new Error("UPSTREAM_DEADLINE")),Math.min(60_000,Math.max(1_000,deadlineMs)));
  const onAbort=()=>controller.abort(signal.reason);
  if(signal?.aborted)onAbort();
  else signal?.addEventListener("abort",onAbort,{once:true});
  try{
    const response=await fetch(url,{
      method:"GET",redirect:"error",signal:controller.signal,
      headers:{"accept":"application/json","x-api-key":apiKey.trim()},
    });
    if(!response.ok){
      // Never include response bodies, key, cookies or user tracking in errors.
      throw Object.assign(new Error("NOON_APISH_HTTP_"+response.status),{
        code:"UPSTREAM_HTTP_"+response.status});
    }
    const headerLength=Number(response.headers.get("content-length"));
    if(Number.isFinite(headerLength)&&headerLength>MAX_BYTES)
      throw new Error("NOON_APISH_RESPONSE_TOO_LARGE");
    const responseText=await response.text();
    if(Buffer.byteLength(responseText,"utf8")>MAX_BYTES)
      throw new Error("NOON_APISH_RESPONSE_TOO_LARGE");
    let payload;
    try{payload=JSON.parse(responseText)}catch{throw new Error("NOON_APISH_INVALID_JSON")}
    const parsed=parseNoonApishSearch(payload,text,{maxResults:limit});
    return {
      provider:"noon-apish-staging",sourceId:"noon-sa",transport:"third_party_API_SH",
      ...parsed,
      // The upstream's cached:false/fetched_at are provenance claims, not
      // independent proof that every displayed offer is checkout-current.
      customerPublishable:false,
      creditsUsed:Number.isInteger(payload.credits_used)?payload.credits_used:null,
    };
  }finally{
    clearTimeout(timeout);
    signal?.removeEventListener("abort",onAbort);
  }
}


// Second *independent API request* for one exact SKU + offer. Both readings
// still originate from one THIRD-PARTY provider; do not call this Noon-first-party
// or Saudi-checkout verification.
export async function fetchNoonSaudiApishOfferParity(record,{
  apiKey=process.env.APISH_KEY,signal,deadlineMs=DEFAULT_DEADLINE_MS,
}={}){
  if(typeof apiKey!=="string"||!apiKey.trim())
    throw Object.assign(new Error("NOON_APISH_KEY_REQUIRED"),{code:"CONFIG_REQUIRED"});
  const id=sourceSaudiIdentity(record?.sourceUrl);
  if(!id||id.sku!==record?.productId||!OFFER_CODE.test(record?.offerCode||""))
    throw new Error("INVALID_NOON_PARITY_IDENTITY");
  const url=new URL("https://api.api.sh/noon/v1/product");
  url.searchParams.set("sku",id.sku);
  url.searchParams.set("country","sa");
  url.searchParams.set("language","en");
  url.searchParams.set("fresh","1");
  url.searchParams.set("raw","0");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(60_000,Math.max(1000,deadlineMs)));
  const onAbort=()=>controller.abort(signal.reason);
  if(signal?.aborted)onAbort();
  else signal?.addEventListener("abort",onAbort,{once:true});
  try{
    const response=await fetch(url,{
      redirect:"error",signal:controller.signal,method:"GET",
      headers:{"accept":"application/json","x-api-key":apiKey.trim()},
    });
    if(!response.ok)throw new Error("NOON_APISH_PRODUCT_HTTP_"+response.status);
    const length=Number(response.headers.get("content-length"));
    if(Number.isFinite(length)&&length>MAX_BYTES)throw new Error("NOON_APISH_PRODUCT_TOO_LARGE");
    const body=await response.text();
    if(Buffer.byteLength(body,"utf8")>MAX_BYTES)throw new Error("NOON_APISH_PRODUCT_TOO_LARGE");
    let data;
    try{data=JSON.parse(body);}catch{throw new Error("NOON_APISH_PRODUCT_INVALID_JSON")}
    const observedAt=Date.parse(data?.fetched_at);
    if(data?.country!=="sa"||data?.cached!==false||
       !Number.isFinite(observedAt)||Math.abs(Date.now()-observedAt)>MAX_AGE_MS||
       String(data?.sku||"").toUpperCase()!==id.sku||
       !Array.isArray(data?.offers))
      return {status:"PRODUCT_EVIDENCE_UNATTESTED",customerPublishable:false};
    const exact=data.offers.filter(o=>
      o?.offer_code===record.offerCode &&
      (o?.sku===id.sku||String(o?.sku||"").startsWith(id.sku+"-")));
    if(exact.length!==1||price(exact[0]?.price)===null ||
       Math.abs(exact[0].price-record.price)>0.001)
      return {status:"SEARCH_PRODUCT_OFFER_PRICE_MISMATCH",
        productId:id.sku,customerPublishable:false};
    return {
      status:"THIRD_PARTY_SEARCH_PRODUCT_OFFER_PARITY",
      productId:id.sku,offerCode:record.offerCode,price:exact[0].price,
      currency:"SAR",creditUsed:Number.isInteger(data.credits_used)?data.credits_used:null,
      sourceCached:false,noonFirstPartyPdpVerified:false,customerPublishable:false,
    };
  }finally{
    clearTimeout(timer);
    signal?.removeEventListener("abort",onAbort);
  }
}
