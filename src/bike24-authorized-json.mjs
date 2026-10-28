// Phase G.2: explicitly authorized BIKE24 JSON feed; no HTML, endpoint
// discovery, browser impersonation, DNS rebinding, retries or redirect fallback.
// The endpoint contract is for a partner-authorized feed, NOT an assertion that
// BIKE24 publishes a public GraphQL/Next.js/mobile API.
import http2 from "node:http2";
import tls from "node:tls";
import {bike24Identity,bike24MatchesQuery} from "./bike24-product-truth.mjs";
import {NAWAA_INDEXER_USER_AGENT} from "./source-http-profile.mjs";
import {resolvePublicHttpsTarget} from "../server/url-resolver.mjs";
import {moneyToSAR} from "../server/fx.mjs";
import {filterQueryOffers} from "./search-query.mjs";

const MAX_JSON_BYTES=1_000_000;
const MAX_FEED_RECORDS=500;
const safeName=x=>typeof x==="string"&&x.length>1&&x.length<=220?x.trim():null;
const positiveCents=x=>{
  if(typeof x!=="string"&&typeof x!=="number")return null;
  const s=String(x);
  if(!/^(?:[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n)&&n>0?Math.round(n*100):null;
};
const safeImage=raw=>{
  try {
    const u=new URL(raw);
    const host=u.hostname.toLowerCase();
    return u.protocol==="https:"&&!u.username&&!u.password&&(!u.port||u.port==="443")&&
      (host==="www.bike24.com"||host.endsWith(".bike24.com")||
       host==="www.bike24.net"||host.endsWith(".bike24.net"))?u.href:null;
  } catch{return null}
};
const safeOptionalCode=(raw,pattern)=>{
  if(raw===null||raw===undefined||raw==="")return null;
  return typeof raw==="string"&&pattern.test(raw)?raw:null;
};

export function authorizedBike24JsonConfig(env=process.env) {
  if(env.NAWAA_BIKE24_JSON_ENABLED!=="1")return null;
  const raw=String(env.NAWAA_BIKE24_JSON_URL||"");
  const approved=String(env.NAWAA_BIKE24_JSON_ALLOWED_HOST||"").trim().toLowerCase();
  if(!raw||!approved||approved.length>253||approved.includes("*"))throw Error("BIKE24_JSON_CONFIG_MISSING_APPROVAL");
  let u;
  try{u=new URL(raw)}catch{throw Error("BIKE24_JSON_ENDPOINT_INVALID")}
  if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443"||
     u.hostname.toLowerCase()!==approved||!u.pathname||u.search||u.hash||
     u.pathname.includes(".."))throw Error("BIKE24_JSON_ENDPOINT_NOT_APPROVED");
  if(!/^[a-z0-9.-]+$/.test(approved)||approved==="localhost"||approved.endsWith(".local")||
     approved.endsWith(".internal")||approved.endsWith(".test")||
     /^[\d.]+$/.test(approved))throw Error("BIKE24_JSON_HOST_NOT_PUBLIC");
  return {url:u.href,hostname:approved};
}

// A documented, partner-provided feed must expose this small, explicit schema:
// {source:"bike24-de",market:"DE",products:[
//  {title,productUrl,retailerProductId,mpn,gtin,priceEUR,image,observedAt}
// ]}. Price/availability must originate from this record, never from URL,
// sibling models, JSON-LD recommendations, conversion or historical estimates.
export function parseAuthorizedBike24Json(payload,query,{now=Date.now()}={}){
  if(!payload||typeof payload!=="object"||Array.isArray(payload)||
     payload.source!=="bike24-de"||payload.market!=="DE"||
     !Array.isArray(payload.products)||payload.products.length>MAX_FEED_RECORDS)
    throw Error("BIKE24_JSON_SCHEMA_REJECTED");
  const checked=[],conflicted=new Set(),seen=new Map();
  let rejected=0;
  for(const record of payload.products){
    const title=safeName(record?.title);
    const productUrl=record?.productUrl;
    const identity=title?bike24Identity({
      title,sourceUrl:productUrl,mpn:record.mpn,gtin:record.gtin,
    }):null;
    const cents=positiveCents(record?.priceEUR);
    const image=safeImage(record?.image);
    const observed=Date.parse(record?.observedAt);
    const maker=safeOptionalCode(record?.mpn,/^[A-Za-z0-9-]{3,64}$/);
    const gtin=safeOptionalCode(record?.gtin,/^\d{8,14}$/);
    const invalidCode=(record?.mpn!=null&&record.mpn!==""&&!maker)||
      (record?.gtin!=null&&record.gtin!==""&&!gtin);
    if(!identity||String(record?.retailerProductId||"")!==identity.retailerProductId||
       cents===null||record?.currency!=="EUR"||!image||invalidCode||!Number.isFinite(observed)||
       observed>now+5*60_000||now-observed>72*3600_000||
       !bike24MatchesQuery(query,{title,sourceUrl:productUrl})){
      rejected++;continue;
    }
    const candidate={
      title,sourceUrl:identityUrl(productUrl),image,
      price:cents/100,currency:"EUR",mpn:maker,gtin,
      identityHash:identity.identityHash,edition:identity.edition,
      observedAt:new Date(observed).toISOString(),
    };
    const existing=seen.get(identity.identityHash);
    if(existing){
      if(existing.price!==candidate.price||existing.mpn!==maker||
         existing.gtin!==gtin||existing.image!==image){
        conflicted.add(identity.identityHash);
      }
      continue;
    }
    seen.set(identity.identityHash,candidate);
    checked.push(candidate);
  }
  return {records:checked.filter(x=>!conflicted.has(x.identityHash)),
    diagnostics:{input:payload.products.length,rejected,identityConflicts:conflicted.size}};
}
function identityUrl(raw){
  const u=new URL(raw);
  return u.origin+u.pathname;
}

// Bound, DNS-pinned, SNI-correct HTTP/2 for an explicitly configured endpoint.
// This method is not attempted in CI: the fake getJson test injects a fixture.
// No HTTP/1.1 fallback, no redirect following, no network on disabled config.
export async function getAuthorizedBike24JsonOverH2(config,{signal}={}){
  const target=await resolvePublicHttpsTarget(config.url);
  if(signal?.aborted)throw signal.reason||Error("ABORTED");
  return await new Promise((resolve,reject)=>{
    let finished=false,size=0,status=null,contentType="",chunks=[];
    const finish=(err,data)=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);
      signal?.removeEventListener("abort",aborted);
      session.close();
      session.destroy();
      if(err)reject(err);else resolve(data);
    };
    const socket=tls.connect({
      host:target.address,port:443,servername:target.parsed.hostname,
      rejectUnauthorized:true,ALPNProtocols:["h2"],minVersion:"TLSv1.2",
    });
    const session=http2.connect(target.parsed.origin,{createConnection:()=>socket});
    const timer=setTimeout(()=>finish(Error("AUTHORIZED_JSON_TIMEOUT")),7500);
    const aborted=()=>finish(signal.reason||Error("AUTHORIZED_JSON_ABORTED"));
    signal?.addEventListener("abort",aborted,{once:true});
    session.once("error",e=>finish(e));
    socket.once("error",e=>finish(e));
    socket.once("secureConnect",()=>{
      if(socket.alpnProtocol!=="h2"||!socket.authorized)
        finish(Error("AUTHORIZED_JSON_H2_TLS_NOT_NEGOTIATED"));
    });
    const request=session.request({
      ":method":"GET",":path":target.parsed.pathname+target.parsed.search,
      "accept":"application/json","user-agent":NAWAA_INDEXER_USER_AGENT,
    },{endStream:true});
    request.once("error",e=>finish(e));
    request.on("response",headers=>{
      status=Number(headers[":status"]);
      contentType=String(headers["content-type"]||"");
      if(status!==200||!/^application\/(?:[\w.+-]*\+)?json(?:;|$)/i.test(contentType)){
        const error=Error("BIKE24_JSON_HTTP_"+String(status||"INVALID_CONTENT_TYPE"));
        error.status=status;
        finish(error);
      }
    });
    request.on("data",chunk=>{
      size+=chunk.length;
      if(size>MAX_JSON_BYTES){finish(Error("AUTHORIZED_JSON_TOO_LARGE"));return}
      chunks.push(chunk);
    });
    request.once("end",()=>{
      if(finished)return;
      try{finish(null,JSON.parse(Buffer.concat(chunks,size).toString("utf8")))}
      catch{finish(Error("AUTHORIZED_JSON_PARSE_FAILED"))}
    });
    request.end();
  });
}

export async function searchAuthorizedBike24Json(query,{
  env=process.env,getJson=getAuthorizedBike24JsonOverH2,
  convert=moneyToSAR,signal,
}={}){
  const config=authorizedBike24JsonConfig(env);
  if(!config)return {active:false,offers:[],candidates:0,
    diagnostics:{reason:"AUTHORIZED_JSON_FEED_NOT_CONFIGURED",mode:"NO_HTML_FALLBACK"}};
  const payload=await getJson(config,{signal});
  const parsed=parseAuthorizedBike24Json(payload,query);
  const results=[];
  for(const item of parsed.records){
    signal?.throwIfAborted();
    const fx=await convert(item.price,"EUR");
    if(!fx||!Number.isFinite(fx.value)||fx.value<=0||
       !Number.isFinite(fx.rate)||!fx.source||!fx.observedAt)continue;
    results.push({
      provider:"free-storefronts",providerMarket:"bike24-de",merchant:"BIKE24",
      merchantCountryCode:"DE",merchantCountryNameAr:"ألمانيا",
      canShipToSaudi:null,isLocal:false,exactMatch:false,matchConfidence:0,
      sourceUrl:item.sourceUrl,title:item.title,image:item.image,
      identityHash:item.identityHash,variantId:item.edition,
      specs:{modelNumber:item.mpn,barcode:item.gtin},
      productPrice:fx.value,originalProductPrice:item.price,
      currency:"SAR",originalCurrency:"EUR",fx:{
        rate:fx.rate,source:fx.source,observedAt:fx.observedAt,
      },observedAt:item.observedAt,dataKind:"live",
      availability:"unknown",condition:"new",shipping:null,importCost:null,tax:null,
      mandatoryFees:0,discount:0,deliveryDays:null,
      sourceMeta:{priceEvidence:"AUTHORIZED_FEED_RECORD_ONLY",
        verifiedByMerchant:false,priceParityConfirmed:false,
        sourceType:"AUTHORIZED_JSON_FEED"},
    });
  }
  const filtered=filterQueryOffers(query,results);
  return {active:true,candidates:parsed.diagnostics.input,offers:filtered.offers,
    diagnostics:{...parsed.diagnostics,queryFilter:filtered.queryFilter,
      mode:"AUTHORIZED_JSON_ONLY",priceEvidence:"FEED_OBSERVED_NOT_ATTESTED"}};
}
