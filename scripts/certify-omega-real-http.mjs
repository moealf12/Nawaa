// Real localhost HTTP/SSE: v16.1 isolated canonical read guard.
// Merchant identity from official Jarir fixture, price transitions SYNTHETIC.
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {MeiliSearch} from "meilisearch";

assert.equal(process.env.NODE_ENV,"test");
assert.equal(process.env.NAWAA_CANONICAL_INDEX_TEST,"1");
assert.equal(process.env.MEILI_HOST,"http://127.0.0.1:7700");
assert.equal(process.env.MEILI_INDEX,"nawaa_ci_omega");
assert.ok(process.env.NAWAA_TEST_DATABASE_URL);
const saved=JSON.parse(await readFile(".omega-canonical-stage.json","utf8"));
const direct=new MeiliSearch({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
const index=direct.index(process.env.MEILI_INDEX);
const existing=await index.getDocument(saved.id);
assert.equal(existing.productPrice,3299);
// Deliberately submit an out-of-order old observation AFTER latest T3.
const stale={...existing,observedAt:saved.t1,
  productPrice:3049,availability:"unknown",canonicalRevision:0,
  canonicalFingerprint:"artificial_delayed_remote_task"};
const task=await index.addDocuments([stale]);
const settled=await index.waitForTask(task.taskUid);
assert.equal(settled.status,"succeeded");
assert.equal((await index.getDocument(saved.id)).productPrice,3049);
process.env.PORT="17777";
process.env.SEARCH_STREAM_DEADLINE_MS="1400";
process.env.SEARCH_REQUEST_DEADLINE_MS="1400";
process.env.NAWAA_CURSOR_SECRET="test-only-cursor-signing-key-omega";
// Prove indexed read consistency in isolation: real merchant observations can
// legitimately be newer than simulated canonical price transitions.
process.env.NAWAA_OMEGA_INDEX_ONLY="1";
const nativeFetch=globalThis.fetch;
let blockedExternal=0;
globalThis.fetch=async(input,options={})=>{
  const url=String(input?.url||input);
  if(url.startsWith("http://127.0.0.1:7700"))
    return nativeFetch(input,options);
  if(url.startsWith("https://search.unbxd.io/"))
    return Response.json({response:{products:[],numberOfProducts:0}});
  if(url.startsWith("https://ac.cnstrc.com/"))
    return Response.json({response:{results:[]}});
  blockedExternal++;
  return new Response("",{status:200,headers:{"content-type":"text/html"}});
};
const get=(port,path)=>new Promise((resolve,reject)=>{
  const req=http.get({host:"127.0.0.1",port,path},res=>{
    let body="";
    res.on("data",v=>body+=v);
    res.on("end",()=>resolve({status:res.statusCode,body}));
  });
  req.on("error",reject);
});
const snapshots=body=>body.split(/\r?\n\r?\n/).filter(block=>block.startsWith("event: snapshot"))
  .map(block=>JSON.parse(block.match(/^data: (.*)$/m)?.[1]||"{}"));
const oldListen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){
  this.once("listening",async()=>{
    try{
      const port=this.address().port,query=encodeURIComponent("PlayStation 5");
      const stream=await get(port,"/api/search/stream?q="+query);
      assert.equal(stream.status,200);
      const received=snapshots(stream.body);
      assert.ok(received.length>0,"actual SSE snapshots required");
      const streamed=received.flatMap(s=>s.offers||[]);
      const canonical=streamed.filter(o=>o.sourceMeta?.productId==="677770");
      console.log("OMEGA_HTTP_SEARCH_DEBUG "+JSON.stringify({snapshotCount:received.length,offers:streamed.length,firstOffers:streamed.slice(0,4).map(o=>({title:o.title,sku:o.sku,sourceMeta:o.sourceMeta,price:o.productPrice})),lastCoverage:received.at(-1)?.coverage}));
      assert.ok(canonical.length>0,"current Jarir SKU should survive actual SSE");
      assert.ok(canonical.every(o=>o.productPrice===3299&&o.availability==="out_of_stock"));
      assert.ok(!streamed.some(o=>o.sourceMeta?.productId==="677770"&&o.productPrice===3049),
        "stale raw index price reached customer SSE");
      const json=await get(port,"/api/search?q="+query);
      assert.equal(json.status,200);
      const body=JSON.parse(json.body);
      const matched=(body.offers||[]).filter(o=>o.sourceMeta?.productId==="677770");
      assert.ok(matched.length>0,"actual JSON canonical candidate is missing");
      assert.ok(matched.every(o=>o.productPrice===3299&&o.availability==="out_of_stock"));
      assert.ok(!body.offers.some(o=>o.sourceMeta?.productId==="677770"&&o.productPrice===3049));
      console.log("REAL_OMEGA_HTTP "+JSON.stringify({
        sseStatus:stream.status,jsonStatus:json.status,snapshots:received.length,
        sseCanonicalOccurrences:canonical.length,jsonCanonicalOccurrences:matched.length,
        rawIndexedPrice:3049,acceptedCanonicalPrice:3299,
        staleSSERejected:true,staleJSONRejected:true,
        blockedExternal,syntheticPrices:true
      }));
    }catch(e){
      console.error("OMEGA_HTTP_FAILED",e?.stack||String(e));
      process.exitCode=1;
    }finally{
      this.close(()=>process.exit(process.exitCode||0));
      setTimeout(()=>process.exit(process.exitCode||0),2000).unref();
    }
  });
  return oldListen.apply(this,args);
};
await import("../server/server.mjs");
