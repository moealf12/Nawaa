import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyCarrefourAeImageFromPage, proveCarrefourAeImages, fetchCarrefourAeBrowserPage, verifyCarrefourAeImageHead,
} from "../server/source-inspector/carrefour-ae-image-proof.mjs";
import { extractCarrefourSearchOffers } from "../server/providers/free-storefronts.mjs";

const URL = "https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-black/p/2258801";
const TITLE = "Apple iPhone 17, 256 GB, Black, 5G";
const IMAGE = "https://cdn.mafrservices.com/pim-content/UAE/media/product/2258801/1757614204/2258801_main.jpg";
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


test("browser-header PDP reader parses JSON-LD product and retains official id", async()=>{
  let calls=0;
  const html='<!doctype html><html><head><title>Apple iPhone 17</title><script type="application/ld+json">'+
    JSON.stringify({"@context":"https://schema.org","@type":"Product",
      name:TITLE, sku:"2258801", image:IMAGE,
      offers:{"@type":"Offer",price:"3999",priceCurrency:"AED"}})+
    '</script></head><body><h1>Apple iPhone 17, 256GB Black 5G</h1></body></html>';
  const page = await fetchCarrefourAeBrowserPage(URL,{
    fetchImpl:async (url,options)=>{
      calls++;assert.equal(options.redirect,"manual");
      assert.match(options.headers["user-agent"],/Mozilla\/5/);
      assert.equal(url,URL);
      return new Response(html,{status:200,headers:{"content-type":"text/html"}});
    },
  });
  assert.equal(calls,1);
  assert.equal(page.finalUrl,URL);
  assert.equal(verifyCarrefourAeImageFromPage(offer(),page).accepted,true);
});

test("reader rejects redirects outside official product identity before fetching",async()=>{
  let calls=0;
  await assert.rejects(fetchCarrefourAeBrowserPage(URL,{
    fetchImpl:async()=>{calls++;return new Response("",{
      status:302,headers:{location:"https://example.org/mafuae/en/p/2258801"}});},
  }),/unsafe_product_redirect/);
  assert.equal(calls,1);
});

test("reader fails closed on tiny WAF or empty HTML response",async()=>{
  await assert.rejects(fetchCarrefourAeBrowserPage(URL,{
    fetchImpl:async()=>new Response("<html>Access Denied</html>",{
      status:200,headers:{"content-type":"text/html"}}),
  }),/block_or_empty_html/);
});


test("rejects CDN image for a different product even when title and price match",()=>{
  const proof=verifyCarrefourAeImageFromPage(offer(),page({},{
    image:"https://cdn.mafrservices.com/pim-content/UAE/media/product/2258802/1757614204/2258802_main.jpg",
  }));
  assert.equal(proof.accepted,false);
  assert.equal(proof.reason,"missing_safe_product_image");
});

test("rejects unrelated HTTPS image domains even when JSON-LD references them",()=>{
  const proof=verifyCarrefourAeImageFromPage(offer(),page({},{
    image:"https://images.evil.example/p/2258801_main.jpg",
  }));
  assert.equal(proof.reason,"missing_safe_product_image");
});

test("rejects mismatched long Carrefour numeric SKU (12-digit)",()=>{
  const longUrl=URL.replace("2258801","199251084393");
  const proof=verifyCarrefourAeImageFromPage(offer({sourceUrl:longUrl}),page({
    finalUrl:longUrl
  },{url:longUrl,sku:"199251084394"}));
  assert.equal(proof.reason,"product_identity_mismatch");
});

test("HEAD validates real image MIME and reasonable optional length without downloading bytes",async()=>{
  let calls=0;
  const result=await verifyCarrefourAeImageHead(IMAGE,"2258801",{
    fetchImpl:async(uri,options)=>{
      calls++;
      assert.equal(uri,IMAGE);
      assert.equal(options.method,"HEAD");
      assert.equal(options.redirect,"manual");
      return new Response(null,{
        status:200,headers:{"content-type":"image/jpeg","content-length":"41000"},
      });
    },
  });
  assert.equal(calls,1);
  assert.equal(result.ok,true);
  assert.equal(result.bytes,41000);
});

test("HEAD refuses HTTP redirect and HTML errors instead of accepting CDN placeholders",async()=>{
  const redirect=await verifyCarrefourAeImageHead(IMAGE,"2258801",{
    fetchImpl:async()=>new Response(null,{status:302,headers:{location:"https://attacker.example/"}}),
  });
  assert.equal(redirect.ok,false);
  const html=await verifyCarrefourAeImageHead(IMAGE,"2258801",{
    fetchImpl:async()=>new Response(null,{status:200,headers:{"content-type":"text/html"}}),
  });
  assert.equal(html.reason,"image_content_type_mismatch");
  const bad=await verifyCarrefourAeImageHead(IMAGE.replace("2258801","2258802"),"2258801",{
    fetchImpl:async()=>{throw new Error("must not request mismatched image");},
  });
  assert.equal(bad.reason,"image_identity_or_domain_mismatch");
});

test("image HEAD rejection never mutates input offers and fails qualification closed",async()=>{
  const original=offer();
  const proof=await proveCarrefourAeImages([original],{
    loadProduct:async()=>page(),
    imageHead:async()=>({ok:false,reason:"image_http_404"}),
  });
  assert.equal(proof.accepted,0);
  assert.equal(proof.results[0].reason,"image_http_404");
  assert.equal(original.image,null);
});
