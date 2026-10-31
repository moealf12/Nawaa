import test from "node:test";
import assert from "node:assert/strict";
import {evaluateR04,ndcgAt,mrrAt} from "../scripts/evaluate-ranking-r04.mjs";

test("R04 metrics: graded NDCG@10 and first truly matching item MRR@10",()=>{
  const grades={a:3,b:0,c:2};
  assert.equal(ndcgAt(["a","c","b"],grades),1);
  assert.ok(ndcgAt(["b","c","a"],grades)<1);
  assert.equal(mrrAt(["b","c","a"],grades),1/3);
  assert.equal(mrrAt(["b","c"],grades),0);
  assert.equal(ndcgAt([],{}),1,"empty relevance requires a separately reported coverage metric");
});

test("R04 benchmark: pinned 36 bilingual intents, 18 paired scenarios, no missing labels",()=>{
  const result=evaluateR04();
  assert.equal(result.sourceCorpusCases,36);
  assert.equal(result.pairedScenarios,18);
  assert.equal(result.cases.length,36);
  assert.equal(new Set(result.cases.map(x=>x.id)).size,36);
  assert.deepEqual(result.cases.map(x=>x.id).sort(),
    Array.from({length:36},(_,i)=>"Q"+String(i+1).padStart(2,"0")));
  assert.equal(result.provenance,"SYNTHETIC_DESIGNED_FIXTURES_NOT_INDEPENDENTLY_ADJUDICATED");
});

test("R04 evaluated ranking: no measured relevance regression or accessory leak",()=>{
  const result=evaluateR04(),r=result.aggregate;
  assert.equal(r.degradedNdcgQueries,0,"graded relevance must not regress for a cheaper offer");
  assert.equal(r.degradedMrrQueries,0,"first principal product must not arrive later");
  assert.equal(r.accessoryFirstQueries,0,"accessories cannot outrank a matched principal item");
  assert.ok(r.candidateNdcgAt10>=r.baselineNdcgAt10);
  assert.ok(r.candidateMrrAt10>=r.baselineMrrAt10);
});

test("R04 evaluated value ranking: equivalent SAR offers improve first comparable price",()=>{
  const result=evaluateR04(),r=result.aggregate;
  assert.equal(r.improvedFirstPriceQueries,36);
  assert.ok(r.baselineFirstComparablePriceRegret>0);
  assert.equal(r.candidateFirstComparablePriceRegret,0);
  assert.ok(result.cases.every(x=>x.candidateTop.endsWith("-sameLow")));
  // Synthetic fixtures quantify a controlled ordering behavior, NOT a 36-query
  // production improvement. Independent judgments and live search remain gates.
  console.log("R04_SYNTHETIC_RANKING_METRICS "+JSON.stringify(r));
});
