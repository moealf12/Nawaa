import test from "node:test";
import assert from "node:assert/strict";
import { assessOfferMatch } from "../src/search-query.mjs";

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
  assert.ok(element("#results").innerHTML.indexOf("نفس النسخة، بين المتاجر") < element("#results").innerHTML.indexOf("المواصفات الموحّدة"), "merchant comparison should precede optional specifications");
  assert.match(element("#results").innerHTML, /id="availabilityFilter"/);
  assert.match(element("#results").innerHTML, /id="merchantFilter"/);
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
  element("#merchantFilter").events.change({target:{value:"unavailable merchant"}});
  assert.match(element("#results").innerHTML, /لا توجد عروض ضمن الفلاتر الحالية/);
  element("#resetResultFilters").events.click();
  assert.equal((element("#results").innerHTML.match(/data-group-key=/g) || []).length, 2);

  let resolveOld;
  globalThis.fetch = async url => {
    if (String(url).includes("q=old")) return new Promise(resolve => { resolveOld = () => resolve({ok:true,text:async()=>JSON.stringify({offers,providers:[]})}); });
    return {ok:true,text:async()=>JSON.stringify(String(url).includes("/health") ? {ok:true} : {offers,providers:[],errors:[{provider:"jarir"}]})};
  };
  element("#searchInput").value="old";
  element("#searchForm").events.submit({preventDefault(){}});
  await new Promise(resolve => setImmediate(resolve));
  element("#searchInput").value="latest";
  element("#searchForm").events.submit({preventDefault(){}});
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element("#searchStatus").textContent,/نتائج جزئية/);
  resolveOld();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element("#results").innerHTML, /<h2>latest<\/h2>/);

  const consoleOffers = [
    { ...offer, title:"Sony PlayStation 5 Slim Digital Console White",image:"https://img.example/digital-1.jpg", specs:{brand:"Sony",color:"White",modelNumber:"CFI-2016B01Y",storage:"825GB"} },
    { ...offer,merchant:"Jarir", title:"PS5 Digital Console",image:"https://img.example/digital-2.jpg",specs:{brand:"Sony",modelNumber:"CFI2016B01Y",storage:"825GB"}},
    { ...offer, title:"Sony PS5 Console 1TB Blu-ray Disc", specs:{brand:"Sony",color:"Black/White",modelNumber:"CFI2116A01Y",storage:"1TB"} },
    { ...offer, title:"PS5 EA SPORTS FC 25", specs:{brand:"EA"} },
  ].map(item=>({...item,...assessOfferMatch("ps5",item)}));
  globalThis.fetch=async url=>({ok:true,text:async()=>JSON.stringify(String(url).includes("/health")?{ok:true}:{offers:consoleOffers,providers:[]})});
  element("#searchInput").value="ps5";
  element("#searchForm").events.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  const html=element("#results").innerHTML;
  assert.doesNotMatch(html,/data-dimension="colorKey"/,"PS5 casing colors must not become a device selector");
  assert.match(html,/data-dimension="editionKey"/);
  assert.ok(html.indexOf('class="match-results-section"')<html.indexOf('class="product-configurator"'),"product cards should lead comparison details");
  assert.match(html,/ألعاب للجهاز/);
  assert.match(html,/data-image-options=/);
  assert.match(html,/https:\/\/img.example\/digital-2.jpg/);
});
