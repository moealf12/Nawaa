import test from "node:test";
import assert from "node:assert/strict";
import {extractNoonUaeJsonCardEvidence} from "../src/noon-ae-search-card-evidence.mjs";

const query="iPhone 17", searchUrl="https://www.noon.com/uae-en/search/?q=iPhone%2017";
const sourceUrl="https://www.noon.com/uae-en/iphone-17-256gb-black/N70211553V/p/?o=a46bd3942170c30c";
const image="https://f.nooncdn.com/p/pzsku/Z83FF2D6F9F3D5BED88F5Z/45/_/1779094525/first.jpg?width=800";
const card={productId:"N70211553V",offerCode:"a46bd3942170c30c",
  sourceUrl,title:"Apple iPhone 17 256GB Black 5G",
  priceText:"3,399",priceAED:3399,currency:"AED",image};
const packet={finalUrl:searchUrl,language:"en-AE",heading:query,cards:[card]};
function admit(override={},opts={}) {
  return extractNoonUaeJsonCardEvidence({...packet,...override},query,
    {searchUrl,finalUrl:opts.finalUrl||searchUrl,limit:250});
}

test("Noon UAE historical PR310 product shape becomes exact product/offer AED record",()=>{
  const out=admit();
  assert.equal(out.status,"VERIFIED_UAE_MARKET_PRICE_CARDS");
  assert.equal(out.accepted,1);
  assert.deepEqual(out.offers[0],{
    productId:"N70211553V",offerCode:"a46bd3942170c30c",
    sourceUrl,title:"Apple iPhone 17 256GB Black 5G",
    image,price:3399,currency:"AED",
    currencyEvidence:"VERIFIED_UAE_STOREFRONT_CONTEXT",
    priceEvidence:"LIVE_AE_SEARCH_CARD_MARKET_CONTEXT_AED",
  });
});
test("Noon UAE Python JSON rejects source SKU/offer swaps and injected off-host links",()=>{
  for(const change of [
    {productId:"N70211554V"},
    {offerCode:"wrongCode"},
    {sourceUrl:"https://evil.invalid/uae-en/iphone-17-256gb-black/N70211553V/p/?o=a46bd3942170c30c"},
    {sourceUrl:"https://www.noon.com/saudi-en/iphone-17-256gb-black/N70211553V/p/?o=a46bd3942170c30c"},
    {image:"https://evil.invalid/p/bad.jpg"}
  ]){
    const out=admit({cards:[{...card,...change}]});
    assert.equal(out.accepted,0);
    assert.equal(out.invalidLinks,1);
  }
});
test("Noon UAE JSON rejects uncorroborated amount and foreign currency",()=>{
  for(const change of [
    {priceAED:3199}, {priceText:"AED 3,499",priceAED:3399},
    {priceText:"USD 3,399"}, {priceText:"SAR 3,399"},
    {priceText:"3,399 AED 1,999"}, {currency:"SAR"}
  ]){
    const out=admit({cards:[{...card,...change}]});
    assert.equal(out.accepted,0);
  }
});
test("Noon UAE JSON requires exact first-party search context, not just claims of UAE market",()=>{
  for(const change of [
    {language:"en-SA"}, {heading:"coffee machine"}, {finalUrl:"https://www.noon.com/uae-en/"},
    {finalUrl:"https://www.noon.com/uae-en/search/?q=PlayStation%205"}
  ]){
    assert.equal(admit(change,{finalUrl:change.finalUrl}).accepted,0);
  }
});
test("Noon UAE JSON rejects contradictory prices for identical SKU + offer",()=>{
  const out=admit({cards:[card,{...card,priceText:"3,499",priceAED:3499}]});
  assert.equal(out.conflicts,1);
  assert.equal(out.accepted,0);
});
test("Noon UAE JSON Arabic market-context prices remain AED with original precision",()=>{
  const q="سماعات بلوتوث", url="https://www.noon.com/uae-en/search/?q="+encodeURIComponent(q);
  const out=extractNoonUaeJsonCardEvidence({
    finalUrl:url,language:"ar-AE",heading:q,
    cards:[{...card,title:"سماعات بلوتوث لاسلكية",priceText:"١٩٩٫٥٠",priceAED:199.5}],
  },q,{searchUrl:url,finalUrl:url});
  assert.equal(out.accepted,1);
  assert.equal(out.offers[0].price,199.5);
  assert.equal(out.offers[0].currency,"AED");
});
