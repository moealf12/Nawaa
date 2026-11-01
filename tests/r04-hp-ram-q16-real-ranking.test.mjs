import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSearchQuery,parseSearchIntent,assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";
import {groupComparableOffers} from "../src/search-core.mjs";

// Captured R04 LIVE Q16 rank-one, GitHub run 41313349013: 16-inch
// display with 8GB RAM outranked true 16GB RAM HP laptops.
const queryAr="لابتوب اتش بي 16 رام";
const queryEn="HP laptop 16GB RAM";
const bad="HP 16 in 2K Touchscreen Laptop | AMD Ryzen 5 40 (Beat Intel i7-1165G7256) | 8GB RAM - 256GB SSD | Wi-Fi 6 - Windows11";
const good="Laptop hp 15 dos (no windows) intel core 7-150u processor, 16 ram, 512 ssd m.2, intel integrated graphics, 15.6 fhd - silver";
const goodEn="HP EliteBook 840 G6 Business Laptop Intel Core i7 16GB DDR4 RAM 512GB SSD";
const unknown="HP 16 in Laptop AMD Ryzen 7 Windows 11 touchscreen";
const mk=(title,productPrice=2000,specs={})=>({title,merchant:"Recorded evidence replay",sourceUrl:"https://example.invalid/q16-test",productPrice,currency:"SAR",availability:"in_stock",condition:"new",specs});

test("R04 RED Q16: normalize the requested Arabic/English RAM quantity without confusing screen inches",()=>{
  assert.match(normalizeSearchQuery(queryAr),/\b16gb ram\b/);
  assert.match(normalizeSearchQuery("HP laptop 16 RAM"),/\b16gb ram\b/);
  assert.equal(parseSearchIntent(queryEn).storage,null,"a requested RAM quantity is not storage");
  assert.equal(parseSearchIntent("HP laptop 16GB RAM 512GB SSD").storage,"512gb","SSD request stays storage");
});

for(const query of [queryAr,queryEn]){
  test(`R04 RED Q16: 16-inch display does not satisfy 16GB RAM, ${query}`,()=>{
    const candidate=mk(bad,1000);
    const result=assessOfferMatch(query,candidate);
    assert.equal(result.exactMatch,false);
    assert.ok(result.matchConfidence < 0.65,JSON.stringify(result));
    assert.equal(filterQueryOffers(query,[candidate]).offers.length,0);
  });
  test(`R04 RED Q16: a 16GB RAM laptop must lead the lower-priced 8GB one, ${query}`,()=>{
    const relevant=mk(query===queryAr?good:goodEn,2600,{ram:"16GB"});
    const wrong=mk(bad,1000,{ram:"8GB"});
    const right=assessOfferMatch(query,relevant);
    const badMatch=assessOfferMatch(query,wrong);
    assert.equal(right.exactMatch,true,JSON.stringify(right));
    assert.equal(badMatch.exactMatch,false);
    const groups=groupComparableOffers([{...wrong,...badMatch},{...relevant,...right}]);
    assert.equal(groups[0].bestOffer.title,relevant.title);
  });
}

test("R04 safety: unknown RAM not fabricated as exact; explicit 32GB is a different variant",()=>{
  const missing=assessOfferMatch(queryAr,mk(unknown));
  assert.equal(missing.exactMatch,false);
  const higher=assessOfferMatch(queryAr,mk("HP ProBook 450 G9 Laptop 32GB RAM 1TB SSD"));
  assert.equal(higher.exactMatch,false);
});

test("R04 safety: merchant title contradicts stale 16GB metadata; sold title wins",()=>{
  const item=mk(bad,1000,{ram:"16GB"});
  assert.equal(assessOfferMatch(queryAr,item).exactMatch,false);
});

test("R04 safety: unqualified HP laptop searches retain ordinary 8GB discovery",()=>{
  const offer=mk(bad);
  assert.ok(assessOfferMatch("HP laptop",offer).matchConfidence>=0.65);
});
