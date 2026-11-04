import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {safeStorefrontStage,safeStorefrontOutcome,summarizeMerchantForensics}
  from "../server/storefront-merchant-evidence.mjs";
const known=new Set(["noon-sa","walmart-us","temu-global"]);
const make=(storeId,status,totalMs,verifiedOffers=0,stages=[])=>safeStorefrontOutcome({
  storeId,pass:"primary",status,totalMs,verifiedOffers,failures:0,candidates:10,stages,
},{knownStoreIds:known});

test("only fixed stage names, safe counts and monotonic offsets are published",()=>{
  assert.equal(safeStorefrontStage("url_search",500,{secret:"SECRET"}),null);
  const stage=safeStorefrontStage("html_complete",350,{
    cards:5,htmlBytes:12000,token:"SECRET",sourceUrl:"https://private.host",
    directOffers:-3,
  });
  assert.deepEqual(stage,{stage:"html_complete",atMs:350,counts:{cards:5,htmlBytes:12000}});
  assert.equal(safeStorefrontStage("cards_parsed",-500).atMs,null);
});
test("bounded merchant trace loses all raw errors, user inputs, prices and hostnames",()=>{
  const e=safeStorefrontOutcome({
    storeId:"https://private.host/?token=SECRET",
    status:"rejected",pass:"fallback",totalMs:6500,
    failureClass:"ACCESS_TOKEN_SECRET",rawError:"Bearer SECRET",
    query:"customer@example.com",price:299,product:"Sensitive title",
    stages:[{stage:"cards_parsed",atMs:50,counts:{cards:2,rawBody:"SECRET"}}],
  },{knownStoreIds:known});
  assert.equal(e.storeId,"unknown");
  assert.equal(e.failureClass,"UNKNOWN");
  assert.equal(e.pass,"fallback");
  const raw=JSON.stringify(e);
  for(const v of ["private.host","SECRET","customer@example.com","Bearer","299","Sensitive"])
    assert.equal(raw.includes(v),false,v);
});
test("never interpret a zero-returning source as out of stock",()=>{
  const a=make("noon-sa","zero_offers",6200);
  assert.equal(a.status,"zero_offers");
  assert.equal(Object.hasOwn(a,"availability"),false);
  assert.equal(Object.hasOwn(a,"outOfStock"),false);
});
test("missing stages remain missing instead of zero duration",()=>{
  const row=make("noon-sa","rejected",6500,0,[]);
  assert.deepEqual(row.stages,[]);
  assert.equal(row.totalMs,6500);
});
test("triage aggregates observed store spans, not inferred merchant outages",()=>{
  const src=[
    make("walmart-us","zero_offers",6500),
    make("walmart-us","rejected",6400),
    make("noon-sa","with_offers",2000,8),
    make("noon-sa","zero_offers",3000),
  ];
  const x=summarizeMerchantForensics(src);
  assert.equal(x.length,2);
  assert.equal(x[0].storeId,"walmart-us");
  assert.equal(x[0].p95Ms,6500);
  assert.equal(x[0].zeroOffers,1);
  assert.equal(x[0].rejected,1);
  assert.equal(x.find(v=>v.storeId==="noon-sa").verifiedOffers,8);
});
test("stage trace is guarded and optional in production code",()=>{
  const server=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  const provider=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
  assert.match(server,/onStoreTrace:SEARCH_TRACE_ENABLED\?event=>recordStoreTrace/);
  assert.match(provider,/const tracking=typeof options.onStoreTrace==="function"/);
  assert.match(provider,/if\(stageStarted\)markStoreStage\("html_complete"/);
  assert.match(provider,/const settled = await Promise\.allSettled/);
});
