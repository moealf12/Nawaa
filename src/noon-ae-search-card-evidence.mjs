// Noon UAE first-party live search cards only. This is NOT the experimental
// fixed-rate AED->SAR preview, and no inferred AE market currency may become
// a customer offer. The generic provider converts admitted AED using fx.mjs.
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
  // Proof is only an explicit AED marker on the price-bearing element.
  // A symbol/font alone or the document's AE locale cannot attest currency.
  if(!/(?:\bAED\b|د\.?\s*إ)/iu.test(raw))return null;
  const n=raw.replace(/(?:\bAED\b|د\.?\s*إ)/giu,"").replace(/\s/g,"");
  if(!MONEY_RE.test(n))return null;
  const value=Number(n.replace(/,/g,""));
  return Number.isFinite(value)&&value>0&&value<1e7?value:null;
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
    const price=parseAedAmount(priceElement.text());
    if(price===null){missingCurrency++;return;}
    const image=imageFromCard($,anchor);
    if(!image)return;
    candidates.push({...identity,title,image,price,currency:"AED",
      priceEvidence:"LIVE_AE_SEARCH_CARD_EXPLICIT_AED"});
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
  return {status:offers.length?"VERIFIED_EXPLICIT_AED_SEARCH_CARDS":"NO_PRICE_CURRENCY_VERIFIED",
    parsedCards:rawCards,accepted:offers.length,missingCurrency,invalidLinks,
    conflicts,offers:offers.slice(0,limitN)};
}
