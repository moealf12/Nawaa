import test from "node:test";
import assert from "node:assert/strict";
import {acquisitionPlan} from "../server/search-cursor.mjs";
import {prepareSearchResultWindow,SEARCH_WAVE_RESULT_LIMIT} from "../server/search-result-window.mjs";
import {createSearchWavePages} from "../server/search-wave-pages.mjs";

const product=(i,{confidence=0.99,exact=true}={})=>({
  title:"Apple iPhone 17 256GB model "+i,
  sourceUrl:"https://fixtures.invalid/item/"+i,
  merchant:i%4===0?"Jarir":i%4===1?"eXtra":i%4===2?"Noon":"Virgin",
  provider:i%4===0?"jarir-direct":i%4===1?"extra-unbxd":i%4===2?"noon-sa":"virgin-ae",
  providerMarket:"sa",productPrice:3500+i,currency:"SAR",
  matchConfidence:confidence,exactMatch:exact,
  specs:{modelNumber:"TEST-"+i,storage:"256GB"},
});
const offered=(n)=>Array.from({length:n},(_,i)=>product(i));
test("R04: 1000 results is a per-acquired-wave capacity, NOT a 1000-card first payload",()=>{
  assert.equal(SEARCH_WAVE_RESULT_LIMIT,1000);
  for(const depth of [0,1,2]){
    const plan=acquisitionPlan(depth,43);
    assert.equal(plan.resultLimit,1000);
    assert.equal(plan.returnLimit,600);
    const ranked=offered(1501);
    const result=prepareSearchResultWindow(ranked,plan);
    assert.equal(result.rankedCandidates,1501);
    assert.equal(result.allSelectedOffers.length,1000);
    assert.equal(result.selectedOffers.length,plan.returnLimit);
    assert.equal(result.resultLimitReached,true);
    assert.equal(new Set(result.allSelectedOffers.map(o=>o.sourceUrl)).size,1000);
    assert.ok(result.allSelectedOffers.every(o=>o.exactMatch));
  }
});
test("R04: 1000 offers are returned without loss or repeats through 600-offer signed pages",()=>{
  const plan=acquisitionPlan(0,43);
  const ranked=prepareSearchResultWindow(offered(1000),plan);
  const pages=createSearchWavePages();
  const state=pages.remember("iPhone 17",0,ranked.allSelectedOffers,plan.returnLimit,{
    coverage:{resultLimit:1000,rankedCandidates:1000,resultLimitReached:false},
    providers:[],errors:[],
  });
  assert.equal(state.unavailable,false,"1000 realistic offers should fit the default free-tier snapshot budget");
  let cursor=state.cursor;
  const collected=[...ranked.selectedOffers];
  let pageCount=1;
  while(cursor){
    const page=pages.page("iPhone 17",cursor);
    collected.push(...page.offers);pageCount++;
    assert.equal(page.coverage.resultLimit,1000);
    assert.equal(page.coverage.rankedCandidates,1000);
    assert.equal(page.coverage.resultLimitReached,false);
    assert.equal(page.coverage.wavePage.total,1000);
    cursor=page.overflowCursor;
  }
  assert.equal(pageCount,2,"600 plus 400 final offers");
  assert.equal(collected.length,1000);
  assert.deepEqual(collected.map(x=>x.sourceUrl),ranked.allSelectedOffers.map(x=>x.sourceUrl));
});
test("R04: cap is honest and persists on the final signed page, even when page is complete",()=>{
  const plan=acquisitionPlan(0,43);
  const ranked=prepareSearchResultWindow(offered(1201),plan);
  assert.equal(ranked.resultLimitReached,true);
  const pages=createSearchWavePages();
  const stored=pages.remember("iPhone 17",0,ranked.allSelectedOffers,plan.returnLimit,{
    coverage:{rankedCandidates:ranked.rankedCandidates,
      resultLimit:1000,resultLimitReached:ranked.resultLimitReached},
    providers:[],errors:[],
  });
  assert.equal(stored.unavailable,false);
  let cursor=stored.cursor,terminal;
  while(cursor){
    terminal=pages.page("iPhone 17",cursor);
    cursor=terminal.overflowCursor;
  }
  assert.equal(terminal.offers.length,400);
  assert.equal(terminal.coverage.wavePage.remaining,0);
  assert.equal(terminal.coverage.truncated,true,
    "1000-window cap must not claim the 1201st candidate was displayed");
  assert.equal(terminal.coverage.rankedCandidates,1201);
  assert.equal(terminal.coverage.resultLimitReached,true);
});
test("R04: ties/price noise and weak accessories cannot promote above exact SKU results",()=>{
  const exact=Array.from({length:1000},(_,i)=>product(i));
  const accessories=Array.from({length:50},(_,i)=>product(i+1000,{confidence:.12,exact:false}))
    .map(x=>({...x,title:"iPhone protective case",productPrice:.01}));
  const a=prepareSearchResultWindow([...accessories,...exact],acquisitionPlan(0,43));
  assert.equal(a.allSelectedOffers.length,1000);
  assert.equal(a.resultLimitReached,true);
  assert.ok(a.allSelectedOffers.every(x=>x.exactMatch));
});
test("R04: empty and sparse queries are not padded to 1000 products",()=>{
  const plan=acquisitionPlan(0,43);
  const empty=prepareSearchResultWindow([],plan);
  assert.equal(empty.selectedOffers.length,0);
  assert.equal(empty.rankedCandidates,0);
  assert.equal(empty.resultLimitReached,false);
  const sparse=prepareSearchResultWindow(offered(2),plan);
  assert.equal(sparse.allSelectedOffers.length,2);
  assert.equal(sparse.resultLimitReached,false);
  assert.throws(()=>prepareSearchResultWindow([],{
    returnLimit:1000,resultLimit:120}),/invalid_search_result_window/);
});
