import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSearchQuery, parseSearchIntent, assessOfferMatch, queryMatchReasons, filterQueryOffers} from "../src/search-query.mjs";
import {groupComparableOffers, offerVariantKey} from "../src/search-core.mjs";

const base = {title:"Samsung Galaxy S25, 256 GB, 12 GB RAM, Icy Blue, 5G, Snapdragon 8 Elite",
  merchant:"Jarir",brand:"Samsung",sourceUrl:"https://www.jarir.com/sa-en/samsung-galaxy-s25-smartphones-651002.html",
  productPrice:3639,currency:"SAR",condition:"new"};
// This is a real title observed in the public NAWAA API on 2026-10-28.
const plus = {title:"Samsung Galaxy S25+ 5G 256GB 12GB RAM Silver Shadow AI Smartphone Middle East Version",
  merchant:"Sharaf DG",brand:"Samsung",sourceUrl:"https://saudi.sharafdg.com/en/product/samsung-galaxy-s25-5g-256gb-12gb-ram-silver-shadow-ai-smartphone/",
  productPrice:3299.01,currency:"SAR",condition:"new"};
const ultra={...base,title:"Samsung Galaxy S25 Ultra 256GB 12GB RAM",sourceUrl:"https://example.com/s25-ultra"};
const fe={...base,title:"Samsung Galaxy S25 FE 256GB 12GB RAM",sourceUrl:"https://example.com/s25-fe"};

test("RED production: S25+ must not claim an exact base S25 match",()=>{
  assert.equal(parseSearchIntent(plus.title).model,"galaxy s25 plus");
  const result=assessOfferMatch("Samsung Galaxy S25 256GB",plus);
  assert.equal(result.exactMatch,false);
  assert.ok(result.matchConfidence<0.35,JSON.stringify(result));
  assert.ok(queryMatchReasons("Samsung Galaxy S25 256GB",plus).includes("model_conflict"));
  assert.deepEqual(filterQueryOffers("Samsung Galaxy S25 256GB",[base,plus]).offers.map(x=>x.merchant),["Jarir"]);
});

test("RED: plus-form normalizations preserve distinct models with Arabic/English queries",()=>{
  for(const value of ["Samsung Galaxy S25+ 5G","Samsung Galaxy S25 + 5G","سامسونج جالاكسي S25+ 5G"]){
    assert.equal(parseSearchIntent(value).model,"galaxy s25 plus",value);
    assert.ok(normalizeSearchQuery(value).includes("s25 plus"),value);
  }
  assert.equal(parseSearchIntent("جالاكسي S25 بلس").model,"galaxy s25 plus");
  assert.equal(parseSearchIntent("Galaxy S25").model,"galaxy s25");
});

test("RED: explicit Galaxy S25 variants cannot borrow an exact base price",()=>{
  const q="Galaxy S25 256GB";
  for(const offer of [plus,ultra,fe]){
    const result=assessOfferMatch(q,offer);
    assert.equal(result.exactMatch,false,offer.title);
    assert.ok(result.matchConfidence<0.35,offer.title+": "+JSON.stringify(result));
  }
  assert.equal(assessOfferMatch(q,base).exactMatch,true);
  assert.notEqual(offerVariantKey(base),offerVariantKey(plus));
  const groups=groupComparableOffers([base,plus],"lowest");
  assert.ok(groups.length>=2,"variants of different models cannot become one sellable comparison");
});

test("positive: explicitly requested Plus remains discoverable and distinct",()=>{
  const q="Samsung Galaxy S25+ 256GB";
  assert.equal(assessOfferMatch(q,plus).exactMatch,true);
  assert.ok(assessOfferMatch(q,base).matchConfidence<0.35);
  assert.deepEqual(filterQueryOffers(q,[base,plus]).offers.map(x=>x.merchant),["Sharaf DG"]);
});

test("boundary: unrelated arithmetic plus symbols and broad Galaxy searches remain safe",()=>{
  assert.equal(normalizeSearchQuery("25 + 25"),"25 25");
  assert.notEqual(parseSearchIntent("Samsung Galaxy S25 Ultra").model,parseSearchIntent("Samsung Galaxy S25+").model);
  assert.ok(assessOfferMatch("Samsung Galaxy",plus).matchConfidence>=0.35);
});
