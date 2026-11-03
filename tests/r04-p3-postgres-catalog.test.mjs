import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_WRITE_WINDOW_MS,CATALOG_WRITE_LIMIT,
  selectFreshLiveObservations,writeThroughFreshLiveObservations,
} from "../server/catalog-write-through.mjs";
import {catalogRecallPlan,summarizeCatalogRecall} from "../server/catalog-recall-evidence.mjs";

const NOW=Date.parse("2026-11-03T15:40:00.000Z");
const fresh=i=>({
  title:"Apple iPhone 17 256GB "+i,
  sourceUrl:"https://example.com/store/"+i,
  productPrice:3500+i,currency:"SAR",provider:"jarir-direct",
  merchant:"Jarir",condition:"new",
  observedAt:new Date(NOW-1000).toISOString(),
  dataKind:"live",matchConfidence:1,exactMatch:true,
});

test("R04 P3: index, replay, missing clocks, invalid currency/price/URLs are never fabricated as new catalog facts",()=>{
 const candidates=[
  fresh(0),
  {...fresh(1),dataKind:"persisted"},
  {...fresh(2),dataKind:"indexed"},
  {...fresh(3),observedAt:null},
  {...fresh(4),observedAt:new Date(NOW-45_001).toISOString()},
  {...fresh(5),observedAt:new Date(NOW+1).toISOString()},
  {...fresh(6),sourceUrl:"http://example.com/p"},
  {...fresh(7),sourceUrl:"https://admin:password@example.com/p"},
  {...fresh(8),productPrice:0},
  {...fresh(9),currency:"USD$"},
  {...fresh(10),title:"x"},
  fresh(11),
  {...fresh(0)}, // duplicate source URL/condition
 ];
 const selected=selectFreshLiveObservations(candidates,{now:NOW});
 assert.deepEqual(selected.map(x=>x.sourceUrl),
  [fresh(0).sourceUrl,fresh(11).sourceUrl]);
 assert.equal(selected[0].observedAt,fresh(0).observedAt);
 assert.equal(candidates[0].dataKind,"live");
});

test("R04 P3: do not create a catalog on unconfigured DB",async()=>{
 let called=0;
 const v=await writeThroughFreshLiveObservations("ps5",[fresh(0)],{
   configured:()=>false,record:async()=>{called++;return {recorded:true}},now:NOW,
 });
 assert.deepEqual(v,{configured:false,attempted:0,recorded:0,failed:0});
 assert.equal(called,0);
});

test("R04 P3: per-observation errors isolate rather than corrupt other real sources",async()=>{
 const seen=[];
 const result=await writeThroughFreshLiveObservations("iphone",[fresh(0),fresh(1),fresh(2)],{
   configured:()=>true,now:NOW,
   record:async x=>{
     seen.push(x);
     if(x.sourceUrl===fresh(1).sourceUrl)throw new Error("password-containing-driver-error");
     return {recorded:true};
   },
 });
 assert.deepEqual(result,{configured:true,attempted:3,recorded:2,failed:1});
 assert.equal(seen.length,3);
 assert.ok(seen.every(x=>x.query==="iphone"&&x.sourceName==="jarir-direct"));
 assert.deepEqual(seen.map(x=>x.observedAt),
   [fresh(0).observedAt,fresh(1).observedAt,fresh(2).observedAt]);
});

test("R04 P3: 1000 acquired offers never create 1000 unexpected free-tier write transactions",()=>{
 const all=Array.from({length:1000},(_,i)=>fresh(i));
 assert.equal(CATALOG_WRITE_LIMIT,64);
 assert.equal(CATALOG_WRITE_WINDOW_MS,45_000);
 assert.equal(selectFreshLiveObservations(all,{now:NOW}).length,64);
 assert.throws(()=>selectFreshLiveObservations(all,{now:NOW,maxRecords:65}),
   /invalid_catalog_write_window/);
});

test("R04 P3: index and Postgres serve disjoint bounded 1000-position recall lanes",()=>{
 const pages=[0,1,2].map(catalogRecallPlan);
 assert.deepEqual(pages,[{offset:0,limit:120},{offset:120,limit:380},
   {offset:500,limit:500}]);
 const ids=pages.flatMap(({offset,limit})=>Array.from({length:limit},(_,i)=>offset+i));
 assert.equal(ids.length,1000);
 assert.equal(new Set(ids).size,1000);
 assert.throws(()=>catalogRecallPlan(3),/invalid_catalog_recall_depth/);
});
test("R04 P3: unavailable DB is NOT merchant out of stock",()=>{
 const source=summarizeCatalogRecall({configured:true,offers:[fresh(0)],
   fetchedRows:2,rejectedStale:1},{offset:120,limit:380});
 assert.deepEqual(source,{
   configured:true,offset:120,limit:380,fetchedRows:2,acceptedFresh:1,
   rejectedStale:1,status:"observed",error:null,
   sourceObservationOnly:true,exhaustive:false,
 });
 const unavailable=summarizeCatalogRecall({configured:true,offers:[],
   error:"password_or_connection_error"},{offset:0,limit:120});
 assert.equal(unavailable.status,"failed");
 assert.equal(unavailable.error,"catalog_recall_unavailable");
 assert.equal(unavailable.exhaustive,false);
 assert.equal(summarizeCatalogRecall({configured:false,offers:[]},pages[0]).status,"unconfigured");
});
