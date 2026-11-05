// Noon UAE first-party live search cards only. The merchant's UAE storefront
// presents prices in AED; on an exact-query, first-party /uae-en/ page, a
// numeric price on an exact SKU+offer card is AED by market context.
// Keep provenance explicit: inferred AED is NOT the same as a per-card label,
// and the SAR display uses the existing live/cached fx.mjs rate, not a fixed FX.
import {load} from "cheerio";
import {normalizeSearchQuery} from "./search-query.mjs";

const MAX_HTML_BYTES = 8_000_000;
const MAX_CARDS = 500;
const SKU_RE = /^(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)$/i;
const OFFER_RE = /^[A-Za-z0-9-]{1,100}$/;
const MONEY_RE = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$|^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?$/;

function noonUaeProductLink(raw) {
  if(typeof raw!=="string" || raw.length>2500)return null;
  try{
    const u=new URL(raw,"https://www.noon.com");
    if(u.protocol!=="https:" || u.username || u.password ||
       (u.port&&u.port!=="443") ||
       !["www.noon.com","noon.com"].includes(u.hostname.toLowerCase()))return null;
    const m=/^\/uae-en\/(?:[a-z0-9-]{2,320}\/)?(N\d{8}[AV]|Z[A-Z0-9]{20}Z)\/p\/?$/i.exec(u.pathname);
    if(!m || !SKU_RE.test(m[1]))return null;
    const offers=u.searchParams.getAll("o");
    if(offers.length!==1 || !OFFER_RE.test(offers[0]))return null;
    const productUrl="https://www.noon.com"+u.pathname;
    return {productId:m[1].toUpperCase(),offerCode:offers[0],
      sourceUrl:productUrl+"?o="+encodeURIComponent(offers[0])};
  }catch{return null;}
}

function verifiedSearchUrl(query,searchUrl,finalUrl) {
  try{
    const a=new URL(searchUrl),b=new URL(finalUrl);
    if(a.protocol!=="https:"||b.protocol!=="https:"||
       a.hostname!=="www.noon.com"||b.hostname!=="www.noon.com"||
       a.username||b.username||a.password||b.password||
       (a.port&&a.port!=="443")||(b.port&&b.port!=="443"))return false;
    const clean=p=>p.replace(/\/+$/,"");
    if(clean(a.pathname)!=="/uae-en/search" ||
       clean(b.pathname)!=="/uae-en/search")return false;
    const q=normalizeSearchQuery(query||"");
    return Boolean(q) && a.searchParams.getAll("q").length===1 &&
      b.searchParams.getAll("q").length===1 &&
      normalizeSearchQuery(a.searchParams.get("q"))===q &&
      normalizeSearchQuery(b.searchParams.get("q"))===q;
  }catch{return false;}
}

function parseAedAmount(text) {
  if(typeof text!=="string")return null;
  const raw=text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g,ch=>
    String(ch.charCodeAt(0)-(ch.charCodeAt(0)<=0x0669?0x0660:0x06f0)))
    .replace(/\u066c/g,",").replace(/\u066b/g,".")
    .replace(/[\u00a0\u202f]/g," ")
    .trim();
  // Explicitly conflicting foreign-currency labels must never be relabelled
  // AED. A shop UI font glyph (private use range) conveys no currency proof.
  if(/(?:\b(?:USD|SAR|EUR|GBP|INR|EGP|QAR|BHD|KWD|OMR)\b|US\$|[$€£₹]|ر\.?\s*س|ريال)/iu.test(raw))
    return null;
  const explicitAed=/(?:\bAED\b|د\.?\s*إ)/iu.test(raw);
  const numeric=raw.replace(/(?:\bAED\b|د\.?\s*إ)/giu,"")
    .replace(/[\uE000-\uF8FF]/gu,"").replace(/\s/gu,"");
  if(!MONEY_RE.test(numeric))return null;
  const value=Number(numeric.replace(/,/g,""));
  return Number.isFinite(value)&&value>0&&value<1e7
    ? {price:value,currencyEvidence:explicitAed?"EXPLICIT_AED_PRICE_LABEL":"VERIFIED_UAE_STOREFRONT_CONTEXT"}
    : null;
}

function noonProductImage(raw) {
  if(typeof raw!=="string" || raw.length>2500)return null;
  try{
    const u=new URL(raw);
    return u.protocol==="https:" && !u.username && !u.password &&
      !u.port && u.hostname==="f.nooncdn.com" &&
      u.pathname.startsWith("/p/") ? u.href:null;
  }catch{return null;}
}

function imageFromCard($,anchor) {
  for(const node of $(anchor).find("picture source, img").toArray().slice(0,15)){
    for(const name of ["srcset","data-srcset","data-src","data-original","data-lazy-src","src"]){
      const attr=$(node).attr(name);
      if(typeof attr!=="string")continue;
      // Srcset entries: URL width, URL width. Only first-party /p/ images.
      for(const entry of attr.split(",").slice(0,8)){
        const candidate=entry.trim().split(/\s+/)[0];
        const image=noonProductImage(candidate);
        if(image)return image;
      }
    }
  }
  return null;
}

// Python emits selected *card evidence*, never arbitrary HTML or a customer
// price. Validation here uses the same URL/amount/image rules as the browser
// HTML path. The worker's AED label alone never creates a trusted offer.
export function extractNoonUaeJsonCardEvidence(
  packet,query,{searchUrl,finalUrl=packet?.finalUrl,limit=MAX_CARDS}={}
){
  const fail=status=>({status,parsedCards:0,accepted:0,missingCurrency:0,
    invalidLinks:0,conflicts:0,explicitAed:0,marketInferredAed:0,offers:[]});
  if(!packet||typeof packet!=="object"||!Array.isArray(packet.cards)||
     packet.cards.length>250)return fail("INVALID_SOURCE_JSON_CARDS");
  if(!verifiedSearchUrl(query,searchUrl,finalUrl))
    return fail("SEARCH_URL_IDENTITY_NOT_ATTESTED");
  const language=String(packet.language||"").toLowerCase();
  if(!["en-ae","ar-ae"].includes(language)||
     normalizeSearchQuery(packet.heading||"")!==normalizeSearchQuery(query||""))
    return fail("SEARCH_PAGE_CONTEXT_NOT_ATTESTED");
  let invalidLinks=0,missingCurrency=0,parsedCards=0;
  const candidates=[];
  for(const item of packet.cards){
    if(!item||typeof item!=="object"||Array.isArray(item)||
       typeof item.title!=="string"||item.title.length<4||item.title.length>350||
       item.currency!=="AED"||typeof item.productId!=="string"||
       typeof item.offerCode!=="string"){
      invalidLinks++;continue;
    }
    const identity=noonUaeProductLink(item.sourceUrl);
    const image=noonProductImage(item.image);
    if(!identity||identity.productId!==item.productId||
       identity.offerCode!==item.offerCode||!image){
      invalidLinks++;continue;
    }
    parsedCards++;
    const price=parseAedAmount(item.priceText);
    if(!price||!Number.isFinite(item.priceAED)||
       Math.abs(price.price-item.priceAED)>0.001){
      missingCurrency++;continue;
    }
    candidates.push({...identity,title:item.title.replace(/\s+/g," ").trim(),
      image,price:price.price,currency:"AED",
      currencyEvidence:price.currencyEvidence,
      priceEvidence:price.currencyEvidence==="EXPLICIT_AED_PRICE_LABEL"
        ? "LIVE_AE_SEARCH_CARD_EXPLICIT_AED"
        : "LIVE_AE_SEARCH_CARD_MARKET_CONTEXT_AED"});
  }
  const byOffer=new Map();
  for(const item of candidates){
    const key=item.productId+"|"+item.offerCode;
    if(!byOffer.has(key))byOffer.set(key,[]);
    byOffer.get(key).push(item);
  }
  let conflicts=0;
  const accepted=[];
  for(const records of byOffer.values()){
    if(new Set(records.map(o=>o.title+"|"+o.price+"|"+o.image)).size!==1){
      conflicts++;continue;
    }
    accepted.push(records[0]);
  }
  const limitN=Math.max(0,Math.min(MAX_CARDS,Math.floor(Number(limit)||0)));
  return {status:accepted.length?"VERIFIED_UAE_MARKET_PRICE_CARDS":"NO_USABLE_AE_PRICE_CARD",
    parsedCards,accepted:accepted.length,missingCurrency,invalidLinks,conflicts,
    explicitAed:accepted.filter(x=>x.currencyEvidence==="EXPLICIT_AED_PRICE_LABEL").length,
    marketInferredAed:accepted.filter(x=>x.currencyEvidence==="VERIFIED_UAE_STOREFRONT_CONTEXT").length,
    offers:accepted.slice(0,limitN)};
}

export function extractNoonUaeSearchCardEvidence(
  html,query,{searchUrl,finalUrl=searchUrl,limit=MAX_CARDS}={}
){
  const fail=(status)=>({status,parsedCards:0,accepted:0,missingCurrency:0,
    invalidLinks:0,conflicts:0,offers:[]});
  if(typeof html!=="string"||!html.length||html.length>MAX_HTML_BYTES)
    return fail("INVALID_HTML");
  if(!verifiedSearchUrl(query,searchUrl,finalUrl))
    return fail("SEARCH_URL_IDENTITY_NOT_ATTESTED");
  const $=load(html);
  const lang=String($("html").attr("lang")||"").toLowerCase();
  const heading=normalizeSearchQuery($("h1").first().text().trim());
  if(!["en-ae","ar-ae"].includes(lang)||
     !heading||heading!==normalizeSearchQuery(query||""))
    return fail("SEARCH_PAGE_CONTEXT_NOT_ATTESTED");
  const limitN=Math.max(0,Math.min(MAX_CARDS,Math.floor(Number(limit)||0)));
  const candidates=[];let rawCards=0,missingCurrency=0,invalidLinks=0;
  $('a[href*="/p/"]').slice(0,MAX_CARDS).each((_,anchor)=>{
    const link=$(anchor),identity=noonUaeProductLink(link.attr("href"));
    if(!identity){invalidLinks++;return;}
    const title=link.find('[data-qa="plp-product-box-name"]').first().text().replace(/\s+/g," ").trim();
    const priceElement=link.find('[data-qa="plp-product-box-price"] strong[class*="amount"]').first();
    if(!priceElement.length||title.length<4||title.length>350)return;
    rawCards++;
    const amount=parseAedAmount(priceElement.text());
    if(amount===null){missingCurrency++;return;}
    const image=imageFromCard($,anchor);
    if(!image)return;
    candidates.push({...identity,title,image,price:amount.price,currency:"AED",
      currencyEvidence:amount.currencyEvidence,
      priceEvidence:amount.currencyEvidence==="EXPLICIT_AED_PRICE_LABEL"
        ? "LIVE_AE_SEARCH_CARD_EXPLICIT_AED"
        : "LIVE_AE_SEARCH_CARD_MARKET_CONTEXT_AED"});
  });
  const grouped=new Map();
  for(const item of candidates){
    const key=item.productId+"|"+item.offerCode;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(item);
  }
  let conflicts=0;const offers=[];
  for(const records of grouped.values()){
    const unique=new Set(records.map(x=>x.title+"|"+x.price+"|"+x.image));
    if(unique.size!==1){conflicts++;continue;}
    offers.push(records[0]);
  }
  return {status:offers.length?"VERIFIED_UAE_MARKET_PRICE_CARDS":"NO_USABLE_AE_PRICE_CARD",
    parsedCards:rawCards,accepted:offers.length,missingCurrency,invalidLinks,
    explicitAed:offers.filter(o=>o.currencyEvidence==="EXPLICIT_AED_PRICE_LABEL").length,
    marketInferredAed:offers.filter(o=>o.currencyEvidence==="VERIFIED_UAE_STOREFRONT_CONTEXT").length,
    conflicts,offers:offers.slice(0,limitN)};
}
