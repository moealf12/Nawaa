import { CheerioCrawler, Configuration } from "crawlee";
import { parseMoney } from "./provider-utils.mjs";
import { resolvePublicHttpsTarget, fetchHtmlSafe } from "./url-resolver.mjs";

const MAX_BODY_BYTES = 8_000_000;

function text(value){ return typeof value === "string" ? value.trim() : value; }
function absolute(base, value){
  if(!value) return null;
  try { return new URL(value, base).href; } catch { return null; }
}
function normalizeAvailability(value=""){
  const v=String(value).toLowerCase();
  if(v.includes("instock")||v.includes("in stock")||v.includes("available")) return "in_stock";
  if(v.includes("outofstock")||v.includes("out of stock")||v.includes("sold out")) return "out_of_stock";
  if(v.includes("preorder")||v.includes("pre-order")) return "preorder";
  return "unknown";
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
function reconcile(candidates, finalUrl){
  const ranked=candidates.filter(Boolean).map(c=>({...c,confidence:score(c)})).sort((a,b)=>b.confidence-a.confidence);
  const best=ranked[0];
  if(!best || !best.title || best.price===null) throw new Error("No structured product evidence found");
  const field=(key)=>first(...ranked.map(c=>c[key]));
  return {
    title:field("title"),
    brand:field("brand"),
    sku:field("sku"),
    gtin:field("gtin"),
    modelNumber:field("modelNumber"),
    image:absolute(finalUrl,field("image")),
    productPrice:field("price"),
    originalProductPrice:field("price"),
    originalCurrency:String(field("currency")||"").toUpperCase()||null,
    availability:field("availability")||"unknown",
    sourceUrl:finalUrl,
    extraction:{
      crawlee:true,
      strategy:best.method,
      attemptedStrategies:[...new Set(ranked.map(c=>c.method))],
      fieldSources:Object.fromEntries(["title","brand","sku","gtin","modelNumber","image","price","currency","availability"].map(k=>[k,ranked.find(c=>c[k]!==null&&c[k]!==undefined&&c[k]!=="")?.method||null])),
      confidence:best.confidence,
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

export async function discoverProductUrlsWithCrawlee(url,{limit=24,timeoutMs=12000,allowedHost=null}={}){
  const { parsed }=await resolvePublicHttpsTarget(url);
  const timeoutSecs=Math.max(1,Math.ceil(timeoutMs/1000));
  const cap=Math.max(1,Math.min(96,Math.floor(Number(limit)||24)));
  const config=new Configuration({persistStorage:false,purgeOnStart:true});
  const discovered=[]; const seen=new Set(); let failure=null;
  const crawler=new CheerioCrawler({maxConcurrency:1,maxRequestsPerCrawl:1,maxRequestRetries:1,navigationTimeoutSecs:timeoutSecs,requestHandlerTimeoutSecs:timeoutSecs+2,
    async requestHandler({$,request}){
      const base=request.loadedUrl||request.url;
      $("a[href]").each((_,el)=>{
        if(discovered.length>=cap) return false;
        const href=$(el).attr("href"); let absoluteUrl;
        try{absoluteUrl=new URL(href,base);}catch{return;}
        if(absoluteUrl.protocol!=="https:") return;
        if(allowedHost && absoluteUrl.hostname!==allowedHost) return;
        if(!/\.html(?:$|[?#])/i.test(absoluteUrl.href)) return;
        const key=absoluteUrl.origin+absoluteUrl.pathname;
        if(seen.has(key)) return; seen.add(key); discovered.push(absoluteUrl.href);
      });
    },
    async failedRequestHandler({request},error){failure=error instanceof Error?error:new Error(String(error||request.errorMessages?.at(-1)||"Crawlee discovery failed"));}
  },config);
  await crawler.run([{url:parsed.href,uniqueKey:parsed.href}]); await crawler.teardown();
  if(!discovered.length && failure) throw failure;
  return discovered;
}
