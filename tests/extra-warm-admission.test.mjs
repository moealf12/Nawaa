import test from "node:test";
import assert from "node:assert/strict";
import {searchExtraUnbxd} from "../server/providers/extra-unbxd.mjs";

const sku="100462492";
const query="Apple iPhone 17e 512GB Soft Pink";
const pdp="https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492";
const indexUrl="https://www.extra.com/en-sa/p/"+sku;
const payload={response:{numberOfProducts:1,products:[{
  _root_:sku,uniqueId:sku,name:query,currentPrice:3499,
  available:true,featureEnBrandName:"Apple",featureEnMemoryInternal:"512GB",
  featureEnColor:"Soft Pink",pdpUrl:pdp,
}]}};
async function scenario(t,warm,extract){
  const prior=globalThis.fetch;
  const flags=["NAWAA_EXTRA_PYTHON_PDP","NAWAA_EXTRA_PYTHON_ALL","NAWAA_EXTRA_PYTHON_CANARY_QUERY"];
  const old=Object.fromEntries(flags.map(key=>[key,process.env[key]]));
  t.after(()=>{
    globalThis.fetch=prior;
    for(const [key,value] of Object.entries(old)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });
  process.env.NAWAA_EXTRA_PYTHON_PDP="1";
  process.env.NAWAA_EXTRA_PYTHON_ALL="1";
  delete process.env.NAWAA_EXTRA_PYTHON_CANARY_QUERY;
  let hits=0;
  globalThis.fetch=async()=>{hits++;return Response.json(payload);};
  const output=await searchExtraUnbxd(query,10,query,{
    pythonWarmStatus:()=>warm,
    pythonExtract:async(...args)=>extract(...args)
  });
  assert.equal(hits,1,"no extra merchant requests");
  assert.equal(output.offers.length,1);
  assert.equal(output.offers[0].merchant,"eXtra");
  assert.equal(output.offers[0].providerMarket,"extra-sa");
  assert.equal(output.offers[0].sourceUrl,indexUrl);
  assert.equal(output.offers[0].productPrice,3499,"source-owned price not erased");
  assert.equal(output.offers[0].currency,"SAR");
  return output;
}
const ready={enabled:true,ready:true,busy:false,completed:1};
const unavailable=[
  [{enabled:true,ready:false,busy:false,completed:0},"NOT_READY"],
  [{enabled:true,ready:true,busy:true,completed:1},"BUSY"],
  [{enabled:true,ready:true,busy:false,completed:8},"EXHAUSTED"],
];
for(const [state,reason] of unavailable){
  test("optional eXtra PDP skips "+reason+" warm worker without dropping existing UNBXD offers",async t=>{
    let calls=0;
    const result=await scenario(t,state,async()=>{calls++;throw Error("PDP_SHOULD_NOT_RUN");});
    assert.equal(calls,0);
    assert.equal(result.diagnostics.pythonExtraPdp.attempted,0);
    assert.equal(result.diagnostics.pythonExtraPdp.failed,0);
    assert.equal(result.diagnostics.pythonExtraPdp.skippedReason,"PYTHON_EXTRA_WARM_"+reason);
  });
}
test("healthy warm worker still attempts optional PDP enrichment",async t=>{
  let calls=0;
  const result=await scenario(t,ready,async()=>{calls++;throw Error("SYNTHETIC_PDP_FAILURE");});
  assert.equal(calls,1);
  assert.equal(result.diagnostics.pythonExtraPdp.attempted,1);
  assert.equal(result.diagnostics.pythonExtraPdp.failed,1);
  assert.equal(result.offers[0].productPrice,3499);
});
test("cold-worker mode remains eligible when warm worker is explicitly disabled",async t=>{
  let calls=0;
  const result=await scenario(t,{enabled:false,ready:false,busy:false,completed:0},async()=>{
    calls++;throw Error("SYNTHETIC_COLD_FAILURE");
  });
  assert.equal(calls,1);
  assert.equal(result.diagnostics.pythonExtraPdp.attempted,1);
  assert.equal(result.offers[0].productPrice,3499);
});
