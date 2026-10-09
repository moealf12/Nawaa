import test from "node:test";
import assert from "node:assert/strict";
import {issueSourceAttestation,verifySourceAttestation,createSignedSourceVerifier} from "../server/tooling/source-attestation.mjs";
import {createOfferIngestionHandler} from "../server/tooling/offer-ingestion-worker.mjs";
const key="isolated-ci-test-secret-should-be-at-least-32-bytes";
const sourceHosts={"ikea-sa":["ikea.com"]},clock=()=>1791562800000;
const offer={title:"IKEA POANG chair",sourceUrl:"https://www.ikea.com/sa/en/p/poang-chair",productPrice:399,currency:"SAR",merchant:"IKEA",image:"https://www.ikea.com/example.jpg"};
const data=()=>({sourceId:"ikea-sa",verifiedBySource:"ikea-sa",offer});
test("signed merchant-origin attestation binds original URL, price, title and source",()=>{
 const attestation=issueSourceAttestation({sourceId:"ikea-sa",offer,sourceHosts,key,clock});
 const input={sourceId:"ikea-sa",offer,attestation,sourceHosts,key,clock};
 assert.equal(verifySourceAttestation(input),true);
 for(const modified of [{productPrice:1},{title:"Unrelated product"},{sourceUrl:"https://ikea.com/sa/en/p/other"},{currency:"USD"},{image:"https://example.org/other.jpg"}])
  assert.equal(verifySourceAttestation({...input,offer:{...offer,...modified}}),false);
 assert.equal(verifySourceAttestation({...input,sourceId:"other"}),false);
});
test("attestations reject domains posing as merchants, missing secrets and stale proofs",()=>{
 for(const url of ["https://ikea.com.bad.example/item","https://badikea.com/item","http://www.ikea.com/item"])
  assert.throws(()=>issueSourceAttestation({sourceId:"ikea-sa",offer:{...offer,sourceUrl:url},sourceHosts,key,clock}));
 assert.throws(()=>issueSourceAttestation({sourceId:"ikea-sa",offer,sourceHosts,key:"short",clock}),/signing_key_required/);
 const attestation=issueSourceAttestation({sourceId:"ikea-sa",offer,sourceHosts,key,clock});
 assert.equal(verifySourceAttestation({sourceId:"ikea-sa",offer,attestation,sourceHosts,key,clock:()=>clock()+16*60*1000}),false);
 assert.equal(verifySourceAttestation({sourceId:"ikea-sa",offer,attestation,sourceHosts,key,clock:()=>clock()-60000}),false);
});
test("ingestion requires intact signed attestation from trusted source adapter",async()=>{
 const attestation=issueSourceAttestation({sourceId:"ikea-sa",offer,sourceHosts,key,clock});
 const verify=createSignedSourceVerifier({sourceHosts,key,clock});
 let writes=0;
 const handler=createOfferIngestionHandler({verify,record:async()=>{writes++;return {recorded:true,observationId:21};}});
 assert.equal((await handler({id:"00000000-0000-4000-8000-000000000001",data:{...data(),attestation}})).recorded,true);
 await assert.rejects(handler({data:{...data(),attestation,offer:{...offer,productPrice:10}}}),/trusted_source_verifier_required/);
 await assert.rejects(handler({data:{...data(),attestation:"v1.0.bad"}}),/trusted_source_verifier_required/);
 assert.equal(writes,1);
});
