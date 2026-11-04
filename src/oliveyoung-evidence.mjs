// OLIVE YOUNG Global: pure offline, fail-closed search and PDP evidence.
// A result COUNT without product cards is NOT an empty catalogue.
// This module performs no network requests and publishes no offers.
import {load} from "cheerio";

const ORIGIN="https://global.oliveyoung.com";
const MAX_HTML=3_000_000;
const MAX_PRICE=1_000_000;
const clean=v=>String(v??"").replace(/[\u00a0\u202f\s]+/g," ").trim();
const ID=/^GA[0-9]{6,12}$/;

export function oliveYoungSearchUrl(query) {
  const q=clean(query);
  if(!q||q.length>160||/[\u0000-\u001f\u007f]/.test(q))
    throw new Error("OLIVEYOUNG_INVALID_QUERY");
  const url=new URL("/global/search/results",ORIGIN);
  url.searchParams.set("query",q);
  return url.href;
}

export function oliveYoungProductIdentity(value){
  try {
    const u=new URL(value);
    const ids=u.searchParams.getAll("prdtNo");
    const id=ids.length===1?ids[0]:null;
    if(u.origin!==ORIGIN||u.username||u.password||u.port||
       u.pathname!=="/product/detail"||!ID.test(id||"")||
       [...u.searchParams.keys()].some(k=>!["prdtNo","accParam"].includes(k)))
      return null;
    return {productId:id,sourceUrl:ORIGIN+"/product/detail?prdtNo="+encodeURIComponent(id)};
  }catch{return null;}
}

export function parseOliveYoungUSD(value){
  const v=clean(value);
  if(!/^US\$\s*(?:[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*|0)\.\d{2}$/.test(v))
    return null;
  const n=Number(v.slice(3).replaceAll(",","").trim());
  return Number.isFinite(n)&&n>0&&n<MAX_PRICE?Math.round(n*100)/100:null;
}

export function observeOliveYoungSearch(html,{query,requestedUrl,finalUrl}={}){
  const base={sourceId:"oliveyoung-global",customerPublishable:false,
    candidates:0,verifiedPriceCount:0,searchResultCount:null};
  const no=(status)=>({...base,status});
  let url,actual;
  try{
    url=new URL(requestedUrl);
    actual=new URL(finalUrl||requestedUrl);
    if(!clean(query)||[url,actual].some(u=>u.origin!==ORIGIN||
      u.pathname!=="/global/search/results"||
      u.searchParams.getAll("query").length!==1||
      clean(u.searchParams.get("query"))!==clean(query)||
      u.username||u.password||u.port))
      return no("SEARCH_CONTEXT_MISMATCH");
  }catch{return no("SEARCH_CONTEXT_MISMATCH");}
  if(typeof html!=="string"||!html||html.length>MAX_HTML)
    return no("SEARCH_HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  const text=clean($("body").text());
  if(/(?:access denied|verify you are human|captcha)/i.test($("title").first().text()))
    return no("SEARCH_ERROR_SHELL");
  const header=text.match(/Results for\s*['‘’"]([^'‘’"]+)['‘’"]/i);
  if(!header||clean(header[1]).toLocaleLowerCase()!==clean(query).toLocaleLowerCase())
    return no("SEARCH_QUERY_EVIDENCE_MISSING");
  // SSR joins adjacent DOM text nodes without separators: "1,301itemsMost Popular".
  // Do not require a word boundary after "items" when the next label starts uppercase.
  const match=text.match(/\b([\d,]+)\s*items(?=$|[^a-z]|[A-Z])/);
  const count=match?Number(match[1].replaceAll(",","")):null;
  // Search currently returns a valid count (e.g. 1301) but NO SSR product
  // links or priced cards. A filter's price range must not become a product.
  const productHrefs=$('a[href*="/product/detail?prdtNo="]')
    .toArray().map(el=>oliveYoungProductIdentity($(el).attr("href")))
    .filter(Boolean);
  return {...base,
    status:productHrefs.length?"SEARCH_PRODUCT_LINKS_WITHOUT_SCOPED_PRICE":
      count>0?"SEARCH_DISCOVERY_UNAVAILABLE":"SEARCH_NO_CARD_EVIDENCE",
    searchResultCount:Number.isSafeInteger(count)?count:null,
    // Count does NOT grant admission to product-price extraction or fan-out.
    unpricedProductLinks:Math.min(productHrefs.length,100)};
}

export function observeOliveYoungPdp(html,{requestedUrl,finalUrl,observedAt=new Date().toISOString()}={}){
  const base={sourceId:"oliveyoung-global",verified:false,
    availability:"unknown",canShipToSaudi:null,
    shippingToSaudiVerified:false,customerPublishable:false,
    price:null,currency:null};
  const no=status=>({...base,status});
  const requested=oliveYoungProductIdentity(requestedUrl);
  const actual=oliveYoungProductIdentity(finalUrl||requestedUrl);
  if(!requested||!actual||requested.productId!==actual.productId)
    return no("PDP_PRODUCT_ID_MISMATCH");
  if(typeof html!=="string"||!html||html.length>MAX_HTML)
    return no("PDP_HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  if($("body.neterror").length||
     /(?:access denied|verify you are human|captcha|network error)/i
       .test($("title").first().text()))
    return no("PDP_ERROR_SHELL");
  // Restrict price evidence to the product-buybox, never promotion widgets,
  // recommended products, "Best Deal" popovers or shipping threshold.
  const root=$(".prd-detail-content").first();
  if(!root.length)return no("PDP_BUYBOX_MISSING");
  const title=clean(root.find('[data-testid="product-name"]').first().text());
  const priceNode=root.find('[data-testid="product-price"]').first();
  const price=parseOliveYoungUSD(priceNode.text());
  if(!title||title.length>450||price===null)return no("PDP_TITLE_OR_PRICE_MISSING");
  const cartButton=root.find('[data-testid="product-addtocart-button"]').first();
  if(!cartButton.length||cartButton.is(":disabled"))return no("PDP_BUY_ACTION_UNAVAILABLE");
  // When the button explicitly declares a monetary amount, it must match
  // the buybox; a disagreement could mean an unselected variant.
  const cartText=clean(cartButton.text());
  if(!/Add to Cart/i.test(cartText))return no("PDP_BUY_ACTION_NOT_READY");
  const buttonAmount=cartText.match(/US\$\s*[\d,.]+/);
  if(buttonAmount && parseOliveYoungUSD(buttonAmount[0])!==price)
    return no("PDP_CART_PRICE_MISMATCH");
  const original=parseOliveYoungUSD(root.find(".prd-price-info dt.price > div > span.notranslate").first().text());
  if(original!==null&&original<price)return no("PDP_INVERTED_DISCOUNT");
  const rawLocation=clean(root.find('[data-testid="product-delivery-country-button"] .notranslate').first().text());
  const destination=rawLocation||null;
  const t=Date.parse(observedAt);
  if(!Number.isFinite(t))return no("PDP_TIMESTAMP_INVALID");
  return {
    ...base,status:"PDP_PRICE_OBSERVED_SHIPPING_UNKNOWN",verified:true,
    productId:requested.productId,sourceUrl:requested.sourceUrl,
    title,price,originalPrice:original,currency:"USD",
    // A selected country's name still does not establish SKU-eligible delivery.
    displayedDestination:destination,
    variantId:null,variantAvailability:"unknown",
    observedAt:new Date(t).toISOString(),
  };
}
