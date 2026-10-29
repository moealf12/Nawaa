import test from "node:test";
import assert from "node:assert/strict";
import {inspectNoonPartnerOffers} from "../src/noon-partner-offer-evidence.mjs";

const partnerSku="MY-MATEBOOK-D16";
const noonSku="N70312362V";
const offer=(overrides={})=>({
  offer_code:"f428b90c38b7fb5b", country_code:"sa",
  business_model:"noon",price:{amount:2489,currency:"SAR"},
  is_active:true,live_status:true,active_net_stock:3,...overrides
});
const payload=(overrides={})=>({
  partner_sku:partnerSku, sku:noonSku,
  title:"Huawei MateBook D16 16GB 512GB",
  brand:"Huawei",offers:[offer()],...overrides
});
const inspect=(x,options={})=>inspectNoonPartnerOffers(x,{
  partnerSku, expectedNoonSku:noonSku,...options,
});

test("Noon Partner Offer is seller-scoped only, never a customer search price",()=>{
  const r=inspect(payload());
  assert.equal(r.status,"SELLER_SCOPED_OFFER_OBSERVED");
  assert.equal(r.accessScope,"AUTHORIZED_PARTNER_SKU_ONLY");
  assert.equal(r.marketplace,"SA");
  assert.equal(r.eligible.length,1);
  assert.equal(r.eligible[0].noonSku,noonSku);
  assert.equal(r.eligible[0].priceCents,248900);
  assert.equal(r.eligible[0].sourceProductUrl,null);
  assert.equal(r.customerPublishable,false);
  assert.equal(r.pdpVerified,false);
  assert.equal(r.independentPriceVerified,false);
  assert.equal(r.eligible[0].sellerVerified,false);
  assert.equal(r.eligible[0].sourceScope,"AUTHORIZED_SELLER_PROJECT");
});

test("Partner SKU cannot be substituted with public Noon search keywords or another seller",()=>{
  assert.equal(inspect(payload({partner_sku:"SOMEONE-ELSE-SKU"})).status,"PARTNER_SKU_MISMATCH");
  assert.equal(inspect(payload(),{partnerSku:"Laptop search"}).status,"INVALID_PARTNER_SKU");
  assert.equal(inspect(payload(),{partnerSku:"../../other"}).status,"INVALID_PARTNER_SKU");
  assert.equal(inspect(payload(),{partnerSku:"MY-MATEBOOK-D16",expectedNoonSku:"N70211519V"}).status,"NOON_SKU_MISMATCH");
  assert.equal(inspect(payload({sku:"N70312362A"})).status,"NOON_SKU_MISMATCH");
});

test("Unknown stock, inactive, non-live and non-Saudi offers cannot pass",()=>{
  for(const changed of [
    {country_code:"ae"}, {country_code:"SA"},
    {live_status:false}, {is_active:false},
    {active_net_stock:0},{active_net_stock:-1},
    {active_net_stock:1.1},{active_net_stock:null},
    {price:{amount:2489,currency:"AED"}},
    {price:{amount:0,currency:"SAR"}},
    {price:{amount:"2489",currency:"SAR"}},
    {price:{amount:Infinity,currency:"SAR"}},
    {price:{amount:2489.001,currency:"SAR"}},
    {offer_code:"bad code?"}, {business_model:"noon; DROP"},
  ]){
    const r=inspect(payload({offers:[offer(changed)]}));
    assert.equal(r.eligible.length,0,JSON.stringify(changed));
    assert.equal(r.rejected,1);
    assert.equal(r.customerPublishable,false);
  }
});

test("Mix of currencies and country offers keeps only source-stated sa/SAR live records",()=>{
  const r=inspect(payload({offers:[
    offer(),offer({offer_code:"ae-offer",country_code:"ae",price:{amount:800,currency:"AED"}}),
    offer({offer_code:"inactive",is_active:false}),
  ]}));
  assert.equal(r.eligible.length,1);
  assert.equal(r.rejected,2);
});

test("Conflicting same-offer prices reject that offer, not silently choose the cheapest",()=>{
  const r=inspect(payload({offers:[
    offer(),offer({price:{amount:2389,currency:"SAR"}}),
  ]}));
  assert.equal(r.conflicting,1);
  assert.equal(r.eligible.length,0);
  assert.equal(r.status,"PARTNER_OFFER_PRICE_CONFLICT");
});

test("Malformed response and public Noon SKU cannot invent catalog evidence",()=>{
  for(const bad of [null,{},[],{...payload(),offers:"oops"},
    {...payload(),sku:"some public search slug"},
    {...payload(),offers:Array.from({length:101},()=>offer())}]){
    const r=inspect(bad);
    assert.equal(r.eligible.length,0);
    assert.equal(r.customerPublishable,false);
  }
  assert.equal(inspect(payload({sku:"Z442D4EDF6FE68F9C7210Z"}),{
    expectedNoonSku:"Z442D4EDF6FE68F9C7210Z"}).eligible.length,1);
});

test("Normalization makes zero network calls and never accepts URLs from seller JSON",()=>{
  const r=inspect(payload({url:"https://evil.example/product",offers:[offer({
    url:"https://evil.example/claim",shipping:"free",seller:"Noon"
  })]}));
  assert.equal(r.eligible.length,1);
  assert.equal("shipping" in r.eligible[0],false);
  assert.equal("url" in r.eligible[0],false);
  assert.equal(r.eligible[0].sourceProductUrl,null);
});
