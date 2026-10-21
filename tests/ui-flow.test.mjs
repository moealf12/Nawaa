import test from "node:test";
import assert from "node:assert/strict";
import { assessOfferMatch } from "../src/search-query.mjs";

test("query deep link starts exactly one live search and URL submission requests comparison", async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", value: "", hidden: false,
      events: {}, addEventListener(name, handler) { this.events[name] = handler; }, querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, focus() {}, scrollIntoView() {},
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
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, "same-origin", "same-origin search must preserve the private Site session without sharing it with external origins");
    requests.push(String(url));
    const data = String(url).includes("/health") ? { ok: true } : { offers, providers: [], providersConfigured: ["extra"],
      resolvedOffer: new URL(url).searchParams.has("url") ? offer : null, comparisonQuery: "iphone 17 256gb black" };
    return { ok: true, text: async () => JSON.stringify(data), json: async () => data };
  };
  await import("../src/search-page.mjs");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.filter((url) => url.includes("/api/search?")).length, 1);
  assert.equal(requests.filter((url) => new URL(url).pathname === "/health").length, 0,
    "the shopper search must not wait for a redundant health warmup");
  assert.equal(new URL(requests[0]).pathname, "/api/search",
    "send the actual search immediately, including on a cold API instance");
  assert.equal((element("#results").innerHTML.match(/data-group-key=/g) || []).length, 2);
  assert.ok(element("#results").innerHTML.indexOf("مقارنة عروض النسخة المختارة") < element("#results").innerHTML.indexOf("المواصفات الموحّدة"), "merchant comparison should be honest and precede optional specifications");
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

  let snapshotAttempts = 0;
  globalThis.fetch = async url => {
    const data = String(url).includes('/health') ? {ok:true} : ++snapshotAttempts === 1
      ? {offers:[],errors:[{provider:'cache',message:'Search snapshot invalidated; retry'}]}
      : {offers,providers:[],errors:[]};
    return {ok:true,text:async()=>JSON.stringify(data)};
  };
  element('#searchInput').value='iphone snapshot';
  element('#searchForm').events.submit({preventDefault(){}});
  await new Promise(resolve=>setTimeout(resolve,1300));
  assert.equal(snapshotAttempts,2,'an invalidated snapshot must trigger a fresh search');
  assert.match(element('#searchStatus').textContent,/بحث حي/);
  assert.doesNotMatch(element('#results').innerHTML,/NO LIVE OFFERS/);

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
  assert.match(html,/نسخة رقمية/);
  assert.match(html,/نسخة الأقراص/);
  assert.doesNotMatch(html,/class="product-configurator"/,"comparison details are rendered only after selecting a product");
  assert.match(html,/ألعاب للجهاز/);
  assert.match(html,/data-image-options=/);
  assert.match(html,/class="product-summary-card/);
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/سعر المنتج من/);
  assert.match(html,/عروض/);
  assert.match(html,/https:\/\/img.example\/digital-2.jpg/);
  let renderedCards = [],loadMoreButtons=[],detailButtons=[];
  element('#results').querySelectorAll = selector => {
    if(selector==='.show-category') {
      loadMoreButtons=[...element('#results').innerHTML.matchAll(/data-show-category="([^"]+)"/g)].map(match=>({dataset:{showCategory:match[1]},events:{},addEventListener(name,handler){this.events[name]=handler;}}));
      return loadMoreButtons;
    }
    if(selector==='.product-detail-btn') {
      detailButtons=[...element('#results').innerHTML.matchAll(/class="product-detail-btn"[^>]*data-source="([^"]+)"/g)].map(match=>({dataset:{source:match[1]},events:{},addEventListener(name,handler){this.events[name]=handler;}}));
      return detailButtons;
    }
    if (selector !== '.match-result-card') return [];
    renderedCards = [...element('#results').innerHTML.matchAll(/class="match-result-card[^"\n]*" data-group-key="([^"]*)"/g)].map(match=>({dataset:{groupKey:match[1]},events:{},addEventListener(name,handler){this.events[name]=handler;},focus(options){this.focusRestored=true;this.focusOptions=options;}}));
    return renderedCards;
  };
  globalThis.requestAnimationFrame = callback => callback();
  const hpOffers = [
    {...offer,title:'HP USB Mouse',productPrice:20,specs:{brand:'HP'}},
    {...offer,title:'HP SmartTank 580 Printer',productPrice:700,specs:{brand:'HP',deviceType:'SmartTank'}},
    {...offer,title:'HP Pavilion Laptop',productPrice:3000,specs:{brand:'HP'}},
  ].map(item=>({...item,...assessOfferMatch('hp',item)}));
  globalThis.fetch=async url=>({ok:true,text:async()=>JSON.stringify(String(url).includes('/health')?{ok:true}:{offers:hpOffers,providers:[]})});
  element('#searchInput').value='hp';
  element('#searchForm').events.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  const hpHtml=element('#results').innerHTML;
  assert.match(hpHtml,/data-category="laptop"/);
  assert.match(hpHtml.split('<details class="selected-comparison"')[0], /<strong>HP SmartTank 580 Printer<\/strong>/, 'cards must retain the product name when merchant metadata only contains a generic family');
  assert.ok(hpHtml.indexOf('HP Pavilion Laptop') < hpHtml.indexOf('HP USB Mouse'),'brand discovery must not lead with a cheap mouse');
  assert.match(hpHtml,/<details class="selected-comparison" hidden>/, 'comparison is closed until the customer selects a card');
  assert.doesNotMatch(hpHtml,/نسخة مختلفة عن الموديل المطلوب/);
  renderedCards.find(card=>card.dataset.groupKey.includes('pavilion')).events.click({detail:0});
  assert.ok(renderedCards.find(card=>card.dataset.groupKey.includes('pavilion')).focusRestored,
    'keyboard card activation must focus the newly rendered button');
  assert.equal(renderedCards.find(card=>card.dataset.groupKey.includes('pavilion')).focusOptions.preventScroll,true,
    'restoring keyboard focus must not unexpectedly scroll the page');
  // The original button was replaced, but a second keyboard activation must still close it.
  renderedCards.find(card=>card.dataset.groupKey.includes('pavilion')).events.click({detail:0});
  assert.match(element('#results').innerHTML,/<details class="selected-comparison" hidden>/,
    'second keyboard activation must collapse the comparison');
  assert.ok(renderedCards.find(card=>card.dataset.groupKey.includes('pavilion')).focusRestored,
    'closing by keyboard must also restore focus');
  renderedCards.find(card=>card.dataset.groupKey.includes('pavilion')).events.click({detail:0});
  assert.doesNotMatch(element('#searchStatus').textContent,/ألوان|سعات/, 'general discovery status must describe categories rather than phone variant counts');

  assert.match(element('#results').innerHTML,/<details class="selected-comparison" open>/);
  assert.match(element('#results').innerHTML, /المنتج المختار[\s\S]*HP Pavilion Laptop/);

  // Failure-first counterexample: broad HP discovery can have exactMatch=true
  // without a manufacturer model/SKU. The selected card must not claim a
  // verified 100% match based on a text relevance score.
  const selectedBrandHtml=element('#results').innerHTML;
  assert.match(selectedBrandHtml,/مقارنة عروض النسخة المختارة/,'unverified manufacturer SKU must never be labeled same version across stores');
  assert.match(selectedBrandHtml,/لا تتوفر أدلة كافية لتأكيد تطابق رقم الموديل بين جميع العروض/,'unverified SKU comparison needs a clear caution');
  assert.doesNotMatch(selectedBrandHtml,/نفس النسخة، بين المتاجر/,'a broad HP brand is not independently verified cross-merchant SKU identity');
  assert.match(selectedBrandHtml,/صلة بالبحث: \d+% \(تقديرية\)/,
    'a relevance heuristic must be labeled as an estimate');
  assert.match(selectedBrandHtml,/ليست إثباتًا لتطابق رقم الموديل أو SKU/,
    'customers need an explicit SKU-level confidence boundary');
  assert.doesNotMatch(selectedBrandHtml,/>تطابق \d+%<\/span>/,
    'bare exact-match percentages misrepresent unverified SKUs');

  assert.doesNotMatch(element('#results').innerHTML, /data-dimension="modelKey"/, 'selected product comparison must not offer unrelated HP products as model variants');

  element(".selected-comparison").events.toggle({target:{open:false,isConnected:false}});
  assert.match(element("#results").innerHTML,/<details class="selected-comparison" open>/,"a detached comparison toggle must not collapse the newly selected product");
  assert.doesNotMatch(element("#results").innerHTML, /المصدر ↗/);
  element(".selected-comparison").events.toggle({target:{open:false,isConnected:true}});
  assert.match(element("#results").innerHTML,/<details class="selected-comparison" hidden>/,"closing the comparison clears its expanded card state");

  // Two stores can report different manufacturer SKUs for what looks like the
  // same phone/color/capacity. The conservative groups MUST stay separate, but
  // the buyer must be shown why the two otherwise-identical cards exist.
  const differentSkuSameAppearance = [
    offer,
    {...offer,merchant:'Jarir',sourceUrl:'https://example.com/black-import',
      specs:{...offer.specs,modelNumber:'MG674LL/A'}},
  ];
  globalThis.fetch=async url=>({ok:true,text:async()=>JSON.stringify(
    String(url).includes('/health')?{ok:true}:{offers:differentSkuSameAppearance,providers:[]})});
  element('#searchInput').value='iPhone 17';
  element('#searchForm').events.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  const duplicatePhonesHtml=element('#results').innerHTML;
  assert.equal((duplicatePhonesHtml.match(/class="match-result-card/g)||[]).length,2,
    'distinct reported manufacturer models must not be silently merged');
  assert.match(duplicatePhonesHtml,/رقم الموديل: MG674AH\/A/,
    'first otherwise-indistinguishable card must display its reported model');
  assert.match(duplicatePhonesHtml,/رقم الموديل: MG674LL\/A/,
    'second otherwise-indistinguishable card must display its different model');

  const manyOffers=Array.from({length:25},(_,i)=>({...offer,title:`HP Pavilion Laptop ${i+1}`,sourceUrl:`https://example.com/hp-${i+1}`,specs:{brand:'HP',modelNumber:`HP-LAP-${i+1}`}}));
  globalThis.fetch=async url=>({ok:true,text:async()=>JSON.stringify(String(url).includes('/health')?{ok:true}:{offers:manyOffers,providers:[]})});
  element('#searchInput').value='hp laptop';element('#searchForm').events.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  const countCards=()=> (element('#results').innerHTML.match(/class="match-result-card/g)||[]).length;
  assert.equal(countCards(),10,'a fresh search must show ten products');
  // Progressive/interactive rerenders must not strand keyboard focus on a detached card.
  const focusedKeyBeforeRerender = renderedCards[0].dataset.groupKey;
  globalThis.document.activeElement = renderedCards[0];
  loadMoreButtons[0].events.click();
  assert.equal(countCards(),20,'the first Load more must add ten products');
  assert.ok(renderedCards.find(card=>card.dataset.groupKey===focusedKeyBeforeRerender)?.focusRestored,
    'focused product must be re-focused when an update replaces the result grid');
  globalThis.document.activeElement = null;
  loadMoreButtons[0].events.click();assert.equal(countCards(),25,'the final Load more must retain all remaining products');
  assert.equal(loadMoreButtons.length,0,'no Load more remains after all products are visible');
  element('#resetResultFilters').events.click();assert.equal(countCards(),10,'reset filters restores the first ten products');
  renderedCards[0].events.click();
  assert.match(element('#results').innerHTML,/صلة بالبحث: \d+% \(تقديرية\)/,
    'model/category searches must also use honest estimated relevance wording');
  assert.doesNotMatch(element('#results').innerHTML,/>تطابق \d+%<\/span>/);
  assert.ok(detailButtons.length>0,'selected product must expose its detail action');
  globalThis.sessionStorage={setItem(){throw Error('storage blocked');}};
  globalThis.localStorage={getItem(){return null;},setItem(){throw Error('storage blocked');}};
  detailButtons[0].events.click();
  assert.match(location.href,/^\.\/product\.html\?/,'blocked storage cannot prevent product detail navigation');
  assert.match(new URL(location.href,'http://localhost').searchParams.get('source'),/https:\/\/example.com\/hp-/);

  // An SSE deadline with no offers is not proof the product does not exist.
  // Do not send automatic deeper requests while the initial search is partial.
  let partialRequests=0;
  globalThis.fetch=async ()=>{
    partialRequests++;
    return {ok:true,text:async()=>JSON.stringify({
      offers:[],providers:[],errors:[{sourceId:'jarir-direct',error:'provider_deadline_exceeded'}],
      coverage:{partial:true,deadlineExceeded:true,providersPending:2},
      nextCursor:'signed-depth-1',
    })};
  };
  element('#searchInput').value='temporarily unavailable device';
  element('#searchForm').events.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(partialRequests,1,'partial search must not recursively expand until its initial sources recover');
  assert.match(element('#searchStatus').textContent,/بحث جزئي/);
  assert.match(element('#results').innerHTML,/PARTIAL SEARCH/);
  assert.match(element('#results').innerHTML,/لا يعني أن المنتج غير متوفر/);
  assert.doesNotMatch(element('#results').innerHTML,/NO LIVE OFFERS/);

  // Older APIs may report provider failures in errors[] without coverage.partial.
  // A failed source is not evidence of zero inventory and must not trigger
  // further automatic requests.
  let errorOnlyRequests=0;
  globalThis.fetch=async ()=>{
    errorOnlyRequests++;
    return {ok:true,text:async()=>JSON.stringify({
      offers:[],providers:[],errors:[{sourceId:'jarir',error:'provider_failed'}],
      nextCursor:'signed-depth-1',
    })};
  };
  element('#searchInput').value='partially failed legacy search';
  element('#searchForm').events.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(errorOnlyRequests,1,'provider errors alone must stop automatic expansion');
  assert.match(element('#searchStatus').textContent,/بحث جزئي/);
  assert.match(element('#results').innerHTML,/PARTIAL SEARCH/);

  globalThis.fetch=async ()=>({ok:true,text:async()=>JSON.stringify({
    offers:[],providers:[],errors:[],coverage:{partial:false,deadlineExceeded:false,providersPending:0},
  })});
  element('#searchInput').value='genuinely unmatched item';
  element('#searchForm').events.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(element('#results').innerHTML,/NO LIVE OFFERS/);
  assert.doesNotMatch(element('#results').innerHTML,/PARTIAL SEARCH/);

});
