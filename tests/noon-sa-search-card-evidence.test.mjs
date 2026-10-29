import test from "node:test";
import assert from "node:assert/strict";
import {extractNoonSaudiSearchCardEvidence} from "../src/noon-sa-search-card-evidence.mjs";

// Minimal synthetic fixtures mirror the data-qa and price structure observed in
// the user-supplied Safari search archive; no archive data is committed.
const longSlug="matebook-d16-upgraded-version-laptop-with-16-inch-full-hd-1920x1080-display-core-i5-12450h-processor-16gb-ram-ddr5-512gb-ssd-windows-11-pro-with-microsoft-office-english-arabic-mystic-silver-english-arabic-mystic-silver";
const laptop="/saudi-en/"+longSlug+"/N70312362V/p/?nav_ctx=private-session-info&o=f428b90c38b7fb5b";
const mouse="/saudi-en/rtx-5070-gaming-laptop-i7-14700hx-20-core-16-inch-qhd-240hz-display-32gb-ddr5-1tb-ssd-rgb-keyboard-type-g-plug/Z20CCB8056BB8E89E0B67Z/p/?o=a2dbffbe0a4e759b";
const img="https://f.nooncdn.com/p/pzsku/ZD2A8C55641CEF42A3D6CZ/45/_/1791453882/fixture.jpg?width=800";
const card=({url=laptop,title="Huawei MateBook D16 16GB 512GB Laptop",price="2,489",
             oldPrice="3,649",image=img}={})=>
  '<a href="'+url+'"><h2 data-qa="plp-product-box-name">'+title+'</h2>'+
  '<div data-qa="plp-product-box-price"><strong class="_amount_a2gq6_61">'+price+'</strong>'+
  '<span class="oldPrice">'+oldPrice+'</span></div>'+
  '<img src="'+image+'" alt="product"></a>';
const html=(...cards)=>'<html><h1>laptop</h1>'+cards.join("")+'</html>';

test("Noon Saudi real-source PLP shape extracts source-owned laptop title, price, image and offer",()=>{
  const output=extractNoonSaudiSearchCardEvidence(html(card()),"Laptop");
  assert.equal(output.status,"SEARCH_CARD_EVIDENCE");
  assert.equal(output.candidates.length,1);
  const item=output.candidates[0];
  assert.equal(item.productId,"N70312362V");
  assert.equal(item.price,2489);
  assert.equal(item.offerCode,"f428b90c38b7fb5b");
  assert.equal(item.sourceUrl,"https://www.noon.com/saudi-en/"+longSlug+"/N70312362V/p/");
  assert.equal(item.offerUrl,item.sourceUrl+"?o=f428b90c38b7fb5b");
  assert.equal(item.image,img);
  assert.equal(item.customerPublishable,false);
  assert.equal(item.priceEvidence,"SAVED_SEARCH_CARD_DISPLAYED");
  assert.equal("shipping" in item,false);
  assert.equal("seller" in item,false);
});

test("Z-prefixed product identity is supported without product-price cross-contamination",()=>{
  const output=extractNoonSaudiSearchCardEvidence(
    html(card(),card({url:mouse,title:"RTX 5070 Gaming Laptop 32GB 1TB SSD",price:"18,518"})),"laptop");
  assert.equal(output.candidates.length,2);
  assert.deepEqual(output.candidates.map(x=>x.productId),["N70312362V","Z20CCB8056BB8E89E0B67Z"]);
  assert.deepEqual(output.candidates.map(x=>x.price),[2489,18518]);
});

test("Homepage and HTTP 200 JS shell do not become a search source",()=>{
  assert.equal(extractNoonSaudiSearchCardEvidence('<title>Noon</title>'+card(),"laptop").candidates.length,0);
  assert.equal(extractNoonSaudiSearchCardEvidence(html(card()),"iphone").status,"SEARCH_CONTEXT_NOT_ATTESTED");
});

test("Non-Noon links, UAE sources, invalid images and MSRP-only cards are rejected",()=>{
  const bogus=html(
    card({url:"https://www.noon.com.evil.example"+laptop}),
    card({url:laptop.replace("/saudi-en/","/uae-en/")}),
    card({image:"https://evil.example/fixture.jpg"}),
    card({price:"invalid",oldPrice:"2,489"}),
    card({url:laptop.replace("N70312362V","N70312362X")})
  );
  assert.deepEqual(extractNoonSaudiSearchCardEvidence(bogus,"laptop").candidates,[]);
});

test("Same product and offer with conflicting advertised prices is held, not chosen",()=>{
  const output=extractNoonSaudiSearchCardEvidence(
    html(card({price:"2,489"}),card({price:"2,399"})),"laptop");
  assert.equal(output.candidates.length,0);
  assert.equal(output.conflicts.length,1);
  assert.deepEqual(output.conflicts[0].observedPrices,[2399,2489]);
});

test("Identical cards deduplicate, but independent offer codes remain distinct",()=>{
  const output=extractNoonSaudiSearchCardEvidence(
    html(card(),card(),card({url:laptop.replace("f428b90c38b7fb5b","another-offer")})),"laptop");
  assert.equal(output.parsedCards,3);
  assert.equal(output.candidates.length,2);
  assert.deepEqual(output.candidates.map(c=>c.offerCode),["f428b90c38b7fb5b","another-offer"]);
});

test("Reject false discounted prices and missing verified price element",()=>{
  const onlyMsrp='<a href="'+laptop+'"><h2 data-qa="plp-product-box-name">Huawei Laptop</h2>'+
    '<div data-qa="plp-product-box-price"><span class="oldPrice">2,489</span></div><img src="'+img+'"></a>';
  assert.equal(extractNoonSaudiSearchCardEvidence(html(onlyMsrp),"laptop").candidates.length,0);
  const output=extractNoonSaudiSearchCardEvidence(html(card({price:"0"})),"laptop");
  assert.equal(output.candidates.length,0);
});
