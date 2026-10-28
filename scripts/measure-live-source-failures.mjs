// Read-only caller: no direct merchant probes, paid services, retries or ingest.
// Live /api/search can perform its normal server-side cache/index maintenance;
// this diagnostic does NOT claim the service itself is free of write side effects.
import {writeFileSync} from "node:fs";
import {attributeSourceFailures,aggregateFailureMatrices} from "../src/source-failure-attribution.mjs";

const origin="https://nawaa-search-api.onrender.com";
const expected=process.env.NAWAA_EXPECT_LIVE_SHA;
const queries=["iPhone 17 256GB","PS5","Samsung Galaxy S25"];
const report={protocol:"LIVE_PRODUCTION_OBSERVED_ERRORS_V1",synthetic:false,
  noDirectMerchantProbes:true,noFirecrawl:true,
  startedAt:new Date().toISOString(),expectedRevision:expected||null,
  actualRevision:null,searches:[],aggregate:null,outcome:"UNKNOWN"};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function fetchJSON(path,timeoutMs=50000){
  const started=Date.now();
  const r=await fetch(origin+path,{method:"GET",headers:{accept:"application/json"},
    redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
  const bytes=await r.arrayBuffer();
  if(bytes.byteLength>3_000_000)throw new Error("BOUNDED_RESPONSE_EXCEEDED");
  const value=JSON.parse(new TextDecoder().decode(bytes));
  return {status:r.status,ms:Date.now()-started,value};
}
const count=o=>Array.isArray(o)?o.length:0;
function valid(o){
  try{return typeof o?.title==="string"&&o.title.length>0&&
    typeof o.merchant==="string"&&o.merchant.length>0&&
    Number(o.productPrice)>0&&Number.isFinite(Number(o.productPrice))&&
    /^[A-Z]{3}$/.test(String(o.currency||""))&&
    new URL(o.sourceUrl).protocol==="https:";}catch{return false;}
}
function visual(r){
  const rows=r.searches.map(s=>"<tr><td>"+esc(s.query)+"</td><td>"+s.returnedOffers+
    "</td><td>"+s.exactMatches+"</td><td>"+s.invalidOffers+"</td><td>"+s.providerEvents+
    "</td><td>"+s.errorEvents+"</td><td>"+s.durationMs+" ms</td></tr>").join("");
  const rowBar=r.searches.map(s=>{
    const pct=Math.max(0,Math.min(100,Math.round(s.exactMatches/Math.max(1,s.returnedOffers)*100)));
    return '<div class="barrow"><span>'+esc(s.query)+'</span><div class="track"><div class="fill" style="width:'+pct+'%"></div></div><strong>'+pct+'%</strong></div>';
  }).join("");
  const matrix=(r.aggregate?.matrix||[]).map(x=>"<tr><td>"+esc(x.sourceId)+"</td><td>"+esc(x.failureClass)+
    "</td><td>"+x.events+"</td></tr>").join("");
  const total=r.searches.reduce((s,x)=>s+x.returnedOffers,0);
  const exact=r.searches.reduce((s,x)=>s+x.exactMatches,0);
  const errors=r.aggregate?.eventCount??0;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; script-src \'none\'">'+
    '<title>NAWAA · LIVE Source Failure Observatory</title><style>'+
    ':root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#090f1d;color:#e6f0ff;font:15px system-ui,Arial;padding:clamp(18px,5vw,55px)}'+
    'main{max-width:1180px;margin:auto}.eyebrow{letter-spacing:.16em;color:#4ee1be;font-size:12px;font-weight:700}h1{font-size:clamp(26px,4vw,48px);margin:10px 0}'+
    'p{color:#9eacc6;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0}'+
    '.card,.panel{border:1px solid #2d3b55;border-radius:16px;background:#131e32;padding:20px}.card b{font-size:34px;display:block}.card small{color:#9eacc6}.panel{margin:16px 0;overflow-x:auto}h2{font-size:19px;margin:0 0 16px}'+
    'table{width:100%;border-collapse:collapse;min-width:640px}th,td{text-align:left;padding:11px;border-bottom:1px solid #304159;font-size:13px}th{color:#93abc6}'+
    '.barrow{display:grid;grid-template-columns:190px 1fr 50px;align-items:center;gap:12px;margin:13px 0}.track{height:13px;border-radius:30px;background:#2a3851;overflow:hidden}'+
    '.fill{height:100%;border-radius:30px;background:linear-gradient(90deg,#09b8c8,#40ddac);animation:grow .8s ease both;transform-origin:left}'+
    '@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}.meta{font:12px ui-monospace,monospace;overflow-wrap:anywhere}'+
    '@media(max-width:630px){.barrow{grid-template-columns:105px 1fr 38px;font-size:12px}}@media(prefers-reduced-motion:reduce){.fill{animation:none}}'+
    '</style></head><body><main><div class="eyebrow">REAL PRODUCTION · EVIDENCE-ONLY</div>'+
    '<h1>Source Failure Observatory</h1><p>No synthetic offers. Read-only client requests to the published site. Provider errors are event counts, not unique failed merchants. A configured source is not a certified price source.</p>'+
    '<div class="grid"><div class="card"><b>'+total+'</b><small>Published offers observed</small></div><div class="card"><b>'+exact+'</b><small>Backend-declared exact matches</small></div>'+
    '<div class="card"><b>'+errors+'</b><small>Source-error events observed</small></div>'+
    '<div class="card"><b>'+(r.aggregate?.unknownEvents??0)+'</b><small>Unclassified events</small></div></div>'+
    '<div class="panel"><h2>Declared exact-match share · live queries</h2>'+rowBar+'</div>'+
    '<div class="panel"><h2>Observed search results</h2><table><thead><tr><th>Query</th><th>Offers</th><th>Exact</th><th>Invalid</th><th>Provider entries</th><th>Error events</th><th>Request</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="panel"><h2>Failure attribution matrix</h2><table><thead><tr><th>Source ID</th><th>Failure class</th><th>Events</th></tr></thead><tbody>'+matrix+'</tbody></table></div>'+
    '<p class="meta">Expected SHA: '+esc(r.expectedRevision)+'<br>Observed SHA: '+esc(r.actualRevision)+
    '<br>Timestamp UTC: '+esc(r.finishedAt||r.startedAt)+'<br>Result: '+esc(r.outcome)+
    '</p><p>Limits: one query sample per intent, no statistically valid P95, no merchant checkout attestation, no Saudi shipping guarantee, no causal attribution beyond recorded failure labels.</p></main></body></html>';
}
try{
  if(!/^[0-9a-f]{40}$/i.test(expected||""))throw Error("EXPECTED_SHA_INVALID");
  const health=await fetchJSON("/health",75000);
  report.healthStatus=health.status;report.actualRevision=health.value?.revision||null;
  if(health.status!==200||health.value?.ok!==true)throw Error("PRODUCTION_HEALTH_FAILED");
  if(report.actualRevision!==expected)throw Error("PRODUCTION_EXACT_SHA_MISMATCH");
  for(const query of queries){
    const res=await fetchJSON("/api/search?q="+encodeURIComponent(query),50000);
    if(res.status!==200)throw Error("SEARCH_HTTP_NOT_200");
    const data=res.value||{};
    if(!Array.isArray(data.offers)||!Array.isArray(data.errors))
      throw Error("SEARCH_CONTRACT_INCOMPLETE");
    const attrs=attributeSourceFailures(data.errors,{query});
    const offers=data.offers, providers=Array.isArray(data.providers)?data.providers:[];
    const measured={
      query,httpStatus:res.status,durationMs:res.ms,
      returnedOffers:offers.length,exactMatches:offers.filter(x=>x.exactMatch===true).length,
      invalidOffers:offers.filter(x=>!valid(x)).length,
      providerEvents:providers.length,sourceProviders:providers.map(x=>({
        sourceId:typeof x?.sourceId==="string"&&/^[a-z0-9:_-]{1,80}$/i.test(x.sourceId)?x.sourceId:"unknown",
        reportedOffers:Math.max(0,Math.floor(Number(x?.returnedOffers)||0))
      })).slice(0,120),
      errorEvents:attrs.eventCount,attribution:attrs,
      completeCoverage:data.coverage?.complete===true,
    };
    report.searches.push(measured);
    console.log("NAWAA_LIVE_SOURCE_MATRIX_QUERY "+JSON.stringify(measured));
  }
  report.aggregate=aggregateFailureMatrices(report.searches.map(x=>x.attribution));
  if(report.aggregate.eventCount!==report.searches.reduce((n,x)=>n+x.errorEvents,0))
    throw Error("ERROR_EVENT_CONSERVATION_FAILURE");
  if(report.aggregate.matrix.reduce((n,x)=>n+x.events,0)!==report.aggregate.eventCount)
    throw Error("ERROR_MATRIX_ACCOUNTING_FAILURE");
  if(report.searches.some(x=>x.invalidOffers>0))throw Error("MALFORMED_PUBLISHED_OFFERS");
  report.outcome="PASS";
}catch(error){
  report.outcome="FAIL";report.failureCode=String(error?.message||error).slice(0,100).replace(/[^a-zA-Z0-9_ -]/g,"_");
  process.exitCode=1;
}finally{
  report.finishedAt=new Date().toISOString();
  writeFileSync("live-source-failure-matrix.json",JSON.stringify(report,null,2)+"\n");
  writeFileSync("live-source-failure-report.html",visual(report));
  console.log("NAWAA_LIVE_SOURCE_MATRIX_FINAL "+JSON.stringify({
    outcome:report.outcome,expectedRevision:report.expectedRevision,actualRevision:report.actualRevision,
    queries:report.searches.length,aggregate:report.aggregate,
    failureCode:report.failureCode||null,finishedAt:report.finishedAt,
  }));
}