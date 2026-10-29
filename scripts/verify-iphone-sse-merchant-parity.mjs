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
const q="iPhone";
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
          providers:(payload.providers||[]).filter(p=>String(p.sourceId||"").includes("extra")).map(p=>({returned:p.returnedOffers||0}))});
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
const report={query:q,revision:expected.slice(0,12),snapshots,final: snapshots.at(-1)||null,json:counts(json.offers||[]),readOnly:true};
console.log("NAWAA_IPHONE_SSE_MERCHANT_PARITY "+JSON.stringify(report));
assert.ok(done,"stream must finish");
assert.ok(snapshots.length>0);
