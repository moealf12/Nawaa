import test from "node:test";
import assert from "node:assert/strict";
import {inspectSource} from "../server/source-inspector/inspector.mjs";
import {createExtractionProfile} from "../server/source-inspector/profiling/profile-schema.mjs";
import {applyInspectorEvidence} from "../server/source-inspector/profiling/profile-builder.mjs";

test("LIVE DIAGNOSTIC eXtra category resolves pagination and market",{skip:process.env.NAWAA_LIVE_DIAGNOSTICS !== "1" ? "Run separately with NAWAA_LIVE_DIAGNOSTICS=1; public endpoint may return HTTP 403" : false},async()=>{
 const url="https://www.extra.com/en-sa/iphone-17-series/c/All-iPhone-17/facet/citySelectionForm";
 const inspection=await inspectSource(url,{timeoutMs:10000});
 const profile=applyInspectorEvidence(createExtractionProfile({sourceId:"extra-sa",sourceUrl:url}),inspection);
 console.log("EXTRA_LIVE",JSON.stringify({status:inspection.probes.html.status,bytes:inspection.probes.html.bytes,strategy:inspection.selectedStrategy,pagination:inspection.probes.pagination,market:profile.market,currency:profile.currency,searchEndpoints:profile.endpoints.search.slice(0,5)}));
 assert.equal(inspection.probes.html.ok,true);
 assert.equal(inspection.probes.pagination.ok,true);
 assert.equal(profile.market,"KSA");
 assert.equal(profile.currency,"SAR");
});
