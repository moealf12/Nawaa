// Phase G.2 PDP structured-data parser. Offline-safe: it NEVER fetches HTML.
// The surrounding source transport must independently honor robot rules,
// source denial, bounded payloads, approved hosts, redirects and cancellation.
import {load} from "cheerio";
import {bike24Identity,bike24PdpId} from "./bike24-product-truth.mjs";

const MAX_HTML=3_000_000;
const MAX_SCRIPT=250_000;
const MAX_SCRIPTS=16;
const clean=s=>typeof s==="string"?s.replace(/[\u00a0\u202f]/g," ").replace(/\s+/g," ").trim():"";
const euroPrice=x=>{
  if(typeof x!=="string"&&typeof x!=="number")return null;
  const s=String(x);
  if(!/^[1-9]\d{0,7}(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n)&&n>0?Math.round(n*100)/100:null;
};
function approvedImage(raw){
  if(Array.isArray(raw))return raw.length===1?approvedImage(raw[0]):null;
  if(raw&&typeof raw==="object")return approvedImage(raw.url||raw.contentUrl);
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443"))return null;
    const host=url.hostname.toLowerCase();
    if(host!=="bike24.com"&&!host.endsWith(".bike24.com")&&
       host!=="bike24.net"&&!host.endsWith(".bike24.net"))return null;
    return url.href;
  }catch{return null}
}
function jsonLdProductNodes(root){
  const nodes=[];
  const visit=(node,depth=0)=>{
    if(depth>3||nodes.length>60||!node)return;
    if(Array.isArray(node)){node.slice(0,30).forEach(x=>visit(x,depth+1));return}
    if(typeof node!=="object")return;
    nodes.push(node);
    if(Array.isArray(node["@graph"]))visit(node["@graph"],depth+1);
  };
  visit(root);
  return nodes.filter(n=>{
    const types=Array.isArray(n["@type"])?n["@type"]:[n["@type"]];
    return types.some(t=>String(t||"").toLowerCase().split("/").pop()==="product");
  });
}
function code(raw,regex){
  if(raw==null||raw==="")return null;
  const v=String(raw);
  return regex.test(v)?v:null;
}
export function extractBike24PdpJsonLd(html,url,{observedAt=new Date().toISOString()}={}){
  if(typeof html!=="string"||html.length>MAX_HTML||!bike24PdpId(url))return null;
  const $=load(html);
  const items=[],productId=bike24PdpId(url);
  const scripts=$('script[type="application/ld+json"]').toArray().slice(0,MAX_SCRIPTS);
  for(const node of scripts){
    const raw=$(node).html()||"";
    if(!raw||raw.length>MAX_SCRIPT)continue;
    let parsed;
    try{parsed=JSON.parse(raw)}catch{continue}
    for(const item of jsonLdProductNodes(parsed)){
      if(bike24PdpId(item?.url)!==productId)continue;
      const title=clean(item.name);
      const identity=bike24Identity({
        title,sourceUrl:url,mpn:item.mpn,gtin:item.gtin13||item.gtin,
      });
      if(!identity)continue;
      const offers=Array.isArray(item.offers)?item.offers:[item.offers];
      if(offers.length!==1||!offers[0]||typeof offers[0]!=="object")continue;
      const offer=offers[0];
      const offerType=String(offer["@type"]||"").toLowerCase();
      if(offerType.includes("aggregateoffer")||!offerType.endsWith("offer"))continue;
      if(offer.url && bike24PdpId(offer.url)!==productId)continue;
      if(offer.priceCurrency!=="EUR")continue;
      const price=euroPrice(offer.price);
      const image=approvedImage(item.image);
      const mpn=code(item.mpn,/^[a-z0-9-]{3,64}$/i);
      const gtin=code(item.gtin13||item.gtin,/^\d{8,14}$/);
      if(price===null||!image||(item.mpn&&!mpn)||
         ((item.gtin13||item.gtin)&&!gtin))continue;
      items.push({
        title,sourceUrl:new URL(url).origin+new URL(url).pathname,image,
        originalProductPrice:price,originalCurrency:"EUR",
        mpn,gtin,retailerProductId:identity.retailerProductId,
        identityHash:identity.identityHash,edition:identity.edition,
        observedAt,sourceMeta:{
          priceEvidence:"PDP_JSONLD_OBSERVED_ONLY",
          merchantAttested:false,searchPdpPriceParity:false,
          saudiShippingVerified:false,
        },
      });
    }
  }
  if(items.length===0)return null;
  const key=items[0];
  // Conflicting same-product JSON-LD nodes must not be resolved by picking a
  // preferred price or assembling fields from different offers.
  if(items.some(x=>x.identityHash!==key.identityHash||
    x.originalProductPrice!==key.originalProductPrice||
    x.image!==key.image||x.mpn!==key.mpn||x.gtin!==key.gtin))return null;
  return key;
}
