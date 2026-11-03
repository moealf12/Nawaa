import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {once} from "node:events";
import {searchIndexedOffers} from "../server/search-index.mjs";

const recordTime=Date.parse("2026-11-03T09:00:00Z");

test("R04 P2: actual Meilisearch JS offset/limit request recovers fresh evidence beyond 80",async()=>{
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    const body=await new Promise((resolve,reject)=>{
      let text="";req.on("data",chunk=>text+=chunk);
      req.on("end",()=>resolve(text));req.on("error",reject);
    });
    requests.push({method:req.method,path:req.url,payload:JSON.parse(body)});
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({
      hits:[
        {title:"Apple iPhone 17 256GB",sourceUrl:"https://store.example/82",
          merchant:"Retailer",currency:"SAR",productPrice:3000,
          exactMatch:true,matchConfidence:1,
          observedAt:new Date(recordTime-10_000).toISOString()},
        {title:"Apple iPhone 17 128GB",sourceUrl:"https://store.example/83",
          merchant:"Retailer",currency:"SAR",productPrice:2000,
          exactMatch:true,matchConfidence:1,
          observedAt:new Date(recordTime-120_000).toISOString()},
      ],offset:80,limit:420,estimatedTotalHits:900,
      processingTimeMs:1,query:"iPhone 17",
    }));
  });
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const savedHost=process.env.MEILI_HOST,savedKey=process.env.MEILI_MASTER_KEY;
  try{
    process.env.MEILI_HOST="http://127.0.0.1:"+server.address().port;
    process.env.MEILI_MASTER_KEY="fixture-only-not-production";
    const result=await searchIndexedOffers("iPhone 17",{
      offset:80,limit:420,now:recordTime,signal:AbortSignal.timeout(2500),
    });
    assert.equal(requests.length,1);
    assert.equal(requests[0].method,"POST");
    assert.equal(requests[0].path,"/indexes/offers/search");
    assert.deepEqual({offset:requests[0].payload.offset,limit:requests[0].payload.limit},
      {offset:80,limit:420});
    assert.equal(result.fetchedHits,2);
    assert.equal(result.offers.length,1);
    assert.equal(result.rejectedStale,1);
    assert.equal(result.estimatedTotalHits,900);
    assert.equal(result.offers[0].sourceUrl,"https://store.example/82");
    assert.equal(result.offers[0].exactMatch,false);
    assert.equal(result.offers[0].matchConfidence,0);
    assert.equal(result.offers[0].observedAt,new Date(recordTime-10_000).toISOString());
    assert.equal(result.offers[0].dataKind,"indexed");
  }finally{
    if(savedHost===undefined)delete process.env.MEILI_HOST;
    else process.env.MEILI_HOST=savedHost;
    if(savedKey===undefined)delete process.env.MEILI_MASTER_KEY;
    else process.env.MEILI_MASTER_KEY=savedKey;
    await new Promise(resolve=>server.close(resolve));
  }
});
