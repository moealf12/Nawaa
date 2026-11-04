#!/usr/bin/env node
// Direct first-party public catalog-path differential. Experimental only.
// User reports merchant approval. No login, private credentials, proxies, retries,
// inventory assertions, product publication, or raw response-body artifacts.
import {writeFile} from "node:fs/promises";
import {parseNoonCatalogPayload} from "../server/providers/noon.mjs";
import {noonSaudiProductIdentity} from "../src/noon-sa-catalog.mjs";

const query="iPhone 17 256GB";
const timeoutMs=10000;
const maxBytes=2_000_000;
const cases=[
  {id:"existing_catalog_v3",path:"/_vs/nc/mp-customer-catalog-api/api/v3/u/search/"},
  {id:"alternate_public_catalog",path:"/_svc/catalog/api/search"},
];
const report={
  schema:"nawaa.noon-sa.first-party-paths.v1",
  testedHeadSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  observedAt:new Date().toISOString(),
  query,
  noProxy:true,
  noRetries:true,
  customerPublished:false,
  source:"noon-sa",
  cases:[],
};
function classify(err){
  if(err?.name==="TimeoutError"||err?.name==="AbortError")return "TIMEOUT";
  const code=String(err?.cause?.code||err?.code||"");
  if(["ENOTFOUND","EAI_AGAIN"].includes(code))return "DNS_FAILURE";
  if(["ECONNRESET","ECONNREFUSED","ETIMEDOUT"].includes(code))return "NETWORK_"+code;
  return "TRANSPORT_ERROR";
}
async function readJson(response){
  const type=response.headers.get("content-type")||"";
  if(!/(?:application\/json|\+json)/i.test(type))return {state:"NOT_JSON"};
  const declared=response.headers.get("content-length");
  if(declared!==null && Number.isFinite(Number(declared)) && Number(declared)>maxBytes)
    return {state:"RESPONSE_TOO_LARGE"};
  if(!response.body)return {state:"EMPTY_BODY"};
  const reader=response.body.getReader();
  let bytes=0;const data=[];
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes)return {state:"RESPONSE_TOO_LARGE"};
      data.push(Buffer.from(value));
    }
  }finally{reader.releaseLock()}
  let obj;
  try{obj=JSON.parse(Buffer.concat(data).toString("utf8"))}catch{return {state:"INVALID_JSON"}}
  // Even the official storefront's own public endpoint is not a PDP or checkout proof.
  const offers=parseNoonCatalogPayload(obj,12);
  const exact=offers.filter(o=>noonSaudiProductIdentity(o.sourceUrl)&&
    o.currency==="SAR"&&Number.isFinite(o.productPrice)&&o.productPrice>0);
  return {
    state:exact.length?"PUBLIC_CATALOG_PRICE_OBSERVED":"NO_VALID_SAUDI_CATALOG_PRICE",
    offerCount:exact.length,
    hitCount:Array.isArray(obj?.hits)?obj.hits.length:0,
    payloadType:typeof obj?.type==="string"?obj.type.slice(0,40):null,
    customerPublishable:false,
    independentPdpVerified:false,
  };
}
for(const spec of cases){
  const url=new URL("https://www.noon.com"+spec.path);
  url.searchParams.set("q",query);
  url.searchParams.set("limit","12");
  if(spec.id==="existing_catalog_v3"){
    url.searchParams.set("sort[by]","popularity");
    url.searchParams.set("sort[dir]","desc");
  }
  const start=performance.now();
  const record={id:spec.id,publicCatalogPath:spec.path};
  try{
    const headers={
      accept:"application/json",
      "accept-language":"en-SA,en;q=0.9",
      "user-agent":"NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)",
      "x-platform":"web",
      "x-locale":"en-sa",
      referer:"https://www.noon.com/saudi-en/search/?q="+encodeURIComponent(query),
    };
    const response=await fetch(url,{method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
    record.status=response.status;
    record.state=response.status===403?"HTTP_403_ACCESS_DENIED":
      response.status===429?"HTTP_429_RATE_LIMITED":
      response.status===401?"HTTP_401_AUTH_REQUIRED":
      response.status===404?"HTTP_404_NOT_FOUND":
      !response.ok?"HTTP_"+response.status:
      "HTTP_OK";
    if(response.ok)Object.assign(record,await readJson(response));
    if(response.body && !response.body.locked)await response.body.cancel().catch(()=>{});
  }catch(err){
    record.state=classify(err);
  }finally{
    record.elapsedMs=Math.round(performance.now()-start);
    report.cases.push(record);
  }
}
report.conclusion=report.cases.some(c=>c.state==="PUBLIC_CATALOG_PRICE_OBSERVED")
  ?"LIVE_SEARCH_CARD_EVIDENCE_ONLY":"NO_VALID_SAUDI_OFFER_EVIDENCE";
await writeFile("noon-sa-first-party-paths.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(report.conclusion!=="LIVE_SEARCH_CARD_EVIDENCE_ONLY")process.exitCode=1;
