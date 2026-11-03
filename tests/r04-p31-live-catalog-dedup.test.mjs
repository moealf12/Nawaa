import test from "node:test";
import assert from "node:assert/strict";
import {dedupeNormalizedOffers} from "../server/match.mjs";

const FIRST="2026-11-03T18:37:28.609Z";
const SECOND="2026-11-03T18:37:41.299Z";
const offer=(overrides={})=>({
  provider:"extra-unbxd",
  merchant:"eXtra",
  merchantCountryCode:"SA",
  title:"PS5, Digital Edition, 30th Anniversary, Limited Edition, Bundle",
  sourceUrl:"https://extra.com/en-sa/p/100387165",
  condition:"new",
  currency:"SAR",
  originalCurrency:"SAR",
  productPrice:2299,
  originalProductPrice:2299,
  specs:{modelNumber:"CFI-2016B30Y"},
  observedAt:FIRST,
  dataKind:"persisted",
  ...overrides,
});

test("R04 P3.1 LIVE: eXtra www/non-www catalog replay is one physical offer, latest live wins in either order",()=>{
  const prior=offer();
  const refreshed=offer({sourceUrl:"https://www.extra.com/en-sa/p/100387165",
    observedAt:SECOND,dataKind:"live"});
  for(const input of [[prior,refreshed],[refreshed,prior]]){
    const actual=dedupeNormalizedOffers(input);
    assert.equal(actual.length,1,"same product must not occupy two customer result slots");
    assert.equal(actual[0].dataKind,"live");
    assert.equal(actual[0].observedAt,SECOND);
    assert.equal(actual[0].productPrice,2299);
  }
});

test("R04 P3.1: price is observation, not listing identity; old price cannot mask newer price",()=>{
  const old=offer({originalProductPrice:2499,productPrice:2499});
  const latest=offer({sourceUrl:"https://www.extra.com/en-sa/p/100387165",
    originalProductPrice:2299,productPrice:2299,observedAt:SECOND,dataKind:"live"});
  const a=dedupeNormalizedOffers([old,latest]);
  assert.equal(a.length,1);
  assert.equal(a[0].productPrice,2299);
  assert.equal(a[0].dataKind,"live");
});

test("R04 P3.1: model, SKU, condition and destination market never collapse into another sellable variant",()=>{
  const base=offer();
  const variants=[
    offer({sourceUrl:"https://www.extra.com/en-sa/p/100387165",specs:{modelNumber:"CFI-2116B01Y"}}),
    offer({sku:"OTHER-SKU"}),
    offer({condition:"refurbished"}),
    offer({merchantCountryCode:"AE"}),
  ];
  for(const variant of variants){
    const unique=dedupeNormalizedOffers([base,variant]);
    assert.equal(unique.length,2,"distinct physical or market identity must survive: "+JSON.stringify(variant));
  }
});

test("R04 P3.1: provider and independent product links remain distinct, even for an identical title",()=>{
  const entries=[
    offer(),
    offer({provider:"jarir-direct",merchant:"Jarir"}),
    offer({sourceUrl:"https://extra.com/en-sa/p/100476675"}),
  ];
  assert.equal(dedupeNormalizedOffers(entries).length,3);
});

test("R04 P3.1: repeated normalized copies remain idempotent and preserve unrelated ordering",()=>{
  const first=offer({observedAt:SECOND,dataKind:"live"});
  const unrelated=offer({sourceUrl:"https://extra.com/en-sa/p/100476675",title:"PS5 Digital 825GB"});
  const duplicate=offer({sourceUrl:"https://www.extra.com/en-sa/p/100387165",observedAt:FIRST});
  const once=dedupeNormalizedOffers([first,unrelated,duplicate]);
  const twice=dedupeNormalizedOffers(once);
  assert.deepEqual(twice,once);
  assert.deepEqual(once.map(x=>x.title),[first.title,unrelated.title]);
});
