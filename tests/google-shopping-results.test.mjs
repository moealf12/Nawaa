import test from "node:test";
import assert from "node:assert/strict";
import {
  safeGoogleShoppingProductUrl,
  safeGoogleShoppingImage,
  normalizeGoogleShoppingResults,
  buildSerpApiGoogleShoppingUrl,
  createGoogleShoppingResultsClient,
} from "../server/google-shopping-results.mjs";
import {renderGoogleShoppingDiscoveryCards} from "../src/google-shopping-cards.mjs";

const product=(override={})=>({
  product_id:"16914877625280977865",
  product_link:"https://www.google.com/shopping/product/16914877625280977865?gl=sa",
  title:"Sony WH-1000XM5 Bluetooth Headphones",
  source:"Example Retailer",
  price:"SAR 1,199.00",
  extracted_price:1199,
  thumbnail:"https://encrypted-tbn2.gstatic.com/shopping?q=tbn:example",
  ...override,
});
const body=(items)=>({shopping_results:items});

test("Google Shopping: canonical product URLs only, no redirectors, merchant links or lookalike hosts",()=>{
 for(const raw of [
   "https://google.com/url?q=https://evil.test",
   "https://google.com/shopping/search?q=iphone",
   "https://www.google.com.evil.test/shopping/product/16914877625280977865",
   "http://www.google.com/shopping/product/16914877625280977865",
   "javascript:alert(1)","https://merchant.example/p/42",
 ])assert.equal(safeGoogleShoppingProductUrl(raw),null,raw);
 assert.match(safeGoogleShoppingProductUrl(product().product_link),/^https:\/\/www\.google\.com\/shopping\/product\//);
 assert.equal(safeGoogleShoppingImage("https://evil.test/shopping.jpg"),null);
 assert.match(safeGoogleShoppingImage(product().thumbnail),/^https:\/\//);
});

test("Google Shopping: structured real-shape shopping_results stay unverified and nonrankable",()=>{
 const normalized=normalizeGoogleShoppingResults(body([product()]),{now:"2026-11-05T00:00:00Z"});
 assert.equal(normalized.state,"UNVERIFIED_SHOPPING_CARDS");
 assert.equal(normalized.cards.length,1);
 const card=normalized.cards[0];
 assert.equal(card.id,"16914877625280977865");
 assert.equal(card.displayedPrice,"SAR 1,199.00");
 assert.equal(card.observedAmountSar,1199);
 assert.equal(card.displayedCurrency,"SAR");
 assert.equal(card.verifiedPrice,false);
 assert.equal(card.verifiedMerchantPdp,false);
 assert.equal(card.verifiedSku,false);
 assert.equal(card.rankableInNawaa,false);
 assert.equal(card.totalLandedCostSar,null);
 assert.equal(card.merchantDeliveryToSaudiVerified,null);
 assert.equal(normalized.comparableOffers,0);
 assert.equal(normalized.verifiedPrices,0);
});

test("Google Shopping: no merchant identity laundering or currency invention",()=>{
 const o=normalizeGoogleShoppingResults(body([
   product({product_id:"12",product_link:"https://www.google.com/shopping/product/12"}),
   product({product_link:"https://www.google.com/shopping/product/12345"}),
   product({product_id:"9999999999",product_link:"https://www.google.com/shopping/product/9999999999",price:"$0 now",extracted_price:0}),
   product({product_id:"123456789012345",product_link:"https://www.google.com/shopping/product/123456789012345",
     price:"1,999",extracted_price:1999}),
 ]));
 assert.equal(o.cards.length,2);
 assert.equal(o.cards[0].observedAmountSar,null);
 assert.equal(o.cards[1].observedAmountSar,null);
 assert.equal(o.cards[1].displayedCurrency,null);
});

test("Google Shopping: dedupe product identifiers and cap bounded results",()=>{
 const base=product();
 const list=Array.from({length:65},(_,i)=>product({
   product_id:String(10000000000000000000n+BigInt(i)),
   product_link:"https://www.google.com/shopping/product/"+String(10000000000000000000n+BigInt(i)),
 }));
 const o=normalizeGoogleShoppingResults(body([base,base,...list]));
 assert.equal(o.cards.length,24);
 assert.equal(new Set(o.cards.map(x=>x.id)).size,24);
 assert.ok(o.rejected>=1);
});

test("Google Shopping: SerpApi request is fixed-host, Saudi localized and requires server-side key",()=>{
 const u=buildSerpApiGoogleShoppingUrl("سماعات بلوتوث JBL",{key:"test_example_private_key_123"});
 assert.equal(u.origin,"https://serpapi.com");
 assert.equal(u.pathname,"/search.json");
 assert.equal(u.searchParams.get("engine"),"google_shopping");
 assert.equal(u.searchParams.get("q"),"سماعات بلوتوث JBL");
 assert.equal(u.searchParams.get("gl"),"sa");
 assert.equal(u.searchParams.get("hl"),"ar");
 assert.equal(u.searchParams.get("api_key"),"test_example_private_key_123");
 assert.equal(buildSerpApiGoogleShoppingUrl("https://secret.test/token",{key:"test_example_private_key_123"}),null);
});

test("Google Shopping: without configured key all requests fail closed before provider network",async()=>{
 let calls=0;
 const client=createGoogleShoppingResultsClient({
   enabled:false,apiKey:"",fetchImpl:()=>{calls++;throw Error("should never be called")},
 });
 const result=await client.run("PS5 Pro");
 assert.equal(result.status,503);
 assert.equal(result.body.error,"google_shopping_not_configured");
 assert.equal(calls,0);
});

test("Google Shopping: remote observations delivered from fake provider transport, no key leak",async()=>{
 let called=0;
 const client=createGoogleShoppingResultsClient({
   enabled:true,apiKey:"example_private_serpapi_key_123456",
   fetchImpl:async (url,opts)=>{
     called++;
     assert.equal(new URL(url).host,"serpapi.com");
     assert.equal(opts.redirect,"error");
     assert.ok(opts.signal);
     return new Response(JSON.stringify(body([product()])),{
       status:200,headers:{"content-type":"application/json"}});
   },
 });
 const r=await client.run("Sony Bluetooth headphones");
 assert.equal(r.status,200);
 assert.equal(r.body.cards.length,1);
 assert.equal(r.body.verifiedPriceCount,0);
 assert.equal(r.body.customerOfferCount,0);
 assert.doesNotMatch(JSON.stringify(r.body),/example_private_serpapi_key/);
 const again=await client.run("Sony Bluetooth headphones");
 assert.equal(again.body.fromCache,true);
 assert.equal(called,1);
});

test("Google Shopping: absolute monthly quota stops additional distinct searches",async()=>{
 let calls=0;
 const client=createGoogleShoppingResultsClient({
   enabled:true,apiKey:"example_private_serpapi_key_123456",
   monthlyCap:1,
   fetchImpl:async()=>{calls++;return new Response(JSON.stringify(body([product()])),{
     headers:{"content-type":"application/json"}})},
 });
 assert.equal((await client.run("AirPods 3")).status,200);
 assert.equal((await client.run("Galaxy S26")).status,429);
 assert.equal(calls,1);
});

test("Google Shopping: cap hourly free-tier requests independently of monthly budget",async()=>{
 let calls=0;
 const client=createGoogleShoppingResultsClient({
   enabled:true,apiKey:"example_private_serpapi_key_123456",
   monthlyCap:200,hourlyCap:1,
   fetchImpl:async()=>{calls++;return new Response(JSON.stringify(body([product()])),{
     headers:{"content-type":"application/json"}})},
 });
 assert.equal((await client.run("AirPods 3")).status,200);
 const blocked=await client.run("Galaxy S26");
 assert.equal(blocked.status,429);
 assert.equal(blocked.body.error,"shopping_hourly_budget_exhausted");
 assert.equal(calls,1);
 assert.equal(client.status().hourlyCalls,1);
});

test("Google Shopping: concurrent identical queries reuse a single provider call",async()=>{
 let calls=0;
 const client=createGoogleShoppingResultsClient({
   enabled:true,apiKey:"example_private_serpapi_key_123456",
   fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return new Response(JSON.stringify(body([product()])),{
     headers:{"content-type":"application/json"}})},
 });
 const r=await Promise.all(Array.from({length:5},()=>client.run("PlayStation 5")));
 assert.equal(calls,1);
 assert.ok(r.every(v=>v.status===200));
});

test("Google Shopping: reject provider errors, wrong content type and oversized JSON",async()=>{
 const bads=[
   ()=>new Response("not json",{headers:{"content-type":"text/html"}}),
   ()=>new Response(JSON.stringify({error:"invalid_api_key"}),{headers:{"content-type":"application/json"}}),
   ()=>new Response("{}",{status:429,headers:{"content-type":"application/json"}}),
 ];
 for(const fail of bads){
   const c=createGoogleShoppingResultsClient({enabled:true,
     apiKey:"example_private_serpapi_key_123456",fetchImpl:async()=>fail()});
   const r=await c.run("iPhone 17");
   assert.equal(r.status,502);
   assert.equal(r.body.cards.length,0);
 }
});

test("Google Shopping: rendered card escapes injected text and refuses unverified source-shaped offers",()=>{
 const valid=normalizeGoogleShoppingResults(body([
   product({title:'Sony "<script>alert(1)</script>" Headphones'})
 ])).cards;
 const html=renderGoogleShoppingDiscoveryCards(valid);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/غير متحقق من المتجر/);
 assert.match(html,/target="_blank" rel="noopener noreferrer"/);
 assert.match(html,/SAR 1,199.00/);
 assert.equal(renderGoogleShoppingDiscoveryCards(valid.map(x=>({...x,verifiedPrice:true}))),"");
 assert.equal(renderGoogleShoppingDiscoveryCards(valid.map(x=>({...x,source:"jarir"}))),"");
 assert.equal(renderGoogleShoppingDiscoveryCards([{...valid[0],productUrl:"javascript:alert(1)"}]),"");
});
