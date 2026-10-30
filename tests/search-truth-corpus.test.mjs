import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {normalizeSearchQuery,parseSearchIntent,assessOfferMatch} from "../src/search-query.mjs";

const corpus=JSON.parse(readFileSync(new URL("../engineering/execution/search-truth-corpus.json",import.meta.url),"utf8"));
const hash=createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
test("R01 SHA-bound 36-query Arabic/English corpus has unique identifiers and a stable content fingerprint",()=>{
  assert.equal(corpus.schemaVersion,"nawaa.search-corpus.v1");
  assert.match(corpus.baselineSha,/^[0-9a-f]{40}$/);
  assert.equal(corpus.liveMerchantCertification,false);
  assert.equal(corpus.queryCases.length,36);
  assert.equal(new Set(corpus.queryCases.map(x=>x.id)).size,36);
  assert.equal(corpus.queryCases.filter(x=>x.language==="ar").length,18);
  assert.equal(corpus.queryCases.filter(x=>x.language==="en").length,18);
  assert.match(hash,/^[a-f0-9]{64}$/);
  console.log("NAWAA_SEARCH_TRUTH_CORPUS_SHA256",hash);
});
test("R01 all 36 multilingual query intents parse deterministically without source network",()=>{
  for(const item of corpus.queryCases){
    assert.ok(["ar","en"].includes(item.language));
    assert.ok(typeof item.group==="string"&&item.group.length>2);
    const one=normalizeSearchQuery(item.query);
    assert.ok(typeof one==="string"&&one.trim(),"empty normalization: "+item.id);
    assert.equal(normalizeSearchQuery(item.query),one,"unstable normalization: "+item.id);
    const intent=parseSearchIntent(item.query);
    assert.ok(intent&&typeof intent==="object","missing intent: "+item.id);
  }
});
test("R01 adversarial exact-match fixtures preserve known variant and accessory boundaries",()=>{
  assert.equal(corpus.matchCases.length,7);
  for(const f of corpus.matchCases){
    const offer={title:f.title,merchant:"Synthetic fixture",sourceUrl:"https://example.com/test/"+f.id,condition:"new"};
    const result=assessOfferMatch(f.query,offer);
    assert.equal(result.exactMatch,f.expectedExact,
      f.id+": "+f.why+" confidence="+result.matchConfidence);
  }
});
test("R01 source access failure is never a proven stock-out in the glossary",()=>{
  assert.equal(corpus.sourceScenarios.length,8);
  for(const s of corpus.sourceScenarios){
    assert.equal(s.verified,false);
    assert.equal(s.stockConclusion,"UNKNOWN");
    assert.ok(["transport","discovery","identity","price","publication"].includes(s.stage));
  }
});
