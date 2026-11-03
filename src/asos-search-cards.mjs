// ASOS visible-search-card evidence parser for NAWAA.
// Pure offline HTML analysis: no HTTP requests, no implied Saudi delivery,
// no customer price publication. Operate only on authorized HTML inputs.
import {load} from "cheerio";

const ORIGIN="https://www.asos.com";
const MAX_HTML_CHARS=4_000_000;
const MAX_CARDS=160;
const MAX_PRICE=1_000_000;
const PRODUCT_ID=/^[1-9]\d{5,11}$/;

const clean=value=>String(value??"").replace(/\s+/g," ").trim();
const digits=value=>String(value??"").match(/^[1-9]\d{5,11}$/)?.[0]||null;

export function asosSearchUrl(query){
  const q=clean(query);
  if(!q||q.length>160||/[\u0000-\u001f\u007f]/.test(q))
    throw new Error("ASOS_INVALID_QUERY");
  const url=new URL("/search/",ORIGIN);
  url.searchParams.set("q",q);
  return url.href;
}

export function verifyAsosSearchContext({requestedUrl,finalUrl,query}={}){
  try{
    const requested=new URL(requestedUrl),final=new URL(finalUrl||requestedUrl);
    const q=clean(query);
    return q.length>0&&requested.origin===ORIGIN&&final.origin===ORIGIN&&
      requested.pathname==="/search/"&&final.pathname==="/search/"&&
      clean(requested.searchParams.get("q"))===q&&
      clean(final.searchParams.get("q"))===q;
  }catch{return false;}
}

export function parseAsosGBP(value){
  const s=clean(value).replace(/[\u00a0\u202f]/g," ");
  if(!/^£\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})$/.test(s))return null;
  const number=Number(s.replace(/[£,\s]/g,""));
  return Number.isFinite(number)&&number>0&&number<MAX_PRICE?number:null;
}

function readListingUrl(value,id){
  try{
    const u=new URL(value,ORIGIN);
    const fromPath=u.pathname.match(/\/prd\/(\d{6,12})(?:\/|$)/i)?.[1];
    if(u.origin!==ORIGIN||u.username||u.password||u.port||
       fromPath!==id||!PRODUCT_ID.test(fromPath))return null;
    const variantId=digits(u.hash.match(/^#colourWayId-(\d+)$/i)?.[1]);
    return {sourceUrl:u.href,productId:id,variantId};
  }catch{return null;}
}

function readImage(value){
  try{
    const u=new URL(value);
    return u.protocol==="https:"&&u.hostname==="images.asos-media.com"&&
      !u.username&&!u.password?u.href:null;
  }catch{return null;}
}

function cardPrice($,card,id){
  const priceRow=$(card).find("p[id='pta-product-"+id+"-1']").first();
  if(!priceRow.length)return null;
  const sale=priceRow.find("[class*='saleAmount_']").first();
  const was=priceRow.find("[class*='originalPrice_']").first();
  const current= sale.length?parseAsosGBP(sale.text()):parseAsosGBP(was.text());
  if(current===null)return null;
  const listPrice=sale.length?parseAsosGBP(was.text()):null;
  if(sale.length&&listPrice!==null&&listPrice<current)return null;
  const accessible=clean(priceRow.attr("aria-label"));
  if(accessible){
    const labelCurrent=accessible.match(/(?:current\s+price|price)\s*:\s*(£\s*[\d,.]+)/i)?.[1];
    if(labelCurrent===undefined||parseAsosGBP(labelCurrent)!==current)return null;
    const labelWas=accessible.match(/original\s+price\s*:\s*(£\s*[\d,.]+)/i)?.[1];
    if(labelWas!==undefined&&(listPrice===null||parseAsosGBP(labelWas)!==listPrice))return null;
  }
  return {price:current,listPrice};
}

/**
 * Parse only first-party, visible ASOS GB search cards, never sponsored rails.
 * Query relevance and Saudi delivery are intentionally outside this parser.
 *
 * @returns {{candidates: object[], diagnostics: object}}
 */
export function parseAsosSearchCards(html,query,options={}){
  const diagnostics={
    status:"UNVERIFIED",cardsSeen:0,pricedCards:0,
    rejectedCards:0,conflicts:0,market:"GB",currency:"GBP",
    customerPublishable:false,shippingToSaudiVerified:false,
  };
  const finish=status=>({candidates:[],diagnostics:{...diagnostics,status}});
  if(!verifyAsosSearchContext({
    requestedUrl:options.requestedUrl,finalUrl:options.finalUrl,query,
  }))return finish("SEARCH_CONTEXT_MISMATCH");
  if(typeof html!=="string"||!html||html.length>MAX_HTML_CHARS)
    return finish("HTML_MISSING_OR_TOO_LARGE");

  const $=load(html,{decodeEntities:true});
  const root=$("html").first();
  if(clean(root.attr("lang")).toLowerCase()!=="en-gb"||
     clean(root.attr("data-country-code")).toUpperCase()!=="GB"||
     clean(root.attr("data-store-code")).toUpperCase()!=="COM")
    return finish("MARKET_CURRENCY_NOT_ATTESTED");

  const listing=$('ul[data-testid^="listing-results-"]').first();
  if(!listing.length)return finish("SEARCH_LISTING_MISSING");
  const max=Math.min(MAX_CARDS,
    Number.isFinite(options.maxCards)?Math.max(0,Math.floor(options.maxCards)):MAX_CARDS);
  const byIdentity=new Map(),conflicts=new Set();
  listing.children("li[id^='product-']").slice(0,max).each((_,li)=>{
    const card=$(li);
    const id=digits(clean(card.attr("id")).replace(/^product-/,""));
    if(!id||!/\bproductTile(?:_|\b)/.test(card.attr("class")||""))return;
    diagnostics.cardsSeen++;
    const title=clean(card.find("p[id='pta-product-"+id+"-0']").first().text());
    const link=card.find("a[href*='/prd/']").first();
    const provenance=readListingUrl(link.attr("href"),id);
    const priced=cardPrice($,li,id);
    if(!title||title.length>350||!provenance||!priced){
      diagnostics.rejectedCards++;return;
    }
    diagnostics.pricedCards++;
    const image=readImage(card.find("img").first().attr("src")||
      card.find("img").first().attr("data-src"));
    const identity=id+"|"+(provenance.variantId||"");
    const candidate={
      productId:id,variantId:provenance.variantId,title,
      sourceUrl:provenance.sourceUrl,image,
      price:priced.price,listPrice:priced.listPrice,
      currency:"GBP",priceEvidence:"VISIBLE_SEARCH_CARD_GB",
      availability:"unknown",canShipToSaudi:null,
    };
    const before=byIdentity.get(identity);
    if(before&&(before.price!==candidate.price||
       before.title!==candidate.title||
       before.sourceUrl!==candidate.sourceUrl)){
      conflicts.add(identity);diagnostics.conflicts++;
    }else if(!before)byIdentity.set(identity,candidate);
  });
  for(const identity of conflicts)byIdentity.delete(identity);
  return {candidates:[...byIdentity.values()],
    diagnostics:{...diagnostics,status:diagnostics.cardsSeen?"PARSED_GB_SEARCH":"NO_VISIBLE_CARDS"}};
}
