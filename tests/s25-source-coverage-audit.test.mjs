import test from "node:test";
import assert from "node:assert/strict";
import { classifyS25CatalogOffer, auditS25Sources } from "../scripts/audit-s25-source-coverage.mjs";

const offer = (changes={})=>({
  provider:"jarir-direct",merchant:"Jarir",
  sourceUrl:"https://www.jarir.com/sa-en/samsung-galaxy-s25-smartphones-651003.html",
  title:"Samsung Galaxy S25, 256 GB, 12 GB RAM, Navy, 5G",
  productPrice:2299,originalProductPrice:2299,
  currency:"SAR",originalCurrency:"SAR",condition:"new",
  specs:{storage:"256 GB",modelNumber:"SMS931BDBOMEA"},
  ...changes,
});

test("RED: exact source-owned Galaxy S25 256GB catalog record is a candidate, never PDP price-verified",()=>{
  const v=classifyS25CatalogOffer("jarir-direct",offer());
  assert.equal(v.eligible,true);
  assert.equal(v.reason,"SOURCE_CATALOG_CANDIDATE");
  assert.equal(v.priceVerifiedAgainstPdp,false);
  assert.equal(v.deliveryVerified,false);
  assert.equal("productPrice" in v,false,"audit returns no merchant price in trace");
});

test("negative: exact model rejects S25 Ultra, FE, Edge, Plus, S26 and S24",()=>{
  for(const variant of ["S25 Ultra","S25 FE","S25 Edge","S25 Plus","S26","S24"]){
    const v=classifyS25CatalogOffer("jarir-direct",
      offer({title:"Samsung Galaxy "+variant+", 256 GB, Navy",
        specs:{storage:"256 GB",modelNumber:null}}));
    assert.equal(v.eligible,false,variant);
  }
});

test("negative: storage and physical model identifier contradictions fail closed",()=>{
  assert.equal(classifyS25CatalogOffer("jarir-direct",offer({title:"Samsung Galaxy S25 128 GB Navy",specs:{storage:"128 GB",modelNumber:"SMS931BDBOMEA"}})).eligible,false);
  assert.equal(classifyS25CatalogOffer("jarir-direct",offer({title:"Samsung Galaxy S25 512 GB Navy",specs:{storage:"512 GB"}})).eligible,false);
  assert.equal(classifyS25CatalogOffer("jarir-direct",offer({specs:{storage:"256 GB",modelNumber:"SM-S938B"}})).eligible,false);
  assert.equal(classifyS25CatalogOffer("jarir-direct",offer({title:"Galaxy S25 case cover 256GB",specs:{storage:"256 GB"}})).eligible,false);
});

test("negative: unrelated hosts and provider/merchant identity conflicts fail closed",()=>{
  assert.equal(classifyS25CatalogOffer("jarir-direct",offer({sourceUrl:"https://www.extra.com/en-sa/p/100392593"})).eligible,false);
  assert.equal(classifyS25CatalogOffer("jarir-direct",offer({sourceUrl:"https://jarir.com.evil.example/sa-en/samsung-galaxy-s25-smartphones-651003.html"})).eligible,false);
  assert.equal(classifyS25CatalogOffer("extra-unbxd",offer()).eligible,false);
  assert.equal(classifyS25CatalogOffer("jarir-direct",offer({sourceUrl:"http://www.jarir.com/sa-en/samsung-galaxy-s25-smartphones-651003.html"})).eligible,false);
});

test("negative: prices must be positive, SAR and owned by the same catalog listing",()=>{
  for(const changes of [
    {productPrice:0},{productPrice:NaN},{productPrice:Infinity},
    {currency:"USD"},{originalCurrency:"AED"},{condition:"renewed"},
    {productPrice:2299,originalProductPrice:100}
  ]) assert.equal(classifyS25CatalogOffer("jarir-direct",offer(changes)).eligible,false,JSON.stringify(changes));
});

test("positive: eXtra catalog S25 256GB exact variant is recognized without claiming delivery",()=>{
  const x=offer({provider:"extra-unbxd",merchant:"eXtra",
    sourceUrl:"https://www.extra.com/en-sa/p/100392593",
    title:"SAMSUNG Galaxy S25, 5G, 256 GB, Navy",
    specs:{modelNumber:"SM-S931BDBOMEA",storage:"256 GB"},
    productPrice:2069,originalProductPrice:2069});
  const result=classifyS25CatalogOffer("extra-unbxd",x);
  assert.equal(result.eligible,true);
  assert.equal(result.priceVerifiedAgainstPdp,false);
});

test("audit: injected providers operate once each with no PDP visits, dedupe and no exposed prices",async()=>{
  let calls={jarir:0,extra:0};
  const good=offer();
  const bad=offer({title:"Galaxy S25 Ultra 256 GB",specs:{storage:"256 GB",modelNumber:null}});
  const run=await auditS25Sources({
    searchJarir:async()=>{calls.jarir++;return {offers:[good,good,bad],errors:[]};},
    searchExtraUnbxd:async()=>{calls.extra++;return {offers:[],errors:[]};},
  });
  assert.equal(calls.jarir,1);
  assert.equal(calls.extra,1);
  assert.equal(run.sources.length,2);
  assert.equal(run.sources[0].eligible,1);
  assert.equal(run.sources[0].returned,3);
  assert.equal(run.sources[0].strictRejected,1);
  assert.equal(run.sources[0].duplicates,1);
  assert.equal(run.sources[1].eligible,0);
  assert.equal(run.claims.pdpPriceVerified,false);
  assert.equal(run.claims.s25DeliveryVerified,false);
  assert.equal(JSON.stringify(run).includes("2299"),false);
});

test("audit: transport failures are UNKNOWN, not zero stock or zero retailer inventory",async()=>{
  const r=await auditS25Sources({
    searchJarir:async()=>{throw Error("HTTP 403 blocked");},
    searchExtraUnbxd:async()=>({offers:[],errors:[]}),
  });
  assert.equal(r.sources[0].status,"UNAVAILABLE");
  assert.equal(r.sources[0].eligible,null);
  assert.equal(r.sources[1].status,"NO_CATALOG_CANDIDATE");
  assert.equal(r.claims.merchantInventoryVerified,false);
});
