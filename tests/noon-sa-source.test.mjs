import test from "node:test";
import assert from "node:assert/strict";
import {configuredFreeStorefronts,routeFreeStorefronts,searchFreeStorefrontById}
  from "../server/providers/free-storefronts.mjs";
import {currentSources} from "../server/source-config.mjs";
import {extractNoonSaudiCatalogCards,noonSaudiProductIdentity}
  from "../src/noon-sa-catalog.mjs";

const sku="N70211519V";
const productUrl="https://www.noon.com/saudi-en/iphone-17-256gb-black-middle-east-version/"+sku+"/p/";
const other="https://www.noon.com/saudi-en/iphone-17-pro-512gb/"+ "N70211665V"+"/p/";
const product=(options={})=>({
  "@type":"Product",name:"Apple iPhone 17 256GB Black Middle East Version",
  sku,url:productUrl,image:"https://f.nooncdn.com/p/test.jpg",
  offers:{"@type":"Offer",price:"3499.00",priceCurrency:"SAR",
    url:productUrl,seller:{"@type":"Organization",name:"Noon"}},
  ...options
});
const html=(...nodes)=>'<html><script type="application/ld+json">'+
  JSON.stringify({"@context":"https://schema.org","@graph":nodes})+
  '</script></html>';

test("RED: Noon Saudi is a configured local marketplace, routed without duplicate providers",()=>{
  const stores=configuredFreeStorefronts();
  assert.equal(stores.filter(s=>s.id==="noon-sa").length,1);
  assert.equal(stores.find(s=>s.id==="noon-sa")?.countryCode,"SA");
  assert.equal(currentSources().find(s=>s.id==="noon-sa")?.status,"configured");
  const routes=routeFreeStorefronts("iphone 17 256GB",Infinity,{stable:true}).map(x=>x.store.id);
  assert.ok(routes.includes("noon-sa"));
  assert.ok(routes.includes("noon-sa"),"source must remain discoverable via cursor");
  const direct=routeFreeStorefronts("noon iphone 17",Infinity,{stable:true});
  assert.equal(direct[0].store.id,"noon-sa","explicit merchant intent must target Noon");
});

test("RED: strict first-party Noon SKU and locale identity excludes foreign hosts/variants",()=>{
  assert.equal(noonSaudiProductIdentity(productUrl)?.sku,sku);
  for(const url of [
    other,"https://www.noon.com/uae-en/iphone-17/"+sku+"/p/",
    "https://www.noon.com.evil.example/saudi-en/iphone-17/"+sku+"/p/",
    "https://noon.com/saudi-en/search/?q="+sku,
    "http://www.noon.com/saudi-en/iphone-17/"+sku+"/p/",
    "https://evil@www.noon.com/saudi-en/iphone-17/"+sku+"/p/",
  ]) if(url!==other)assert.equal(noonSaudiProductIdentity(url),null,url);
});

test("Noon long Saudi-en laptop PDP URL keeps exact SKU and strips untrusted navigation query",()=>{
  // User supplied real URL structure. Synthetic JSON-LD amount below is a fixture, NOT a live price.
  const longSlug="matebook-d16-upgraded-version-laptop-with-16-inch-full-hd-1920x1080-display-core-i5-12450h-processor-16gb-ram-ddr5-512gb-ssd-windows-11-pro-with-microsoft-office-english-arabic-mystic-silver-english-arabic-mystic-silver";
  const url="https://www.noon.com/saudi-en/"+longSlug+"/N70312362V/p/";
  const decorated=url+"?nav_ctx=test-navigation-data&o=f428b90c38b7fb5b";
  assert.equal(longSlug.length,219);
  assert.deepEqual(noonSaudiProductIdentity(decorated),{
    sku:"N70312362V",canonicalUrl:url
  });
  assert.equal(noonSaudiProductIdentity(url.replace("N70312362V","N70312362A")),null);
  assert.equal(noonSaudiProductIdentity(url.replace("saudi-en","uae-en")),null);
  assert.equal(noonSaudiProductIdentity(url.replace("www.noon.com","www.noon.com.evil.example")),null);
  const title="Huawei MateBook D16 Upgraded Version Laptop 16 Inch Core i5-12450H 16GB RAM 512GB SSD";
  const candidate={
    "@type":"Product",name:title,sku:"N70312362V",url:decorated,
    image:"https://f.nooncdn.com/p/test.jpg",
    offers:{"@type":"Offer",price:"2199.00",priceCurrency:"SAR",url:decorated}
  };
  const records=extractNoonSaudiCatalogCards(html(candidate),"laptop");
  assert.equal(records.length,1);
  assert.equal(records[0].productId,"N70312362V");
  assert.equal(records[0].sourceUrl,url);
  assert.equal(records[0].price,2199);
  // Different offer SKU must remain rejected even when the long slug is valid.
  const wrongOffer={...candidate,offers:{...candidate.offers,sku:"N70211519V"}};
  assert.deepEqual(extractNoonSaudiCatalogCards(html(wrongOffer),"laptop"),[]);
});

test("RED: one exact Noon product record yields source-stated SAR price, no delivery certification",()=>{
  const records=extractNoonSaudiCatalogCards(html(product()),"iphone 17 256gb");
  assert.equal(records.length,1);
  assert.equal(records[0].productId,sku);
  assert.equal(records[0].price,3499);
  assert.equal(records[0].currency,"SAR");
  assert.equal(records[0].sourceUrl,productUrl);
  assert.equal(records[0].sellerDeclared,"Noon");
});

test("RED: foreign item, sibling price and weak metadata cannot launder Noon offers",()=>{
  const cross=product({url:other,sku:"N70211665V",
    offers:{...product().offers,url:other,price:"49"}});
  for(const bad of [
    product({offers:{...product().offers,url:other}}),
    product({offers:{...product().offers,priceCurrency:"AED"}}),
    product({offers:{...product().offers,price:"0"}}),
    product({offers:{...product().offers,price:"3499,00"}}),
    product({offers:[product().offers,product().offers]}),
    product({offers:{"@type":"AggregateOffer",lowPrice:"1",priceCurrency:"SAR"}}),
    product({url:"https://www.noon.com/uae-en/item/"+sku+"/p/"}),
    product({sku:"N70211665V"}),
    product({name:"iPhone 17 Pro Max case"}),
  ])assert.deepEqual(extractNoonSaudiCatalogCards(html(bad),"iphone 17 256gb"),[],
    JSON.stringify(bad).slice(0,120));
  assert.deepEqual(extractNoonSaudiCatalogCards(html(cross),"iphone 17 256gb"),[]);
});

test("RED: no invented Noon price from an unparsed HTML shell",()=>{
  assert.deepEqual(extractNoonSaudiCatalogCards('<title>noon</title>',"iphone 17"),[]);
});

test("RED: bounded Noon search fetch does not hit hidden APIs or fabricate shipping/availability",{
 concurrency:false
},async()=>{
  const old=globalThis.fetch,requests=[];
  try {
    globalThis.fetch=async url=>{
      requests.push(String(url));
      return new Response(html(product()),{status:200,headers:{"content-type":"text/html"}});
    };
    const result=await searchFreeStorefrontById("noon-sa","iphone 17 256gb",{perStore:2});
    assert.equal(requests.length,1);
    assert.ok(requests[0].startsWith("https://www.noon.com/saudi-en/search/"));
    assert.equal(result.offers.length,1);
    const offer=result.offers[0];
    assert.equal(offer.providerMarket,"noon-sa");
    assert.equal(offer.originalCurrency,"SAR");
    assert.equal(offer.productPrice,3499);
    assert.equal(offer.canShipToSaudi,null);
    assert.equal(offer.shipping,null);
    assert.equal(offer.availability,"unknown");
    assert.equal(offer.sourceUrl,productUrl);
    assert.equal(offer.sourceMeta.priceEvidence,"SEARCH_CARD_ONLY");
  }finally{globalThis.fetch=old}
});

test("RED: Noon 403 denied response stops without secondary fetches",{
 concurrency:false
},async()=>{
  const old=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return new Response("Access denied",{status:403})};
    const result=await searchFreeStorefrontById("noon-sa","iphone 17",{perStore:2})
      .catch(error=>({offers:[],error:String(error)}));
    assert.equal(calls,1);
    assert.deepEqual(result.offers,[]);
  }finally{globalThis.fetch=old}
});


test("A rejected Noon JSON-LD sibling cannot come back through the generic fallback",{
 concurrency:false
},async()=>{
  const old=globalThis.fetch;
  let calls=0;
  const foreign=product({url:other,sku:"N70211665V",
    offers:{...product().offers,url:other,price:"49"}});
  try{
    globalThis.fetch=async()=>{calls++;
      return new Response(html(foreign),{status:200,headers:{"content-type":"text/html"}})};
    const result=await searchFreeStorefrontById("noon-sa","iphone 17 256gb",{perStore:2});
    assert.deepEqual(result.offers,[]);
    assert.equal(calls,1,"rejected record cannot trigger PDP fallback requests");
  }finally{globalThis.fetch=old}
});
