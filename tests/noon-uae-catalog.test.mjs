import test from "node:test";
import assert from "node:assert/strict";
import {parseNoonCatalogPayload} from "../server/providers/noon.mjs";

const hit={
  name:"Apple iPhone 17 256GB Black",
  sku:"N70211553V",
  price:3500,
  sale_price:3299,
  pdp_url:"/iphone-17-256gb-black/N70211553V/p/?o=tracking",
  image_url:"https://f.nooncdn.com/p/iphone17.jpg",
};
test("Noon UAE catalog preserves country, AED, offer price and canonical product link",()=>{
  const offers=parseNoonCatalogPayload({hits:[hit]},10,"AE");
  assert.equal(offers.length,1);
  assert.equal(offers[0].providerMarket,"noon-ae");
  assert.equal(offers[0].merchantCountryCode,"AE");
  assert.equal(offers[0].isLocal,false);
  assert.equal(offers[0].currency,"AED");
  assert.equal(offers[0].originalCurrency,"AED");
  assert.equal(offers[0].productPrice,3299);
  assert.equal(offers[0].sourceUrl,"https://www.noon.com/uae-en/iphone-17-256gb-black/N70211553V/p/");
});
test("Noon UAE refuses wrong-market, external and unpriced catalog hits",()=>{
  const hits=[
    {...hit,pdp_url:"/saudi-en/iphone/N70211553V/p/"},
    {...hit,pdp_url:"https://other.example/item/N70211553V/p/"},
    {...hit,price:0,sale_price:0},
  ];
  assert.equal(parseNoonCatalogPayload({hits},10,"AE").length,0);
});
test("Saudi Noon catalog behavior remains SAR with Saudi paths",()=>{
  const offers=parseNoonCatalogPayload({hits:[hit]},10);
  assert.equal(offers.length,1);
  assert.equal(offers[0].currency,"SAR");
  assert.equal(offers[0].merchantCountryCode,"SA");
  assert.equal(offers[0].sourceUrl,"https://www.noon.com/saudi-en/iphone-17-256gb-black/N70211553V/p/?o=tracking");
});
