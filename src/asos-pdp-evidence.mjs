// NAWAA ASOS PDP truth gate. Parses supplied HTML only, never networks.
// Missing price, selected-colour stock evidence or a browser error page
// is UNKNOWN, never IN_STOCK or OUT_OF_STOCK.
import {load} from "cheerio";
const ORIGIN="https://www.asos.com";
const positive=new Set(["https://schema.org/InStock","http://schema.org/InStock","InStock"]);
const negative=new Set(["https://schema.org/OutOfStock","http://schema.org/OutOfStock","OutOfStock","https://schema.org/SoldOut","SoldOut"]);
const idPattern=/^[1-9]\d{5,11}$/;
const clean=s=>String(s??"").trim();
function sameProductUrl(raw,id){
  try{
    const u=new URL(raw,ORIGIN);
    return u.origin===ORIGIN&&!u.username&&!u.password&&!u.port&&
      u.pathname.match(/\/prd\/(\d{6,12})(?:\/|$)/i)?.[1]===id;
  }catch{return false;}
}
function validPrice(value){
  const s=clean(value);
  if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n)&&n>0&&n<1_000_000?Math.round(n*100)/100:null;
}
function productNodes(node,depth=0){
  if(depth>8||!node||typeof node!=="object")return[];
  if(Array.isArray(node))return node.flatMap(v=>productNodes(v,depth+1));
  const kinds=Array.isArray(node["@type"])?node["@type"]:[node["@type"]];
  const here=kinds.some(k=>/^(?:https?:\/\/schema\.org\/)?Product$/i.test(String(k)))
    ? [node]:[];
  const child=node["@graph"]??node.mainEntity??null;
  return [...here,...productNodes(child,depth+1)];
}
function readColour(url){
  try{return new URL(url,ORIGIN).hash.match(/^#colourWayId-(\d{6,12})$/i)?.[1]||null}
  catch{return null}
}
export function verifyAsosPdpEvidence(html,candidate,{finalUrl,observedAt=new Date().toISOString()}={}){
  const no=(reason,availability="unknown")=>({
    verified:false,reason,availability,price:null,currency:null,observedAt:null,
  });
  const productId=clean(candidate?.productId),variantId=clean(candidate?.variantId);
  if(!idPattern.test(productId)||!sameProductUrl(candidate?.sourceUrl,productId)||
      !sameProductUrl(finalUrl,productId))
    return no("PRODUCT_URL_IDENTITY_MISMATCH");
  if(typeof html!=="string"||!html||html.length>4_000_000)
    return no("PDP_HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  const root=$("html").first();
  if(root.attr("lang")?.toLowerCase()!=="en-gb"||
    root.attr("data-country-code")?.toUpperCase()!=="GB"||
    root.attr("data-store-code")?.toUpperCase()!=="COM")
    return no("PDP_MARKET_MISMATCH");
  if($("body.neterror").length ||
     /(?:network error|something went wrong|access denied|verify you are human)/i.test($("title").first().text()))
    return no("HTTP_200_PDP_ERROR_SHELL");
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(clean(observedAt)) ||
      !Number.isFinite(Date.parse(observedAt)))return no("OBSERVATION_TIME_MISSING");
  // Verify exact variant: a product-wide stock flag is not per-colour proof.
  if(!idPattern.test(variantId))return no("COLOURWAY_ID_MISSING");
  const evidence=[];
  for(const el of $("script[type='application/ld+json']").toArray().slice(0,16)){
    let parsed;
    try{parsed=JSON.parse($(el).html()||"")}catch{continue}
    for(const product of productNodes(parsed)){
      const declaredId=clean(product.productID??product.productId??product.sku);
      if(declaredId!==productId)continue;
      const offers=Array.isArray(product.offers)?product.offers:[product.offers];
      for(const offer of offers){
        if(!offer||typeof offer!=="object"||
           !sameProductUrl(offer.url,productId) ||
           readColour(offer.url)!==variantId ||
           clean(offer.priceCurrency).toUpperCase()!=="GBP")continue;
        const price=validPrice(offer.price);
        if(price===null)continue;
        const a=clean(offer.availability);
        if(!positive.has(a)&&!negative.has(a))continue;
        evidence.push({price,availability:positive.has(a)?"in_stock":"out_of_stock"});
      }
    }
  }
  if(!evidence.length)return no("PDP_VARIANT_PRICE_STOCK_UNATTESTED");
  if(evidence.some(x=>x.price!==evidence[0].price||
      x.availability!==evidence[0].availability))
    return no("PDP_CONFLICTING_EVIDENCE");
  const selected=evidence[0];
  if(selected.availability!=="in_stock")
    return no("PDP_VARIANT_OUT_OF_STOCK","out_of_stock");
  if(selected.price!==candidate.price)return no("SEARCH_PDP_PRICE_MISMATCH");
  // A colourway-wide schema.org InStock signal does NOT prove any selected
  // size is buyable. Only PDP price and colourway stock signalling are verified.
  // Do not publish in-stock status until a size-specific checkout offer is proven.
  return {verified:true,reason:"COLOURWAY_PRICE_PARITY_SIZE_UNKNOWN",
    availability:"unknown",colourwayAvailability:"in_stock",
    sizeAvailability:"unknown",sizeStockVerified:false,
    price:selected.price,currency:"GBP",observedAt};
}
