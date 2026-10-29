import test from "node:test";
import assert from "node:assert/strict";
import {canonicalOfferIdentity,canonicalOfferPayload} from "../server/canonical-offer-identity.mjs";
import {approvedJarirPdp,runJarirPythonPdp} from "../src/python-jarir-bridge.mjs";
import {admitJarirPythonObservation,enrichJarirOffersWithPython} from "../server/python-jarir-enrichment.mjs";

const URL="https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html";
const SHA="a".repeat(64);
const original=()=>({
  provider:"jarir-direct",providerMarket:"jarir-sa",merchant:"Jarir",
  merchantCountryCode:"SA",merchantCountryNameAr:"السعودية",
  title:"Apple iPhone 17 256GB Black",
  sourceUrl:URL,condition:"new",availability:"unknown",
  productPrice:4399,originalProductPrice:4399,
  currency:"SAR",originalCurrency:"SAR",
  observedAt:new Date().toISOString(),dataKind:"live",
  exactMatch:false,matchConfidence:0,priceConfidence:"incomplete",
  specs:{brand:"Apple",storage:"256GB"},
  sourceMeta:{productId:"666784",parsedFrom:"jarir-constructor-search"}
});
const evidence=()=>({
  sku:"666784",product_title:"Apple iPhone 17 256GB Black",
  requested_url:URL,final_url:URL,
  response_sha256:SHA,fetched_at:new Date().toISOString(),
  seller:"Jarir Bookstore",offer_url:URL,price:"4299.00",
  currency:"SAR",availability:"IN_STOCK",issues:[],
  field_evidence:{
    sku:{source:"JSON-LD"},seller:{source:"JSON-LD"},
    offer_url:{source:"JSON-LD"},
    price:{source:"JSON-LD"},currency:{source:"JSON-LD"},
    availability_raw:{source:"JSON-LD"}
  }
});

test("source URL strictly binds allowed HTTPS Jarir PDP to its own SKU",()=>{
  assert.equal(approvedJarirPdp(URL,"666784"),true);
  for(const [url,sku] of [
    [URL,"666785"],[URL+"?variant=1","666784"],
    ["http://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html","666784"],
    ["https://www.jarir.com.evil.example/sa-en/apple-iphone-17-smartphones-666784.html","666784"],
    ["https://www.jarir.com/sa-en/catalogsearch/result/?q=iphone","666784"],
    ["https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html#section","666784"],
    ["https://user@www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html","666784"]
  ])assert.equal(approvedJarirPdp(url,sku),false,url);
});

test("Node accepts one independently sourced SKU+seller+SAR in-stock observation, no new offer",()=>{
  const before=original();
  const result=admitJarirPythonObservation(before,evidence(),"iPhone 17 256GB");
  assert.equal(result.accepted,true,result.reason);
  assert.equal(result.offer.sourceMeta.productId,"666784");
  assert.equal(result.offer.productPrice,4299);
  assert.equal(result.offer.originalProductPrice,4299);
  assert.equal(result.offer.currency,"SAR");
  assert.equal(result.offer.availability,"in_stock");
  assert.equal(result.offer.sourceMeta.priceSource,"jarir-python-pdp-jsonld");
  assert.equal(result.offer.sourceMeta.pythonPdpEvidence.sha256,SHA);
  assert.equal(result.offer.sourceMeta.indexPrice,4399);
  assert.equal(result.offer.exactMatch,false,"Python never awards ranking flags");
  assert.equal(result.offer.priceConfidence,"incomplete","Python never certifies a trust badge");
  assert.deepEqual(canonicalOfferIdentity(result.offer).documentId,
    canonicalOfferIdentity(before).documentId,
    "Price-only update must preserve the same durable canonical offer ID");
  assert.ok(canonicalOfferPayload(result.offer),
    "Evidence remains eligible for normal Node canonical validation");
});

test("cross-SKU, unowned seller, currency, ambiguous offer and stale evidence fail closed",()=>{
  const base=evidence();
  const cases=[
    ["sku","666785"],
    ["requested_url","https://www.jarir.com/sa-en/other-666784.html"],
    ["final_url","https://www.jarir.com/sa-en/other-666784.html"],
    ["seller","Marketplace Seller"],
    ["offer_url","https://www.jarir.com/sa-en/other-666784.html"],
    ["response_sha256",""],
    ["currency","AED"],["price",null],["price","0.00"],
    ["price","4299.999"],["availability","UNKNOWN"],
    ["issues",["MULTIPLE_PRODUCT_NODES"]],
    ["fetched_at","2024-01-01T00:00:00.000Z"],
    ["product_title","Apple iPhone 17 Pro 256GB Black"]
  ];
  for(const [field,value] of cases){
    const e={...base,[field]:value};
    const result=admitJarirPythonObservation(original(),e,"iPhone 17 256GB");
    assert.equal(result.accepted,false,field+" should reject "+result.reason);
  }
});

test("unproven JSON-LD seller/availability or conflicting price sources never promote",()=>{
  for(const broken of [
    {seller:{source:"DOM"}},
    {price:{source:"DOM"}},
    {currency:{source:"Hydration"}},
    {availability_raw:{source:"DOM"}},
  ]){
    const e=evidence();
    e.field_evidence={...e.field_evidence,...broken};
    assert.equal(admitJarirPythonObservation(original(),e,"iPhone 17 256GB").accepted,false);
  }
});

test("feature-gated extraction updates existing slot only; no duplicates and no unverified badge",async()=>{
  const offer=original();
  const calls=[];
  const run=await enrichJarirOffersWithPython([offer,{...offer}], "iPhone 17 256GB",{
    maxCandidates:2,extract:async input=>{
      calls.push(input);return evidence();
    }
  });
  assert.equal(run.offers.length,2);
  assert.equal(run.diagnostics.attempted,1,"dedup same PDP+SKU even with two original hits");
  assert.equal(run.diagnostics.accepted,1);
  assert.equal(run.offers[0].productPrice,4299);
  assert.equal(run.offers[1].productPrice,4399);
  assert.equal(calls[0].expectedSku,"666784");
});

test("transport failure cannot erase or invent a Jarir offer",async()=>{
  const candidate=original();
  const outcome=await enrichJarirOffersWithPython([candidate],"iPhone 17 256GB",{
    extract:async()=>{throw Error("an untrusted raw URL or merchant response");}
  });
  assert.deepEqual(outcome.offers,[candidate]);
  assert.equal(outcome.diagnostics.accepted,0);
  assert.equal(outcome.diagnostics.failed,1);
  assert.deepEqual(outcome.diagnostics.failureClasses,["PYTHON_JARIR_FAILURE"]);
});

test("bridge rejects unsafe URL and cancellation before process spawn",async()=>{
  await assert.rejects(
    runJarirPythonPdp({url:"https://evil.example/x-666784.html",expectedSku:"666784"}),
    /PYTHON_JARIR_URL_SKU_REJECTED/
  );
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(
    runJarirPythonPdp({url:URL,expectedSku:"666784"},{signal:controller.signal}),
    /PYTHON_JARIR_ABORTED/
  );
});
