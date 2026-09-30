import test from "node:test";
import assert from "node:assert/strict";

test("query deep link starts exactly one live search and URL submission requests comparison", async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", value: "", hidden: false,
      events: {}, addEventListener(name, handler) { this.events[name] = handler; }, querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, focus() {},
    });
    return elements.get(id);
  }
  globalThis.document = { querySelector: element };
  globalThis.location = { href: "http://localhost/search.html?q=%D8%A7%D9%8A%D9%81%D9%88%D9%86%2017", search: "?q=ايفون%2017" };
  globalThis.window = { NAWAA_API_BASE: "http://localhost" };
  globalThis.addEventListener = () => {};
  let storageWrites = 0;
  const stored = new Map();
  globalThis.localStorage = { getItem: (key) => stored.get(key) || null, setItem: (key, value) => {
    assert.ok(++storageWrites < 10, "deep link must not recurse through recent-search persistence"); stored.set(key, value);
  } };
  const offer = { merchant: "eXtra", title: "Apple iPhone 17 256GB Black", sourceUrl: "https://example.com/black",
    productPrice: 3999, condition: "new", exactMatch: true, matchConfidence: 1, dataKind: "live",
    availability: "in_stock", canShipToSaudi: true, shipping: null, importCost: 0, tax: null, mandatoryFees: 0, discount: 0,
    specs: { brand: "Apple", deviceType: "iPhone 17", storage: "256GB", color: "Black", modelNumber: "MG674AH/A" },
  };
  const offers = [offer, { ...offer, title: "Apple iPhone 17 256GB White", sourceUrl: "https://example.com/white",
    specs: { ...offer.specs, color: "White", modelNumber: "MG684AH/A" } }];
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const data = String(url).includes("/health") ? { ok: true } : { offers, providers: [], providersConfigured: ["extra"],
      resolvedOffer: new URL(url).searchParams.has("url") ? offer : null, comparisonQuery: "iphone 17 256gb black" };
    return { ok: true, text: async () => JSON.stringify(data), json: async () => data };
  };
  await import("../src/search-page.mjs");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.filter((url) => url.includes("/api/search?")).length, 1);
  assert.equal((element("#results").innerHTML.match(/data-group-key=/g) || []).length, 2);
  element("#searchInput").value = "https://example.com/black";
  element("#searchForm").events.submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(new URL(requests.at(-1)).searchParams.get("url"), "https://example.com/black");
  assert.equal((element("#results").innerHTML.match(/data-group-key=/g) || []).length, 2);
  globalThis.window.NAWAA_QUOTE_URL = "https://nawaa.example/";
  element("#quoteBestBtn").events.click();
  assert.equal(new URL(location.href).origin, "https://nawaa.example");
  assert.match(new URL(location.href).searchParams.get("request"), /MG674AH\/A/);
  assert.equal(requests.filter((url) => url.includes("/api/requests")).length, 0, "prefill must not submit an order");
});
