// COSRX official Shopify: deterministic, network-free search and variant evidence.
// US storefront price is not evidence of Saudi delivered cost.
import {load} from "cheerio";
const ORIGIN="https://www.cosrx.com";
const clean=x=>String(x??"").replace(/[\s\u00a0\u202f]+/g," ").trim();
const productId=/^[1-9]\d{9,16}$/;
const variantId=/^[1-9]\d{9,18}$/;

export function cosrxSearchUrl(query){
  const q=clean(query);
  if(!q||q.length>160||/[\u0000-\u001f\u007f]/.test(q))throw Error("COSRX_INVALID_QUERY");
  const u=new URL("/search",ORIGIN);
  u.searchParams.set("type","product");u.searchParams.set("q",q);return u.href;
}
export function cosrxIdentity(value){
  try{
    // Shopify SSR cards use first-party root-relative hrefs. Resolve them
    // against the pinned merchant origin, then enforce the exact origin.
    const u=new URL(value,ORIGIN);
    const m=u.pathname.match(/^\/products\/([a-z0-9][a-z0-9-]{1,150})\/?$/);
    if(u.origin!==ORIGIN||u.username||u.password||u.port||!m)return null;
    return {handle:m[1],sourceUrl:ORIGIN+"/products/"+m[1]};
  }catch{return null}
}
export function cosrxProductJsonUrl(value){
  const id=cosrxIdentity(value);
  return id?id.sourceUrl+".js":null;
}
export function cosrxUSD(value){
  const s=clean(value);
  if(!/^(?:US)?\$\s*(?:[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*|0)\.\d{2}$/.test(s))return null;
  const n=Number(s.replace(/^(?:US)?\$\s*/,"").replaceAll(",",""));
  return Number.isFinite(n)&&n>0&&n<1_000_000?Math.round(n*100)/100:null;
}
function safeCosrxImage(value){
  if(!value)return null;
  try{
    const raw=String(value).replaceAll("{width}","460")
      .replace(/%7Bwidth%7D/gi,"460");
    const u=new URL(raw,ORIGIN);
    if(u.origin!==ORIGIN||!u.pathname.startsWith("/cdn/shop/")||
       u.username||u.password||u.port)return null;
    return u.href;
  }catch{return null}
}
export function cosrxSearchContext({query,requestedUrl,finalUrl}={}){
  const q=clean(query).toLowerCase();
  if(!q)return false;
  try{
    return [requestedUrl,finalUrl||requestedUrl].every(raw=>{
      const u=new URL(raw);
      return u.origin===ORIGIN&&u.pathname==="/search"&&!u.username&&!u.password&&!u.port &&
        u.searchParams.getAll("q").length===1&&u.searchParams.getAll("type").length===1 &&
        u.searchParams.get("type")==="product" &&
        clean(u.searchParams.get("q")).toLowerCase()===q;
    });
  }catch{return false}
}
export function parseCosrxSearchCards(html,query,{requestedUrl,finalUrl,maxCards=80}={}){
  const d={status:"UNVERIFIED",sourceId:"cosrx-global",cardsSeen:0,accepted:0,
    rejected:0,conflicts:0,customerPublishable:false,
    shippingToSaudiVerified:false,currency:"USD"};
  const exit=status=>({candidates:[],diagnostics:{...d,status}});
  if(!cosrxSearchContext({query,requestedUrl,finalUrl}))return exit("SEARCH_CONTEXT_MISMATCH");
  if(typeof html!=="string"||!html||html.length>3_500_000)
    return exit("SEARCH_HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  if(/(?:access denied|verify you are human|captcha|neterror)/i.test($("title").first().text()))
    return exit("SEARCH_ERROR_SHELL");
  const title=clean($("title").first().text());
  const match=title.match(/Search:\s*\d+[\s\S]{0,80}for\s*["“]([^"”]+)["”]/i);
  if(!match||clean(match[1]).toLowerCase()!==clean(query).toLowerCase())
    return exit("SEARCH_QUERY_TITLE_MISSING");
  const limit=Math.max(0,Math.min(100,Number.isFinite(maxCards)?Math.floor(maxCards):80));
  const seen=new Map(),conflict=new Set();
  $(".collection-listing .product-list .product-block[data-product-id]")
    .slice(0,limit).each((_,el)=>{
      d.cardsSeen++;
      const node=$(el);
      const numericId=clean(node.attr("data-product-id"));
      const anchor=node.find(".product-info a.product-link[href]").first();
      const identity=cosrxIdentity(anchor.attr("href"));
      const name=clean(anchor.find(".product-block__title").first().text());
      const amounts=node.find(".product-info .product-price-data .product-price__amount")
        .toArray().map(span=>cosrxUSD($(span).text()));
      const price=amounts.length===1?amounts[0]:null;
      if(!productId.test(numericId)||!identity||!name||name.length>320||price===null){
        d.rejected++;return;
      }
      const imageEl=node.find(".product-block__image--primary img").first();
      const image=safeCosrxImage(imageEl.attr("data-src")||imageEl.attr("src"));
      const item={productId:numericId,handle:identity.handle,
        sourceUrl:identity.sourceUrl,title:name,image,price,currency:"USD",
        priceEvidence:"VISIBLE_US_DEFAULT_SEARCH_PRICE",
        availability:"unknown",variantId:null,shippingToSaudiVerified:false,
        canShipToSaudi:null,customerPublishable:false};
      const previous=seen.get(identity.handle);
      if(previous&&(previous.productId!==numericId||previous.price!==price||previous.title!==name)){
        conflict.add(identity.handle);d.conflicts++;
      }else if(!previous)seen.set(identity.handle,item);
    });
  for(const key of conflict)seen.delete(key);
  d.accepted=seen.size;
  d.status=d.cardsSeen?"PARSED_QUERY_BOUND_USD_CARDS":"SEARCH_NO_VISIBLE_CARDS";
  return {candidates:[...seen.values()],diagnostics:d};
}
const validCents=n=>Number.isSafeInteger(n)&&n>0&&n<100_000_000;
export function verifyCosrxVariantJson(json,candidate,{observedAt=new Date().toISOString()}={}){
  const no=reason=>({verified:false,reason,availability:"unknown",
    customerPublishable:false,shippingToSaudiVerified:false,
    canShipToSaudi:null,price:null});
  let product;
  try{product=typeof json==="string"?JSON.parse(json):json}catch{return no("PRODUCT_JSON_INVALID")}
  if(!product||typeof product!=="object"||Array.isArray(product))
    return no("PRODUCT_JSON_INVALID");
  const identity=cosrxIdentity(candidate?.sourceUrl);
  if(!identity||identity.handle!==candidate.handle||product.handle!==identity.handle||
    !productId.test(String(product.id))||String(product.id)!==candidate.productId)
    return no("PRODUCT_IDENTITY_MISMATCH");
  if(!Array.isArray(product.variants)||!product.variants.length||product.variants.length>80)
    return no("VARIANT_LIST_MISSING");
  if(!clean(product.title)||clean(product.title).toLowerCase()!==clean(candidate.title).toLowerCase())
    return no("PRODUCT_TITLE_MISMATCH");
  if(!Number.isFinite(Date.parse(observedAt)))
    return no("OBSERVATION_TIME_INVALID");
  if(product.variants.some(v=>!v||!variantId.test(String(v.id))||
      !validCents(v.price)||typeof v.available!=="boolean"))
    return no("VARIANT_DATA_INVALID");
  const selected=candidate.variantId
    ?product.variants.find(v=>String(v.id)===String(candidate.variantId))
    :product.variants.length===1?product.variants[0]:null;
  if(!selected)return no("VARIANT_SELECTION_REQUIRED");
  const normalized=selected.price/100;
  if(normalized!==candidate.price)return no("SEARCH_JSON_PRICE_MISMATCH");
  if(product.available===false&&selected.available===true)return no("STOCK_CONFLICT");
  const compare=validCents(selected.compare_at_price)?selected.compare_at_price/100:null;
  if(compare!==null&&compare<normalized)return no("COMPARE_PRICE_INVERTED");
  return {verified:true,reason:"EXACT_SHOPIFY_VARIANT_PRICE_AND_AVAILABILITY",
    productId:candidate.productId,handle:candidate.handle,
    variantId:String(selected.id),variantTitle:clean(selected.public_title||selected.title)||null,
    price:normalized,listPrice:compare,currency:"USD",
    availability:selected.available?"in_stock":"out_of_stock",
    // Global variant availability is NOT checkout availability to Saudi Arabia.
    canShipToSaudi:null,shippingToSaudiVerified:false,customerPublishable:false,
    observedAt:new Date(observedAt).toISOString()};
}


// First-party Shopify public predictive search. A fallback only for a
// query-authenticated HTML search which contains no usable product cards.
export function cosrxSuggestUrl(query){
  const q=new URL(cosrxSearchUrl(query)).searchParams.get("q");
  const u=new URL("/search/suggest.json",ORIGIN);
  u.searchParams.set("q",q);
  u.searchParams.set("resources[type]","product");
  u.searchParams.set("resources[limit]","10");
  return u.href;
}
export function parseCosrxSuggestCards(json,query,{requestedUrl,finalUrl}={}){
  const d={sourceId:"cosrx-global",status:"UNVERIFIED",accepted:0,rejected:0,
    conflicts:0,customerPublishable:false,shippingToSaudiVerified:false};
  const no=status=>({candidates:[],diagnostics:{...d,status}});
  const expected=cosrxSuggestUrl(query);
  if(requestedUrl!==expected || finalUrl!==expected)
    return no("SUGGEST_URL_CONTEXT_MISMATCH");
  if(typeof json!=="string"||!json||json.length>512_000)
    return no("SUGGEST_JSON_MISSING_OR_OVERSIZED");
  let root;
  try{root=JSON.parse(json)}catch{return no("SUGGEST_JSON_INVALID")}
  const products=root?.resources?.results?.products;
  if(!Array.isArray(products)||products.length>10)
    return no("SUGGEST_PRODUCTS_INVALID");
  const seen=new Map(),conflicts=new Set();
  for(const p of products){
    const identity=(()=>{
      try{return cosrxIdentity(new URL(p?.url,ORIGIN).href)}
      catch{return null}
    })();
    const id=String(p?.id||"");
    const name=clean(p?.title);
    // Shopify predictive amounts are decimal major units, not cents.
    // Require one unambiguous product price before exact variant confirmation.
    const amount=typeof p?.price==="string"?cosrxUSD("$"+p.price):null;
    const min=typeof p?.price_min==="string"?cosrxUSD("$"+p.price_min):null;
    const max=typeof p?.price_max==="string"?cosrxUSD("$"+p.price_max):null;
    if(!productId.test(id)||!identity||identity.handle!==p.handle||
      !name||name.length>320 || !/cosrx/i.test(clean(p.vendor)) ||
      amount===null || amount!==min || amount!==max ||
      typeof p.available!=="boolean"){
      d.rejected++;continue;
    }
    let image=null;
    try{
      const u=new URL(p.image);
      if(u.origin==="https://cdn.shopify.com"&&
         u.pathname.startsWith("/s/files/1/0513/3775/6828/files/") &&
         !u.username&&!u.password&&!u.port)image=u.href;
    }catch{}
    const entry={productId:id,handle:identity.handle,
      sourceUrl:identity.sourceUrl,title:name,price:amount,
      image,currency:"USD",availability:"unknown",variantId:null,
      priceEvidence:"FIRST_PARTY_SHOPIFY_QUERY_JSON",
      customerPublishable:false,shippingToSaudiVerified:false,
      canShipToSaudi:null};
    const prev=seen.get(identity.handle);
    if(prev&&(prev.productId!==id||prev.price!==amount||prev.title!==name)){
      conflicts.add(identity.handle);d.conflicts++;
    }else if(!prev)seen.set(identity.handle,entry);
  }
  for(const key of conflicts)seen.delete(key);
  d.accepted=seen.size;
  d.status=seen.size?"QUERY_BOUND_SHOPIFY_SUGGEST_CARDS":"NO_VERIFIED_SUGGEST_CARDS";
  return {candidates:[...seen.values()],diagnostics:d};
}
