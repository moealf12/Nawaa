import test from "node:test";
import assert from "node:assert/strict";
import { parse1688Catalog, search1688 } from "../server/providers/1688-cn.mjs";
import { calculateComparableTotal, classifyOffer } from "../src/search-core.mjs";

const fx = async amount => ({
  value: Number((amount * 0.52).toFixed(2)),
  rate: 0.52, source: "TEST_REFERENCE_ONLY", observedAt: "2026-11-05T00:00:00Z",
});
const product = (overrides = {}) => ({
  offerId: "123456789012",
  title: "蓝牙耳机",
  titleEn: "Bluetooth wireless headphones",
  image: "https://cbu01.alicdn.com/img/ibank/test.jpg",
  currency: "CNY",
  minimumOrderQuantity: 1,
  priceTiers: [{minQuantity: 1, unitPriceCny: 20}, {minQuantity: 10, unitPriceCny: 12}],
  stockQuantity: 200, condition: "new",
  ...overrides,
});

test("1688: verified one-piece tier is converted with evidence and is not a landed Saudi offer", async () => {
  const {offers, diagnostics} = await parse1688Catalog({products: [product()]}, {convertMoney: fx});
  assert.equal(diagnostics.accepted, 1);
  const offer = offers[0];
  assert.equal(offer.productPrice, 10.4);
  assert.equal(offer.originalProductPrice, 20);
  assert.equal(offer.originalCurrency, "CNY");
  assert.equal(offer.currency, "SAR");
  assert.equal(offer.sourceUrl, "https://detail.1688.com/offer/123456789012.html");
  assert.equal(offer.sourceMeta.minimumOrderQuantity, 1);
  assert.equal(offer.sourceMeta.priceEvidence, "QUANTITY_ONE_TIER");
  assert.equal(offer.sourceMeta.shippingStatus, "FORWARDER_OR_UNVERIFIED");
  assert.equal(offer.canShipToSaudi, null);
  assert.equal(offer.shipping, null);
  assert.equal(offer.importCost, null);
  assert.equal(calculateComparableTotal(offer), null);
  assert.notEqual(classifyOffer(offer), "confirmed");
});

test("1688: wholesale MOQ above 1 never leaks bulk unit price into retail results", async () => {
  const result = await parse1688Catalog({products: [product({minimumOrderQuantity: 12})]}, {convertMoney: fx});
  assert.equal(result.offers.length, 0);
  assert.equal(result.diagnostics.rejected.WHOLESALE_ONLY, 1);
});

test("1688: an unverified quantity-one price is rejected even if the lowest tier is cheap", async () => {
  const result = await parse1688Catalog({products: [
    product({priceTiers: [{minQuantity: 10, unitPriceCny: 2}]}),
    product({offerId: "123456789013", priceTiers: [], price: 2}),
  ]}, {convertMoney: fx});
  assert.equal(result.offers.length, 0);
  assert.equal(result.diagnostics.rejected.SINGLE_UNIT_PRICE_UNVERIFIED, 2);
});

test("1688: missing MOQ, ambiguous currency, or invalid canonical ID fail closed", async () => {
  const result = await parse1688Catalog({products: [
    product({minimumOrderQuantity: undefined}),
    product({offerId: "123456789013", currency: "SAR"}),
    product({offerId: "../private"}),
  ]}, {convertMoney: fx});
  assert.equal(result.offers.length, 0);
  assert.equal(result.diagnostics.rejected.MOQ_UNKNOWN, 1);
  assert.equal(result.diagnostics.rejected.UNVERIFIED_CURRENCY, 1);
  assert.equal(result.diagnostics.rejected.INVALID_ID_OR_TITLE, 1);
});

test("1688: image host is restricted and listing URL is derived from the offer ID", async () => {
  const result = await parse1688Catalog({items: [product({
    sourceUrl: "https://malicious.example/p/123456789012",
    image: "https://cbu01.alicdn.com.evil.example/image.jpg",
  })]}, {convertMoney: fx});
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].image, null);
  assert.equal(new URL(result.offers[0].sourceUrl).hostname, "detail.1688.com");
});

test("1688: duplicate identity is rejected; distinct SKU identities may remain", async () => {
  const result = await parse1688Catalog({products: [
    product({skuId: "blue"}), product({skuId: "blue"}), product({skuId: "black"}),
  ]}, {convertMoney: fx});
  assert.equal(result.offers.length, 2);
  assert.equal(result.diagnostics.rejected.DUPLICATE, 1);
});

test("1688: unavailable FX blocks publishing; unknown stock does not imply in-stock", async () => {
  const badFx = await parse1688Catalog({products: [product()]}, {convertMoney: async () => null});
  assert.equal(badFx.offers.length, 0);
  assert.equal(badFx.diagnostics.rejected.FX_UNAVAILABLE, 1);
  const stock = await parse1688Catalog({products: [product({stockQuantity: undefined})]}, {convertMoney: fx});
  assert.equal(stock.offers[0].availability, "unknown");
});

test("1688: guarded feed schema and response cap", async () => {
  await assert.rejects(parse1688Catalog({products: {a: 1}}, {convertMoney: fx}), /INVALID_CATALOG_SCHEMA/);
  await assert.rejects(parse1688Catalog({products: Array.from({length: 201}, () => product())}, {convertMoney: fx}), /INVALID_CATALOG_SCHEMA/);
  const capped = await parse1688Catalog({products: Array.from({length: 80}, (_, i) =>
    product({offerId: String(100000000000 + i)}) )}, {convertMoney: fx, limit: 3});
  assert.equal(capped.offers.length, 3);
});

test("1688: source stays disabled without authorized catalog; injected client works", async () => {
  const disabled = await search1688("headphones");
  assert.equal(disabled.ok, false);
  assert.equal(disabled.offers.length, 0);
  assert.equal(disabled.errors[0].error, "1688_AUTHORIZED_CATALOG_NOT_CONFIGURED");
  let calls = 0;
  const live = await search1688("headphones", {
    catalogSearch: async (query, options) => {
      calls++;
      assert.equal(query, "headphones");
      assert.equal(options.limit, 20);
      return {products: [product()]};
    },
    convertMoney: fx,
  });
  assert.equal(calls, 1);
  assert.equal(live.offers.length, 1);
  assert.equal(live.errors.length, 0);
});

test("1688: network client errors remain source-scoped and aborts propagate", async () => {
  const failure = await search1688("phone", {catalogSearch: async () => {throw new Error("permission denied");}});
  assert.equal(failure.ok, false);
  assert.equal(failure.errors[0].error, "permission denied");
  const c = new AbortController();
  c.abort(new Error("customer disconnected"));
  await assert.rejects(search1688("phone", {signal: c.signal, catalogSearch: async () => ({products:[]})}), /customer disconnected/);
});
