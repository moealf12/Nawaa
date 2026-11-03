import test from "node:test";
import assert from "node:assert/strict";
import {createSearchWavePages,SEARCH_WAVE_TTL_MS} from "../server/search-wave-pages.mjs";

const offers=n=>Array.from({length:n},(_,i)=>({
  title:`PS5 Retail Product ${i}`,merchant:i%2?"Jarir":"eXtra",
  provider:i%2?"jarir-direct":"extra-unbxd",providerMarket:"sa",
  productPrice:100+i,currency:"SAR",sourceUrl:`https://example.org/p/${i}`,
  matchConfidence:i%3===0?1:0.12,exactMatch:i%3===0,
  specs:{modelNumber:`SKU-${i}`},
}));
const meta={coverage:{complete:false,partial:true,sourceFailures:{errorsReported:1},
  deadlineExceeded:true,providersPending:1},errors:[{error:"source_timeout"}],
  providers:[{sourceId:"jarir-direct"}],providersConfigured:["jarir-direct"]};

test("R04: 351 offers in 120-offer wave are replayed exactly once in signed order",()=>{
  let time=1000;
  const pages=createSearchWavePages({now:()=>time});
  const all=offers(351);
  const initial=all.slice(0,120);
  const first=pages.remember("ps5",0,all,120,meta);
  assert.equal(first.unavailable,false);
  assert.ok(first.cursor);
  const second=pages.page("ps5",first.cursor);
  assert.equal(second.offers.length,120);
  assert.equal(second.coverage.availableOffers,351);
  assert.equal(second.coverage.wavePage.offset,120);
  assert.equal(second.coverage.wavePage.remaining,111);
  assert.equal(second.coverage.partial,true);
  assert.equal(second.coverage.sourceFailures.errorsReported,1);
  assert.equal(second.coverage.truncated,true);
  const third=pages.page("ps5",second.overflowCursor);
  assert.equal(third.offers.length,111);
  assert.equal(third.overflowCursor,null);
  assert.equal(third.coverage.truncated,false);
  assert.deepEqual([...initial,...second.offers,...third.offers],all);
  assert.equal(new Set([...initial,...second.offers,...third.offers].map(o=>o.sourceUrl)).size,351);
  assert.notEqual(second.offers[0],all[120],"snapshot pages must not share mutable offer objects");
  second.offers[0].productPrice=0;
  assert.equal(pages.page("ps5",first.cursor).offers[0].productPrice,220);
});

test("R04: token tampering, query mismatch, offset forgery and depth token confusion rejected",()=>{
  const pages=createSearchWavePages();
  const token=pages.remember("iPhone 17",1,offers(200),120,meta).cursor;
  assert.throws(()=>pages.page("PS5",token),/invalid_wave_cursor/);
  assert.throws(()=>pages.page("iPhone 17",token+"X"),/invalid_wave_cursor/);
  assert.throws(()=>pages.page("iPhone 17","not.a.token"),/invalid_wave_cursor/);
  const [body,signature]=token.split(".");
  const data=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
  data.o=121;
  const forged=Buffer.from(JSON.stringify(data)).toString("base64url")+"."+signature;
  assert.throws(()=>pages.page("iPhone 17",forged),/invalid_wave_cursor/);
  pages.clear();
  assert.throws(()=>pages.page("iPhone 17",token),/wave_snapshot_unavailable/);
});

test("R04: 2-minute expiry is explicit, not a false empty inventory claim",()=>{
  let t=1000;
  const pages=createSearchWavePages({now:()=>t});
  const token=pages.remember("HP laptop",0,offers(121),120,meta).cursor;
  t+=SEARCH_WAVE_TTL_MS-1;
  assert.equal(pages.page("HP laptop",token).offers.length,1);
  t+=1;
  assert.throws(()=>pages.page("HP laptop",token),/expired_wave_cursor/);
  assert.equal(pages.stats().entries,0);
});

test("R04: bounded memory evicts old snapshots with explicit unavailable semantics",()=>{
  const pages=createSearchWavePages({maxEntries:1,maxBytes:2_000_000});
  const first=pages.remember("HP laptop",0,offers(121),120,meta).cursor;
  const second=pages.remember("PS5",0,offers(140),120,meta).cursor;
  assert.ok(second);
  assert.equal(pages.stats().entries,1);
  assert.throws(()=>pages.page("HP laptop",first),/wave_snapshot_unavailable/);
  assert.equal(pages.page("PS5",second).offers.length,20);
});

test("R04: oversized wave fails closed but does not suppress the first page",()=>{
  const pages=createSearchWavePages({maxSnapshotBytes:100});
  const response=pages.remember("PS5",2,offers(3000),300,meta);
  assert.equal(response.cursor,null);
  assert.equal(response.unavailable,true);
  assert.equal(pages.stats().bytes,0);
  assert.equal(pages.remember("PS5",0,offers(100),120,meta).cursor,null);
  assert.equal(pages.remember("PS5",0,offers(100),120,meta).unavailable,false);
});

test("R04: depth-1 and depth-2 waves keep their own exact contents",()=>{
  const pages=createSearchWavePages();
  const x=offers(181),y=offers(301);
  x.forEach(o=>o.title="R1 "+o.title);
  y.forEach(o=>o.title="R2 "+o.title);
  const xcur=pages.remember("ps5",1,x,180,meta).cursor;
  const ycur=pages.remember("ps5",2,y,300,meta).cursor;
  assert.match(pages.page("ps5",xcur).offers[0].title,/R1/);
  assert.match(pages.page("ps5",ycur).offers[0].title,/R2/);
  assert.equal(pages.page("ps5",ycur).acquisitionDepth,2);
});
