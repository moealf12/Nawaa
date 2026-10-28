import {load} from "cheerio";
import {thomannVariantIdentity} from "../src/thomann-product-truth.mjs";

// Dedicated Thomann German PDP extractor. Only the primary visible offer
// is eligible; recommendations, MSRP and B-Stock never create an offer.
export function isThomannProductUrl(value) {
  try {
    const u=new URL(value);
    return u.protocol==="https:" && u.hostname==="www.thomann.de" &&
      (!u.port || u.port==="443") && !u.username && !u.password &&
      /^\/de\/[a-z0-9_+-]+\.htm$/i.test(u.pathname);
  } catch {return false}
}
const normalize=v=>String(v||"").replace(/[\u00a0\u202f]/g," ").replace(/\s+/g," ").trim();
const euroPattern=/(?:^|[^\d.,])((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)\s*€/g;
function parseEuro(value){
  const n=Number(value.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)&&n>0?n:null;
}
function primaryPrice(text,title){
  const page=normalize(text),pos=page.indexOf(normalize(title));
  if(pos<0)return null;
  const body=page.slice(pos+normalize(title).length,pos+normalize(title).length+16000);
  const vat=/Alle\s+Preise\s+inkl\.?\s*MwSt\.?/i.exec(body);
  if(!vat)return null;
  const slice=body.slice(Math.max(0,vat.index-850),vat.index)
    .replace(/\bB[- ]Stock\b.{0,105}?(?:\bab\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*€/gi," ")
    .replace(/UVP\s*:?\s*(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*€/gi," ");
  const values=[];
  for(const m of slice.matchAll(euroPattern)){
    const price=parseEuro(m[1]);if(price!==null)values.push(price);
  }
  const distinct=[...new Set(values)];
  return distinct.length===1?distinct[0]:null;
}
function scopedSchemaEvidence($,identity){
  if(!identity)return {price:null,shipping:null};
  const values=[],shipping=[];
  const nodes=[];
  for(const script of $('script[type="application/ld+json"]').toArray().slice(0,12)){
    const raw=$(script).html()||"";
    if(raw.length>200000)continue;
    try{
      const entry=JSON.parse(raw);
      const group=Array.isArray(entry)?entry:[entry];
      for(const node of group) {
        if(Array.isArray(node?.["@graph"]))nodes.push(...node["@graph"]);
        nodes.push(node);
      }
    }catch{}
  }
  for(const node of nodes){
    if(!node||typeof node!=="object"||!String(node["@type"]||"").toLowerCase().split(" ").includes("product"))continue;
    const declared=thomannVariantIdentity(node.name,node.url||"");
    if(!declared||declared.identityHash!==identity.identityHash)continue;
    const offers=Array.isArray(node.offers)?node.offers:[node.offers];
    if(offers.length!==1||!offers[0]||typeof offers[0]!=="object")continue;
    const offer=offers[0];
    if(String(offer["@type"]||"").toLowerCase()==="aggregateoffer")continue;
    if(String(offer.priceCurrency||"").toUpperCase()==="EUR"){
      const n=Number(offer.price);
      if(Number.isFinite(n)&&n>0)values.push(Math.round(n*100));
    }
    const ship=Array.isArray(offer.shippingDetails)?offer.shippingDetails:[offer.shippingDetails];
    for(const details of ship){
      if(!details||typeof details!=="object")continue;
      const destination=details.shippingDestination?.addressCountry;
      const country=typeof destination==="string"?destination:destination?.name;
      const rate=details.shippingRate;
      const amount=Number(rate?.value);
      if(country==="SA"&&String(rate?.currency||"").toUpperCase()==="EUR"&&
        Number.isFinite(amount)&&amount>=0)
        shipping.push({country:"SA",amountEUR:amount,source:"PDP_JSON_LD",checkoutVerified:false});
    }
  }
  const distinct=[...new Set(values)];
  return {price:distinct.length===1?distinct[0]/100:null,
    priceConflict:distinct.length>1,shipping:shipping.length===1?shipping[0]:null};
}

function imageFromMerchant($){
  const imgs=[
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $('main img').first().attr("src"),
    $('main img').first().attr("data-src")];
  for(const raw of imgs){
    try{
      const u=new URL(raw),host=u.hostname.toLowerCase();
      if(u.protocol==="https:" &&
        (host==="www.thomann.de"||host==="thomann.de"||
         host==="static-thomann.de"||host.endsWith(".static-thomann.de")))
        return u.href;
    }catch{}
  }
  return null;
}
export function extractThomannProduct(html,url){
  if(!isThomannProductUrl(url)||typeof html!=="string"||html.length>5_000_000)return null;
  const $=load(html);
  const heading=$("h1").first(),title=normalize(heading.text());
  if(!heading.length||title.length<4||title.length>240)return null;
  const image=imageFromMerchant($);
  if(!image)return null;
  $("script,style,noscript,template,nav,footer,aside,[hidden],[aria-hidden='true']").remove();
  $("[class*='recommend'],[class*='accessor'],[class*='cross-sell'],[class*='upsell']").remove();
  const main=$("main").first();
  const root=main.length?main:$("body");
  // Cheerio .text() joins neighboring block nodes WITHOUT separators:
  // "Artikelnummer 153257" + "69 €" would look like "15325769 €".
  // Insert boundaries only for block-level elements, preserving inline price spans.
  root.find("p,div,section,article,li,dl,dt,dd,h1,h2,h3,h4,br").each((_,node)=>{
    $(node).prepend(" ");
    $(node).append(" ");
  });
  const plain=root.text();
  const price=primaryPrice(plain,title);
  if(price===null)return null;
  const sku=normalize(plain).match(/\bArtikelnummer\s+(\d{4,10})\b/i)?.[1]||null;
  // Reject HD-662 family pages if the title and canonical product URL
  // do not agree on the exact F/B/base SKU. Other Thomann products keep
  // their existing extraction path.
  const identity=thomannVariantIdentity(title,url);
  const evidence=identity?scopedSchemaEvidence(load(html),identity):{price:null,shipping:null};
  if(evidence.priceConflict ||
     (evidence.price!==null&&Math.round(evidence.price*100)!==Math.round(price*100)))return null;
  if(/^\/de\/superlux_hd662(?:_[a-z]+)?\.htm$/i.test(new URL(url).pathname) && !identity)return null;
  return {
    name:title,image,brand:identity?.brand||null,sku,
    ...(identity?{mpn:identity.model,model:identity.model,variantId:identity.model,
      identityHash:identity.identityHash,
      ...(evidence.shipping?{shippingContext:evidence.shipping}:{})}:{}),
    offers:{price,priceCurrency:"EUR",availability:""}
  };
}
