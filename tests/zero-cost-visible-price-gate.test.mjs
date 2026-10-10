import test from "node:test";
import assert from "node:assert/strict";
import {verifyIkeaVisiblePrice} from "../server/tooling/ikea-dom-price-proof.mjs";
const url="https://www.ikea.com/sa/en/p/poang-chair-12345678/";
const offer={title:"POANG armchair",sourceUrl:url,productPrice:479,currency:"SAR"};
const markup=price=>"<html><div class='pipcom-pip-price-module'>POANG armchair ﷼"+price+"</div></html>";
test("visible-price attestation succeeds on verified same merchant page",async()=>{
 const proof=await verifyIkeaVisiblePrice(offer,{fetchPage:async()=>({finalUrl:url,html:markup("479")})});
 assert.equal(proof.status,"matched");
 assert.equal(proof.price,479);
});
test("visible-price gate rejects wrong visible price and redirects",async()=>{
 await assert.rejects(verifyIkeaVisiblePrice(offer,{fetchPage:async()=>({finalUrl:url,html:markup("399")})}),/visible_price_evidence_mismatch/);
 await assert.rejects(verifyIkeaVisiblePrice(offer,{fetchPage:async()=>({finalUrl:"https://www.ikea.com/sa/en/p/other-chair-87654321/",html:markup("479")})}),/visible_price_page_identity_mismatch/);
});
