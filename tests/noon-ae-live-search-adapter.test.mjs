import test from "node:test";
import assert from "node:assert/strict";
import {extractNoonUaeSearchCardEvidence} from "../src/noon-ae-search-card-evidence.mjs";

const q="laptop";
const url="https://www.noon.com/uae-en/search/?q=laptop";
const pdp="/uae-en/laptop-16gb-512gb/N70312362V/p/?o=offerA01";
const photo="https://f.nooncdn.com/p/na-item-0001.jpg";
const card=(o={})=>{
  const {href=pdp,name="Pro Laptop 16GB 512GB",price="AED 2,499.50",src=photo,secondary="https://f.nooncdn.com/p/secondary.jpg"}=o;
  return '<a href="'+href+'">'+
    '<div data-qa="plp-product-box-name">'+name+'</div>'+
    '<div data-qa="plp-product-box-price"><strong class="amount">'+price+'</strong></div>'+
    '<picture><source srcset="'+src+' 800w, '+secondary+' 1200w"/></picture>'+
  '</a>';
};
const document=(cards,{lang="en-AE",heading=q}={})=>
  '<html lang="'+lang+'"><body><h1>'+heading+'</h1>'+cards.join("")+'</body></html>';
const extract=(cards,options={})=>extractNoonUaeSearchCardEvidence(
  document(cards,options),options.query||q,
  {searchUrl:options.searchUrl||url,finalUrl:options.finalUrl||url}
);

test("Noon UAE customer parser accepts an exact SKU/offer URL with explicit AED and first-party /p/ image",()=>{
  const x=extract([card()]);
  assert.equal(x.status,"VERIFIED_EXPLICIT_AED_SEARCH_CARDS");
  assert.equal(x.accepted,1);
  assert.equal(x.offers[0].productId,"N70312362V");
  assert.equal(x.offers[0].price,2499.5);
  assert.equal(x.offers[0].currency,"AED");
  assert.equal(x.offers[0].sourceUrl,"https://www.noon.com"+pdp);
  assert.equal(x.offers[0].image,photo);
  assert.equal(x.offers[0].priceEvidence,"LIVE_AE_SEARCH_CARD_EXPLICIT_AED");
});

test("Noon UAE market-locale number alone cannot become an AED customer price",()=>{
  for(const price of ["2,499.50","\uE0002,499.50","2,499.50 AED 1,999","USD 2499.50"]){
    const x=extract([card({price})]);
    assert.deepEqual(x.offers,[]);
    assert.equal(x.missingCurrency,1);
  }
});

test("Noon UAE rejects foreign domain, Saudi SKU URL, missing offer code and untrusted images",()=>{
  const bad=[
    card({href:"https://bad.noon.com"+pdp}),
    card({href:"/saudi-en/laptop-16gb-512gb/N70312362V/p/?o=offerA01"}),
    card({href:"/uae-en/laptop-16gb-512gb/N70312362V/p/"}),
    card({href:"/uae-en/laptop-16gb-512gb/N70312362V/p/?o=offerA01&o=offerA02"}),
    card({src:"https://evil.example/p/image.jpg",secondary:"https://evil.example/p/secondary.jpg"}),
  ];
  const x=extract(bad);
  assert.equal(x.accepted,0);
});

test("Noon UAE rejects unexpected redirected query, homepage shell and wrong locale",()=>{
  const good=[card()];
  for(const options of [
    {finalUrl:"https://www.noon.com/uae-en/"},
    {finalUrl:"https://www.noon.com/uae-en/search/?q=phone"},
    {finalUrl:"https://www.noon.com/saudi-en/search/?q=laptop"},
    {lang:"en-SA"},
    {heading:"phone"},
  ])assert.deepEqual(extract(good,options).offers,[]);
});

test("Noon UAE conflicts on one SKU/offer price, instead of selecting arbitrary first or cheaper price",()=>{
  const x=extract([card({price:"AED 2,499"}),card({price:"AED 1,999"})]);
  assert.equal(x.accepted,0);
  assert.equal(x.conflicts,1);
});

test("Noon UAE supports Arabic text with an actual explicit dirham code attached to price",()=>{
  const arabicQuery="سماعات بلوتوث", searchUrl="https://www.noon.com/uae-en/search/?q="+encodeURIComponent(arabicQuery);
  const html=document([card({name:"سماعات بلوتوث",price:"د.إ ١٩٩٫٥٠"})],
    {lang:"ar-AE",heading:arabicQuery});
  const x=extractNoonUaeSearchCardEvidence(html,arabicQuery,{searchUrl,finalUrl:searchUrl});
  assert.equal(x.offers.length,1);
  assert.equal(x.offers[0].price,199.5);
});

test("Noon UAE parser refuses all offers when no explicit currency is attested, as in the 252-card live run",()=>{
  const html=document(Array.from({length:55},(_,i)=>card({
    href:"/uae-en/laptop-16gb-512gb/N"+String(70000000+i)+"V/p/?o=offer"+i,
    price:"\uE000"+String(1500+i),
    src:"https://f.nooncdn.com/p/p-"+i+".jpg",
  })));
  const x=extractNoonUaeSearchCardEvidence(html,q,{searchUrl:url,finalUrl:url});
  assert.equal(x.accepted,0);
  assert.equal(x.missingCurrency,55);
});
