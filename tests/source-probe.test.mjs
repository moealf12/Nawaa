import assert from "node:assert/strict";
import test from "node:test";
import { probeSource } from "../server/source-probe.mjs";
import { searchAmazonCreators } from "../server/providers/amazon-creators.mjs";
import { searchExtraUnbxd } from "../server/providers/extra-unbxd.mjs";

test("eXtra successful empty HTTP response passes only an expected-empty control",async()=>{
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({response:{products:[],numberOfProducts:0}});
    const r=await probeSource({sourceId:"extra",query:"nawaa-unfindable-943271",expected:"empty",verifyPages:false});
    assert.equal(r.status,"NEGATIVE_CONTROL_PASS");assert.deepEqual(r.errorCodes,[]);
    const positive=await probeSource({sourceId:"extra",query:"iphone",verifyPages:false});
    assert.equal(positive.status,"NO_RESULTS");
    globalThis.fetch=async()=>Response.json({response:{error:"Bad schema"}});
    await assert.rejects(()=>searchExtraUnbxd("iphone"),/Malformed/);
  } finally {globalThis.fetch=originalFetch;}
});

test("probing one source returns only that source and never falls back to another", async () => {
  const sources=[{id:"extra",name:"eXtra",adapter:"extra-unbxd",status:"configured"},{id:"jarir",name:"Jarir",adapter:"jarir-direct",status:"configured"}];
  const r=await probeSource({sourceId:"extra",query:"iphone",sources,verifyPages:false,searchers:{"extra-unbxd":async()=>({offers:[],errors:[]}),"jarir-direct":async()=>{throw new Error("Unexpected unrelated source");}},revision:"local-sha"});
  assert.equal(r.source.id,"extra");assert.equal(r.status,"NO_RESULTS");assert.equal(r.revision,"local-sha");
});
test("unknown source IDs fail before any provider operation", async () => {
  await assert.rejects(()=>probeSource({sourceId:"not-a-source",query:"iphone",sources:[]}),/Unknown source/);
});
test("Amazon audit restricts network search to one configured marketplace", async () => {
  const keys=["AMAZON_CREATORS_CLIENT_ID","AMAZON_CREATORS_CLIENT_SECRET","AMAZON_CREATORS_VERSION","AMAZON_PARTNER_TAG_SA","AMAZON_PARTNER_TAG_AE"];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const originalFetch=globalThis.fetch;
  try {
    Object.assign(process.env,{AMAZON_CREATORS_CLIENT_ID:"audit-isolation-test",AMAZON_CREATORS_CLIENT_SECRET:"fixture",AMAZON_CREATORS_VERSION:"3.1",AMAZON_PARTNER_TAG_SA:"sa-tag",AMAZON_PARTNER_TAG_AE:"ae-tag"});
    globalThis.fetch=async (url,options)=>{
      if(String(url).includes('/auth/')) return Response.json({access_token:"fixture",expires_in:3600});
      const body=JSON.parse(options.body);
      if(body.marketplace !== "www.amazon.sa") throw new Error("Unrequested marketplace");
      return Response.json({searchResult:{items:[]}});
    };
    const result=await searchAmazonCreators("iphone",{marketId:"amazon-sa"});
    assert.deepEqual(result.searchedMarkets.map(x=>x.id),["amazon-sa"]);
    assert.deepEqual(result.errors,[]);
  } finally {
    globalThis.fetch=originalFetch;
    for(const key of keys) {if(old[key]===undefined) delete process.env[key];else process.env[key]=old[key];}
  }
});
