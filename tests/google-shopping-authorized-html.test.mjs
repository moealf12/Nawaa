import test from "node:test";
import assert from "node:assert/strict";
import {
  merchantProductLink,productImageUrl,extractAuthorizedGoogleShoppingHtml,
  authorizedGoogleShoppingSearchUrl,
} from "../server/providers/google-shopping-authorized.mjs";

const SOURCE="https://www.google.com/search?tbm=shop&q=iphone&gl=sa&hl=ar";
const JSONLD='<html><head><title>Shopping</title><script type="application/ld+json">'+JSON.stringify({
  "@context":"https://schema.org","@type":"ItemList",
  "itemListElement":[{"@type":"ListItem","item":{"@type":"Product",
    name:"iPhone 17 256GB",
    image:"https://encrypted-tbn0.gstatic.com/images?q=tbn:iphone",
    offers:{"@type":"Offer",price:3299,priceCurrency:"SAR",
      url:"https://merchant.example/products/iphone-17-256gb",
      seller:{name:"Merchant Example"}}}}]
})+'</script></head><body></body></html>';
const DOM='<html><head><title>Shopping results</title></head><body>'+
  '<article data-product-id="01234"><h3>Sony Wireless Headphones WH1000XM5</h3>'+
  '<img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:headphones">'+
  '<span class="price">SAR 1299.00</span>'+
  '<a href="https://www.google.com/url?url=https%3A%2F%2Fstore.example%2Fsony-headphones">Buy</a>'+
  '</article></body></html>';
test("extractor handles complete co-located JSON-LD Product and Offer",()=>{
 const r=extractAuthorizedGoogleShoppingHtml(JSONLD,{query:"iPhone 17 256GB",sourceUrl:SOURCE});
 assert.equal(r.status,"UNVERIFIED_CANDIDATES");
 assert.equal(r.cards.length,1);
 const item=r.cards[0];
 assert.equal(item.title,"iPhone 17 256GB");
 assert.equal(item.image,"https://encrypted-tbn0.gstatic.com/images?q=tbn:iphone");
 assert.equal(item.merchantUrl,"https://merchant.example/products/iphone-17-256gb");
 assert.equal(item.currency,"SAR");assert.equal(item.numericAmount,3299);
 assert.equal(item.merchantName,"Merchant Example");
 assert.equal(item.verifiedPrice,false);assert.equal(item.verifiedMerchantPdp,false);
 assert.equal(item.rankableInNawaa,false);assert.equal(r.publishableOffers,0);
});
test("extractor handles complete co-located DOM Shopping card",()=>{
 const r=extractAuthorizedGoogleShoppingHtml(DOM,{query:"سماعات بلوتوث",sourceUrl:SOURCE});
 assert.equal(r.cards.length,1);
 assert.equal(r.cards[0].currency,"SAR");
 assert.equal(r.cards[0].numericAmount,1299);
 assert.equal(r.cards[0].merchantUrl,"https://store.example/sony-headphones");
 assert.equal(r.cards[0].evidenceType,"colocated_search_card");
});
test("extractor never imports partial or differently scoped price/image/merchant cards",()=>{
 const withoutImage=DOM.replace(/<img[^>]+>/,"");
 const withoutPrice=DOM.replace(/<span class="price">[^<]+<\/span>/,"");
 const withoutMerchant=DOM.replace(/<a href="[^"]+">Buy<\/a>/,"");
 for(const html of [withoutImage,withoutPrice,withoutMerchant]){
   const r=extractAuthorizedGoogleShoppingHtml(html,{query:"sony",sourceUrl:SOURCE});
   assert.equal(r.cards.length,0);
   assert.equal(r.publishableOffers,0);
 }
});
test("safe original merchant URLs only; Google redirector may unwrap only HTTPS external URL",()=>{
 for(const url of [
   "javascript:alert(1)",
   "http://store.example/p/1",
   "https://www.google.com/shopping/product/123",
   "https://store.example@google.com/url?q=x",
   "https://127.0.0.1/private",
   "https://192.168.0.1/private",
   "https://www.google.com/url?q=javascript%3Aalert%281%29",
 ])assert.equal(merchantProductLink(url),null,url);
 assert.equal(merchantProductLink("https://www.google.com/url?q=https%3A%2F%2Fmerchant.example%2Fproduct%3Fid%3D1"),
  "https://merchant.example/product?id=1");
 assert.equal(productImageUrl("javascript:alert(1)"),null);
 assert.equal(productImageUrl("http://store.example/1.png"),null);
});
test("blocked/interstitial HTML must not produce price cards",()=>{
 for(const title of ["Update your browser to continue","Our systems have detected unusual traffic","Captcha challenge"]){
   const r=extractAuthorizedGoogleShoppingHtml(JSONLD.replace("<title>Shopping</title>","<title>"+title+"</title>"),{
     query:"iPhone",sourceUrl:SOURCE});
   assert.equal(r.status,"PAGE_INTERSTITIAL_OR_ACCESS_CHALLENGE");
   assert.equal(r.cards.length,0);
 }
});
test("no original seller link means no fake Google Shopping PDP equivalent",()=>{
 const g=JSONLD.replace("https://merchant.example/products/iphone-17-256gb",
   "https://www.google.com/shopping/product/123456");
 const r=extractAuthorizedGoogleShoppingHtml(g,{query:"iPhone",sourceUrl:SOURCE});
 assert.equal(r.cards.length,0);
});
test("arbitrary search query builds only pinned Google Shopping path; rejects URL and malformed",()=>{
 for(const q of ["PS5 Pro","سماعات بلوتوث","لابتوب HP 16GB","iPhone 17 256GB"]){
   const url=authorizedGoogleShoppingSearchUrl(q);
   const parsed=new URL(url);
   assert.equal(parsed.origin,"https://www.google.com");
   assert.equal(parsed.pathname,"/search");
   assert.equal(parsed.searchParams.get("q"),q);
   assert.equal(parsed.searchParams.get("tbm"),"shop");
   assert.equal(parsed.searchParams.get("gl"),"sa");
 }
 assert.equal(authorizedGoogleShoppingSearchUrl("https://test.example/?token=secret"),null);
 assert.equal(authorizedGoogleShoppingSearchUrl("A"),null);
 assert.equal(authorizedGoogleShoppingSearchUrl(""),null);
});
test("direct extraction is only a candidate; does not mutate source registry or main search flow",async()=>{
 const {readFile}=await import("node:fs/promises");
 const code=await readFile(new URL("../server/providers/google-shopping-authorized.mjs",import.meta.url),"utf8");
 const script=await readFile(new URL("../scripts/google-shopping-authorized-live.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(code+script,/persistOffers|recordOffer\(|searchAll\(|\/api\/ingest\/offers|fetch\(.*merchantUrl/);
 assert.match(script,/NAWAA_GOOGLE_SHOPPING_DIRECT_AUTHORIZED==="1"/);
 assert.match(script,/redirect:"manual"/);
 assert.match(script,/NO_PROXY_NO_PAID_API/);
});
