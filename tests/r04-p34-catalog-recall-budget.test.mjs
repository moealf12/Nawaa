import test from "node:test";
import assert from "node:assert/strict";
import {createBoundedCatalogRecall} from "../server/catalog-recall-budget.mjs";

const wait = () => {
  let resolve, reject;
  const promise = new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
};
const result = (observedAt="2026-11-03T21:09:34.453Z") => ({
  configured:true,offset:0,limit:120,fetchedRows:1,rejectedStale:0,
  offers:[{title:"PS5 Disc Drive",productPrice:599,currency:"SAR",
    sourceUrl:"https://example.org/p/123",observedAt,dataKind:"persisted"}],
});

test("R04-P3.4: a stalled optional PostgreSQL read cannot hold the customer behind the completed providers", async()=>{
  const pending = wait();
  let calls=0;
  const recall=createBoundedCatalogRecall({read:async()=>{calls++;return pending.promise;},
    configured:()=>true,budgetMs:15,maxInFlight:2});
  const began=performance.now();
  const answer=await recall("PS5 disc drive",{offset:0,limit:120});
  assert.deepEqual(answer,{configured:true,offers:[],error:"catalog_recall_budget_exceeded"});
  assert.ok(performance.now()-began<1000,"wait should be bounded, not a 12s database pool stall");
  assert.equal(calls,1);
  pending.resolve(result());
  await new Promise(resolve=>setImmediate(resolve));
});

test("R04-P3.4: two exhausted pool slots fail closed; third request never grows a database read queue", async()=>{
  const stall=wait();
  let reads=0;
  const recall=createBoundedCatalogRecall({read:async()=>{reads++;return stall.promise;},
    configured:()=>true,budgetMs:20,maxInFlight:2});
  const a=recall("سماعة بلوتوث",{offset:0,limit:120});
  const b=recall("PS5 SSD",{offset:0,limit:120});
  const c=await recall("laptop",{offset:0,limit:120});
  assert.equal(c.error,"catalog_recall_busy");
  assert.equal(reads,2);
  const answers=await Promise.all([a,b]);
  assert.ok(answers.every(x=>x.error==="catalog_recall_budget_exceeded"));
  assert.equal(reads,2,"timed-out reads still occupy bounded physical database slots");
  stall.resolve(result());
  await new Promise(resolve=>setImmediate(resolve));
  const retry=await recall("PS5",{offset:0,limit:120});
  assert.equal(retry.offers.length,1);
  assert.equal(reads,3);
});

test("R04-P3.4: late query completion cannot republish a stale price as current customer evidence", async()=>{
  const pending=wait();
  const recall=createBoundedCatalogRecall({read:()=>pending.promise,
    configured:()=>true,budgetMs:15,maxInFlight:1});
  const reply=await recall("PS5",{offset:0,limit:120});
  assert.equal(reply.offers.length,0);
  assert.equal(reply.error,"catalog_recall_budget_exceeded");
  pending.resolve(result("2020-01-01T00:00:00.000Z"));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reply.offers.length,0,"no late mutation of already returned customer payload");
});

test("R04-P3.4: an abort stops waiting without falsely cancelling shared read or publishing late results", async()=>{
  const pending=wait();
  const controller=new AbortController();
  const recall=createBoundedCatalogRecall({read:()=>pending.promise,
    configured:()=>true,budgetMs:400,maxInFlight:1});
  const task=recall("iPhone 17",{offset:0,limit:120},{signal:controller.signal});
  await Promise.resolve();
  controller.abort();
  assert.deepEqual(await task,{configured:true,offers:[],error:"catalog_recall_aborted"});
  assert.equal((await recall("PS5",{offset:0,limit:120})).error,"catalog_recall_busy");
  pending.resolve(result());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await recall("PS5",{offset:0,limit:120})).offers.length,1);
});

test("R04-P3.4: transient reader errors remain observable and do not poison subsequent searches", async()=>{
  let n=0;
  const recall=createBoundedCatalogRecall({read:async()=>{
    if(++n===1)throw Error("simulated pool outage");
    return result();
  },configured:()=>true,budgetMs:100,maxInFlight:1});
  assert.equal((await recall("لابتوب")).error,"catalog_recall_unavailable");
  const next=await recall("laptop",{offset:0,limit:120});
  assert.deepEqual(next,result());
});

test("R04-P3.4: successful evidence is returned unchanged; missing configuration creates no DB work", async()=>{
  const evidence=result();
  const seen=[];
  const recall=createBoundedCatalogRecall({read:async(q,opts)=>{seen.push([q,opts]);return evidence;},
    configured:()=>true,budgetMs:100,maxInFlight:1});
  assert.strictEqual(await recall("Samsung Galaxy",{offset:120,limit:380}),evidence);
  assert.deepEqual(seen,[["Samsung Galaxy",{offset:120,limit:380}]]);
  const unavailable=createBoundedCatalogRecall({read:()=>{throw Error("must not connect");},
    configured:()=>false,budgetMs:100,maxInFlight:1});
  assert.deepEqual(await unavailable("PS5"),{configured:false,offers:[],fetchedRows:0});
});

test("R04-P3.4: invalid budgets and concurrency bounds are rejected at startup",()=>{
  const base={read:async()=>result(),configured:()=>true};
  for(const budgetMs of [0,-1,NaN,Infinity,1.5])
    assert.throws(()=>createBoundedCatalogRecall({...base,budgetMs}),RangeError);
  for(const maxInFlight of [0,-1,Infinity,1.5])
    assert.throws(()=>createBoundedCatalogRecall({...base,maxInFlight}),RangeError);
});
