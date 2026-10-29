// Single public read-only iPhone query; compare JSON and every SSE snapshot.
// Do not publish visitor identifiers, product prices or raw merchant payloads.
import assert from "node:assert/strict";
const origin="https://nawaa-search-api.onrender.com";
const expected=process.env.NAWAA_EXPECT_LIVE_SHA;
assert.match(expected||"",/^[a-f0-9]{40}$/);
const health=await fetch(origin+"/health",{signal:AbortSignal.timeout(70000)});
assert.equal(health.status,200);
const info=await health.json();
assert.equal(info.revision,expected);
async function probe(q){
const sourceFailureClass=err=>{
  const m=String(err?.error||"");
  if(/provider_deadline_exceeded:extra-unbxd/.test(m))return "PROVIDER_DEADLINE";
  const http=/HTTP\\s+([45][0-9]{2})/.exec(m);
  if(http)return "HTTP_"+http[1];
  if(/timeout|aborted|abort/i.test(m))return "TIMEOUT_OR_ABORT";
  if(/fetch failed|network/i.test(m))return "NETWORK_FAILURE";
  if(/Malformed product response/i.test(m))return "INVALID_RESPONSE";
  return m ? "OTHER_SOURCE_FAILURE" : "UNKNOWN";
};
const extraFailures=data=>(Array.isArray(data?.errors)?data.errors:[])
  .filter(e=>String(e?.sourceId||e?.provider||"").includes("extra"))
  .map(sourceFailureClass);
const counts=offers=>({
  all:offers.length,
  extra:offers.filter(x=>x.merchant==="eXtra").length,
  jarir:offers.filter(x=>x.merchant==="Jarir").length,
  distinctMerchants:[...new Set(offers.map(x=>x.merchant).filter(Boolean))].length
});
const endpoint="/api/search/stream?q="+encodeURIComponent(q);
const response=await fetch(origin+endpoint,{headers:{accept:"text/event-stream"},signal:AbortSignal.timeout(55000)});
assert.equal(response.status,200);
let buffer="",eventType="",dataLines=[],snapshots=[],done=false;
for await(const chunk of response.body){
  buffer+=new TextDecoder().decode(chunk);
  if(buffer.length>8_000_000)throw Error("SSE_RESPONSE_TOO_LARGE");
  let pos;
  while((pos=buffer.indexOf("\n"))>=0){
    const line=buffer.slice(0,pos).replace(/\r$/,"");buffer=buffer.slice(pos+1);
    if(line===""){
      if(eventType==="snapshot"&&dataLines.length){
        const payload=JSON.parse(dataLines.join("\n"));
        const offers=Array.isArray(payload.offers)?payload.offers:[];
        snapshots.push({...counts(offers),cacheMode:payload.cache?.mode||null,
          providers:(payload.providers||[]).filter(p=>String(p.sourceId||"").includes("extra")).map(p=>({returned:p.returnedOffers||0})),extraFailures:extraFailures(payload)});
        if(snapshots.length>50)throw Error("SSE_TOO_MANY_SNAPSHOTS");
      }
      if(eventType==="done")done=true;
      eventType="";dataLines=[];if(done)break;
    }else if(line.startsWith("event: "))eventType=line.slice(7);
    else if(line.startsWith("data: "))dataLines.push(line.slice(6));
  }
  if(done)break;
}
const jsonRes=await fetch(origin+"/api/search?q="+encodeURIComponent(q),{signal:AbortSignal.timeout(45000)});
assert.equal(jsonRes.status,200);
const json=await jsonRes.json();
const report={query:q,revision:expected.slice(0,12),snapshots,final: snapshots.at(-1)||null,json:counts(json.offers||[]),jsonExtraFailures:extraFailures(json),readOnly:true};
console.log("NAWAA_IPHONE_SSE_MERCHANT_PARITY "+JSON.stringify(report));
assert.ok(done,"stream must finish");
assert.ok(snapshots.length>0);
  // Customer-facing SSE and conventional JSON should both include a real,
  // source-owned merchant offer; zero is a failed acceptance, never a PASS.
  assert.ok(report.final?.extra>0,"SSE_EXTRA_SOURCE_MISSING_FOR_"+q);
  assert.ok(report.json?.extra>0,"JSON_EXTRA_SOURCE_MISSING_FOR_"+q);
  return report;
}
for(const q of ["iPhone","PS5"])await probe(q);
