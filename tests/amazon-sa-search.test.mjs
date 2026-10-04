import test from "node:test";
import assert from "node:assert/strict";
import { extractAmazonSearchOffers } from "../server/providers/free-storefronts.mjs";

test("Amazon Saudi search cards produce verified price offers without product-page fetch",()=>{
 const html=`<div data-component-type="s-search-result" data-asin="B0ABC12345">
 <h2><a href="/HP-Laptop/dp/B0ABC12345/ref=sr_1_1"><span>HP OmniBook 5 Laptop 16GB 512GB</span></a></h2>
 <img src="https://m.media-amazon.com/images/I/example.jpg">
 <span class="a-price"><span class="a-offscreen">SAR 2,999.50</span><span class="a-price-whole">2,999</span><span class="a-price-fraction">50</span></span>
 </div>`;
 const offers=extractAmazonSearchOffers(html,"HP");
 assert.equal(offers.length,1);
 assert.equal(offers[0].productId,"B0ABC12345");
 assert.equal(offers[0].price,2999.5);
 assert.equal(offers[0].currency,"SAR");
 assert.match(offers[0].sourceUrl,/amazon\.sa/);
});
