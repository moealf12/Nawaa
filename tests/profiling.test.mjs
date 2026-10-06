import test from "node:test";
import assert from "node:assert/strict";
import { createExtractionProfile, PROFILE_STATUS } from "../server/source-inspector/profiling/profile-schema.mjs";
import { applyInspectorEvidence, finalizeExtractionProfile } from "../server/source-inspector/profiling/profile-builder.mjs";
import { diffExtractionProfiles } from "../server/source-inspector/profiling/profile-diff.mjs";
import { versionExtractionProfile } from "../server/source-inspector/profiling/profile-versioning.mjs";
import { saveExtractionProfile, loadExtractionProfile, createProfileStore } from "../server/source-inspector/profiling/profile-store.mjs";

test("profile opens before probes and accumulates evidence",()=>{
 const p=createExtractionProfile({sourceId:"store-sa",sourceUrl:"https://example.com"});
 const n=applyInspectorEvidence(p,{observedAt:"2026-10-07T00:00:00.000Z",phase:"FAST_PROBE",source:{url:"https://example.com/"},capabilities:{platform:"nextjs",jsonLd:true,embeddedJson:true,searchHint:true},strategies:[{id:"jsonld",score:93}],selectedStrategy:{id:"jsonld",score:93},probes:{}});
 assert.equal(n.status,PROFILE_STATUS.OPEN); assert.equal(n.platform,"nextjs"); assert.equal(n.mechanisms.product,"json-ld"); assert.equal(n.evidence.length,1);
});
test("profile is finalized only explicitly",()=>{const p=createExtractionProfile({sourceUrl:"https://example.com"});const n=finalizeExtractionProfile(p,{market:"KSA",currency:"SAR"});assert.equal(n.status,PROFILE_STATUS.COMPLETE);assert.equal(n.currency,"SAR");});
test("profile diff and versioning preserve history semantics",()=>{const a=createExtractionProfile({sourceUrl:"https://example.com"});const b={...a,currency:"SAR"};const d=diffExtractionProfiles(a,b);assert.equal(d.changed,true);const v=versionExtractionProfile(a,b,{reason:"currency-verified",now:"2026-10-07T01:00:00.000Z"});assert.equal(v.profileVersion,2);assert.equal(v.changeReason,"currency-verified");});
test("profile store persists a valid source-specific profile",async()=>{const store=createProfileStore();const p=createExtractionProfile({sourceId:"extra-sa",sourceUrl:"https://www.extra.com"});await saveExtractionProfile(p,{store});const loaded=await loadExtractionProfile("extra-sa",{store});assert.equal(loaded.sourceId,"extra-sa");});

test("profile diff detects nested mechanism changes",()=>{const a=createExtractionProfile({sourceUrl:"https://shop.example"});const b=structuredClone(a);b.mechanisms.product="json-xhr";const d=diffExtractionProfiles(a,b);assert.equal(d.changed,true);assert.equal(d.changes.some(x=>x.field==="mechanisms"),true);});
