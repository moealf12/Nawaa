import { randomUUID } from "node:crypto";
import { assessOfferMatch, productCategory, filterQueryOffers, queryMatchReasons, normalizeSearchQuery } from "../../src/search-query.mjs";
import { resolveProductUrl, fetchHtmlSafe } from "../url-resolver.mjs";
import { sameOfferIdentity } from "../product-identity.mjs";
import {enrichJarirOffersWithPython} from "../python-jarir-enrichment.mjs";

// Constructor index keys are public browser-side identifiers, not API tokens.
// Jarir exposes this English index key in its public storefront configuration.
const JARIR_CONSTRUCTOR_KEY = "key_KcSYfmQTEwRpBnd9";
const JARIR_CONSTRUCTOR_BASE = "https://ac.cnstrc.com/v1/search/";
const CLIENT_ID = randomUUID();

function decode(value = "") {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/");
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
  const match = String(tag).match(new RegExp("\\b" + escaped + "=[\\\"']([^\\\"']*)[\\\"']", "i"));
  return match ? decode(match[1]) : null;
}

function firstImage(chunk, title) {
  const tags = String(chunk).match(/<img\b[^>]*>/gi) || [];
  const normalizedTitle = String(title || "").toLowerCase();
  for (const tag of tags) {
    const src = attr(tag, "src");
    if (!src) continue;
    const alt = String(attr(tag, "alt") || "").toLowerCase();
    if (alt && normalizedTitle && alt === normalizedTitle) return src;
  }
  // Search tile markup can contain promotional or neighboring product images.
  // Without an exact alt-to-title match, the image association is unproven.
  // Preserve the priced product card but leave its image unknown.
  return null;
}

function firstProductUrl(chunk, productId) {
  const links = String(chunk).match(/<a\b[^>]*>/gi) || [];
  for (const tag of links) {
    const href = attr(tag, "href");
    const id = attr(tag, "data-product-id");
    if (href && (!productId || id === productId) && /jarir\.com\/sa-en\//i.test(href)) return href;
  }
  return null;
}

function titlePart(title, pattern) {
  return String(title || "").split(",").map((x) => x.trim()).find((x) => pattern.test(x)) || null;
}

function processorFromTitle(title) {
  const parts = String(title || "").split(",").map((x) => x.trim()).filter(Boolean);
  return [...parts].reverse().find((part) => /\b(?:Apple\s+)?A\d+|Bionic|Snapdragon|Exynos|Dimensity/i.test(part)) || null;
}

function colorFromTitle(title) {
  const parts = String(title || "").split(",").map((x) => x.trim()).filter(Boolean);
  const storageIndex = parts.findIndex((part) => /\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i.test(part));
  const candidate = storageIndex >= 0 ? parts[storageIndex + 1] : null;
  if (!candidate || /^(?:4G|5G|LTE)$/i.test(candidate)) return null;
  return candidate;
}

function normalizeJarirConstructorResult(result) {
  const data = result?.data || {};
  const meta = data?.metadata || {};
  const id = String(data.id || data.sku || "").trim();
  const title = String(meta.name || result?.value || data.description || "").trim();
  const price = Number(data.price ?? meta.price);
  if (!id || !title || !Number.isFinite(price) || price <= 0) return null;

  const renewed = /\bRenewed\b/i.test(title) || /Renewed/i.test(String(meta.productcode_description || ""));
  const storage = meta.tsca || titlePart(title, /\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i);
  const color = meta.colo || meta.cofa || null;
  const network = titlePart(title, /^(?:4G|5G|LTE)$/i);
  const processor = processorFromTitle(title);
  const productPath = String(data.url || "").replace(/^\/+/, "");
  const image = data.image_url || (meta.akeneo_image ? "https://ak-asset.jarir.com/akeneo-prod/asset/" + meta.akeneo_image : null);
  const camera = String(meta.cars || "").trim() || null;
  const rearCamera = camera ? camera.split("/")[0]?.replace(/^Rear:\s*/i, "") || camera : null;
  const frontCamera = camera && /Front:/i.test(camera) ? camera.split("/").slice(1).join("/").replace(/^Front:\s*/i, "") : null;
  const observedAt = new Date().toISOString();

  return {
    provider: "jarir-direct",
    providerMarket: "jarir-sa",
    merchant: "Jarir",
    merchantCountryCode: "SA",
    merchantCountryNameAr: "السعودية",
    sourceUrl: productPath ? "https://www.jarir.com/sa-en/" + productPath : "https://www.jarir.com/sa-en/",
    image,
    title,
    condition: renewed ? "renewed" : "new",
    availability: "unknown",
    canShipToSaudi: true,
    productPrice: price,
    originalProductPrice: price,
    shipping: null,
    importCost: 0,
    tax: null,
    mandatoryFees: 0,
    discount: 0,
    currency: "SAR",
    originalCurrency: "SAR",
    exactMatch: false,
    matchConfidence: 0,
    priceConfidence: "incomplete",
    isLocal: true,
    deliveryDays: null,
    observedAt,
    dataKind: "live",
    seller: { name: "Jarir", type: "retailer" },
    specs: {
      brand: meta.brand || null,
      series: meta.seri || meta.model || null,
      deviceType: meta.model || meta.ptyp || null,
      color,
      storage,
      ram: null,
      processor,
      screenSize: meta.scsz || null,
      screenType: meta.scty || null,
      network,
      operatingSystem: meta.opsy || meta.moos || null,
      rearCamera,
      frontCamera,
      battery: null,
      waterproof: null,
      sim: meta.nsim || null,
      modelNumber: meta.mpn || null,
      barcode: meta.bar_code1 || meta.bar_code2 || null,
    },
    sourceMeta: {
      productId: id,
      itemNumber: meta.item_number || null,
      productType: meta.productcode_description || null,
      parsedFrom: "jarir-constructor-search",
    },
  };
}

export function parseJarirConstructorPayload(payload, limit = 24) {
  const results = Array.isArray(payload?.response?.results) ? payload.response.results : [];
  return results.map(normalizeJarirConstructorResult).filter(Boolean).slice(0, limit);
}

export function parseJarirSearchHtml(html, limit = 24) {
  const source = String(html || "");
  const tileRe = /<div\b[^>]*class=["'][^"']*product-tile__item--spacer[^"']*["'][^>]*>/gi;
  const matches = [...source.matchAll(tileRe)];
  const offers = [];
  const seen = new Set();

  for (let index = 0; index < matches.length && offers.length < limit; index++) {
    const tag = matches[index][0];
    const productId = attr(tag, "data-cnstrc-item-id");
    const title = attr(tag, "data-cnstrc-item-name");
    const rawPrice = attr(tag, "data-cnstrc-item-price");
    const price = Number(String(rawPrice || "").replace(/,/g, ""));

    if (!productId || !title || !Number.isFinite(price) || price <= 0) continue;

    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    const chunk = source.slice(start, end);

    const sourceUrl = firstProductUrl(chunk, productId) || ("https://www.jarir.com/sa-en/catalogsearch/result/?q=" + encodeURIComponent(title));
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    const image = firstImage(chunk, title);
    const addToCart = /Add\s+to\s+Cart/i.test(chunk);
    const renewed = /\bRenewed\b/i.test(title);
    const observedAt = new Date().toISOString();

    offers.push({
      provider: "jarir-direct",
      providerMarket: "jarir-sa",
      merchant: "Jarir",
      merchantCountryCode: "SA",
      merchantCountryNameAr: "السعودية",
      sourceUrl,
      image,
      title,
      condition: renewed ? "renewed" : "new",
      availability: addToCart ? "in_stock" : "unknown",
      canShipToSaudi: true,
      productPrice: price,
      originalProductPrice: price,
      shipping: null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      discount: 0,
      currency: "SAR",
      originalCurrency: "SAR",
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "incomplete",
      isLocal: true,
      deliveryDays: null,
      observedAt,
      dataKind: "live",
      seller: { name: "Jarir", type: "retailer" },
      specs: {
        brand: /\bApple\b/i.test(title) ? "Apple" : null,
        series: String(title).split(",")[0] || null,
        deviceType: String(title).split(",")[0] || null,
        color: colorFromTitle(title),
        storage: titlePart(title, /\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i),
        processor: processorFromTitle(title),
        network: titlePart(title, /^(?:4G|5G|LTE)$/i),
      },
      sourceMeta: {
        productId,
        addToCart,
        parsedFrom: "jarir-search-page",
      },
    });
  }

  // v15.16 E1: Jarir's real category uses nested product links plus
  // ItemList/Product/Offer JSON-LD, not data-cnstrc-* on the outer tile.
  // Accept only independently visible, matching, in-stock SAR retail offers.
  const visible = new Map();
  for (const tag of source.match(/<a\b[^>]*>/gi) || []) {
    if (!/\bproduct-tile__link\b/i.test(attr(tag,"class") || "")) continue;
    const id=String(attr(tag,"data-product-id")||"").trim();
    const href=attr(tag,"href");
    if(!/^\d{5,8}$/.test(id) || !href)continue;
    try {
      const url=new URL(href,"https://www.jarir.com");
      if(url.protocol!=="https:"||url.hostname!=="www.jarir.com"||
        !url.pathname.startsWith("/sa-en/")||
        !url.pathname.endsWith("-"+id+".html")||
        url.username||url.password||url.search||url.hash)continue;
      visible.set(id,url.href);
    }catch{}
  }
  if (!visible.size) return offers;
  const seenSku=new Set(offers.map(o=>String(o.sourceMeta?.productId||"")));
  const scripts=source.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[];
  for(const tag of scripts.slice(0,12)){
    const start=tag.indexOf(">"),end=tag.lastIndexOf("</script>");
    if(start<0||end<=start||end-start>1200000)continue;
    let root;
    try{root=JSON.parse(tag.slice(start+1,end))}catch{continue}
    const nodes=Array.isArray(root)?root:[root];
    for(const top of nodes){
      const graphs=Array.isArray(top?.["@graph"])?top["@graph"]:[];
      for(const list of [top,...graphs]){
        if(!Array.isArray(list?.itemListElement))continue;
        for(const entry of list.itemListElement.slice(0,160)){
          if(offers.length>=limit)break;
          const p=entry?.item;
          if(!p||p["@type"]!=="Product")continue;
          const id=String(p.sku||"").trim();
          if(!visible.has(id)||seenSku.has(id))continue;
          const seller=Array.isArray(p.offers)?p.offers[0]:p.offers;
          if(!seller||String(seller.priceCurrency||"").toUpperCase()!=="SAR"||
            !/^https?:\/\/schema\.org\/InStock$/i.test(String(seller.availability||""))||
            String(seller.seller?.name||"").trim()!=="Jarir Bookstore")continue;
          const rawPrice=String(seller.price??"").trim();
          if(!/^\d+(?:\.\d{1,2})?$/.test(rawPrice))continue;
          const price=Number(rawPrice);
          if(!Number.isFinite(price)||price<=0||price>1e8)continue;
          let sourceUrl;
          try{
            const prod=new URL(String(p.url||"")),offerUrl=new URL(String(seller.url||""));
            sourceUrl=visible.get(id);
            if(prod.href!==sourceUrl||offerUrl.href!==sourceUrl)continue;
          }catch{continue}
          const title=String(p.name||"").replace(/\s+/g," ").trim();
          if(!title||title.length>300)continue;
          let image=null;
          try {
            const rawImage=Array.isArray(p.image)?p.image[0]:p.image;
            const u=new URL(typeof rawImage==="string"?rawImage:rawImage?.url);
            if(u.protocol==="https:"&&!u.username&&!u.password)image=u.href;
          }catch{}
          const renewed=/\bRenewed\b/i.test(title);
          const model=typeof p.model==="string"?p.model:null;
          const brand=typeof p.brand==="string"?p.brand:p.brand?.name||null;
          offers.push({
            provider:"jarir-direct",providerMarket:"jarir-sa",merchant:"Jarir",
            merchantCountryCode:"SA",merchantCountryNameAr:"السعودية",
            sourceUrl,image,title,condition:renewed?"renewed":"new",
            availability:"in_stock",canShipToSaudi:true,
            productPrice:price,originalProductPrice:price,
            shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
            currency:"SAR",originalCurrency:"SAR",exactMatch:false,
            matchConfidence:0,priceConfidence:"incomplete",isLocal:true,
            deliveryDays:null,observedAt:new Date().toISOString(),dataKind:"live",
            seller:{name:"Jarir",type:"retailer"},
            specs:{brand,series:model,deviceType:model,
              color:colorFromTitle(title),
              storage:titlePart(title,/\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i),
              modelNumber:typeof p.mpn==="string"?p.mpn:null},
            sourceMeta:{productId:id,productType:null,
              parsedFrom:"jarir-category-jsonld",
              priceSource:"merchant-category-jsonld",
              availabilitySource:"merchant-category-jsonld"},
          });
          seenSku.add(id);
        }
      }
    }
  }
  return offers;
}

const PS5_CATEGORY_URL="https://www.jarir.com/sa-en/sony-ps5-consoles-4518-x.html";
let cachedPs5Category=null,ps5CategoryInFlight=null,lastPs5CategoryRequest=0;
const ps5ConsoleCategoryQuery=query=>{
  const q=normalizeSearchQuery(query);
  return /^ps5(?: (?:slim|pro|digital|dig|disc|edition|console|bundle|dualsense|with|controller|white|1tb|825gb))*$/.test(q);
};
async function getOfficialPs5Catalog(signal) {
  signal?.throwIfAborted();
  const now=Date.now();
  if(cachedPs5Category&&now-cachedPs5Category.time<45000)
    return cachedPs5Category.offers;
  if(!ps5CategoryInFlight) {
    ps5CategoryInFlight=(async()=>{
      const wait=Math.max(0,1100-(Date.now()-lastPs5CategoryRequest));
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      lastPs5CategoryRequest=Date.now();
      // Shared single-flight transport deliberately has its own deadline.
      // Aborting one shopper cannot kill another shopper's category read.
      const {html}=await fetchHtmlSafe(PS5_CATEGORY_URL,0,{
        signal:AbortSignal.timeout(6500)});
      const offers=parseJarirSearchHtml(html,48)
        .filter(o=>o.sourceMeta?.parsedFrom==="jarir-category-jsonld");
      if(!offers.length)throw Error("jarir-category: no verified in-stock JSON-LD offers");
      cachedPs5Category={time:Date.now(),offers};
      return offers;
    })().finally(()=>{ps5CategoryInFlight=null});
  }
  const result=await ps5CategoryInFlight;
  signal?.throwIfAborted();
  return result;
}

export async function searchViaConstructor(query, limit, requestSignal, onPage) {
  const cap = Math.max(1, Math.min(96, Math.floor(Number(limit) || 24)));
  const pageSize = Math.min(48, cap);
  const signal = requestSignal ? AbortSignal.any([requestSignal,AbortSignal.timeout(6200)]) : AbortSignal.timeout(6200);
  const offers = [];
  const seen = new Set();
  let paginationError = null;

  for (let page = 1; page <= Math.ceil(cap / pageSize) && offers.length < cap; page += 1) {
    signal.throwIfAborted();
    const url = new URL(JARIR_CONSTRUCTOR_BASE + encodeURIComponent(query));
    url.searchParams.set("key", JARIR_CONSTRUCTOR_KEY);
    url.searchParams.set("section", "Products");
    url.searchParams.set("num_results_per_page", String(Math.min(pageSize, cap - offers.length)));
    url.searchParams.set("page", String(page));
    url.searchParams.set("i", CLIENT_ID);
    url.searchParams.set("s", "1");
    url.searchParams.set("c", "cio-fe-web-nawaa");
    url.searchParams.set("origin_referrer", "https://www.jarir.com/sa-en/catalogsearch/result/");

    let payload;
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
        },
        signal,
      });
      if (!response.ok) throw new Error("jarir-constructor: HTTP " + response.status);
      payload = await response.json();
      if (!Array.isArray(payload?.response?.results)) throw new Error("jarir-constructor: Malformed product response");
    } catch (error) {
      if(requestSignal?.aborted) throw requestSignal.reason || error;
      if (!offers.length) throw error;
      paginationError = error?.message || String(error);
      break;
    }

    const rawCount = payload.response.results.length;
    const parsed = parseJarirConstructorPayload(payload, rawCount || pageSize);
    if (rawCount && !parsed.length) {
      if (!offers.length) throw new Error("jarir-constructor: No valid live products returned");
      paginationError = "jarir-constructor: page contained no valid live products";
      break;
    }

    let added = 0;
    const pageOffers = [];
    for (const offer of parsed) {
      const key = offer.sourceUrl || offer.sourceMeta?.productId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      offers.push(offer);
      pageOffers.push(offer);
      added += 1;
      if (offers.length >= cap) break;
    }
    // Publish only normalized, deduplicated page results. Later pages still run
    // with the same cap/deadline and retain the existing partial-error contract.
    requestSignal?.throwIfAborted();
    const hasNextPage = page < Math.ceil(cap / pageSize) && offers.length < cap &&
      rawCount >= Number(url.searchParams.get("num_results_per_page")) && added > 0;
    if (hasNextPage && typeof onPage === "function") await onPage(pageOffers);
    requestSignal?.throwIfAborted();
    if (rawCount < Number(url.searchParams.get("num_results_per_page")) || added === 0) break;
  }

  offers.paginationError = paginationError;
  return offers;
}

async function searchViaHtml(query, limit, signal) {
  const url = "https://www.jarir.com/sa-en/catalogsearch/result/?q=" + encodeURIComponent(query);
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.4; +https://moealf12.github.io/Nawaa/)",
    },
    redirect: "follow",
    signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("jarir-html: HTTP " + response.status);
  const html = await response.text();
  if (html.length > 10000000) throw new Error("jarir-html: response too large");
  return parseJarirSearchHtml(html, limit);
}

export async function refreshJarirPrices(raw, matchingQuery, {resolvePage=resolveProductUrl}={}) {
  const {offers:matches,queryFilter}=filterQueryOffers(matchingQuery,raw);
  const refreshed=new Array(matches.length), failures=new Array(matches.length);
  const pageRefresh={attempted:matches.length,verified:0,failed:0};
  let cursor=0;
  const worker=async()=>{
    while(cursor<matches.length){
      const index=cursor++, offer=matches[index];
      try{
        const page=await resolvePage(offer.sourceUrl);
        if(!sameOfferIdentity(offer,page)) throw new Error('Product page identity mismatch');
        if(queryMatchReasons(matchingQuery,page).length) throw new Error('Product page query mismatch');
        if(page.currency!=='SAR' || page.originalCurrency!=='SAR') throw new Error('Product page currency mismatch');
        if(typeof page.productPrice!=='number' || !Number.isFinite(page.productPrice) || page.productPrice<=0 || typeof page.originalProductPrice!=='number' || page.originalProductPrice!==page.productPrice) throw new Error('Product page price invalid');
        refreshed[index]={...offer,productPrice:page.productPrice,originalProductPrice:page.originalProductPrice,
          availability:page.availability,observedAt:page.observedAt,
          sourceMeta:{...offer.sourceMeta,indexPrice:offer.productPrice,priceSource:'product-page',priceObservedAt:page.observedAt}};
        pageRefresh.verified++;
      }catch(error){
        failures[index]={market:'jarir-sa',error:error?.message || String(error)};
        pageRefresh.failed++;
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(6,matches.length)},worker));
  return {offers:refreshed.filter(Boolean),errors:failures.filter(Boolean),queryFilter,pageRefresh};
}

export async function searchJarir(query, limit = 24, matchingQuery = query, {signal, onOffers, pythonExtract} = {}) {
  const capped=Math.max(1,Math.min(96,Math.floor(Number(limit)||24))), errors=[];
  // Explicit opt-in only. Default shopper search, first-offer latency and all
  // existing Jarir providers remain unchanged without this exact flag.
  // Live opt-in requires a single explicit operator-selected SKU AND query;
  // a bare activation flag never slows general customer searches.
  const canarySku=String(process.env.NAWAA_JARIR_PYTHON_CANARY_SKU||"");
  const canaryQuery=String(process.env.NAWAA_JARIR_PYTHON_CANARY_QUERY||"");
  const pythonGate=process.env.NAWAA_JARIR_PYTHON_PDP==="1" &&
    /^\d{5,8}$/.test(canarySku) &&
    canaryQuery.length>=5 && canaryQuery.length<=128 &&
    normalizeSearchQuery(canaryQuery)===normalizeSearchQuery(matchingQuery);
  const withPython=async result=>{
    if(!pythonGate||!Array.isArray(result?.offers)||!result.offers.length)return result;
    const tested=await enrichJarirOffersWithPython(result.offers,matchingQuery,{
      signal,maxCandidates:1,timeoutMs:5500,extract:pythonExtract,allowedSku:canarySku
    });
    const offers=tested.offers.map(offer=>({
      ...offer,...assessOfferMatch(matchingQuery,offer),category:productCategory(offer)
    })).sort((a,b)=>Number(b.exactMatch)-Number(a.exactMatch)||
      b.matchConfidence-a.matchConfidence||a.productPrice-b.productPrice);
    // Only public SKU and diagnostic classes are logged, never source HTML,
    // prices, headers or user identifiers. Suitable for Render canary checks.
    console.info("NAWAA_JARIR_PYTHON_CANARY "+JSON.stringify({
      sourceId:"jarir-sa",sku:canarySku,
      attempted:tested.diagnostics.attempted,
      accepted:tested.diagnostics.accepted,
      rejected:tested.diagnostics.rejected,
      failed:tested.diagnostics.failed,
      failureClasses:tested.diagnostics.failureClasses
    }));
    // An opt-in request emits the final same-SKU replacement once. Never
    // stream the old index price and then add a second Python-derived offer.
    signal?.throwIfAborted();
    if(typeof onOffers==="function"&&offers.length)await onOffers(offers);
    return {...result,offers,
      diagnostics:{...result.diagnostics,pythonJarirPdp:tested.diagnostics}};
  };
  const classify=(raw)=>{
    const offers=raw.map(offer=>({...offer,...assessOfferMatch(matchingQuery,offer),category:productCategory(offer)}));
    const categories={}; for(const offer of offers) categories[offer.category]=(categories[offer.category]||0)+1;
    offers.sort((a,b)=>Number(b.exactMatch)-Number(a.exactMatch)||b.matchConfidence-a.matchConfidence||a.productPrice-b.productPrice);
    return {offers,categories,exactMatches:offers.filter(o=>o.exactMatch).length};
  };
  try {
    const raw=await searchViaConstructor(query,capped,signal,
      typeof onOffers === "function" && !pythonGate ? page => onOffers(classify(page).offers) : undefined
    );
    const categoryErrors=[],missing=[];
    if(ps5ConsoleCategoryQuery(matchingQuery)){
      try{
        const category=await getOfficialPs5Catalog(signal);
        const ids=new Set(raw.map(o=>String(o.sourceMeta?.productId||"")));
        const urls=new Set(raw.map(o=>o.sourceUrl));
        for(const item of category){
          if(ids.has(String(item.sourceMeta.productId))||urls.has(item.sourceUrl))continue;
          if(!assessOfferMatch(matchingQuery,item).exactMatch)continue;
          missing.push(item);
        }
        if(missing.length&&typeof onOffers==="function"&&!pythonGate)
          await onOffers(classify(missing).offers);
      }catch(error){
        if(signal?.aborted)throw signal.reason||error;
        categoryErrors.push({market:"jarir-sa",error:"catalog recovery: "+String(error?.message||error)});
      }
    }
    // Ranking, not arbitrary source order, decides which offers fit the cap.
    // Exact true category consoles displace irrelevant low-ranked accessories.
    const combined=classify([...raw,...missing]);
    const offers=combined.offers.slice(0,capped);
    const categories=combined.categories,exactMatches=offers.filter(o=>o.exactMatch).length;
    const paginationErrors=raw.paginationError?[{market:"jarir-sa",error:raw.paginationError}]:[];
    return withPython({provider:"jarir-direct",ok:offers.length>0,searchedMarkets:[{id:"jarir-sa",countryCode:"SA",countryNameAr:"السعودية"}],offers,errors:paginationErrors,
      diagnostics:{acquisition:{strategy:missing.length?"search-plus-official-category":"search-results-first",
        discovered:raw.length+missing.length,classified:offers.length,dropped:combined.offers.length-offers.length,
        categoryRecovery:{attempted:ps5ConsoleCategoryQuery(matchingQuery),added:missing.length,
          errors:categoryErrors.map(e=>e.error)},pdpFallback:{attempted:0,verified:0,failed:0}},
        classification:{categories,exactMatches},
        pagination:{partial:Boolean(raw.paginationError),error:raw.paginationError||null}}});
  } catch(error){
    if(signal?.aborted) throw signal.reason || error;
    errors.push({market:"jarir-sa",error:error?.message||String(error)});
  }
  signal?.throwIfAborted();
  if(ps5ConsoleCategoryQuery(matchingQuery)){
    try{
      const category=await getOfficialPs5Catalog(signal);
      const offers=classify(category.filter(o=>assessOfferMatch(matchingQuery,o).exactMatch)).offers.slice(0,capped);
      if(offers.length)return withPython({provider:"jarir-direct",ok:true,
        searchedMarkets:[{id:"jarir-sa",countryCode:"SA",countryNameAr:"السعودية"}],
        offers,errors,diagnostics:{acquisition:{strategy:"verified-category-after-constructor-failure",
          discovered:offers.length,classified:offers.length,dropped:0},
          classification:{exactMatches:offers.length}}});
    }catch(error){
      if(signal?.aborted)throw signal.reason||error;
      errors.push({market:"jarir-sa",error:"catalog recovery: "+String(error?.message||error)});
    }
  }
  try {
    const raw=await searchViaHtml(query,capped,signal), {offers,categories,exactMatches}=classify(raw);
    if(raw.length) return withPython({provider:"jarir-direct",ok:offers.length>0,searchedMarkets:[{id:"jarir-sa",countryCode:"SA",countryNameAr:"السعودية"}],offers,errors,
      diagnostics:{acquisition:{strategy:"html-search-results",discovered:raw.length,classified:offers.length,dropped:0,pdpFallback:{attempted:0,verified:0,failed:0}},classification:{categories,exactMatches}}});
    errors.push({market:"jarir-sa",error:"HTML fallback returned no products"});
  } catch(error){
    if(signal?.aborted) throw signal.reason || error;
    errors.push({market:"jarir-sa",error:error?.message||String(error)});
  }
  return {provider:"jarir-direct",ok:false,searchedMarkets:[{id:"jarir-sa",countryCode:"SA",countryNameAr:"السعودية"}],offers:[],errors};
}
