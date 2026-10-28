// Source-owned public Saudi Noon storefront evidence only.
// No private API, browser emulation, proxies, access-denial retries, or synthetic
// offers. A first-party JSON-LD Product must own its SAR Offer and exact SKU.
import {normalizeSearchQuery,parseSearchIntent} from "./search-query.mjs";

export function noonSaudiProductIdentity(raw) {
  try {
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.username||url.password||
       (url.port&&url.port!=="443")||
       !["www.noon.com","noon.com"].includes(url.hostname.toLowerCase()))return null;
    // Product URLs are distinct from categories/search and UAE market pages.
    const m=/^\/saudi-en\/(?:[a-z0-9-]{2,150}\/)?(N\d{8}V)\/p\/?$/i.exec(url.pathname);
    if(!m)return null;
    return {sku:m[1].toUpperCase(),canonicalUrl:
      "https://www.noon.com"+url.pathname};
  }catch{return null}
}

function scriptProducts(html){
  const nodes=[];let count=0;
  const source=String(html||"");
  if(source.length>8000000)return [];
  const scripts=source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);
  for(const script of scripts){
    if(++count>70||nodes.length>160)break;
    if(!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1]))continue;
    const body=script[2].trim();
    if(body.length>250000||!body)continue;
    let obj;
    try{obj=JSON.parse(body)}catch{continue}
    const visit=(node,depth=0)=>{
      if(!node||typeof node!=="object"||depth>6||nodes.length>160)return;
      if(Array.isArray(node)){for(const x of node.slice(0,100))visit(x,depth+1);return}
      if(node["@type"]==="Product")nodes.push(node);
      if(node["@graph"])visit(node["@graph"],depth+1);
      if(node.itemListElement)visit(node.itemListElement,depth+1);
      if(node.item)visit(node.item,depth+1);
    };
    visit(obj);
  }
  return nodes;
}
const numberPrice=value=>{
  if(typeof value!=="string"&&typeof value!=="number")return null;
  const s=String(value).trim();
  if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n)&&n>0?n:null;
};
const sellerName=raw=>typeof raw==="string"?raw.trim():
  typeof raw?.name==="string"?raw.name.trim():null;
const imageUrl=raw=>{
  const value=Array.isArray(raw)?raw[0]:raw;
  const candidate=typeof value==="string"?value:value?.url;
  if(typeof candidate!=="string")return null;
  try{
    const url=new URL(candidate);
    return url.protocol==="https:" &&
      (url.hostname==="f.nooncdn.com"||url.hostname==="nooncdn.com"||
       url.hostname.endsWith(".nooncdn.com"))?url.href:null;
  }catch{return null}
};

export function extractNoonSaudiCatalogCards(html,query,limit=32){
  const queryNorm=normalizeSearchQuery(query);
  const intent=parseSearchIntent(query);
  const tokens=queryNorm.split(" ").filter(Boolean);
  if(!tokens.length)return [];
  const seen=new Map();
  for(const product of scriptProducts(html)){
    const identity=noonSaudiProductIdentity(product.url);
    if(!identity||String(product.sku||"").trim().toUpperCase()!==identity.sku)continue;
    const title=typeof product.name==="string"?product.name.trim():"";
    const normalized=normalizeSearchQuery(title);
    if(title.length<4||title.length>260||!normalized)continue;
    // A priced cross-sell without the shopper's model/storage is NOT a hit.
    if(intent.model){
      const subject=parseSearchIntent(title);
      if(subject.model!==intent.model)continue;
    }
    if(intent.storage && parseSearchIntent(title).storage!==intent.storage)continue;
    if(intent.color && parseSearchIntent(title).color!==intent.color)continue;
    const matches=tokens.filter(token=>
      normalized.split(" ").includes(token)).length;
    if(matches < Math.max(1,Math.ceil(tokens.length*0.67)))continue;
    const declared=Array.isArray(product.offers)?product.offers:[product.offers];
    if(declared.length!==1||!declared[0]||typeof declared[0]!=="object")continue;
    const offer=declared[0];
    if(offer["@type"] && String(offer["@type"]).toLowerCase()!=="offer")continue;
    if(offer.lowPrice!=null||offer.highPrice!=null||offer.priceSpecification!=null)continue;
    const offerIdentity=noonSaudiProductIdentity(offer.url);
    if(!offerIdentity||offerIdentity.sku!==identity.sku)continue;
    if(offer.sku!=null&&String(offer.sku).trim().toUpperCase()!==identity.sku)continue;
    if(offer.priceCurrency!=="SAR")continue;
    const price=numberPrice(offer.price);
    if(price===null)continue;
    const record={productId:identity.sku,title,
      sourceUrl:identity.canonicalUrl,image:imageUrl(product.image),
      price,currency:"SAR",sellerDeclared:sellerName(offer.seller)||null};
    const previous=seen.get(identity.sku);
    if(previous)seen.set(identity.sku,null); // ambiguous duplicate product owner
    else if(!seen.has(identity.sku))seen.set(identity.sku,record);
  }
  return [...seen.values()].filter(Boolean).slice(0,Math.max(0,Math.min(50,Number(limit)||0)));
}
