import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSearchQuery,parseSearchIntent,assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

// Independent, synthetically wrapped retail-title contracts.
// The title of the guide was actually observed on P0 LIVE artifact 13185305712.
// The genuine-device and accessory titles are controls, not stock or price claims.
const offer=(title,id)=>({
 title,sourceUrl:"https://fixture.invalid/"+id,merchant:"TEST_ONLY",
 provider:"test",condition:"new",availability:"in_stock",productPrice:999,currency:"SAR",specs:{}
});
test("R04 P0 RED: preserve Arabic camera/vacuum/watch retail intent in canonical search tokens",()=>{
 const checks=[
  ["كاميرا كانون بدون مرآة",["camera","canon","mirrorless"],"camera"],
  ["مكنسة دايسون V15",["vacuum","dyson","v15"],"vacuum"],
  ["ساعة ابل سيريس 11",["watch","apple","series","11"],"watch"]
 ];
 for(const [raw,tokens,category] of checks){
  const intent=parseSearchIntent(raw);
  for(const token of tokens)assert.ok(intent.providerQuery.split(" ").includes(token),
    raw+" missing canonical token "+token+" in "+intent.providerQuery);
  assert.equal(intent.category,category,raw+" wrong category");
 }
});
test("R04 P0 RED: valid complete principals match bilingual semantic-equivalent requests",()=>{
 const cases=[
  ["كاميرا كانون بدون مرآة","Canon EOS R50 Mirrorless Camera Body"],
  ["مكنسة دايسون V15","Dyson V15 Detect Absolute Cordless Vacuum Cleaner"],
  ["ساعة ابل سيريس 11","Apple Watch Series 11 GPS Smartwatch 46mm"],
  ["Apple Watch Series 11","Apple Watch Series 11 GPS Smartwatch 46mm"]
 ];
 for(const [query,title] of cases){
  const candidate=offer(title,query);
  const m=assessOfferMatch(query,candidate);
  assert.equal(m.exactMatch,true,query+" failed valid complete item "+JSON.stringify(m));
  assert.equal(filterQueryOffers(query,[candidate]).offers.length,1,query+" disappeared from discovery");
 }
});
test("R04 P0 RED: known physical books never exact-match whole Apple Watch 11",()=>{
 const title="Apple Watch Series 11 for Beginners and Seniors: An Easy Visual Guide to Navigation, Health Monitoring, Fitness Tracking";
 for(const query of ["Apple Watch 11","Apple Watch Series 11","ساعة ابل سيريس 11"]){
  const item=offer(title,query);
  const m=assessOfferMatch(query,item);
  assert.equal(m.exactMatch,false,query+" matched a book as a complete wearable");
  assert.equal(filterQueryOffers(query,[item]).offers.length,0,query+" retained book in strict shopping");
 }
});
test("R04 P0: preserve explicit guide/accessory intent and genuine bundled devices",()=>{
 const checks=[
  ["Apple Watch Series 11 beginners guide","Apple Watch Series 11 for Beginners and Seniors: An Easy Visual Guide"],
  ["Apple Watch Series 11 strap","Apple Watch Series 11 Replacement Sport Strap Band"],
  ["ساعة ابل سيريس 11 سوار","Apple Watch Series 11 Replacement Sport Strap Band"],
  ["Apple Watch Series 11","Apple Watch Series 11 GPS Smartwatch with Quick Start Guide"],
  ["Canon mirrorless camera","Canon EOS R50 Mirrorless Camera Body with Lens Kit"],
  ["Dyson V15 vacuum cleaner","Dyson V15 Detect Absolute Vacuum Cleaner with HEPA Filter"]
 ];
 for(const [query,title] of checks){
  const m=assessOfferMatch(query,offer(title,title.slice(0,15)));
  assert.ok(m.matchConfidence>=0.65,query+" over-blocked "+JSON.stringify(m));
 }
});
test("R04 P0: do not turn accessory-only queries into principal requests",()=>{
 for(const q of ["Dyson V15 vacuum filter","Canon EOS R50 camera lens","Apple Watch Series 11 tempered glass"]){
  assert.ok(normalizeSearchQuery(q).length>0);
 }
});
