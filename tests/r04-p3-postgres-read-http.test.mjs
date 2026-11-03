import test from "node:test";
import assert from "node:assert/strict";
import {promisify} from "node:util";
import {execFile} from "node:child_process";

const run=promisify(execFile);
test("R04 P3: real pg Pool read uses bounded literal query, no DDL, source-clock recency and stable offset",async()=>{
 const mockModule=`
  export default {Pool:class Pool{
    constructor(){globalThis.CALLS.push({kind:"pool"});}
    async query(config){
      globalThis.CALLS.push({kind:"query",config});
      const base=globalThis.MOCK_NOW;
      return {rows:[
        {observed_at:new Date(base-2000),payload:{
          title:"Apple iPhone 17 256GB",sourceUrl:"https://example.com/iphone",
          productPrice:3500,currency:"SAR",exactMatch:true,
          matchConfidence:1,observedAt:new Date(base-2000).toISOString()}},
        {observed_at:new Date(base-46000),payload:{
          title:"stale iPhone 17",sourceUrl:"https://example.com/old",
          productPrice:3400,currency:"SAR"}},
        {observed_at:new Date(base+61000),payload:{
          title:"future iPhone 17",sourceUrl:"https://example.com/future",
          productPrice:3400,currency:"SAR"}},
      ]};
    }
  }};
 `;
 const script=`
  import {registerHooks} from "node:module";
  globalThis.CALLS=[];
  globalThis.MOCK_NOW=Date.parse("2026-11-03T15:40:00.000Z");
  registerHooks({resolve(spec,context,next){
    if(spec==="pg")return {url:"data:text/javascript,"+encodeURIComponent(${JSON.stringify(mockModule)}),shortCircuit:true};
    return next(spec,context);
  }});
  process.env.DATABASE_URL="postgres://fixture";
  const {searchPersistedOffers}=await import("./server/persistence.mjs");
  const result=await searchPersistedOffers("iPhone 17",{
    limit:380,offset:120,now:globalThis.MOCK_NOW,
  });
  let invalid;
  try{await searchPersistedOffers("bad",{limit:501});}
  catch(e){invalid=e.message;}
  console.log("RESULT "+JSON.stringify({result,calls:globalThis.CALLS,invalid}));
 `;
 const {stdout}=await run(process.execPath,["--input-type=module","-e",script],{
   cwd:new URL("..",import.meta.url),timeout:12000,
 });
 const line=stdout.split("\n").find(x=>x.startsWith("RESULT "));
 assert.ok(line,stdout);
 const data=JSON.parse(line.slice(7));
 assert.equal(data.invalid,"invalid_persisted_page");
 assert.equal(data.calls.filter(x=>x.kind==="query").length,1);
 const q=data.calls.find(x=>x.kind==="query").config;
 assert.match(q.text,/limit \$3 offset \$4/i);
 assert.match(q.text,/offer_key asc/);
 assert.match(q.text,/strpos\(lower\(title\),lower\(\$1\)\)/);
 assert.doesNotMatch(q.text,/create table|drop trigger/i);
 assert.deepEqual(q.values,["iPhone 17",45000,380,120]);
 assert.equal(q.query_timeout,900);
 assert.equal(data.result.configured,true);
 assert.equal(data.result.fetchedRows,3);
 assert.equal(data.result.rejectedStale,2);
 assert.equal(data.result.offers.length,1);
 assert.equal(data.result.offers[0].exactMatch,false);
 assert.equal(data.result.offers[0].matchConfidence,0);
 assert.equal(data.result.offers[0].dataKind,"persisted");
 assert.equal(data.result.offers[0].observedAt,new Date(Date.parse("2026-11-03T15:40:00.000Z")-2000).toISOString());
});
