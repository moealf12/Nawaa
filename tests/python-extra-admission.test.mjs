import test from "node:test";
import assert from "node:assert/strict";
import {canonicalOfferIdentity,canonicalOfferPayload} from "../server/canonical-offer-identity.mjs";
import {approvedExtraPdp,approvedExtraIndexUrl,runExtraPythonPdp} from "../src/python-extra-bridge.mjs";
import {admitExtraPythonObservation,enrichExtraOffersWithPython} from "../server/python-extra-enrichment.mjs";

const SKU="100462492";
const PDP="https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492";
const INDEX="https://www.extra.com/en-sa/p/100462492";
const QUERY="Apple iPhone 17e 512GB Soft Pink";

function candidate(){
  return {
    provider:"extra-unbxd",providerMarket:"extra-sa",
    merchant:"eXtra",merchantCountryCode:"SA",
    sourceUrl:INDEX,title:QUERY,
    specs:{brand:"Apple",storage:"512GB",color:"Soft Pink",modelNumber:null},
    condition:"new",availability:"unknown",
    productPrice:3499,originalProductPrice:3499,
    currency:"SAR",originalCurrency:"SAR",
    observedAt:new Date().toISOString(),exactMatch:false,
    matchConfidence:0,priceConfidence:"incomplete",
    sourceMeta:{productId:SKU,jeddahInStock:null}
  };
}
function evidence(){
  return {
    price:"3299.00",currency:"SAR",
    sku:SKU,product_title:QUERY,brand:"Apple",
    requested_url:PDP,final_url:PDP,
    response_sha256:"a".repeat(64),fetched_at:new Date().toISOString(),
    parser_version:"1.1.0",issues:[],availability:"IN_STOCK",
    field_evidence:{
      sku:{source:"JSON-LD",raw_value:SKU},
      price:{source:"JSON-LD",raw_value:"3299.00"},
      currency:{source:"JSON-LD",raw_value:"SAR"},
      availability:{source:"JSON-LD",raw_value:"https://schema.org/InStock"}
    }
  };
}

test("eXtra URLs require same exact host and numeric SKU",()=>{
  assert.equal(approvedExtraPdp(PDP,SKU),true);
  assert.equal(approvedExtraIndexUrl(INDEX,SKU),true);
  for(const [url,sku] of [
    [PDP, "100462493"],[PDP+"?color=red",SKU],
    [PDP+"#view",SKU],["http://"+PDP.slice(8),SKU],
    ["https://www.extra.com.evil.test/en-sa/mobiles/p/"+SKU,SKU],
    ["https://www.extra.com/en-sa/search?q=iphone",SKU],
    ["https://user@www.extra.com/en-sa/mobiles/p/"+SKU,SKU],
    ["https://127.0.0.1/en-sa/mobiles/p/"+SKU,SKU]
  ])assert.equal(approvedExtraPdp(url,sku),false,url);
  assert.equal(approvedExtraIndexUrl(INDEX+"?utm_x=a",SKU),false);
});

test("admission updates only price on original canonical eXtra offer identity",()=>{
  const old=candidate();
  const decision=admitExtraPythonObservation(old,evidence(),QUERY,{pdpUrl:PDP});
  assert.equal(decision.accepted,true,decision.reason);
  const next=decision.offer;
  assert.equal(next.productPrice,3299);
  assert.equal(next.originalProductPrice,3299);
  assert.equal(next.sourceUrl,INDEX);
  assert.equal(next.sourceMeta.productId,SKU);
  assert.equal(next.availability,"unknown","unbxd city/stock evidence is not overwritten");
  assert.equal(next.priceConfidence,"incomplete");
  assert.equal(next.exactMatch,false);
  assert.equal(next.sourceMeta.pythonPdpEvidence.sha256,"a".repeat(64));
  assert.equal(next.sourceMeta.pythonPdpEvidence.priceFieldSource,"JSON-LD");
  assert.equal(next.sourceMeta.indexPrice,3499);
  assert.equal(canonicalOfferIdentity(next).documentId,canonicalOfferIdentity(old).documentId);
  assert.ok(canonicalOfferPayload(next));
});

test("cross-variant, stale, wrong SKU/currency/owner and missing evidence reject",()=>{
  const original=evidence();
  const bad=[
    {sku:"100462493"},
    {requested_url:"https://www.extra.com/en-sa/mobiles/p/100462493"},
    {final_url:"https://www.extra.com/en-sa/mobiles/p/100462493"},
    {response_sha256:"BAD"},
    {fetched_at:"2023-01-01T00:00:00Z"},
    {issues:["PRODUCT_SKU_MISMATCH"]},
    {price:"0.00"},{price:"-1"},{price:"3299.999"},
    {currency:"AED"}, {product_title:"Apple iPhone 17 Pro 512GB Soft Pink"},
    {product_title:"Apple iPhone 17e 256GB Soft Pink"},
    {product_title:"Apple iPhone 17e 512GB Black"},
    {brand:"Samsung"}
  ];
  for(const mutation of bad){
    const outcome=admitExtraPythonObservation(candidate(),{...original,...mutation},QUERY,{pdpUrl:PDP});
    assert.equal(outcome.accepted,false,JSON.stringify(mutation)+" "+outcome.reason);
  }
  assert.equal(admitExtraPythonObservation(candidate(),original,QUERY,
    {pdpUrl:PDP.replace("100462492","100462493")}).accepted,false);
});

test("source traces and conservative price drift guard cannot be bypassed",()=>{
  for(const e of [
    {field_evidence:{...evidence().field_evidence,price:{source:"Fallback"}}},
    {field_evidence:{...evidence().field_evidence,currency:{source:"DOM"}}},
    {field_evidence:{...evidence().field_evidence,sku:{source:"DOM"}}},
    {availability:"IN_STOCK",field_evidence:{...evidence().field_evidence,availability:null}},
  ]){
    const result=admitExtraPythonObservation(candidate(),{...evidence(),...e},QUERY,{pdpUrl:PDP});
    assert.equal(result.accepted,false);
  }
  const huge={...evidence(),price:"100.00"};
  assert.equal(admitExtraPythonObservation(candidate(),huge,QUERY,{pdpUrl:PDP}).reason,
    "PRICE_DELTA_REVIEW_REQUIRED");
});

test("existing eXtra provider entries can be enriched only once",async()=>{
  const base=candidate(),called=[];
  const result=await enrichExtraOffersWithPython([base,{...base}],QUERY,{
    approvedSku:SKU,approvedUrl:PDP,
    extract:async input=>{called.push(input);return evidence();}
  });
  assert.equal(result.offers.length,2);
  assert.equal(result.diagnostics.attempted,1);
  assert.equal(result.diagnostics.accepted,1);
  assert.equal(result.offers[0].productPrice,3299);
  assert.equal(result.offers[1].productPrice,3499);
  assert.equal(called[0].expectedSku,SKU);
});

test("Python transport failure keeps the original offer without leaking network details",async()=>{
  const old=candidate();
  const result=await enrichExtraOffersWithPython([old],QUERY,{
    approvedSku:SKU,approvedUrl:PDP,
    extract:async()=>{throw Error("HTTP to private merchant URL with raw query");}
  });
  assert.deepEqual(result.offers,[old]);
  assert.equal(result.diagnostics.failed,1);
  assert.deepEqual(result.diagnostics.failureClasses,["PYTHON_EXTRA_FAILURE"]);
});

test("bridge rejects invalid URL and cancelled request before spawning Python",async()=>{
  await assert.rejects(runExtraPythonPdp({
    url:"https://localhost/en-sa/mobiles/p/"+SKU,expectedSku:SKU
  }),/PYTHON_EXTRA_URL_SKU_REJECTED/);
  const c=new AbortController();c.abort();
  await assert.rejects(runExtraPythonPdp({url:PDP,expectedSku:SKU},
    {signal:c.signal}),/PYTHON_EXTRA_ABORTED/);
});
