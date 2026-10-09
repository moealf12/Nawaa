import test from "node:test";
import assert from "node:assert/strict";
import {chooseExtractionStrategies,runExtractionFallback} from "../server/tooling/source-strategy-router.mjs";
import {createSourceQueue} from "../server/tooling/async-source-queue.mjs";

test("free-first router never chooses Firecrawl without explicit credit opt-in",()=>{
 const capabilities={crawlee:true,jina:true,crawl4ai:true,firecrawl:true};
 const quota={jinaRemaining:10,firecrawlRemaining:300};
 assert.deepEqual(chooseExtractionStrategies({capabilities,quota,env:{JINA_API_KEY:"test"}}),["crawlee","jina","crawl4ai"]);
 assert.deepEqual(chooseExtractionStrategies({capabilities,quota,env:{JINA_API_KEY:"test",NAWAA_ALLOW_CREDIT_EXTRACTOR:"1"}}),["crawlee","jina","crawl4ai","firecrawl"]);
 assert.deepEqual(chooseExtractionStrategies({capabilities,quota:{jinaRemaining:0,firecrawlRemaining:0},env:{JINA_API_KEY:"test",NAWAA_ALLOW_CREDIT_EXTRACTOR:"1"}}),["crawlee","crawl4ai"]);
});
test("router fails over to next strategy without accepting unverified offers",async()=>{
 const called=[];
 const result=await runExtractionFallback({
  strategies:["crawlee","jina","firecrawl"],
  handlers:{
   crawlee:async()=>{called.push("crawlee");return [{title:"junk",productPrice:0}];},
   jina:async()=>{called.push("jina");return [{title:"Valid phone",productPrice:1250,sourceUrl:"https://example.com/phone"}];},
   firecrawl:async()=>{called.push("firecrawl");return [];},
  },
  validate:o=>o.productPrice>0&&o.sourceUrl?.startsWith("https://")?o:null,
 });
 assert.deepEqual(called,["crawlee","jina"]);
 assert.equal(result.strategy,"jina");
 assert.equal(result.offers.length,1);
 assert.deepEqual(result.attempts.map(x=>x.status),["no_valid_offers","success"]);
});
test("router reports errors without silent manufactured search offers",async()=>{
 const r=await runExtractionFallback({strategies:["crawlee","jina"],handlers:{crawlee:async()=>{throw new Error("403");},jina:async()=>[]},validate:x=>x});
 assert.deepEqual(r.offers,[]);assert.equal(r.strategy,null);
 assert.deepEqual(r.attempts.map(x=>x.status),["failed","no_valid_offers"]);
});
test("bounded source queue enforces concurrency and backpressure",async()=>{
 const queue=createSourceQueue({concurrency:1,maxWaiting:1});
 let release,ran=0;
 const first=queue.submit(()=>new Promise(resolve=>{release=()=>resolve(++ran);}));
 await Promise.resolve();await Promise.resolve();
 const second=queue.submit(async()=>++ran);
 await assert.rejects(queue.submit(async()=>3),/queue_overloaded/);
 release();
 assert.equal(await first,1);
 assert.equal(await second,2);
 assert.deepEqual(queue.status(),{active:0,waiting:0,closed:false});
});
test("closing queue rejects queued work but allows in-flight work to settle",async()=>{
 const q=createSourceQueue({concurrency:1,maxWaiting:2});
 let finish;
 const active=q.submit(()=>new Promise(resolve=>{finish=resolve;}));
 await Promise.resolve();await Promise.resolve();
 const queued=q.submit(async()=>2);
 const rejected=assert.rejects(queued,/queue_closed/);
 q.close();await rejected;
 finish(1);assert.equal(await active,1);
 await assert.rejects(q.submit(async()=>3),/queue_closed/);
});
