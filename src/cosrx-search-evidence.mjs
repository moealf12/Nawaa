// COSRX official storefront: pure parsers, no network access.
// Search-card USD prices are discovery evidence, NOT Saudi landed offers.
import {load} from "cheerio";

const ORIGIN="https://www.cosrx.com";
const MAX_HTML=4_000_000;
const MAX_CARDS=120;
const clean=value=>String(value??"").replace(/[\u00a0\u202f\s]+/g," ").trim();

export function cosrxSearchUrl(query){
  const q=clean(query);
  if(!q||q.length>160||/[\u0000-\u001f\u007f]/.test(q))
    throw new Error("COSRX_INVALID_QUERY");
  const u=new URL("/search",ORIGIN);
  u.searchParams.set("type","product");
  u.searchParams.set("q",q);
  return u.href;
}
export function cosrxProductIdentity(value){
  try{
    const u=new URL(value,ORIGIN);
    const match=u.pathname.match(/^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
    if(u.origin!==ORIGIN||!match||u.username||u.password||u.port)return null;
    return {handle:match[1].toLowerCase(),sourceUrl:ORIGIN+"/products/"+match[1].toLowerCase()};
  }catch{return null}
}
export function parseCosrxUSD(value){
  const s=clean(value);
  if(!/^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(s))return null;
  const n=Number(s.replace(/[$,\s]/g,""));
  return Number.isFinite(n)&&n>0&&n<1_000_000?Math.round(n*100)/100:null;
}
export function verifyCosrxSearchContext({query,requestedUrl,finalUrl}={}){
  try{
    const q=clean(query);
    if(!q)return false;
    return [requestedUrl,finalUrl||requestedUrl].every(raw=>{
      const u=new URL(raw);
      return u.origin===ORIGIN&&u.pathname==="/search"&&
        !u.port&&!u.username&&!u.password&&
        u.searchParams.getAll("q").length===1&&
        clean(u.searchParams.get("q")).toLowerCase()===q.toLowerCase()&&
        u.searchParams.getAll("type").length===1&&u.searchParams.get("type")==="product";
    });
  }catch{return false}
}
function safeImage(raw){
  if(!raw)return null;
  try{
    // Shopify image resize placeholders are not concrete URLs.
    const normalized=String(raw).replaceAll("{width}","460")
      .replaceAll("%7Bwidth%7D","460");
    const u=new URL(normalized,ORIGIN);
    return u.origin===ORIGIN&&u.pathname.startsWith("/cdn/shop/")&&
      !u.username&&!u.password&&!u.port?u.href:null;
  }catch{return null}
}
export function extractCosrxSearchCards(html,query,{
  requestedUrl,finalUrl,maxCards=100,
}={}){
  const diagnostics={
    source:"cosrx-global",status:"UNVERIFIED",reportedCount:null,
    cardsSeen:0,accepted:0,rejected:0,conflicts:0,
    observedCurrency:"USD",currencyAssumption:"USD_SEARCH_CARD_DISPLAY",
    inventoryVerified:false,shippingToSaudiVerified:false,
    customerPublishable:false,
  };
  const done=status=>({candidates:[],diagnostics:{...diagnostics,status}});
  if(!verifyCosrxSearchContext({query,requestedUrl,finalUrl}))
    return done("SEARCH_CONTEXT_MISMATCH");
  if(typeof html!=="string"||!html||html.length>MAX_HTML)
    return done("SEARCH_HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  if($("body.neterror").length||
    /(?:access denied|verify you are human|captcha|request blocked)/i.test($("title").text()))
    return done("SEARCH_ERROR_SHELL");
  const heading=clean($("title").first().text());
  const matched=heading.match(/^Search:\s*([\d,]+)\s+results found for\s+["“](.*?)["”]\s*[-–|]/i);
  if(!matched||clean(matched[2]).toLowerCase()!==clean(query).toLowerCase())
    return done("SEARCH_TITLE_QUERY_MISMATCH");
  const count=Number(matched[1].replaceAll(",",""));
  diagnostics.reportedCount=Number.isSafeInteger(count)?count:null;
  const region=$(".collection-listing .product-list").first();
  if(!region.length)return done("SEARCH_LISTING_MISSING");
  const max=Math.max(0,Math.min(MAX_CARDS,Number.isFinite(maxCards)?Math.floor(maxCards):100));
  const products=new Map(),bad=new Set();
  region.children(".product-block[data-product-id]").slice(0,max).each((_,node)=>{
    diagnostics.cardsSeen++;
    const card=$(node);
    const id=clean(card.attr("data-product-id"));
    const titleNode=card.find(".product-info a.product-link .product-block__title").first();
    const title=clean(titleNode.text());
    const productAnchor=titleNode.closest("a.product-link");
    const identity=cosrxProductIdentity(productAnchor.attr("href"));
    const priceText=clean(card.find(".product-info .product-price-data .product-price__amount").first().text());
    const price=parseCosrxUSD(priceText);
    if(!/^\d{8,18}$/.test(id)||!identity||!title||title.length>360||
      price===null||!productAnchor.length){
      diagnostics.rejected++;return;
    }
    const image=card.find(".product-block__image--primary img").first();
    const candidate={
      productId:id,handle:identity.handle,sourceUrl:identity.sourceUrl,
      title,price,currency:"USD",
      image:safeImage(image.attr("data-src")||image.attr("src")),
      availability:"unknown",variantId:null,
      shippingToSaudiVerified:false,canShipToSaudi:null,
      priceEvidence:"VISIBLE_SEARCH_CARD_USD_ONLY",
      customerPublishable:false,
    };
    const prev=products.get(id);
    if(prev&&(
       prev.handle!==candidate.handle||prev.title!==title||prev.price!==price)){
      bad.add(id);diagnostics.conflicts++;
    }else if(!prev)products.set(id,candidate);
  });
  for(const id of bad)products.delete(id);
  diagnostics.accepted=products.size;
  return {candidates:[...products.values()],
    diagnostics:{...diagnostics,status:diagnostics.cardsSeen?
      "SEARCH_CARD_EVIDENCE_OBSERVED":count>0?
      "SEARCH_CARD_DISCOVERY_UNAVAILABLE":"NO_LISTING_CARD_EVIDENCE"}};
}

export function verifyCosrxPdp(html,candidate,{
  finalUrl,observedAt=new Date().toISOString(),
}={}){
  const no=reason=>({
    verified:false,reason,price:null,availability:"unknown",
    variantAvailability:"unknown",shippingToSaudiVerified:false,
    canShipToSaudi:null,customerPublishable:false,
  });
  const requested=cosrxProductIdentity(candidate?.sourceUrl);
  const actual=cosrxProductIdentity(finalUrl);
  if(!requested||!actual||requested.handle!==actual.handle||
    requested.handle!==candidate?.handle||!/^\d{8,18}$/.test(String(candidate?.productId||"")))
    return no("PDP_PRODUCT_IDENTITY_MISMATCH");
  if(typeof html!=="string"||!html||html.length>MAX_HTML)
    return no("PDP_HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  if($("body.neterror").length||
    /(?:access denied|captcha|request blocked|network error)/i.test($("title").first().text()))
    return no("PDP_ERROR_SHELL");
  const buybox=$('.product-detail .product-form[data-product-id]').first();
  if(!buybox.length||clean(buybox.attr("data-product-id"))!==String(candidate.productId))
    return no("PDP_BUYBOX_ID_MISMATCH");
  const title=clean(buybox.find("h1.title").first().text());
  if(!title)return no("PDP_TITLE_MISSING");
  // Require exact visible name; avoids separately listed limited editions,
  // alternative bundles and "short dated" variants sharing a family.
  if(title.toLocaleLowerCase()!==clean(candidate.title).toLocaleLowerCase())
    return no("PDP_TITLE_MISMATCH");
  const priceText=clean(buybox.find(".price-container .price-area .current-price.theme-money").first().text());
  const price=parseCosrxUSD(priceText);
  if(price===null)return no("PDP_PRICE_UNATTESTED");
  if(price!==candidate.price)return no("SEARCH_PDP_PRICE_MISMATCH");
  if(!Number.isFinite(Date.parse(observedAt)))return no("PDP_TIMESTAMP_INVALID");
  // PDP current price parity does not attest a selected Shopify variant's
  // availability, nor Saudi shipping/checkout eligibility.
  return {verified:true,reason:"PDP_CURRENT_PRICE_PARITY",
    productId:candidate.productId,handle:requested.handle,
    title,price,currency:"USD",
    availability:"unknown",variantAvailability:"unknown",
    variantId:null,canShipToSaudi:null,shippingToSaudiVerified:false,
    customerPublishable:false,observedAt:new Date(observedAt).toISOString()};
}
