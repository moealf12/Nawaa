import assert from "node:assert/strict";
import test from "node:test";
import { validateAuditOffer, auditSource } from "../server/audit-contract.mjs";

const source = {id:"extra",name:"eXtra",adapter:"extra-unbxd",status:"configured"};
const fixture = (overrides = {}) => ({
  title:"Apple iPhone 17 256GB", sourceUrl:"https://www.extra.com/en-sa/p/123",
  merchant:"eXtra", merchantCountryCode:"SA", provider:"extra-unbxd",
  productPrice:3000, originalProductPrice:3000, currency:"SAR",originalCurrency:"SAR",
  condition:"new", availability:"in_stock", canShipToSaudi:true,
  image:null,specs:{storage:"256GB"}, observedAt:"2026-10-03T00:00:00Z",
  shipping:null,importCost:null,tax:null,mandatoryFees:0,discount:0,...overrides,
});
const probe = (offers, extra = {}) => async () => ({offers,errors:[],...extra});

test('page diagnosis distinguishes invalid data, identity, price and currency without raw errors',async()=>{
  const cases=[
    [fixture({productPrice:null}), 'PAGE_DATA_INVALID', 'invalid_price_sar'],
    [fixture({sourceUrl:'https://another.example/product/1'}),'PAGE_IDENTITY_MISMATCH',null],
    [fixture({productPrice:3100,originalProductPrice:3100}),'PAGE_PRICE_CHANGED',null],
    [fixture({originalCurrency:'USD',originalProductPrice:800,fx:{rate:3.75,source:'fixture',observedAt:'2026-10-03T00:00:00Z'}}),'PAGE_CURRENCY_CHANGED',null],
  ];
  for(const [resolved,code,reason] of cases){
    const r=await auditSource({source,query:'iPhone 17 256GB',search:probe([fixture()]),verifyPage:async()=>resolved});
    assert.equal(r.status,'PAGE_VERIFICATION_FAILED');assert.equal(r.pageChecks?.[0]?.code,code);
    assert.equal(r.pageChecks[0].status,'failed');assert.equal(r.pageChecks[0].sampleIndex,0);
    if(reason) assert.ok(r.pageChecks[0].reasons.includes(reason));
  }
});
test('page transport diagnosis exposes allowlisted codes rather than exception text',async()=>{
  for(const [error,code] of [[Object.assign(new Error('fetch failed secret-token'),{cause:{code:'ENOTFOUND'}}),'DNS_LOOKUP_FAILED'],[new Error('URL is not an HTML product page secret-token'),'PAGE_NOT_HTML'],[new Error('Product page is too large secret-token'),'PAGE_TOO_LARGE'],[new Error('Product page returned 403 secret-token'),'HTTP_403']]){
    const r=await auditSource({source,query:'iPhone 17 256GB',search:probe([fixture()]),verifyPage:async()=>{throw error;}});
    assert.equal(r.pageChecks?.[0]?.code,code);assert.ok(!JSON.stringify(r).includes('secret-token'));
  }
});
test('provider filter counts survive empty output while upstream failures still fail the control',async()=>{
  const queryFilter={input:18,retained:0,removed:18};
  const r=await auditSource({source,query:'nawaa-unfindable-943271',expected:'empty',search:probe([],{diagnostics:{queryFilter}})});
  assert.equal(r.status,'NEGATIVE_CONTROL_PASS');assert.deepEqual(r.providerQueryFilter,queryFilter);
  const denied=await auditSource({source,query:'nawaa-unfindable-943271',expected:'empty',search:probe([],{diagnostics:{queryFilter},errors:[{error:'HTTP 503'}]})});
  assert.equal(denied.status,'FETCH_FAILED');assert.deepEqual(denied.providerQueryFilter,queryFilter);
});

test("accepts a matching advertised price without inventing missing image or delivered cost", () => {
  const r=validateAuditOffer("iPhone 17 256GB",fixture());
  assert.equal(r.accepted,true);
  assert.equal(r.product.media.primaryImage,null);
  assert.equal(r.cost.complete,false);
  assert.equal(r.cost.totalSAR,null);
  assert.ok(r.warnings.includes("missing_image"));
});
test("rejects zero, negative, NaN, Infinity and string prices", () => {
  for(const productPrice of [0,-1,NaN,Infinity,1e308,"3000",null]) {
    const r=validateAuditOffer("iPhone 17 256GB",fixture({productPrice}));
    assert.equal(r.accepted,false);assert.ok(r.reasons.includes("invalid_price_sar"));
  }
});
test("rejects source attribution from an unrelated adapter", async () => {
  const r=await auditSource({source,query:"iPhone 17 256GB",search:probe([fixture({provider:"jarir-direct",merchant:"Jarir"})])});
  assert.equal(r.status,"INVALID_OFFERS");assert.ok(r.rejections[0].reasons.includes("source_mismatch"));
});
test("rejects currencies and invalid product URLs before page verification", () => {
  for(const value of ["https://www.extra.com/search?q=iphone","https://www.extra.com/", "http://www.extra.com/p/123","https://user:pass@www.extra.com/p/123","https://127.0.0.1/p/123","https://[::1]/p/123","https://localhost/p/123","https://www.extra.com:8000/p/123"]) {
    assert.equal(validateAuditOffer("iPhone 17 256GB",fixture({sourceUrl:value})).accepted,false,value);
  }
  assert.ok(validateAuditOffer("iPhone 17 256GB",fixture({originalCurrency:"ZZZ"})).reasons.includes("invalid_original_currency"));
  assert.ok(validateAuditOffer("iPhone 17 256GB",fixture({currency:"USD"})).reasons.includes("invalid_normalized_currency"));
});
test("rejects different model, variant, capacity, accessories and used condition", () => {
  for(const title of ["Apple iPhone 17 Pro 256GB","Apple iPhone 17 512GB","Samsung 17 256GB","Apple iPhone 17 256GB case","Apple iPhone 17 256GB Used"]) {
    assert.equal(validateAuditOffer("iPhone 17 256GB",fixture({title,specs:{}})).accepted,false,title);
  }
});
test("distinguishes sold out from invalid product data", () => {
  const r=validateAuditOffer("iPhone 17 256GB",fixture({availability:"out_of_stock"}));
  assert.equal(r.accepted,true);assert.ok(r.warnings.includes("out_of_stock"));assert.equal(r.cost.complete,false);
});
test("calculates delivered cost only from known components and confirmed availability", () => {
  const r=validateAuditOffer("iPhone 17 256GB",fixture({shipping:20,importCost:30,tax:450,mandatoryFees:5,discount:100}));
  assert.equal(r.cost.complete,true);assert.equal(r.cost.totalSAR,3405);
  assert.equal(validateAuditOffer("iPhone 17 256GB",fixture({shipping:0,importCost:0,tax:0,canShipToSaudi:null})).cost.complete,false);
  assert.equal(validateAuditOffer("iPhone 17 256GB",fixture({shipping:-1})).accepted,false);
});
test("rejects conflicting title and metadata capacities",()=>{
  const r=validateAuditOffer("iPhone 17 256GB",fixture({title:"Apple iPhone 17 512GB",specs:{storage:"256GB"}}));
  assert.equal(r.accepted,false);assert.ok(r.reasons.includes("capacity_conflict"));
});
test("foreign prices require a consistent conversion with recorded rate evidence",()=>{
  const bad=fixture({originalCurrency:"USD",originalProductPrice:800});
  assert.equal(validateAuditOffer("iPhone 17 256GB",bad).accepted,false);
  const fx={rate:3.75,source:"fixture",observedAt:"2026-10-03T00:00:00Z"};
  assert.equal(validateAuditOffer("iPhone 17 256GB",{...bad,fx}).accepted,true);
  assert.equal(validateAuditOffer("iPhone 17 256GB",{...bad,fx:{...fx,rate:4}}).accepted,false);
});
test("malformed offers are rejected rather than crashing an audit", () => {
  for(const v of [null,{},"product",{title:32}]) assert.equal(validateAuditOffer("iPhone 17 256GB",v).accepted,false);
});
test("records revision, rejected reasons, duplicates and a deterministic completeness sample", async () => {
  const r=await auditSource({source,query:"iPhone 17 256GB",revision:"abc123",search:probe([fixture(),fixture(),fixture({title:"Samsung S25"})])});
  assert.equal(r.status,"PARTIAL_SAMPLE");assert.equal(r.revision,"abc123");
  assert.deepEqual(r.counts,{raw:3,accepted:1,rejected:1,duplicates:1});
  assert.equal(r.samples[0].cost.complete,false);assert.ok(r.rejections[0].reasons.includes("query_mismatch"));
});
test("empty results cannot certify a source; a negative control is recorded separately", async () => {
  assert.equal((await auditSource({source,query:"nonexistent",search:probe([])})).status,"NO_RESULTS");
  const r=await auditSource({source,query:"nonexistent",expected:"empty",search:probe([])});
  assert.equal(r.status,"NEGATIVE_CONTROL_PASS");assert.equal(r.verifiedSource,false);
  assert.equal((await auditSource({source,query:"iPhone 17 256GB",expected:"empty",search:probe([fixture()])})).status,"NEGATIVE_CONTROL_FAIL");
});
test("transport failures and reported upstream errors cannot pass a negative control", async () => {
  const denied=await auditSource({source,query:"nonexistent",expected:"empty",search:async()=>{throw new Error("HTTP 403 secret-token");}});
  assert.equal(denied.status,"BLOCKED");assert.equal(denied.failureCode,"HTTP_403");assert.ok(!JSON.stringify(denied).includes("secret-token"));
  const partial=await auditSource({source,query:"nonexistent",expected:"empty",search:probe([],{errors:[{error:"HTTP 503"}]})});
  assert.equal(partial.status,"FETCH_FAILED");
  assert.equal(partial.failureStage,"search");assert.deepEqual(partial.counts,{raw:null,accepted:null,rejected:null,duplicates:null});
});
test("disabled and candidate sources never execute a fetch", async () => {
  for(const [status,want] of [["disabled","NOT_CONFIGURED"],["candidate","UNCONNECTED"]]) {
    const r=await auditSource({source:{...source,status},query:"iphone",search:async()=>{throw new Error("unexpected fetch");}});
    assert.equal(r.status,want);assert.equal(r.counts.raw,0);
  }
});
test("page verification failures remain separate from valid catalog offers", async () => {
  const r=await auditSource({source,query:"iPhone 17 256GB",search:probe([fixture()]),verifyPage:async()=>{throw new Error("HTTP 403");}});
  assert.equal(r.status,"PAGE_VERIFICATION_FAILED");assert.equal(r.pageVerification.verified,0);assert.equal(r.counts.accepted,1);
});
test("page verification rejects a product page that resolves to another model", async () => {
  const r=await auditSource({source,query:"iPhone 17 256GB",search:probe([fixture()]),verifyPage:async()=>fixture({title:"Samsung Galaxy S25",specs:{}})});
  assert.equal(r.status,"PAGE_VERIFICATION_FAILED");
});
test("verified page samples prove this query only, and do not certify source stability", async () => {
  const r=await auditSource({source,query:"iPhone 17 256GB",search:probe([fixture()]),verifyPage:async()=>fixture()});
  assert.equal(r.status,"VERIFIED_SAMPLE");assert.equal(r.verifiedSource,false);
  assert.deepEqual(r.pageVerification,{attempted:1,verified:1,failed:0});
});
test("a partial provider failure stays visible even when some offers pass", async () => {
  const r=await auditSource({source,query:"iPhone 17 256GB",search:probe([fixture()],{errors:[{error:"HTTP 503"}]})});
  assert.equal(r.status,"PARTIAL_SAMPLE");assert.equal(r.verifiedSource,false);assert.equal(r.errorCodes[0],"HTTP_503");
});

test("page identity requires positive evidence and rejects identifier or merchant conflicts",async()=>{
  for(const [catalog,page,query] of [
    [fixture({sku:"A"}),fixture({sku:"B"}),"iPhone 17 256GB"],
    [fixture({title:"Blue cotton dress",specs:{}}),fixture({title:"Red silk dress",specs:{}}),"dress"],
    [fixture(),fixture({sourceUrl:"https://unrelated.example/p/123"}),"iPhone 17 256GB"],
  ]) {
    const r=await auditSource({source,query,search:probe([catalog]),verifyPage:async()=>page});
    assert.equal(r.status,"PAGE_VERIFICATION_FAILED");
  }
});
test("SAR original prices must agree and pages cannot bypass price checks with null originals",async()=>{
  assert.equal(validateAuditOffer("iPhone 17 256GB",fixture({originalProductPrice:9000})).accepted,false);
  for(const originalProductPrice of [null,3000]) {
    const r=await auditSource({source,query:"iPhone 17 256GB",search:probe([fixture({originalProductPrice})]),verifyPage:async()=>fixture({productPrice:5000,originalProductPrice:5000})});
    assert.equal(r.status,"PAGE_VERIFICATION_FAILED");
  }
});
test("model evidence is checked independently across title and metadata",()=>{
  for(const specs of [{deviceType:"iPhone 16"},{series:"iPhone 17 Pro"}]) {
    const r=validateAuditOffer("iPhone 17 256GB",fixture({specs:{storage:"256GB",...specs}}));
    assert.equal(r.accepted,false);assert.ok(r.reasons.includes("model_conflict"));
  }
});
test("labeled RAM does not conflict with requested storage",()=>{
  for(const title of ["Apple iPhone 17 256GB 8GB RAM","Apple iPhone 17 RAM 8GB 256GB"]) {
    assert.equal(validateAuditOffer("iPhone 17 256GB",fixture({title})).accepted,true,title);
  }
});
test("search timeout preserves the schema and reports unknown counts",async()=>{
  const r=await auditSource({source,query:"iphone",search:()=>new Promise(()=>{}),timeoutMs:100});
  assert.equal(r.status,"TIMEOUT");assert.equal(r.failureStage,"search");
  assert.deepEqual(r.counts,{raw:null,accepted:null,rejected:null,duplicates:null});
  assert.deepEqual(r.samples,[]);assert.deepEqual(r.rejections,[]);assert.deepEqual(r.errorCodes,["TIMEOUT"]);
  assert.deepEqual(r.source,{id:"extra",name:"eXtra",adapter:"extra-unbxd",status:"configured"});
});
test("page timeout preserves collected catalog counts and verification progress",async()=>{
  const r=await auditSource({source,query:"iPhone 17 256GB",search:probe([fixture()]),verifyPage:()=>new Promise(()=>{}),timeoutMs:100});
  assert.equal(r.status,"TIMEOUT");assert.equal(r.failureStage,"page_verification");
  assert.equal(r.counts.accepted,1);assert.equal(r.samples.length,1);
  assert.deepEqual(r.pageVerification,{attempted:1,verified:0,failed:1});
});
