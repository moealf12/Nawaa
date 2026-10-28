import {load} from "cheerio";
import {bike24PdpId,bike24Identity} from "../src/bike24-product-truth.mjs";

export const isBike24ProductUrl=value=>Boolean(bike24PdpId(value));
export function isBike24GarminEdge540Page(html,url){
  if(!isBike24ProductUrl(url)||typeof html!=="string"||html.length>5_000_000)return false;
  return /^garmin\s+edge\s+540\b/i.test(String(load(html)("h1").first().text()||"").trim());
}
const clean=value=>String(value||"").replace(/[\u00a0\u202f]/g," ").replace(/\s+/g," ").trim();
const euroText=/(?:^|[^\d.,])((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)\s*€/g;
function eur(value){
  if(typeof value==="number")return Number.isFinite(value)&&value>0 ? Math.round(value*100)/100:null;
  if(typeof value!=="string")return null;
  const s=clean(value).replace(/\s*€$/,"");
  const formatted=/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(s);
  if(!formatted)return null;
  const n=Number(s.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)&&n>0?Math.round(n*100)/100:null;
}
function matchProductNodes($,rawUrl,title){
  const id=bike24PdpId(rawUrl),out=[];
  for(const script of $('script[type="application/ld+json"]').toArray().slice(0,15)){
    const raw=$(script).html()||"";
    if(raw.length>250000)continue;
    let parsed;
    try{parsed=JSON.parse(raw)}catch{continue}
    const queue=Array.isArray(parsed)?parsed:[parsed],nodes=[];
    for(const entry of queue) {
      if(Array.isArray(entry?.["@graph"]))nodes.push(...entry["@graph"]);
      nodes.push(entry);
    }
    for(const node of nodes){
      if(!node||typeof node!=="object")continue;
      const types=Array.isArray(node["@type"])?node["@type"]:[node["@type"]];
      if(!types.some(t=>String(t||"").toLowerCase().endsWith("product")))continue;
      if(!bike24PdpId(node.url) || bike24PdpId(node.url)!==id)continue;
      const identity=bike24Identity({title:node.name,sourceUrl:rawUrl,mpn:node.mpn,gtin:node.gtin13||node.gtin});
      if(!identity||identity.edition!==bike24Identity({title,sourceUrl:rawUrl})?.edition)continue;
      const offers=Array.isArray(node.offers)?node.offers:[node.offers];
      if(offers.length!==1||!offers[0]||String(offers[0]["@type"]||"").toLowerCase()==="aggregateoffer")continue;
      const offer=offers[0];
      let price=null;
      if(String(offer.priceCurrency||"").toUpperCase()==="EUR"){
        // JSON-LD Offer.price is a decimal-dot JSON number, not a locale-formatted string.
        const n=Number(offer.price);
        if(Number.isFinite(n)&&n>0)price=Math.round(n*100)/100;
      }
      out.push({price,identity,mpn:node.mpn||null,gtin:node.gtin13||node.gtin||null});
    }
  }
  return out;
}
function visibleBuyboxPrice($,title){
  // Strictly exclude recommendations, RRP, crossed-out prices and related cards.
  const dom=load($.html());
  dom("script,style,noscript,template,nav,aside,footer,del,s,[hidden]").remove();
  dom("[class*='recommend'],[class*='cross-sell'],[class*='old-price'],[class*='rrp'],[class*='saving']").remove();
  const main=dom("main").first();
  const scope=main.length?main:dom("body");
  scope.find("p,div,section,article,li,h1,h2,br").each((_,el)=>{dom(el).prepend(" ");dom(el).append(" ");});
  const text=clean(scope.text());
  const start=text.indexOf(clean(title));
  if(start<0)return null;
  const following=text.slice(start+clean(title).length,start+clean(title).length+3500);
  const cart=/(?:Add to cart|In den Warenkorb)/i.exec(following);
  if(!cart)return null;
  const relevant=following.slice(0,cart.index);
  const found=[];
  for(const match of relevant.matchAll(euroText)){
    const n=eur(match[1]);if(n!==null)found.push(n);
  }
  const unique=[...new Set(found)];
  return unique.length===1?unique[0]:null;
}
function imageFromPdp($){
  const raw=$('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $("main img").first().attr("src");
  if(!raw)return null;
  try{
    const url=new URL(raw,"https://www.bike24.com");
    const host=url.hostname.toLowerCase();
    return url.protocol==="https:" &&
      (host==="bike24.com"||host.endsWith(".bike24.com")||
       host==="bike24.net"||host.endsWith(".bike24.net"))?url.href:null;
  }catch{return null}
}
export function extractBike24Product(html,rawUrl){
  if(!isBike24ProductUrl(rawUrl)||typeof html!=="string"||html.length>5_000_000)return null;
  const $=load(html);
  const title=clean($("h1").first().text());
  const identity=bike24Identity({title,sourceUrl:rawUrl});
  if(!identity)return null; // first phase: Garmin Edge 540 variant family only
  const image=imageFromPdp($);
  if(!image)return null;
  const structural=matchProductNodes($,rawUrl,title);
  const schemaPrices=[...new Set(structural.map(x=>x.price).filter(x=>x!==null))];
  if(schemaPrices.length>1)return null; // conflicting product-owned offers
  const visible=visibleBuyboxPrice($,title);
  const schemaPrice=schemaPrices.length===1?schemaPrices[0]:null;
  if(visible!==null&&schemaPrice!==null&&
     Math.round(visible*100)!==Math.round(schemaPrice*100))return null;
  // One price must be product-owned. Never infer a price from another product's
  // search listing, a min-price/aggregate offer, or unrelated page content.
  const price=visible??schemaPrice;
  if(price===null)return null;
  // Cheerio joins adjacent block text without a separator. Preserve
  // field boundaries: "Item Code: GAR643304" must not run into "MPN" or GTIN.
  const sheet=$("main").first().length?$("main").first():$("body");
  sheet.find("p,div,section,article,li,dt,dd,h1,h2,br").each((_,node)=>$(node).append(" "));
  const plain=clean(sheet.text());
  const maker=plain.match(/\bmanufacturer item code\s*:\s*([0-9A-Z-]{7,30})\b/i)?.[1]||null;
  const gtin=plain.match(/\bGTINs?\s*:\s*(\d{8,14})\b/i)?.[1]||null;
  const listed=structural[0]||null;
  if(maker&&listed?.mpn&&maker.toUpperCase()!==String(listed.mpn).toUpperCase())return null;
  if(gtin&&listed?.gtin&&gtin!==String(listed.gtin))return null;
  const itemCode=plain.match(/(?:^|\s)Item Code\s*:\s*([A-Z]{2,6}\d{3,10})\b/i)?.[1]||null;
  const owned=bike24Identity({title,sourceUrl:rawUrl,mpn:maker||listed?.mpn,gtin:gtin||listed?.gtin});
  return {
    name:title,image,brand:"Garmin",sku:itemCode,
    mpn:owned.mpn,gtin:owned.gtin,model:"Garmin Edge 540",
    variantId:owned.edition,identityHash:owned.identityHash,
    offers:{price,priceCurrency:"EUR",availability:""},
  };
}
