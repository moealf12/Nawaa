import {load} from "cheerio";
import { parseMoney, normalizeAvailability } from "./provider-utils.mjs";
import {fetchHtmlSafe} from "./url-resolver.mjs";

const MAX_BODY_BYTES = 8_000_000;

function text(value){ return typeof value === "string" ? value.trim() : value; }
function absolute(base, value){
  if(!value) return null;
  try { return new URL(value, base).href; } catch { return null; }
}
function first(...values){ return values.find(v=>v!==null&&v!==undefined&&v!=="") ?? null; }

function flattenJsonLd(node,out=[]){
  if(!node) return out;
  if(Array.isArray(node)){ for(const item of node) flattenJsonLd(item,out); return out; }
  if(typeof node!=="object") return out;
  out.push(node);
  if(node["@graph"]) flattenJsonLd(node["@graph"],out);
  return out;
}
function isProduct(node){
  const t=node?.["@type"];
  return Array.isArray(t) ? t.some(x=>String(x).toLowerCase()==="product") : String(t||"").toLowerCase()==="product";
}
function jsonLdCandidates($){
  const out=[];
  $("script[type='application/ld+json']").each((_,el)=>{
    const raw=$(el).text().trim();
    if(!raw || raw.length>750000) return;
    try {
      for(const node of flattenJsonLd(JSON.parse(raw))){
        if(!isProduct(node)) continue;
        const offers=Array.isArray(node.offers)?node.offers[0]:node.offers;
        const brand=typeof node.brand==="string"?node.brand:node.brand?.name;
        const image=Array.isArray(node.image)?node.image[0]:(typeof node.image==="string"?node.image:node.image?.url);
        out.push({
          method:"json_ld",
          title:text(node.name),
          brand:text(brand),
          sku:first(node.sku,node.productID),
          gtin:first(node.gtin14,node.gtin13,node.gtin12,node.gtin8,node.gtin),
          modelNumber:first(node.mpn,node.model),
          image,
          price:parseMoney(first(offers?.price,offers?.lowPrice)),
          currency:text(first(offers?.priceCurrency,node.priceCurrency)),
          availability:normalizeAvailability(offers?.availability),
          evidence:["json-ld"],
        });
      }
    } catch {}
  });
  return out;
}
function metaCandidate($){
  const get=(selector)=>text($(selector).first().attr("content"));
  const price=parseMoney(first(
    get('meta[property="product:price:amount"]'),
    get('meta[itemprop="price"]'),
    $('[itemprop="price"]').first().attr("content"),
    $('[itemprop="price"]').first().text()
  ));
  return {
    method:"structured_meta",
    title:first(get('meta[property="og:title"]'),text($("title").first().text())),
    brand:first(get('meta[property="product:brand"]'),get('meta[name="brand"]')),
    sku:first(get('meta[property="product:retailer_item_id"]'),$('[itemprop="sku"]').first().attr("content"),text($('[itemprop="sku"]').first().text())),
    gtin:first($('[itemprop="gtin13"]').first().attr("content"),$('[itemprop="gtin"]').first().attr("content")),
    modelNumber:first($('[itemprop="mpn"]').first().attr("content"),$('[itemprop="model"]').first().attr("content")),
    image:first(get('meta[property="og:image"]'),get('meta[name="twitter:image"]')),
    price,
    currency:first(get('meta[property="product:price:currency"]'),get('meta[itemprop="priceCurrency"]'),$('[itemprop="priceCurrency"]').first().attr("content")),
    availability:normalizeAvailability(first(get('meta[property="product:availability"]'),$('[itemprop="availability"]').first().attr("href"),text($('[itemprop="availability"]').first().text()))),
    evidence:["meta","microdata"],
  };
}
function score(candidate){
  let s=0;
  if(candidate.title) s+=0.2;
  if(candidate.price!==null) s+=0.35;
  if(candidate.currency) s+=0.12;
  if(candidate.image) s+=0.1;
  if(candidate.brand) s+=0.07;
  if(candidate.sku||candidate.gtin||candidate.modelNumber) s+=0.1;
  if(candidate.availability!=="unknown") s+=0.06;
  if(candidate.method==="json_ld") s+=0.08;
  return Math.min(1,Number(s.toFixed(3)));
}
export function reconcile(candidates, finalUrl){
  const ranked=candidates.filter(Boolean).map(c=>({...c,confidence:score(c)}))
    .sort((a,b)=>b.confidence-a.confidence);
  // Price and currency are one inseparable, source-owned observation. Never
  // combine two individually valid scalar fields into a fabricated offer.
  const priced=ranked.find(c=>typeof c.title==="string"&&c.title.trim()&&
    Number.isFinite(c.price)&&c.price>0&&
    /^[A-Z]{3}$/.test(String(c.currency||"").trim().toUpperCase()));
  if(!priced)throw new Error("No coherent structured product evidence found");

  // Other extraction strategies may enrich only when they share an explicit
  // product identifier with the chosen priced record, without contradiction.
  // Same PDP or similar title alone cannot establish sellable-item ownership.
  const identityFields=["sku","gtin","modelNumber"];
  // A model/MPN alone may identify a family of sellable variants. An
  // enrichment donor needs a matching merchant SKU or GTIN; hard identifier
  // punctuation is identity-bearing (X+1 and X1 are not interchangeable).
  const canonical=v=>String(v??"").normalize("NFKC").trim().toLowerCase();
  const sameIdentity=other=>{
    let strongMatch=false;
    for(const key of identityFields){
      const own=canonical(priced[key]),alternate=canonical(other[key]);
      if(own&&alternate){
        if(own!==alternate)return false;
        if(key==="sku"||key==="gtin")strongMatch=true;
      }
    }
    return strongMatch;
  };
  const trusted=[priced,...ranked.filter(c=>c!==priced&&sameIdentity(c))];
  const origin=key=>trusted.find(c=>c[key]!==null&&c[key]!==undefined&&c[key]!=="");
  const field=key=>first(...trusted.map(c=>c[key]));
  return {
    title:priced.title,
    brand:field("brand"),
    sku:field("sku"),
    gtin:field("gtin"),
    modelNumber:field("modelNumber"),
    image:absolute(finalUrl,field("image")),
    productPrice:priced.price,
    originalProductPrice:priced.price,
    originalCurrency:String(priced.currency).trim().toUpperCase(),
    availability:field("availability")||"unknown",
    sourceUrl:finalUrl,
    extraction:{
      crawlee:true,
      strategy:priced.method,
      attemptedStrategies:[...new Set(ranked.map(c=>c.method))],
      fieldSources:Object.fromEntries(["title","brand","sku","gtin","modelNumber","image","price","currency","availability"]
        .map(k=>[k,k==="price"||k==="currency"||k==="title"?priced.method:origin(k)?.method||null])),
      confidence:priced.confidence,
    },
  };
}

export async function extractProductWithCrawlee(url,{timeoutMs=12000}={}){
  // Network acquisition is delegated to the same pinned-DNS, redirect-validated,
  // streaming byte-limited transport used by the primary resolver. Crawlee is
  // retained as the structured parsing fallback, not as a second network policy.
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error("Crawlee fallback timed out")),Math.max(1,timeoutMs));
  try {
    const {finalUrl,html}=await fetchHtmlSafe(url,0,{signal:controller.signal});
    const $=(await import("cheerio")).load(html);
    const extracted=reconcile([...jsonLdCandidates($),metaCandidate($)],finalUrl);
    extracted.extraction={...extracted.extraction,crawlee:true,crawler:"cheerio-safe-transport",requestRetries:0};
    return extracted;
  } finally { clearTimeout(timer); }
}

// Extraction fallback and URL discovery must share the same network policy.
// A separate CheerioCrawler socket after preflight DNS resolution could connect
// to a different address or follow a redirect outside the pinned transport.
// This helper is a pure *link enumerator*, not source or offer certification.
export function extractDiscoveredProductUrls(html,finalUrl,{limit=24,allowedHost=null}={}){
  const base=new URL(finalUrl);
  if(allowedHost&&base.hostname!==allowedHost)
    throw new Error("Discovery redirected beyond allowed merchant host");
  if(typeof html!=="string"||Buffer.byteLength(html)>MAX_BODY_BYTES)
    throw new Error("Discovery HTML exceeds body budget");
  const cap=Math.max(1,Math.min(96,Math.floor(Number(limit)||24)));
  const $=load(html);
  const urls=[],seen=new Set();
  $("a[href]").each((_,element)=>{
    if(urls.length>=cap)return false;
    let target;
    try{target=new URL($(element).attr("href"),base);}catch{return;}
    if(target.protocol!=="https:"||target.username||target.password||
       target.port&&target.port!=="443")return;
    if(allowedHost&&target.hostname!==allowedHost)return;
    if(!/\.html$/i.test(target.pathname))return;
    // Strip only known tracking keys from the de-duplication key. Preserve
    // duplicate selectors and parameter ORDER: a source may interpret order.
    const identity=new URL(target.href);
    for(const key of [...identity.searchParams.keys()]){
      if(/^(utm_.+|gclid|fbclid|msclkid|affiliate|aff)$/i.test(key))
        identity.searchParams.delete(key);
    }
    const key=identity.origin+identity.pathname+identity.search;
    if(seen.has(key))return;
    seen.add(key);urls.push(target.href);
  });
  return urls;
}

// Legacy exported name retained for callers; acquisition no longer creates a
// second crawler-owned network transport. Same bounded pinned-DNS/redirect/TLS
// policy as the existing selected-product resolver, with a global deadline.
export async function discoverProductUrlsWithCrawlee(url,{limit=24,timeoutMs=12000,allowedHost=null}={}){
  const controller=new AbortController();
  const duration=Math.max(1,Math.min(12000,Math.floor(Number(timeoutMs)||12000)));
  const clock=setTimeout(()=>controller.abort(new Error("Discovery timed out")),duration);
  try{
    const {finalUrl,html}=await fetchHtmlSafe(url,0,{signal:controller.signal});
    return extractDiscoveredProductUrls(html,finalUrl,{limit,allowedHost});
  }finally{clearTimeout(clock);}
}
