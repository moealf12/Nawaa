import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredFreeStorefronts,
  routeFreeStorefronts,
  searchFreeStorefrontById,
  extractAmazonSearchOffers,
} from "../server/providers/free-storefronts.mjs";
import {WORLD_SOURCE_REGISTRY} from "../src/source-registry.mjs";
import {currentSources} from "../server/source-config.mjs";

// Source presence and buyability are different observations.
const europe=[
  ["amazon-uk","GB","offer_dependent"],
  ["amazon-de","DE","offer_dependent"],
  ["mediamarkt-de","DE","no_direct"],
  ["pccomponentes-es","ES","no_direct"],
  ["bike24-de","DE","verified_market"],
  ["thomann-de","DE","offer_dependent"],
];

test("RED: six EU merchant search routes are configured without duplicating existing merchants",()=>{
  const stores=configuredFreeStorefronts();
  const ids=stores.map(x=>x.id);
  assert.equal(ids.length,new Set(ids).size);
  for(const [id,country] of europe){
    const store=stores.find(x=>x.id===id);
    assert.ok(store,id+" not configured");
    assert.equal(store.countryCode,country);
    assert.equal(currentSources().find(x=>x.id===id)?.status,"configured");
  }
  for(const id of ["asos-global","farfetch-sa","mytheresa-global"])
    assert.equal(ids.filter(x=>x===id).length,1);
  assert.equal(ids.includes("decathlon-sa"),false);
});

test("RED: correct product-family routing covers UK/DE electronics and specialty EU stores",()=>{
  const phone=routeFreeStorefronts("iphone 17",Infinity,{stable:true}).map(x=>x.store.id);
  for(const id of ["amazon-uk","amazon-de","mediamarkt-de","pccomponentes-es"])
    assert.ok(phone.includes(id),"missing phone route "+id);
  const audio=routeFreeStorefronts("studio headphones",Infinity,{stable:true}).map(x=>x.store.id);
  assert.ok(audio.includes("thomann-de"));
  const shoes=routeFreeStorefronts("running shoes",Infinity,{stable:true}).map(x=>x.store.id);
  assert.ok(shoes.includes("bike24-de"));
});

test("RED: shipping evidence is distinct from offer-level delivery verification",()=>{
  const sources=currentSources();
  for(const [id,country,delivery] of europe) {
    const entry=sources.find(x=>x.id===id);
    assert.ok(entry,id+" missing registry");
    assert.equal(entry.countryCode,country);
    assert.equal(entry.saudiDelivery,delivery);
  }
  assert.equal(WORLD_SOURCE_REGISTRY.find(x=>x.id==="geizhals-de")?.sourceKind,"price_discovery_index");
  assert.equal(WORLD_SOURCE_REGISTRY.find(x=>x.id==="idealo-de")?.sourceKind,"price_discovery_index");
  assert.equal(sources.find(x=>x.id==="geizhals-de")?.status,"candidate");
  assert.equal(sources.find(x=>x.id==="idealo-de")?.status,"candidate");
  assert.equal(configuredFreeStorefronts().some(x=>["geizhals-de","idealo-de"].includes(x.id)),false);
});

const asin="B012345678";
const card=(price,title="Apple iPhone 17 256GB")=>
  '<div data-asin="'+asin+'"><h2>'+title+'</h2>'+
  '<span class="a-price"><span class="a-offscreen">'+price+'</span></span>'+
  '<a href="/dp/'+asin+'">View product</a></div>';

test("RED: localized Amazon DE and UK price cards retain their real currency and safe same-ASIN URL",()=>{
  const de=extractAmazonSearchOffers(card("1.299,00 €"),"iphone 17","https://www.amazon.de","EUR");
  assert.equal(de.length,1);assert.equal(de[0].price,1299);
  assert.equal(de[0].currency,"EUR");
  assert.match(de[0].sourceUrl,/^https:\/\/www\.amazon\.de\/dp\/B012345678/);
  const uk=extractAmazonSearchOffers(card("£1,049.95"),"iphone 17","https://www.amazon.co.uk","GBP");
  assert.equal(uk.length,1);assert.equal(uk[0].price,1049.95);
  assert.equal(uk[0].currency,"GBP");
  assert.match(uk[0].sourceUrl,/^https:\/\/www\.amazon\.co\.uk\/dp\/B012345678/);
});

test("RED: foreign price cards reject missing/ambiguous currency and mismatched offer URL",()=>{
  assert.deepEqual(extractAmazonSearchOffers(card("1.299,00"),"iphone 17","https://www.amazon.de","EUR"),[]);
  assert.deepEqual(extractAmazonSearchOffers(card("£1,299.00"),"iphone 17","https://www.amazon.de","EUR"),[]);
  assert.deepEqual(extractAmazonSearchOffers(card("1.299.00 €"),"iphone 17","https://www.amazon.de","EUR"),[]);
  const html=card("£899.00").replace('href="/dp/'+asin+'"','href="https://attacker.invalid/dp/'+asin+'"');
  const uk=extractAmazonSearchOffers(html,"iphone 17","https://www.amazon.co.uk","GBP");
  assert.equal(uk.length,1);
  assert.equal(new URL(uk[0].sourceUrl).hostname,"www.amazon.co.uk");
  assert.equal(new URL(uk[0].sourceUrl).pathname,"/dp/"+asin);
});

test("RED: non-direct EU storefront may return a price, but never a Saudi shipping promise",{concurrency:false},async()=>{
  const prev=globalThis.fetch;
  const url="https://www.mediamarkt.de/de/product/_apple-iphone-17-256-gb-1234567.html";
  const json=JSON.stringify({"@context":"https://schema.org","@type":"Product",
    name:"Apple iPhone 17 256GB",url,sku:"1234567",
    offers:{"@type":"Offer",price:799,priceCurrency:"EUR",url}});
  let calls=0;
  try{
    globalThis.fetch=async request=>{
      calls++;
      if(String(request).startsWith("https://api.frankfurter.dev/"))
        return new Response(JSON.stringify({rate:4.2,date:"2026-10-28"}),{status:200,headers:{"content-type":"application/json"}});
      return new Response('<html><script type="application/ld+json">'+json+'</script></html>',{
        status:200,headers:{"content-type":"text/html"}});
    };
    const result=await searchFreeStorefrontById("mediamarkt-de","iphone 17",{perStore:2});
    assert.equal(result.offers.length,1);
    assert.equal(result.offers[0].canShipToSaudi,false);
    assert.equal(result.offers[0].shipping,null);
    assert.equal(result.offers[0].importCost,null);
    assert.equal(result.offers[0].exactMatch,false);
    assert.equal(result.offers[0].originalCurrency,"EUR");
    assert.ok(calls>=1);
  }finally{globalThis.fetch=prev}
});

test("RED: price comparators are discovery indexes, never fake sale offers",async()=>{
  for(const id of ["geizhals-de","idealo-de"]){
    await assert.rejects(searchFreeStorefrontById(id,"iphone 17"),/unknown storefront/);
  }
});

test("Thomann pilot uses the German merchant site, never an international redirect to another host",{concurrency:false},async()=>{
  const old=globalThis.fetch;
  const hits=[];
  try{
    globalThis.fetch=async input=>{
      hits.push(String(input));
      return new Response("<html><body>No matching products</body></html>",{
        status:200,headers:{"content-type":"text/html"}
      });
    };
    const result=await searchFreeStorefrontById("thomann-de","studio headphones",{perStore:1});
    assert.equal(result.offers.length,0);
    assert.equal(hits.length,1);
    assert.ok(hits[0].startsWith("https://www.thomann.de/de/search_dir.html?sw="));
  } finally {globalThis.fetch=old}
});

test("foreign JSON-LD product price cannot be attributed to a trusted EU merchant host",{concurrency:false},async()=>{
  const old=globalThis.fetch;
  const bad=JSON.stringify({"@context":"https://schema.org","@type":"Product",
    name:"Apple iPhone 17 256GB",url:"https://untrusted.example/item/iphone-17",
    offers:{"@type":"Offer",price:"49",priceCurrency:"EUR"}});
  let count=0;
  try{
    globalThis.fetch=async ()=>{
      count++;
      return new Response('<html><script type="application/ld+json">'+bad+'</script></html>',{
        status:200,headers:{"content-type":"text/html"}});
    };
    const result=await searchFreeStorefrontById("mediamarkt-de","iphone 17",{perStore:2});
    assert.equal(result.offers.length,0);
    assert.equal(count,1);
  }finally{globalThis.fetch=old}
});

test("pilot EU merchants remain on subsequent pages, without displacing the first shopper search wave",{concurrency:false},()=>{
  for(const query of ["iphone 17","PS5 Slim","running shoes","studio headphones"]){
    const first=routeFreeStorefronts(query,16,{stable:true});
    assert.equal(first.length,16);
    assert.equal(first.some(x=>europe.some(([id])=>id===x.store.id)),false,
      "EU candidates with zero live offers must not replace existing sources in initial wave: "+query);
  }
  const all=routeFreeStorefronts("iphone 17",Infinity,{stable:true});
  assert.ok(all.some(x=>x.store.id==="amazon-de"),"pilot still available for later cursor passes");
});

test("a specifically requested EU retailer bypasses the pilot deprioritization",()=>{
  for(const [query,id] of [
    ["amazon uk iphone 17","amazon-uk"],["amazon germany iphone 17","amazon-de"],
    ["mediamarkt iphone 17","mediamarkt-de"],["pccomponentes laptop","pccomponentes-es"],
    ["bike24 running shoes","bike24-de"],["thomann headphones","thomann-de"],
  ]){
    assert.ok(routeFreeStorefronts(query,5,{stable:true}).some(x=>x.store.id===id),
      "explicit EU merchant must remain eligible: "+id);
  }
});
