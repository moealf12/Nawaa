import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGermanEuroCents, inspectAmazonDeSamePageOffer, probeAmazonDeOffer,
} from "../server/amazon-de-offer-evidence.mjs";
import { amazonDeCustomerPriceDecision } from "../src/amazon-de-price-gate.mjs";

const asin = "B0FQFW3423";
const url = "https://www.amazon.de/dp/" + asin;
const seller = "Source seller";
const declaration = {
  "@type": "Product", sku: asin, name: "Example watch 46 mm",
  url, offers: { "@type": "Offer", price: "299.99", priceCurrency: "EUR",
    url, seller: { "@type": "Organization", name: seller } },
};
function doc({
  json = declaration, selectedAsin = asin, buyboxSeller = seller,
  buyboxPrice = "299,99 €", extraPrice = "", embedded = "",
} = {}) {
  return '<!doctype html><html lang="de"><head><title>Example</title>' +
    '<script type="application/ld+json">' + JSON.stringify(json) + '</script></head><body>' +
    '<input type="hidden" id="ASIN" value="' + selectedAsin + '">' +
    '<div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">' +
    buyboxPrice + '</span></span>' +
    (extraPrice ? '<span class="a-price"><span class="a-offscreen">' + extraPrice + '</span></span>' : '') +
    '</div><a id="sellerProfileTriggerId">' + buyboxSeller + '</a>' + embedded + '</body></html>';
}
const sample = doc();
const reply = (html, status=200, headers={}) => new Response(html,{
  status, headers: { "content-type": "text/html", ...headers },
});

test("strict German currency parsing accepts only unambiguous euro cents", () => {
  assert.equal(parseGermanEuroCents("1.299,99 €"), 129999);
  assert.equal(parseGermanEuroCents("€ 299,99"), 29999);
  assert.equal(parseGermanEuroCents("299,99\u00a0€"), 29999);
  for (const bad of ["299.99 €", "$299.99", "299", "free", "299,99 EUR",
    "299,999 €", "0,00 €", "1,2 €", "€NaN", "1.2.3,00 €"]) {
    assert.equal(parseGermanEuroCents(bad), null, bad);
  }
});

test("matching page variant, declared seller and selected buybox price stays unpublishable", () => {
  const report = inspectAmazonDeSamePageOffer(sample,url,asin);
  assert.equal(report.status, "SAME_PAGE_PARITY_CANDIDATE_NOT_ATTESTED");
  assert.equal(report.sourceDeclaredOfferPresent, true);
  assert.equal(report.requestedVariantObserved, true);
  assert.equal(report.selectedSellerObserved, true);
  assert.equal(report.selectedPriceObserved, true);
  assert.equal(report.samePageParityObserved, true);
  assert.equal(report.buyboxIndependentlyAttested, false);
  assert.equal(report.saudiShippingVerified, false);
  assert.equal(report.customerPublishable, false);
  assert.equal(amazonDeCustomerPriceDecision({ sourceId: "amazon-de", sourceUrl: url }).customerPublishable, false);
  assert.equal(JSON.stringify(report).includes("299.99"), false);
  assert.equal(JSON.stringify(report).includes(seller), false);
});

test("foreign ASIN, wrong seller and wrong price fail closed", () => {
  for (const [html,status] of [
    [doc({ selectedAsin: "B0ABC12345" }), "SELECTED_VARIANT_NOT_PROVEN"],
    [doc({ buyboxSeller: "Other seller" }), "SOURCE_AND_BUYBOX_SELLER_CONFLICT"],
    [doc({ buyboxPrice: "299,98 €" }), "SOURCE_AND_BUYBOX_PRICE_CONFLICT"],
    [doc({ buyboxPrice: "299.99 €" }), "SELECTED_PRICE_NOT_PROVEN"],
    [doc({ buyboxPrice: "299,99 €", extraPrice: "399,99 €" }), "SELECTED_PRICE_NOT_PROVEN"],
    [doc({ json: { "@type": "Product", sku: "B0ABC12345", url, name: "Wrong item" } }),
      "SOURCE_DECLARED_OFFER_NOT_ATTESTED"],
  ]) {
    const observed = inspectAmazonDeSamePageOffer(html,url,asin);
    assert.equal(observed.status,status);
    assert.equal(observed.customerPublishable,false);
  }
});

test("unrelated recommendations cannot satisfy price or selected seller evidence", () => {
  const html=doc({buyboxPrice:"not a price",buyboxSeller:"",embedded:
    '<div class="recommendations"><span class="a-price"><span class="a-offscreen">299,99 €</span></span>' +
    '<a class="seller">Source seller</a></div>'});
  const observed=inspectAmazonDeSamePageOffer(html,url,asin);
  assert.equal(observed.samePageParityObserved,false);
  assert.equal(observed.customerPublishable,false);
});

test("HTTP 200 captcha, generic PDP or Amazon block response are not attestation", () => {
  assert.equal(inspectAmazonDeSamePageOffer('<html><title>Robot Check</title></html>',url,asin).status,
    "CHALLENGE_SUSPECTED");
  assert.equal(inspectAmazonDeSamePageOffer("<html><body>" + asin + "</body></html>",url,asin).status,
    "SOURCE_DECLARED_OFFER_NOT_ATTESTED");
});

test("probe reads one HTML only, without retries, redirects, or persistence", async () => {
  const calls = [];
  const check = await probeAmazonDeOffer({asin,url,fetchImpl:async (input, init) => {
    calls.push({input,init});
    return reply(sample);
  }});
  assert.equal(calls.length,1);
  assert.equal(calls[0].input,url);
  assert.equal(calls[0].init.method,"GET");
  assert.equal(calls[0].init.redirect,"manual");
  assert.equal(check.status,"SAME_PAGE_PARITY_CANDIDATE_NOT_ATTESTED");
  assert.equal(check.customerPublishable,false);
});

test("redirect must stay within exact same ASIN/domain", async () => {
  for (const location of ["https://evilamazon.de/dp/"+asin,
    "https://www.amazon.de/dp/B0ABC12345", "http://amazon.de/dp/"+asin]) {
    let calls=0;
    const report=await probeAmazonDeOffer({asin,url,fetchImpl:async()=>{
      calls++;
      return reply(null,302,{location});
    }});
    assert.equal(report.status,"UNSAFE_OR_MISMATCHED_REDIRECT");
    assert.equal(calls,1);
  }
  let n=0;
  const accepted=await probeAmazonDeOffer({asin,url,fetchImpl:async()=>{
    return ++n===1 ? reply(null,302,{location:"/gp/product/"+asin}) : reply(sample);
  }});
  assert.equal(accepted.status,"SAME_PAGE_PARITY_CANDIDATE_NOT_ATTESTED");
  assert.equal(n,2);
});

test("HTTP errors, content type and body cap fail closed", async () => {
  for (const [code,status] of [[403,"ACCESS_RESTRICTED"],[429,"ACCESS_RESTRICTED"],
    [404,"NOT_FOUND"],[503,"HTTP_UNVERIFIED"]]) {
    const r=await probeAmazonDeOffer({asin,url,fetchImpl:async()=>reply(null,code)});
    assert.equal(r.status,status);
    assert.equal(r.customerPublishable,false);
  }
  const json=await probeAmazonDeOffer({asin,url,fetchImpl:async()=>new Response("{}",
    {headers:{"content-type":"application/json"}})});
  assert.equal(json.status,"NON_HTML_RESPONSE");
  const huge=await probeAmazonDeOffer({asin,url,fetchImpl:async()=>reply("<html></html>",200,
    {"content-length":"4000000"})});
  assert.equal(huge.status,"HTML_TOO_LARGE");
  const aborted=new AbortController();aborted.abort();
  let network=0;
  const cancelled=await probeAmazonDeOffer({asin,url,signal:aborted.signal,
    fetchImpl:async()=>{network++;return reply(sample);}});
  assert.equal(cancelled.status,"ABORTED");
  assert.equal(network,0);
});
