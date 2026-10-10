import test from "node:test";
import assert from "node:assert/strict";
import {carrefourPdpId,inspectCarrefourImageEvidence} from "../server/tooling/carrefour-image-evidence.mjs";
const id="2258790",title="Apple iPhone 17 256 GB Sage 5G";
const url="https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-sage/p/2258790?offer=123";
const page=inner=>"<html><body>"+inner+"</body></html>";
const link='<a href="/mafuae/en/smartphones/apple-iphone-17-256gb-sage/p/2258790"><span>Apple iPhone 17 256 GB Sage 5G</span></a>';
test("normalizes only official Carrefour numeric PDP URL",()=>{
 assert.equal(carrefourPdpId(url),id);
 assert.equal(carrefourPdpId("https://evil.carrefouruae.com/mafuae/en/test/p/2258790"),null);
 assert.equal(carrefourPdpId("https://www.carrefouruae.com.evil.test/mafuae/en/test/p/2258790"),null);
 assert.equal(carrefourPdpId("javascript:alert(1)"),null);
});
test("image immediately before product link is verified by exact alt inside a single card",()=>{
 const html=page('<div class="card"><picture><source srcset="https://cdn.mafrservices.com/img/2258790.webp 1x"></picture>'+
 '<img data-src="https://cdn.mafrservices.com/img/2258790.webp" alt="Apple iPhone 17 256 GB Sage 5G"/>'+link+'</div>');
 const result=inspectCarrefourImageEvidence(html,{sourceUrl:url,title});
 assert.equal(result.status,"unique_product_image_evidence");
 assert.equal(result.pdpId,id);
 assert.equal(result.candidateImageHosts[0],"cdn.mafrservices.com");
});
test("image in sibling AFTER anchor is considered only with sufficient identity evidence",()=>{
 const html=page('<article>'+link+'<img src="/assets/genuine.webp" alt="Apple iPhone 17 256 GB Sage 5G"/></article>');
 assert.equal(inspectCarrefourImageEvidence(html,{sourceUrl:url,title}).status,"unique_product_image_evidence");
});
test("a nearby image from another product does not become verified evidence",()=>{
 const html=page('<div class="card"><img src="https://example.com/not-an-iphone.webp" alt="Samsung Galaxy S26"/>'+link+'</div>');
 const result=inspectCarrefourImageEvidence(html,{sourceUrl:url,title});
 assert.equal(result.status,"unverified_nearby_images");
 assert.equal(result.matchingCount,0);
});
test("different PDPs within same container are not eligible for cross-product inference",()=>{
 const html=page('<div>'+link+'<a href="/mafuae/en/phone/other/p/9999999"><img alt="Apple iPhone 17 256 GB Sage 5G" src="https://img.test/wrong.webp"/></a></div>');
 const result=inspectCarrefourImageEvidence(html,{sourceUrl:url,title});
 assert.equal(result.status,"no_image_with_unique_product_card");
});
test("multiple strongly matching images are ambiguous and not automatically recoverable",()=>{
 const html=page('<div>'+link+'<img alt="Apple iPhone 17 256 GB Sage 5G" src="https://img.test/a.webp"/>'+
 '<img alt="Apple iPhone 17 256 GB Sage 5G" src="https://img.test/b.webp"/></div>');
 assert.equal(inspectCarrefourImageEvidence(html,{sourceUrl:url,title}).status,"ambiguous_matching_images");
});
test("invalid or risky image URLs are discarded",()=>{
 const html=page('<div>'+link+'<img alt="Apple iPhone 17 256 GB Sage 5G" src="data:image/png;base64,AAA"/>'+
 '<img alt="Apple iPhone 17 256 GB Sage 5G" src="https://example.com/asset.svg"/></div>');
 assert.equal(inspectCarrefourImageEvidence(html,{sourceUrl:url,title}).evidenceCount,0);
});
test("merchant HTML is never fetched by this pure analyzer",()=>{
 assert.throws(()=>inspectCarrefourImageEvidence("",{sourceUrl:"https://evil.example/mafuae/en/p/2258790",title}),/invalid_carrefour_product_identity/);
 assert.throws(()=>inspectCarrefourImageEvidence("x".repeat(8_000_001),{sourceUrl:url,title}),/invalid_carrefour_html_fixture/);
});
