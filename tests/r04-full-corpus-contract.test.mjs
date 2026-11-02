import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateR04Corpus,summarizeR04Judgments,summarizeR04LiveEvidence} from "../scripts/r04-full-corpus-contract.mjs";

const corpus=JSON.parse(readFileSync(new URL("../engineering/execution/search-truth-corpus.json",import.meta.url),"utf8"));
const validSha="a".repeat(40);
const row=i=>({id:"Q"+String(i).padStart(2,"0"),status:"OBSERVED",partial:true,
  sourceErrors:2,firstTen:[{judgment:{grade:3}}],judgments:{ndcg10:null,unjudged:1}});
test("R04 36: validate exact 18 paired bilingual intents",()=>{
  assert.deepEqual(validateR04Corpus(corpus),{pass:true,pairs:18,queries:36});
});
test("R04 36: missing, duplicated, reordered and unpaired intents fail closed",()=>{
  for(const mutate of [
    x=>x.queryCases.pop(),
    x=>x.queryCases[1].language="en",
    x=>x.queryCases[2].id="Q02",
    x=>x.queryCases[2].query=x.queryCases[0].query,
    x=>x.queryCases[0].query="  ",
  ]){
    const bad=structuredClone(corpus);mutate(bad);
    assert.equal(validateR04Corpus(bad).pass,false);
  }
});
test("R04 36: unknown labels cannot be coerced to zero and cannot produce NDCG",()=>{
  const result=summarizeR04Judgments([{grade:3},{grade:null},{grade:0}]);
  assert.equal(result.ndcg10,null);assert.equal(result.mrr10,null);
  assert.equal(result.unjudged,1);
  assert.equal(result.status,"INCOMPLETE_INDEPENDENT_JUDGMENTS");
});
test("R04 36: all known grades yield reproducible rule-based metrics, not human certificate",()=>{
  const result=summarizeR04Judgments([{grade:3},{grade:0},{grade:2}]);
  const expected=(7+3/Math.log2(4))/(7+3/Math.log2(3));
  assert.equal(result.ndcg10,Number(expected.toFixed(6)));
  assert.equal(result.mrr10,1);
  assert.equal(result.status,"FULLY_RULE_JUDGED_NOT_HUMAN_CERTIFIED");
});
test("R04 36: empty results must not be assigned perfect relevance",()=>{
  const x=summarizeR04Judgments([]);
  assert.equal(x.ndcg10,null);
  assert.equal(x.status,"NO_RESULTS");
});
test("R04 36: 36 observed partial results qualify only as evidence collected, not VERIFIED",()=>{
  const x=summarizeR04LiveEvidence(Array.from({length:36},(_,i)=>row(i+1)),{
    expectedSha:validSha,observedSha:validSha});
  assert.equal(x.evidenceCollected,true);assert.equal(x.rankingRoundCertified,false);
  assert.equal(x.humanJudgmentCertified,false);assert.equal(x.unknownJudgments,36);
  assert.equal(x.sourceErrorEvents,72);
});
test("R04 36: missing query or mismatched production revision blocks evidence",()=>{
  const rows=Array.from({length:36},(_,i)=>row(i+1));
  assert.equal(summarizeR04LiveEvidence(rows.slice(1),{expectedSha:validSha,observedSha:validSha}).evidenceCollected,false);
  assert.equal(summarizeR04LiveEvidence(rows,{expectedSha:validSha,observedSha:"b".repeat(40)}).evidenceCollected,false);
  rows[2].id=rows[0].id;
  assert.equal(summarizeR04LiveEvidence(rows,{expectedSha:validSha,observedSha:validSha}).evidenceCollected,false);
});
test("R04 36: a failed request cannot masquerade as collected evidence",()=>{
  const rows=Array.from({length:36},(_,i)=>row(i+1));rows[9].status="REQUEST_FAILED";
  const result=summarizeR04LiveEvidence(rows,{expectedSha:validSha,observedSha:validSha});
  assert.equal(result.evidenceCollected,false);
  assert.deepEqual(result.requestFailures,["Q10"]);
});

test("R04 36: missing source error counters are UNKNOWN and block evidence certificate",()=>{
  const rows=Array.from({length:36},(_,i)=>row(i+1));delete rows[4].sourceErrors;
  const result=summarizeR04LiveEvidence(rows,{expectedSha:validSha,observedSha:validSha});
  assert.equal(result.evidenceCollected,false);
  assert.deepEqual(result.missingSourceErrorCounters,["Q05"]);
  assert.equal(result.sourceErrorEvents,70);
});
