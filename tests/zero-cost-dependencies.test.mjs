import test from "node:test";
import assert from "node:assert/strict";
import {validateCandidateOffer} from "../server/tooling/offer-schema.mjs";
import {createMerchantQueue} from "../server/tooling/merchant-queue.mjs";
import {backgroundBossConfigured,createBackgroundBoss} from "../server/tooling/background-boss.mjs";

test("Zod validates realistic HTTPS product offers without inventing data",()=>{
 const candidate={title:"Dell XPS 13 Laptop",sourceUrl:"https://shop.example.com/p/123",productPrice:3500,currency:"SAR",image:"https://shop.example.com/image.png"};
 const r=validateCandidateOffer(candidate);
 assert.equal(r.valid,true);assert.equal(r.offer.productPrice,3500);
 for(const patch of [{productPrice:0},{currency:"SA"},{sourceUrl:"http://shop.example.com/p"},{title:"x"},{image:"javascript:alert(1)"}])
  assert.equal(validateCandidateOffer({...candidate,...patch}).valid,false,JSON.stringify(patch));
});
test("p-queue bounds merchant concurrency and rejects overloaded requests",async()=>{
 const queue=createMerchantQueue({concurrency:1,maxWaiting:1,interval:100,intervalCap:5});
 let resolveOne;const first=queue.submit(()=>new Promise(resolve=>{resolveOne=resolve}));
 await new Promise(resolve=>setImmediate(resolve));
 const second=queue.submit(async()=>2);
 await assert.rejects(queue.submit(async()=>3),/overloaded/);
 assert.equal(queue.status().active,1);
 resolveOne(1);assert.equal(await first,1);assert.equal(await second,2);
 await queue.drain();assert.equal(queue.status().active,0);
 queue.close();await assert.rejects(queue.submit(async()=>4),/closed/);
});
test("pg-boss cannot initialize without explicit background-worker opt-in",()=>{
 assert.equal(backgroundBossConfigured({DATABASE_URL:"postgres://localhost/na",NAWAA_ENABLE_BACKGROUND_JOBS:"0"}),false);
 assert.equal(backgroundBossConfigured({NAWAA_ENABLE_BACKGROUND_JOBS:"1"}),false);
 assert.equal(backgroundBossConfigured({DATABASE_URL:"postgres://localhost/na",NAWAA_ENABLE_BACKGROUND_JOBS:"1"}),true);
 assert.throws(()=>createBackgroundBoss({env:{DATABASE_URL:"postgres://localhost/na"}}),/disabled/);
 // No real Postgres connections are made during tests.
 const boss=createBackgroundBoss({env:{DATABASE_URL:"postgres://localhost/na",NAWAA_ENABLE_BACKGROUND_JOBS:"1",DATABASE_SSL:"false"}});
 assert.ok(boss);assert.equal(typeof boss.start,"function");assert.equal(typeof boss.stop,"function");
});
