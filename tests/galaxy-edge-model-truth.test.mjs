import test from "node:test";
import assert from "node:assert/strict";
import {parseSearchIntent,assessOfferMatch,queryMatchReasons,filterQueryOffers} from "../src/search-query.mjs";
import {groupComparableOffers,offerVariantKey} from "../src/search-core.mjs";

const edge={
 title:"Samsung Galaxy S25 Edge, 256 GB, 12 GB RAM, Titanium Icy Blue, 5G, Snapdragon 8 Elite",
 merchant:"Jarir",brand:"Samsung",sourceUrl:"https://www.jarir.com/sa-en/samsung-galaxy-s25-edge-smartphones-000001.html",
 productPrice:2999,currency:"SAR",condition:"new",
};
const base={
 ...edge,title:"Samsung Galaxy S25, 256 GB, 12 GB RAM, Icy Blue, 5G, Snapdragon 8 Elite",
 sourceUrl:"https://www.jarir.com/sa-en/samsung-galaxy-s25-smartphones-651002.html"
};
const plus={...edge,title:"Samsung Galaxy S25+ 5G 256GB",sourceUrl:"https://example.org/s25-plus"};
const ultra={...edge,title:"Samsung Galaxy S25 Ultra 256GB",sourceUrl:"https://example.org/s25-ultra"};
const fe={...edge,title:"Samsung Galaxy S25 FE 256GB",sourceUrl:"https://example.org/s25-fe"};

test("RED live production S25 Edge is not a base Galaxy S25 exact match",()=>{
 assert.equal(parseSearchIntent(edge.title).model,"galaxy s25 edge");
 const comparison=assessOfferMatch("Samsung Galaxy S25 256GB",edge);
 assert.equal(comparison.exactMatch,false);
 assert.ok(comparison.matchConfidence<0.35,JSON.stringify(comparison));
 assert.ok(queryMatchReasons("Samsung Galaxy S25 256GB",edge).includes("model_conflict"));
 assert.deepEqual(filterQueryOffers("Samsung Galaxy S25 256GB",[edge,base]).offers.map(o=>o.title),[base.title]);
});

test("RED directly requested Galaxy S25 Edge must match and avoid other editions",()=>{
 for(const q of ["Galaxy S25 Edge 256GB","سامسونج جالاكسي S25 Edge 256GB"]){
   assert.equal(parseSearchIntent(q).model,"galaxy s25 edge");
   assert.equal(assessOfferMatch(q,edge).exactMatch,true,q);
   const eligible=filterQueryOffers(q,[base,plus,ultra,fe,edge]).offers;
   assert.deepEqual(eligible.map(o=>o.title),[edge.title],q);
 }
});

test("RED Samsung models have distinct compare keys and broad discovery is retained",()=>{
 assert.notEqual(offerVariantKey(edge),offerVariantKey(base));
 assert.equal(groupComparableOffers([base,edge],"lowest").length,2);
 assert.ok(assessOfferMatch("Samsung Galaxy",edge).matchConfidence>=0.35);
 assert.notEqual(parseSearchIntent("Galaxy S25 Edge").model,parseSearchIntent("Galaxy S25 Plus").model);
});
