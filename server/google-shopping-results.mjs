// Opt-in, quota-bounded Google Shopping discovery through SerpApi.
// This is NOT a verified merchant provider. Never ingest these observations into
// NAWAA offers, SSE, canonical prices, persisted history or lowest-price ranking.
import { normalizeGoogleShoppingDiscoveryQuery } from "../src/google-shopping-discovery.mjs";
import { checkSerpApiFreeAccount } from "./serpapi-free-plan-guard.mjs";

const API_ENDPOINT="https://serpapi.com/search.json";
const MAX_JSON_BYTES=900_000;
const MAX_ITEMS=24;
const PROVIDER_TIMEOUT_MS=8500;
const MONTHLY_CAP=200; // leave margin beneath the documented 250 free searches
const HOURLY_CAP=40; // free tier documents 50 successful requests/hour
const DISCOVERY_CACHE_TTL_MS=90_000;
const SAFE_GOOGLE_HOST=/(^|\.)google\.com$/i;
const SAFE_IMAGE_HOST=/(^|\.)(?:gstatic\.com|googleusercontent\.com)$/i;

export function safeGoogleShoppingProductUrl(raw) {
  if(typeof raw!=="string"||raw.length>3500)return null;
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443"||
      !SAFE_GOOGLE_HOST.test(u.hostname))return null;
    // Do not forward to a Google redirect, ad tracking or API proxy.
    if(!/^\/shopping\/product\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) &&
       !/^\/shopping\/product\/[0-9]+\/?$/.test(u.pathname))return null;
    u.hash="";
    return u.href;
  }catch{return null;}
}
export function safeGoogleShoppingImage(raw) {
  if(typeof raw!=="string"||raw.length>2600)return null;
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||
       !SAFE_IMAGE_HOST.test(u.hostname)||u.port&&u.port!=="443")return null;
    return u.href;
  }catch{return null;}
}
function stringField(raw,max=300){
  return typeof raw==="string" ? raw.normalize("NFC").replace(/[\x00-\x1f\x7f-\x9f]/g," ").trim().slice(0,max) : "";
}
function priceInfo(rawPrice,rawNumeric) {
  const displayed=stringField(rawPrice,100);
  if(!displayed||/\/(?:mo|month)|per\s*month|شهري|تقسيط/i.test(displayed))
    return {priceText:null,amount:null,currency:null};
  // Display exactly the provider text; only derive a quantitative SAR price
  // when the original price text proves an unambiguous currency and amount.
  const currency=/(?:ر\.?\s*س\.?|SAR|Saudi Riyal|ريال\s+سعودي)/i.test(displayed)?"SAR":
    /(?:USD|US\$|\$)/i.test(displayed)?"USD":
    /(?:EUR|€)/i.test(displayed)?"EUR":null;
  const number=Number(rawNumeric);
  const validNumber=Number.isFinite(number)&&number>0&&number<100_000_000;
  return {
    priceText:displayed,
    amount:currency==="SAR"&&validNumber?number:null,
    currency,
  };
}
export function normalizeGoogleShoppingResults(payload,{now=new Date().toISOString()}={}) {
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
    return {state:"INVALID_PROVIDER_PAYLOAD",cards:[],totalSeen:0,rejected:0};
  if(payload.error)return {state:"PROVIDER_ERROR",cards:[],totalSeen:0,rejected:0};
  const raw=Array.isArray(payload.shopping_results)?payload.shopping_results:[];
  const totalSeen=Math.min(raw.length,100);
  const cards=[],seen=new Set();let rejected=0;
  for(const item of raw.slice(0,100)){
    if(!item||typeof item!=="object"){rejected++;continue;}
    const title=stringField(item.title,250);
    const source=stringField(item.source,120);
    const productUrl=safeGoogleShoppingProductUrl(item.product_link);
    const productId=String(item.product_id||"");
    if(title.length<4||!productUrl||!source||!/^\d{5,30}$/.test(productId)){
      rejected++;continue;
    }
    const pathId=new URL(productUrl).pathname.match(/\/shopping\/product\/(\d+)/)?.[1];
    if(pathId!==productId){rejected++;continue;}
    if(seen.has(productId)){rejected++;continue;}
    seen.add(productId);
    const pricing=priceInfo(item.price,item.extracted_price);
    const image=safeGoogleShoppingImage(item.thumbnail);
    cards.push({
      id:productId,title,merchantLabel:source,productUrl,image,
      displayedPrice:pricing.priceText,
      observedAmountSar:pricing.amount,
      displayedCurrency:pricing.currency,
      observedAt:now,
      evidence:"aggregated_google_shopping_search_card",
      verifiedMerchantPdp:false,
      verifiedSku:false,
      verifiedPrice:false,
      merchantDeliveryToSaudiVerified:null,
      source:"google-shopping",
      rankableInNawaa:false,
      shippingCostSar:null,
      totalLandedCostSar:null,
    });
    if(cards.length>=MAX_ITEMS)break;
  }
  return {
    state:cards.length?"UNVERIFIED_SHOPPING_CARDS":"NO_VALIDATED_SHOPPING_CARDS",
    cards,totalSeen,rejected,observedAt:now,
    comparableOffers:0,verifiedPrices:0,
  };
}
export function buildSerpApiGoogleShoppingUrl(query,{key}={}){
  const q=normalizeGoogleShoppingDiscoveryQuery(query);
  if(!q||typeof key!=="string"||key.trim().length<12)return null;
  const u=new URL(API_ENDPOINT);
  u.searchParams.set("engine","google_shopping");
  u.searchParams.set("q",q);
  u.searchParams.set("gl","sa");
  u.searchParams.set("hl","ar");
  u.searchParams.set("google_domain","google.com");
  u.searchParams.set("api_key",key.trim());
  // Permit SerpApi own cache where available; avoid burning a free credit for repeats.
  return u;
}
function validPlainObject(x){return Boolean(x)&&typeof x==="object"&&!Array.isArray(x);}
function classifyProviderStatus(code){
  if(code===401||code===403)return "PROVIDER_AUTH_DENIED";
  if(code===429)return "PROVIDER_RATE_LIMIT";
  if(code>=500)return "PROVIDER_UNAVAILABLE";
  return "PROVIDER_BAD_RESPONSE";
}
export function createGoogleShoppingResultsClient({
  apiKey=process.env.SERPAPI_API_KEY,
  enabled=process.env.NAWAA_GOOGLE_SHOPPING_RESULTS_ENABLED==="1",
  fetchImpl=globalThis.fetch,
  clock=()=>Date.now(),
  monthlyCap=MONTHLY_CAP,
  hourlyCap=HOURLY_CAP,
  freeAccountCheck=checkSerpApiFreeAccount,
}={}){
  let month=null,calls=0,hour=null,hourlyCalls=0;
  const cache=new Map();
  const pending=new Map();
  async function run(query) {
    const q=normalizeGoogleShoppingDiscoveryQuery(query);
    if(!q)return {status:400,body:{error:"invalid_query",cards:[]}};
    if(!enabled||!apiKey||apiKey.length<12)return {
      status:503,body:{error:"google_shopping_not_configured",cards:[]}
    };
    const t=clock();
    const monthKey=new Date(t).toISOString().slice(0,7);
    const hourKey=new Date(t).toISOString().slice(0,13);
    if(hour!==hourKey){hour=hourKey;hourlyCalls=0;}
    if(month!==monthKey){month=monthKey;calls=0;cache.clear();}
    const key=q.toLocaleLowerCase("und");
    const saved=cache.get(key);
    if(saved && saved.expires>t)return {...saved.data,body:{...saved.data.body,fromCache:true}};
    if(pending.has(key))return pending.get(key);
    if(calls>=monthlyCap)return {status:429,body:{error:"shopping_monthly_budget_exhausted",cards:[]}};
    if(hourlyCalls>=hourlyCap)return {status:429,body:{error:"shopping_hourly_budget_exhausted",cards:[]}};
    // Reserve a local budget slot synchronously BEFORE asynchronous free-plan
    // verification, so unrelated queries cannot race through this local cap.
    calls++;
    hourlyCalls++;
    const action=(async()=>{
      try{
    // Verify current provider account on every cache miss. The account API is
    // documented as free of charge. No cached permission to spend free credits.
    // Concurrent instances are still bounded by the upstream Free plan and
    // deliberately generous reserve; no paid-account usage is ever allowed.
    let freePlan;
    try {freePlan=await freeAccountCheck({apiKey,fetchImpl});}
    catch {freePlan={allowed:false,reason:"ACCOUNT_VERIFICATION_UNAVAILABLE"};}
    if(!freePlan?.allowed) return {
      status:503,body:{
        error:"GOOGLE_SHOPPING_ZERO_COST_GUARD",
        reason:String(freePlan?.reason||"ACCOUNT_VERIFICATION_UNAVAILABLE"),
        cards:[],
      }
    };
      
        const target=buildSerpApiGoogleShoppingUrl(q,{key:apiKey});
        const response=await fetchImpl(target.href,{
          method:"GET",signal:AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          headers:{"accept":"application/json"},
          redirect:"error",
        });
        if(!response.ok)return {status:502,body:{error:classifyProviderStatus(response.status),cards:[]}};
        const type=String(response.headers.get("content-type")||"");
        if(!type.toLowerCase().includes("application/json"))return {
          status:502,body:{error:"PROVIDER_CONTENT_TYPE_INVALID",cards:[]}
        };
        const len=Number(response.headers.get("content-length"));
        if(Number.isFinite(len)&&len>MAX_JSON_BYTES)return {
          status:502,body:{error:"PROVIDER_RESPONSE_TOO_LARGE",cards:[]}
        };
        let size=0;const chunks=[];
        if(!response.body)return {status:502,body:{error:"PROVIDER_BODY_MISSING",cards:[]}};
        for await(const chunk of response.body){
          size+=chunk.byteLength;
          if(size>MAX_JSON_BYTES){await response.body.cancel().catch(()=>{});return {
            status:502,body:{error:"PROVIDER_RESPONSE_TOO_LARGE",cards:[]}
          };}
          chunks.push(Buffer.from(chunk));
        }
        const payload=JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if(!validPlainObject(payload)||payload.error)return {
          status:502,body:{error:"PROVIDER_ERROR",cards:[]}
        };
        const normalized=normalizeGoogleShoppingResults(payload);
        const data={status:200,body:{
          source:"google-shopping",provider:"SerpApi",mode:"unverified_discovery_cards",
          query:q, ...normalized, fromCache:false,
          customerOfferCount:0,verifiedPriceCount:0,
        }};
        cache.set(key,{data,expires:clock()+DISCOVERY_CACHE_TTL_MS});
        if(cache.size>48)cache.delete(cache.keys().next().value);
        return data;
      }catch(e){
        return {status:502,body:{error:e?.name==="TimeoutError"?"PROVIDER_TIMEOUT":"PROVIDER_TRANSPORT_FAILURE",cards:[]}};
      }
    })();
    pending.set(key,action);
    try{return await action;}finally{pending.delete(key);}
  }
  return {run,status:()=>({enabled:Boolean(enabled&&apiKey&&apiKey.length>=12),calls,monthlyCap,month,hourlyCalls,hourlyCap,hour})};
}
