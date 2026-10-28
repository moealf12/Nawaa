import assert from "node:assert/strict";
import test from "node:test";
import {retiredSourceRecord,isRetiredSourceUrl} from "../src/source-retirement.mjs";
import {configuredFreeStorefronts,routeFreeStorefronts,searchFreeStorefrontById}
  from "../server/providers/free-storefronts.mjs";
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {EUROPE_SOURCES,summarizeEuropeanProbe} from "../src/europe-source-yield.mjs";
import {currentSources} from "../server/source-config.mjs";

test("retired BIKE24 is catalog 404, never a fabricated HTTP 404",()=>{
  const state=retiredSourceRecord("bike24-de");
  assert.equal(state.status,"SOURCE_RETIRED");
  assert.equal(state.catalogCode,404);
  assert.equal(state.observedHttpStatus,null);
  assert.equal(retiredSourceRecord("thomann-de"),null);
  const registry=currentSources().find(entry=>entry.id==="bike24-de");
  assert.equal(registry.status,"disabled");
  assert.equal(registry.sourceStatus,"SOURCE_RETIRED");
  assert.equal(registry.catalogCode,404);
  assert.equal(registry.httpStatus,null);
  assert.deepEqual(registry.adapters,[]);
});

test("BIKE24 is absent from catalog, routing, and five-source European pilot",()=>{
  assert.equal(configuredFreeStorefronts().some(x=>x.id==="bike24-de"),false);
  for(const query of ["bike24 cycling shoes","garmin edge 540","running shoes"])
    assert.equal(routeFreeStorefronts(query).some(x=>x.store.id==="bike24-de"),false);
  assert.equal(Object.hasOwn(EUROPE_SOURCES,"bike24-de"),false);
  assert.equal(Object.keys(EUROPE_SOURCES).length,5);
  assert.equal(Object.hasOwn(EUROPE_SOURCES,"thomann-de"),true);
});

test("direct retired source call gives zero offers, no attempted network or false HTTP status",async()=>{
  const result=await searchFreeStorefrontById("bike24-de","garmin edge 540");
  assert.equal(result.candidates,0);
  assert.deepEqual(result.offers,[]);
  assert.equal(result.searchUrl,null);
  assert.equal(result.diagnostics.status,"SOURCE_RETIRED");
  assert.equal(result.diagnostics.sourceCatalogCode,404);
  assert.equal(result.diagnostics.httpStatus,null);
  const report=summarizeEuropeanProbe("bike24-de",result);
  assert.equal(report.status,"SOURCE_RETIRED");
  assert.equal(report.httpStatus,null);
});

test("manual product page and subdomains are blocked before DNS/network",async()=>{
  for(const url of [
    "https://www.bike24.com/p2735527.html",
    "https://bike24.de/p2735527.html",
    "https://assets.bike24.com/p2735527.html",
  ]){
    assert.equal(isRetiredSourceUrl(url),true);
    await assert.rejects(fetchHtmlSafe(url),error=>error.message==="SOURCE_RETIRED" && error.sourceCatalogCode===404);
  }
  assert.equal(isRetiredSourceUrl("https://bike24.com.evil.example/p2735527.html"),false);
  assert.equal(isRetiredSourceUrl("https://www.thomann.de/de/hd_662.htm"),false);
});
