import test from "node:test";
import assert from "node:assert/strict";
import {benchmarkDecathlonShadowQuote} from "../scripts/benchmark-decathlon-shadow-quote.mjs";

test("fixture-only benchmark quantifies detection, never claims production uplift",()=>{
  let t=0;
  const out=benchmarkDecathlonShadowQuote({iterations:3,now:()=>{t+=.25;return t;}});
  assert.equal(out.fixtureCount,12);
  assert.equal(out.scenarioCount,4);
  assert.equal(out.wrongQuoteOrOfferPromotions,0);
  assert.equal(out.scenarioClassificationErrors,0);
  assert.equal(out.priceDriftDetected,3);
  assert.equal(out.networkRequests,0);
  assert.equal(out.productionRecallImprovementCertified,false);
  assert.equal(out.productionPricePrecisionCertified,false);
  assert.ok(out.localShadowLatencyMs.onP95>=0);
});
test("benchmark refuses unbounded fixture loops",()=>{
  for(const iterations of [0,-1,301,1.5,NaN]){
    assert.throws(()=>benchmarkDecathlonShadowQuote({iterations}),/bounded_iterations_required/);
  }
});
