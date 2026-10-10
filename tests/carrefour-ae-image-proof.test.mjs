import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyCarrefourAeImageFromPage, proveCarrefourAeImages,
} from "../server/source-inspector/carrefour-ae-image-proof.mjs";
import { extractCarrefourSearchOffers } from "../server/providers/free-storefronts.mjs";

const URL = "https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-black/p/2258801";
const TITLE = "Apple iPhone 17, 256 GB, Black, 5G";
const IMAGE = "https://cdn.carrefouruae.com/mafuae/media/p/2258801.jpg";
const offer = (patch = {}) => ({
  sourceUrl:URL, title:TITLE, originalProductPrice:3999,
  originalCurrency:"AED", image:null, ...patch,
});
const page = (patch = {}, productPatch = {}) => ({
  finalUrl:URL,
  candidates:[{strategy:"jsonld", product:{
    name:"Apple iPhone 17 256GB Black 5G",
    sku:"2258801", url:URL,
    image:IMAGE, offers:{price:"3999.00", priceCurrency:"AED"},
    ...productPatch,
  }}],
  ...patch,
});

test("search card retains original price and lacks image (baseline regression)", () => {
  const html = '<a href="/mafuae/en/smartphones/apple-iphone-17-256gb-black/p/2258801"><span>Apple iPhone 17, 256 GB, Black, 5G</span></a><div><span>AED</span><span>3,999.00</span></div>';
  const list = extractCarrefourSearchOffers(html, "iPhone 17");
  assert.equal(list.length, 1);
  assert.equal(list[0].image, null);
  assert.equal(list[0].price, 3999);
  assert.equal(list[0].productId, "2258801");
});

test("accepts matching merchant image only with id/title/price/currency parity", () => {
  const result = verifyCarrefourAeImageFromPage(offer(), page());
  assert.equal(result.accepted, true);
  assert.equal(result.image, IMAGE);
  assert.equal(result.evidence.productId, "2258801");
  assert.equal(result.evidence.originalPriceAED, 3999);
});

test("never trusts redirected product pages with a different ID", () => {
  const other = URL.replace("2258801", "2258802");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({finalUrl:other})).reason,
    "product_redirect_mismatch");
});

test("never trusts another product's explicit SKU or product URL", () => {
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {sku:"2258802"})).reason,
    "product_identity_mismatch");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {sku:null,url:URL.replace("2258801","2258802")})).reason,
    "product_identity_mismatch");
});

test("rejects title mismatch and closely related model variants", () => {
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    name:"Samsung Galaxy S25 256GB Black 5G",
  })).reason, "product_title_mismatch");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    name:"Apple iPhone 17 Pro 256GB Black 5G",
  })).reason, "product_title_mismatch");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    name:"Apple iPhone 17 512GB Black 5G",
  })).reason, "product_title_mismatch");
});

test("rejects stale seller price and incorrect currency (not SAR-converted comparisons)", () => {
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    offers:{price:"4099",priceCurrency:"AED"},
  })).reason, "product_price_mismatch");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    offers:{price:"3999",priceCurrency:"SAR"},
  })).reason, "missing_aed_price_evidence");
  assert.equal(verifyCarrefourAeImageFromPage(offer({originalCurrency:"SAR"}), page()).reason,
    "invalid_original_price");
});

test("accepts only HTTPS product-page images, not placeholders or tracking URLs", () => {
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    image:"javascript:alert(1)",
  })).reason, "missing_safe_product_image");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    image:"http://cdn.carrefouruae.com/p.jpg",
  })).reason, "missing_safe_product_image");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), page({}, {
    image:"https://cdn.carrefouruae.com/assets/placeholder.jpg",
  })).reason, "missing_safe_product_image");
});

test("rejects unsafe PDP origins and missing page evidence", () => {
  assert.equal(verifyCarrefourAeImageFromPage(offer({
    sourceUrl:"https://carrefouruae.com.evil.example/mafuae/en/p/2258801",
  }), page()).reason, "invalid_product_url");
  assert.equal(verifyCarrefourAeImageFromPage(offer(), {
    finalUrl:URL, candidates:[],
  }).reason, "no_matching_page_candidate");
});

test("failure of one product does not misattribute the next product image", async () => {
  const offers = [offer(), offer({sourceUrl:URL.replace("2258801","2258802")})];
  const proof = await proveCarrefourAeImages(offers,{
    loadProduct:async url=>url.endsWith("2258801")?page():page({
      finalUrl:url,
    }, {sku:"2258802",url, name:"Dell XPS 13 Laptop 512GB Silver"}),
  });
  assert.equal(proof.attempted, 2);
  assert.equal(proof.accepted, 1);
  assert.equal(proof.rejected, 1);
  assert.equal(proof.results[0].image, IMAGE);
  assert.equal(proof.results[1].accepted, false);
});

test("enforces <=8 requests and concurrency <=2, even on aggressive options", async () => {
  let inflight = 0, peak = 0, calls = 0;
  const result = await proveCarrefourAeImages(Array.from({length:20},()=>offer()),{
    limit:100000, concurrency:100000,
    loadProduct:async()=>{
      calls++;
      peak = Math.max(peak, ++inflight);
      await new Promise(resolve=>setTimeout(resolve,3));
      inflight--;
      return page();
    },
  });
  assert.equal(calls, 8);
  assert.equal(result.attempted, 8);
  assert.equal(result.accepted, 8);
  assert.ok(peak <= 2, "at most two in-flight product reads");
});

test("fails closed on fetch errors without changing original offer", async () => {
  const original = offer();
  const result = await proveCarrefourAeImages([original],{
    loadProduct:async()=>{throw new Error("403 blocked");},
  });
  assert.equal(result.results[0].reason, "product_page_fetch_failed");
  assert.equal(result.accepted, 0);
  assert.equal(original.image, null);
});
