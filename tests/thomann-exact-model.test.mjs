import assert from "node:assert/strict";
import test from "node:test";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {filterQueryOffers,queryMatchReasons} from "../src/search-query.mjs";
import {inspectEuropeanOffer} from "../src/europe-source-yield.mjs";
import {thomannVariantMatchesQuery} from "../src/thomann-product-truth.mjs";

const STORE="thomann-de";
const QUERY="superlux hd 662";
const MAX_PRODUCT_PAGES=3;
const modelInTitle=title=>/\bsuperlux\b/i.test(String(title||"")) &&
  /\bhd[\s-]*662(?:\b|[^\w])/i.test(String(title||""));

function evaluateExactModel(result){
  const offers=Array.isArray(result?.offers)?result.offers:[];
  const matches=offers.filter(offer=>modelInTitle(offer?.title) &&
    thomannVariantMatchesQuery(QUERY,offer?.title,offer?.sourceUrl) &&
    queryMatchReasons(QUERY,offer).length===0);
  const checks=matches.map(offer=>inspectEuropeanOffer(STORE,offer));
  return {
    query:QUERY,candidates:Number(result?.candidates)||0,
    offersReturned:offers.length,modelMatches:matches.length,
    fieldComplete:checks.filter(x=>x.fieldsPass).length,
    rejectionReasons:checks.flatMap(x=>x.issues),
    blocked:!!result?.diagnostics?.primarySearchError,
  };
}

test("Superlux HD-662 exact-model query keeps the relevant product",()=>{
  const basic={
    title:"Superlux HD-662",sourceUrl:"https://www.thomann.de/de/superlux_hd662.htm?type=quickSearch",
    productPrice:138.04,currency:"SAR",originalProductPrice:29.9,originalCurrency:"EUR",
    merchantCountryCode:"DE",providerMarket:"thomann-de",dataKind:"live",
    image:"https://thumbs.static-thomann.de/pics/product.jpg",
    fx:{rate:4.6,source:"test-fx",observedAt:"2026-10-28T00:00:00Z"},
    canShipToSaudi:null,
  };
  const selected=filterQueryOffers(QUERY,[basic]);
  assert.equal(selected.offers.length,1);
  const check=inspectEuropeanOffer(STORE,selected.offers[0]);
  assert.deepEqual(check,{fieldsPass:true,issues:[]});
  assert.deepEqual(evaluateExactModel({candidates:1,offers:selected.offers}),{
    query:QUERY,candidates:1,offersReturned:1,modelMatches:1,
    fieldComplete:1,rejectionReasons:[],blocked:false
  });
});

test("Base-model acceptance rejects HD-662 F and B as different products",()=>{
  const offers=["f","b"].map(suffix=>({
    title:"Superlux HD-662 "+suffix.toUpperCase(),
    sourceUrl:"https://www.thomann.de/de/superlux_hd662_"+suffix+".htm",
  }));
  assert.equal(evaluateExactModel({candidates:2,offers}).modelMatches,0);
});

test("The exact-model gate rejects irrelevant or unproven prices",()=>{
  const sample={
    title:"Superlux HD-662",sourceUrl:"https://www.thomann.de/de/superlux_hd662.htm",
    providerMarket:STORE,merchantCountryCode:"DE",dataKind:"live",canShipToSaudi:null,
    image:"https://thumbs.static-thomann.de/p.jpg",originalCurrency:"EUR",
    originalProductPrice:29.9,productPrice:138,currency:"SAR",
    fx:{rate:4.6,source:"test-fx",observedAt:"2026-10-28T00:00:00Z"},
  };
  assert.equal(evaluateExactModel({candidates:2,offers:[
    {...sample,title:"Unrelated Studio Earbuds"},
    {...sample,originalCurrency:"GBP"},
  ]}).fieldComplete,0);
  assert.equal(evaluateExactModel({candidates:1,offers:[
    {...sample,canShipToSaudi:true},
  ]}).fieldComplete,0);
  assert.equal(evaluateExactModel({candidates:2,offers:[]}).fieldComplete,0);
});

// One bounded real search, only when deliberately enabled for a single run.
// No automatic retries, no source routing change, no database/index writes.
// This tests price-field completeness; it is NOT independent merchant attestation.
test("LIVE: Thomann exact-model source yields one field-complete relevant offer",{
  skip:process.env.NAWAA_THOMANN_EXACT_MODEL_LIVE!=="1",
  timeout:20000,
},async()=>{
  let result;
  try{
    result=await searchFreeStorefrontById(STORE,QUERY,{
      perStore:MAX_PRODUCT_PAGES,catalogLimit:MAX_PRODUCT_PAGES,
    });
  }catch(error){
    const status=Number(error?.status || String(error?.message||"").match(/\bHTTP\s+(\d{3})\b/)?.[1]);
    assert.fail("LIVE_SOURCE_FAILED "+(Number.isInteger(status)?status:"NETWORK_OR_ACCESS"));
  }
  const evidence=evaluateExactModel(result);
  console.log("THOMANN_EXACT_MODEL_EVIDENCE "+JSON.stringify(evidence));
  assert.ok(evidence.candidates>0,"No product candidates from the live query");
  assert.ok(evidence.modelMatches>0,"Exact-model result was filtered out or unpriced");
  assert.ok(evidence.fieldComplete>0,"No field-complete, model-relevant merchant offer");
});
