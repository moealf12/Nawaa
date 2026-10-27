// NAWAA E.1.5: deliberately bounded, source-owned sitemap URL discovery.
// Diagnostic-only: NEVER writes prices, offers, inventory, DB or Meilisearch.
import { load } from "cheerio";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE="decathlon-sa";
const ROOT="https://decathlon.com.sa/sitemap.xml";
const HOST="decathlon.com.sa";
const MAX_XML_BYTES=512_000;
const MAX_ENTRIES=300;
const MAX_FETCHES=2;

const empty=()=>({kind:"INVALID",productUrls:[],childSitemaps:[],complete:false,entryCount:0});
function owned(url,kind){
  try{
    const u=new URL(url);
    if(u.protocol!=="https:"||u.username||u.password||
       u.port&&u.port!=="443"||u.hostname!==HOST||u.hash)return null;
    if(kind==="product"){
      if(u.search || !/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname))return null;
    }else if(kind==="sitemap"){
      if(!/^\/sitemap_products_\d+\.xml$/i.test(u.pathname))return null;
      if([...u.searchParams.keys()].some(k=>!["from","to"].includes(k)))return null;
      if([...u.searchParams.values()].some(v=>!/^[a-z0-9_-]{1,60}$/i.test(v)))return null;
    }
    return u.href;
  }catch{return null;}
}

export function parseCatalogSitemap(xml,sourceUrl=ROOT){
  if(typeof xml!=="string"||!xml.trim()||
     Buffer.byteLength(xml,"utf8")>MAX_XML_BYTES ||
     /<!(?:DOCTYPE|ENTITY)\b/i.test(xml))return empty();
  try{
    const $=load(xml,{xmlMode:true,decodeEntities:true});
    const urls=$("urlset > url");
    const indexes=$("sitemapindex > sitemap");
    const hasUrlset=$("urlset").length===1 && $("sitemapindex").length===0;
    const hasIndex=$("sitemapindex").length===1 && $("urlset").length===0;
    if(!hasUrlset && !hasIndex)return empty();
    const nodes=hasUrlset?urls:indexes;
    const entryCount=nodes.length;
    const seen=new Set(),filtered=[];
    nodes.slice(0,MAX_ENTRIES).each((_,element)=>{
      const raw=$(element).children("loc").first().text().trim();
      if(!raw)return;
      let url;
      try{url=new URL(raw,sourceUrl).href;}catch{return;}
      const valid=owned(url,hasUrlset?"product":"sitemap");
      if(valid&&!seen.has(valid)){seen.add(valid);filtered.push(valid);}
    });
    return {
      kind:hasUrlset?"urlset":"sitemapindex",
      productUrls:hasUrlset?filtered:[],
      childSitemaps:hasIndex?filtered:[],
      // If there are more entries than the safe parse budget, missing URL
      // signals are never permitted. A sampled index is also incomplete.
      complete:entryCount<=MAX_ENTRIES,
      entryCount,
    };
  }catch{return empty();}
}

export function diffCatalogSitemapObservations(previous,current){
  const before=new Set(previous?.productUrls||[]);
  const after=new Set(current?.productUrls||[]);
  // No sitemap-only diff is evidence of an expired price or inventory state.
  const complete=previous?.complete===true&&current?.complete===true;
  return {
    newCandidates:[...after].filter(u=>!before.has(u)),
    notObservedInLatest:complete?[...before].filter(u=>!after.has(u)):[],
    missingUrlMeaning:complete?"NOT_OBSERVED_IN_LATEST_SITEMAP":"INSUFFICIENT_COVERAGE",
    inventoryChanges:[],
    priceUpdates:[],
    allowTrustedOfferPromotion:false,
  };
}

async function readBoundedXml(response){
  const advertised=Number(response.headers.get("content-length"));
  if(Number.isFinite(advertised)&&advertised>MAX_XML_BYTES)
    throw Error("XML_RESPONSE_TOO_LARGE");
  const contentType=response.headers.get("content-type")||"";
  if(!/application\/xml|text\/xml|\+xml/i.test(contentType))
    throw Error("NOT_XML_CONTENT");
  const reader=response.body?.getReader();
  if(!reader)throw Error("EMPTY_SOURCE_BODY");
  const pieces=[];let bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_XML_BYTES)throw Error("XML_RESPONSE_TOO_LARGE");
      pieces.push(value);
    }
  }finally{reader.releaseLock();}
  const joined=new Uint8Array(bytes);let at=0;
  for(const piece of pieces){joined.set(piece,at);at+=piece.byteLength;}
  return new TextDecoder("utf-8",{fatal:true}).decode(joined);
}

function result(status,{productCandidates=0,complete=false,requests=0,
  candidatePageKind=null}={}){
  return {
    sourceId:SOURCE,status,requests,productCandidates,complete,
    candidatePageKind,offerPricesCertified:0,inventoryVerified:false,
    allowTrustedOfferPromotion:false,canInferOutOfStock:false,
    note:"Sitemap URLs are discovery hints only; no live SKU, price, availability or shipping evidence.",
  };
}

export async function auditDecathlonSitemap({
  fetchPage=fetch,signal,
}={}){
  const deadline=AbortSignal.timeout(6500);
  const combined=signal?AbortSignal.any([signal,deadline]):deadline;
  let requests=0;
  async function acquire(url){
    combined.throwIfAborted();
    if(requests>=MAX_FETCHES)throw Error("SITEMAP_FETCH_BUDGET_EXCEEDED");
    // Only exact root and single child URLs authorized by the parser are used.
    if(url!==ROOT && !owned(url,"sitemap"))throw Error("UNTRUSTED_SITEMAP_URL");
    requests++;
    const response=await fetchPage(url,{
      headers:{accept:"application/xml,text/xml;q=0.9"},
      redirect:"manual",signal:combined,
    });
    // A 3xx never causes a blind cross-domain hop. 403/429 are terminal.
    if(response.status===429)throw Object.assign(Error("RATE_LIMITED"),{failureClass:"SOURCE_RATE_LIMITED"});
    if(response.status===403)throw Object.assign(Error("DENIED"),{failureClass:"SOURCE_DENIED"});
    if(response.status!==200)throw Error("HTTP_UNAVAILABLE");
    return parseCatalogSitemap(await readBoundedXml(response),url);
  }
  try{
    const root=await acquire(ROOT);
    if(root.kind==="INVALID")return result("XML_INVALID",{requests});
    if(root.kind==="urlset")return result(root.productUrls.length?"CANDIDATES_OBSERVED":"NO_CANDIDATES_OBSERVED",{
      requests,productCandidates:root.productUrls.length,complete:root.complete,candidatePageKind:"urlset",
    });
    if(root.childSitemaps.length===0)
      return result("NO_PRODUCT_SITEMAP_OBSERVED",{requests,complete:false,candidatePageKind:"sitemapindex"});
    const child=await acquire(root.childSitemaps[0]);
    if(child.kind!=="urlset")return result("XML_INVALID",{requests});
    const complete=root.complete && root.entryCount===1 &&
      root.childSitemaps.length===1 && child.complete;
    const status=complete
      ? child.productUrls.length?"CANDIDATES_OBSERVED":"NO_CANDIDATES_OBSERVED"
      : "PARTIAL_SAMPLE";
    return result(status,{
      requests,productCandidates:child.productUrls.length,
      complete,candidatePageKind:"sitemapindex",
    });
  }catch(error){
    return result(error?.failureClass||"SOURCE_UNAVAILABLE",{requests});
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // Execute once in CI. Output only aggregate evidence; do not store a URL
  // catalog or mutate canonical NAWAA records.
  const report=await auditDecathlonSitemap();
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
}
