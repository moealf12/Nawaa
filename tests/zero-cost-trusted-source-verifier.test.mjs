import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedSourceVerifier} from "../server/tooling/trusted-source-verifier.mjs";
const valid={title:"Genuine merchant listing",productPrice:70,currency:"SAR",sourceUrl:"https://www.ikea.com/sa/en/p/item"};
test("merchant identity AND independently checked evidence are both mandatory",async()=>{
 let n=0;
 const verify=createTrustedSourceVerifier({sourceHosts:{"ikea-sa":["ikea.com"]},verifyEvidence:async()=>{n++;return true;}});
 assert.equal(await verify({sourceId:"ikea-sa",offer:valid}),true);
 assert.equal(await verify({sourceId:"ikea-sa",offer:{...valid,sourceUrl:"https://ikea.com.attacker.com/p"}}),false);
 assert.equal(await verify({sourceId:"ikea-sa",offer:{...valid,sourceUrl:"http://www.ikea.com/p"}}),false);
 assert.equal(await verify({sourceId:"ikea-sa",offer:{...valid,sourceUrl:"https://www.ikea.com:8888/p"}}),false);
 assert.equal(await verify({sourceId:"unknown",offer:valid}),false);
 assert.equal(n,1);
});
test("verified-looking payloads are refused when evidence check fails",async()=>{
 const verify=createTrustedSourceVerifier({sourceHosts:{"ikea-sa":["ikea.com"]},verifyEvidence:async()=>false});
 assert.equal(await verify({sourceId:"ikea-sa",offer:valid,job:{verifiedBySource:"ikea-sa"}}),false);
 assert.throws(()=>createTrustedSourceVerifier({sourceHosts:{"ikea-sa":["ikea.com"]}}),/evidence_verifier_required/);
});
