import test from "node:test";
import assert from "node:assert/strict";
import {searchExtraUnbxd} from "../server/providers/extra-unbxd.mjs";

const SKU="100462492";
const PDP="https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492";
const QUERY="Apple iPhone 17e 512GB Soft Pink";
const originalPayload={response:{numberOfProducts:1,products:[{
  _root_:SKU,uniqueId:SKU,name:QUERY,currentPrice:3499,
  available:true,featureEnBrandName:"Apple",featureEnMemoryInternal:"512GB",
  featureEnColor:"Soft Pink",inStock:[]}
]}};
function originalEnv(t){
  const keys=["NAWAA_EXTRA_PYTHON_PDP","NAWAA_EXTRA_PYTHON_ALL","NAWAA_EXTRA_PYTHON_CANARY_QUERY",
    "NAWAA_EXTRA_PYTHON_CANARY_SKU","NAWAA_EXTRA_PYTHON_CANARY_URL"];
  const before=Object.fromEntries(keys.map(x=>[x,process.env[x]]));
  const fetch=globalThis.fetch;
  t.after(()=>{
    globalThis.fetch=fetch;
    for(const key of keys){
      if(before[key]===undefined)delete process.env[key];
      else process.env[key]=before[key];
    }
  });
}
function canary(){
  process.env.NAWAA_EXTRA_PYTHON_PDP="1";
  process.env.NAWAA_EXTRA_PYTHON_CANARY_QUERY=QUERY;
  process.env.NAWAA_EXTRA_PYTHON_CANARY_SKU=SKU;
  process.env.NAWAA_EXTRA_PYTHON_CANARY_URL=PDP;
}
function evidence(){
  return {
    price:"3299.00",currency:"SAR",sku:SKU,
    product_title:QUERY,brand:"Apple",
    requested_url:PDP,final_url:PDP,
    response_sha256:"f".repeat(64),fetched_at:new Date().toISOString(),
    parser_version:"1.1.0",issues:[],availability:"IN_STOCK",
    field_evidence:{
      sku:{source:"JSON-LD"},price:{source:"JSON-LD"},
      currency:{source:"JSON-LD"},availability:{source:"JSON-LD"}
    }
  };
}

test("feature off preserves original UNBXD price and skips Python entirely",async t=>{
  originalEnv(t);
  delete process.env.NAWAA_EXTRA_PYTHON_PDP;
  globalThis.fetch=async()=>Response.json(originalPayload);
  const out=await searchExtraUnbxd(QUERY,10,QUERY,{
    pythonExtract:async()=>{throw Error("should not be called");}
  });
  assert.equal(out.offers.length,1);
  assert.equal(out.offers[0].productPrice,3499);
  assert.equal(out.diagnostics.pythonExtraPdp,undefined);
});

test("three exact operator flags + URL update one original UNBXD price slot",async t=>{
  originalEnv(t);canary();
  globalThis.fetch=async()=>Response.json(originalPayload);
  const calls=[];
  const out=await searchExtraUnbxd(QUERY,10,QUERY,{
    pythonExtract:async req=>{calls.push(req);return evidence();}
  });
  assert.equal(out.offers.length,1,"no extra price source or duplicate offer");
  assert.equal(out.offers[0].sourceUrl,"https://www.extra.com/en-sa/p/"+SKU);
  assert.equal(out.offers[0].productPrice,3299);
  assert.equal(out.offers[0].sourceMeta.indexPrice,3499);
  assert.equal(out.offers[0].priceConfidence,"incomplete");
  assert.equal(out.diagnostics.pythonExtraPdp.attempted,1);
  assert.equal(out.diagnostics.pythonExtraPdp.accepted,1);
  assert.deepEqual(calls,[{url:PDP,expectedSku:SKU}]);
});

test("different query never starts Python, even with all flags set",async t=>{
  originalEnv(t);canary();
  globalThis.fetch=async()=>Response.json(originalPayload);
  const out=await searchExtraUnbxd("Apple iPhone 17e",10,"Apple iPhone 17e",{
    pythonExtract:async()=>{throw Error("wrong-query Python must not run");}
  });
  assert.equal(out.diagnostics.pythonExtraPdp,undefined);
});

test("bare flag or wrong SKU/URL cannot activate Python for users",async t=>{
  originalEnv(t);
  globalThis.fetch=async()=>Response.json(originalPayload);
  process.env.NAWAA_EXTRA_PYTHON_PDP="1";
  let out=await searchExtraUnbxd(QUERY,10,QUERY,{
    pythonExtract:async()=>{throw Error("bare flag must not run");}
  });
  assert.equal(out.offers.length,1);
  assert.equal(out.diagnostics.pythonExtraPdp,undefined);
  canary();
  process.env.NAWAA_EXTRA_PYTHON_CANARY_SKU="100462493";
  out=await searchExtraUnbxd(QUERY,10,QUERY,{
    pythonExtract:async()=>{throw Error("wrong SKU must not run");}
  });
  assert.equal(out.diagnostics.pythonExtraPdp,undefined);
});

test("source HTTP denial preserves original offer when canary is explicitly selected",async t=>{
  originalEnv(t);canary();
  globalThis.fetch=async()=>Response.json(originalPayload);
  const out=await searchExtraUnbxd(QUERY,10,QUERY,{
    pythonExtract:async()=>{throw Error("PYTHON_EXTRA_SOURCE_HTTP_403");}
  });
  assert.equal(out.offers.length,1);
  assert.equal(out.offers[0].productPrice,3499);
  assert.equal(out.diagnostics.pythonExtraPdp.failed,1);
  assert.equal(out.diagnostics.pythonExtraPdp.accepted,0);
});

test("other SKU in existing source cannot be enriched with a canary offer",async t=>{
  originalEnv(t);canary();
  globalThis.fetch=async()=>Response.json({
    response:{numberOfProducts:1,products:[{
      uniqueId:"100462493",name:QUERY,currentPrice:3499,
      featureEnBrandName:"Apple",featureEnMemoryInternal:"512GB"
    }]}
  });
  const out=await searchExtraUnbxd(QUERY,10,QUERY,{
    pythonExtract:async()=>{throw Error("must not fetch an unrelated index SKU");}
  });
  assert.equal(out.diagnostics.pythonExtraPdp.attempted,0);
  assert.equal(out.diagnostics.pythonExtraPdp.accepted,0);
});

test("general rollout accepts exact merchant PDP on every query without canary flags",async t=>{
  originalEnv(t);
  process.env.NAWAA_EXTRA_PYTHON_PDP="1";
  process.env.NAWAA_EXTRA_PYTHON_ALL="1";
  delete process.env.NAWAA_EXTRA_PYTHON_CANARY_SKU;
  delete process.env.NAWAA_EXTRA_PYTHON_CANARY_QUERY;
  delete process.env.NAWAA_EXTRA_PYTHON_CANARY_URL;
  globalThis.fetch=async()=>Response.json({
    response:{numberOfProducts:1,products:[{
      ...originalPayload.response.products[0],productUrl:PDP
    }]}
  });
  const calls=[];
  const out=await searchExtraUnbxd(QUERY,12,QUERY,{
    pythonExtract:async req=>{calls.push(req);return evidence();}
  });
  assert.equal(out.offers.length,1);
  assert.equal(out.offers[0].sourceUrl,"https://www.extra.com/en-sa/p/"+SKU);
  assert.equal(out.offers[0].productPrice,3299);
  assert.equal(out.diagnostics.pythonExtraPdp.attempted,1);
  assert.equal(out.diagnostics.pythonExtraPdp.accepted,1);
  assert.deepEqual(calls,[{url:PDP,expectedSku:SKU}]);
});

test("general mode never guesses PDP URLs or trusts wrong host and SKU",async t=>{
  originalEnv(t);
  process.env.NAWAA_EXTRA_PYTHON_PDP="1";
  process.env.NAWAA_EXTRA_PYTHON_ALL="1";
  for(const url of [undefined,
    "https://www.extra.com.evil.test/en-sa/mobiles/p/"+SKU,
    PDP.replace(SKU,"100462493"),
    "https://www.extra.com/en-sa/p/"+SKU,
    PDP+"?utm_source=untrusted"]){
    globalThis.fetch=async()=>Response.json({
      response:{numberOfProducts:1,products:[{
        ...originalPayload.response.products[0],productUrl:url
      }]}
    });
    const out=await searchExtraUnbxd(QUERY,12,QUERY,{
      pythonExtract:async()=>{throw Error("unapproved PDP must not be fetched");}
    });
    assert.equal(out.offers[0].productPrice,3499);
    assert.equal(out.diagnostics.pythonExtraPdp.attempted,0,String(url));
  }
});

test("general switch cannot bypass disabled base feature",async t=>{
  originalEnv(t);
  delete process.env.NAWAA_EXTRA_PYTHON_PDP;
  process.env.NAWAA_EXTRA_PYTHON_ALL="1";
  globalThis.fetch=async()=>Response.json({
    response:{numberOfProducts:1,products:[{
      ...originalPayload.response.products[0],productUrl:PDP
    }]}
  });
  const out=await searchExtraUnbxd(QUERY,12,QUERY,{
    pythonExtract:async()=>{throw Error("disabled base flag must not spawn");}
  });
  assert.equal(out.diagnostics.pythonExtraPdp,undefined);
  assert.equal(out.offers[0].productPrice,3499);
});
