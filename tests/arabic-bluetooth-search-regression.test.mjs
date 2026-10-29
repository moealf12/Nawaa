import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSearchQuery,parseSearchIntent,filterQueryOffers,
  assessOfferMatch,productCategory} from "../src/search-query.mjs";

const base={
  merchant:"Jarir",
  provider:"jarir",
  sourceUrl:"https://www.jarir.com/sa-en/jbl-tune-headphones-612345.html",
  productPrice:299,
  currency:"SAR",
  condition:"new",
  availability:"unknown",
  specs:{},
};
const headphone={...base,title:"JBL Tune 770NC Wireless Bluetooth Over-Ear Headphones"};
const speaker={...base,title:"JBL Portable Bluetooth Speaker",
  sourceUrl:"https://www.jarir.com/sa-en/jbl-bluetooth-speaker-612346.html"};
const wired={...base,title:"JBL Wired Over-Ear Headphones",
  sourceUrl:"https://www.jarir.com/sa-en/jbl-wired-headphones-612347.html"};

test("Arabic Bluetooth term is mapped as a complete token in both query and retailer title",()=>{
  assert.equal(normalizeSearchQuery("سماعات بلوتوث"),"headphones bluetooth");
  assert.equal(normalizeSearchQuery("سماعة بلوتوث"),"headphones bluetooth");
  assert.equal(parseSearchIntent("سماعات بلوتوث").providerQuery,"headphones bluetooth");
  assert.equal(normalizeSearchQuery("بلوتوثات"),"بلوتوثات");
});
test("Arabic and English Bluetooth-headphone queries retain the same eligible headphones",()=>{
  assert.equal(productCategory(headphone),"audio");
  for(const query of ["سماعات بلوتوث","bluetooth headphones","سماعة بلوتوث"]){
    assert.equal(filterQueryOffers(query,[headphone]).offers.length,1,query);
    assert.equal(assessOfferMatch(query,headphone).matchConfidence>=0.65,true,query);
  }
});
test("Bluetooth speakers cannot replace requested headphones despite shared audio category",()=>{
  assert.equal(productCategory(speaker),"audio");
  for(const query of ["سماعات بلوتوث","bluetooth headphones"]){
    assert.deepEqual(filterQueryOffers(query,[speaker]).offers,[],query);
    assert.equal(assessOfferMatch(query,speaker).exactMatch,false,query);
  }
});
test("Bluetooth headphone request retains Bluetooth attribute constraint",()=>{
  for(const query of ["سماعات بلوتوث","bluetooth headphones"]){
    assert.deepEqual(filterQueryOffers(query,[wired]).offers,[],query);
  }
});
test("Broad standalone headphone search still accepts a genuine wired headphone",()=>{
  assert.equal(filterQueryOffers("سماعات",[wired]).offers.length,1);
  assert.equal(filterQueryOffers("headphones",[wired]).offers.length,1);
});
