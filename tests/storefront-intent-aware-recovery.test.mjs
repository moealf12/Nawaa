import test from "node:test";
import assert from "node:assert/strict";
import {
  selectStorefrontRecoveryLinks,
  searchFreeStorefrontById,
} from "../server/providers/free-storefronts.mjs";

const link=(slug,label)=>({url:"https://gcc.luluhypermarket.com/en-sa/product/"+slug,label,score:1});
const s25=link("samsung-galaxy-s25-256gb","Samsung Galaxy S25 256GB");
const s26=link("samsung-galaxy-s26-256gb","Samsung Galaxy S26 256GB");
const ultra=link("samsung-galaxy-s25-ultra-256gb","Samsung Galaxy S25 Ultra 256GB");
const old={title:"Samsung Galaxy S26 256GB",sourceUrl:s26.url,productPrice:3000,currency:"SAR"};
const valid={title:"Samsung Galaxy S25 256GB",sourceUrl:s25.url,productPrice:2400,currency:"SAR"};

test("RED: off-model direct cards cannot suppress eligible S25 PDP exploration",()=>{
  const d=selectStorefrontRecoveryLinks({
    query:"galaxy s25 256gb",directOffers:[old],links:[s26,ultra,s25],pageLimit:2,
  });
  assert.deepEqual(d.links.map(x=>x.url),[s25.url]);
  assert.equal(d.reason,"DIRECT_ALL_REJECTED");
  assert.equal(d.pageBudget,2);
});

test("positive controls: relevant direct offer never adds PDP traffic, empty direct follows old link plan",()=>{
  assert.deepEqual(selectStorefrontRecoveryLinks({
    query:"galaxy s25 256gb",directOffers:[valid],links:[s25],pageLimit:2,
  }).links,[]);
  const x=selectStorefrontRecoveryLinks({
    query:"galaxy s25 256gb",directOffers:[],links:[s25,s26],pageLimit:2,
  });
  assert.deepEqual(x.links,[s25,s26]);
  assert.equal(x.reason,"NO_DIRECT_OFFERS");
});

test("negative: malformed/contradictory anchors do not trigger expensive PDP recovery",()=>{
  const conflict={...s25,label:"Samsung Galaxy S26 256GB"};
  const results=selectStorefrontRecoveryLinks({
    query:"galaxy s25",directOffers:[old],links:[s26,ultra,conflict],pageLimit:2,
  });
  assert.deepEqual(results.links,[]);
  assert.equal(results.reason,"NO_SAFE_CANDIDATES");
});

test("negative: constrained budget and acquisition block fail closed, never loop endlessly",()=>{
  const other=link("samsung-galaxy-s25-navy","Galaxy S25 Navy");
  assert.equal(selectStorefrontRecoveryLinks({
    query:"galaxy s25",directOffers:[old],links:[s25,other],pageLimit:20,
  }).links.length,2);
  assert.deepEqual(selectStorefrontRecoveryLinks({
    query:"galaxy s25",directOffers:[old],links:[s25],pageLimit:0,
  }).links,[]);
  assert.deepEqual(selectStorefrontRecoveryLinks({
    query:"galaxy s25",directOffers:[old],links:[s25],pageLimit:2,searchBlocked:true,
  }).links,[]);
});

function makeSearchHtml(withDirectModel=false){
  const catalog=[
    {name:"Samsung Galaxy S26 256GB",price:2999,currency:"SAR",url:s26.url,image:"https://cdn.example.test/s26.jpg"},
    ...(withDirectModel?[{name:"Samsung Galaxy S25 256GB",price:2499,currency:"SAR",url:s25.url,image:"https://cdn.example.test/s25.jpg"}]:[]),
  ];
  return '<html><body><script type="application/json">'+JSON.stringify(catalog)+'</script>'+
    '<a href="'+s26.url+'">Samsung Galaxy S26 256GB</a>'+
    '<a href="'+s25.url+'">Samsung Galaxy S25 256GB</a></body></html>';
}
const productHtml='<html><head><script type="application/ld+json">'+JSON.stringify({
  "@context":"https://schema.org","@type":"Product",
  name:"Samsung Galaxy S25 256GB",sku:"SM-S931B",brand:{ "@type":"Brand",name:"Samsung"},
  image:"https://cdn.example.test/s25.jpg",url:s25.url,
  offers:{"@type":"Offer",price:"2499",priceCurrency:"SAR",url:s25.url,availability:"https://schema.org/InStock"},
})+'</script></head><body><h1>Samsung Galaxy S25 256GB</h1></body></html>';

test("RED integration: structured wrong-model prices cannot mask valid real PDP evidence", {concurrency:false}, async()=>{
  const previous=globalThis.fetch;let searchCalls=0,pdpCalls=0;
  try{
    globalThis.fetch=async input=>{
      const requested=String(input);
      if(requested.startsWith("https://gcc.luluhypermarket.com/en-sa/list/")){
        searchCalls++;return new Response(makeSearchHtml(),{status:200,headers:{"content-type":"text/html"}});
      }
      if(requested===s25.url){
        pdpCalls++;return new Response(productHtml,{status:200,headers:{"content-type":"text/html"}});
      }
      throw Error("unexpected network request: "+new URL(requested).origin);
    };
    const found=await searchFreeStorefrontById("lulu-sa","galaxy s25 256gb",{perStore:2});
    assert.equal(searchCalls,1);
    assert.equal(pdpCalls,1);
    assert.equal(found.offers.length,1);
    assert.equal(found.offers[0].title,"Samsung Galaxy S25 256GB");
    assert.equal(found.offers[0].productPrice,2499);
    assert.equal(found.diagnostics.intentRecovery?.reason,"DIRECT_ALL_REJECTED");
  }finally{globalThis.fetch=previous}
});

test("integration: already matched direct cards must not request PDPs", {concurrency:false}, async()=>{
  const prior=globalThis.fetch;let pdps=0;
  try{
    globalThis.fetch=async input=>{
      if(String(input).startsWith("https://gcc.luluhypermarket.com/en-sa/list/"))
        return new Response(makeSearchHtml(true),{status:200,headers:{"content-type":"text/html"}});
      pdps++;throw Error("unnecessary PDP request");
    };
    const r=await searchFreeStorefrontById("lulu-sa","galaxy s25 256gb",{perStore:2});
    assert.equal(pdps,0);
    assert.ok(r.offers.some(x=>x.title==="Samsung Galaxy S25 256GB"));
    assert.equal(r.diagnostics.intentRecovery?.attempted,0);
  }finally{globalThis.fetch=prior}
});

test("negative: distinct S25 Plus and Edge versions must not consume base S25 recovery budget",()=>{
  const variants=[
    link("samsung-galaxy-s25-plus-256gb","Samsung Galaxy S25+ 256GB"),
    link("samsung-galaxy-s25-edge-256gb","Samsung Galaxy S25 Edge 256GB"),
    link("samsung-galaxy-s25-ultra-256gb","Samsung Galaxy S25 Ultra 256GB"),
    link("samsung-galaxy-s25-fe-256gb","Samsung Galaxy S25 FE 256GB"),
  ];
  const plan=selectStorefrontRecoveryLinks({
    query:"Samsung Galaxy S25 256GB",directOffers:[old],
    links:[...variants,s25],pageLimit:2,
  });
  assert.deepEqual(plan.links.map(x=>x.url),[s25.url]);
});

test("bounded recovery: unconvertible structured cards must not trigger 30 PDP requests",()=>{
  const candidates=Array.from({length:15},(_,i)=>link(
    "samsung-galaxy-s25-256gb-variant-"+i,"Samsung Galaxy S25 256GB variant "+i));
  const result=selectStorefrontRecoveryLinks({
    query:"galaxy s25 256gb",directOffers:[],hadStructuredCards:true,
    links:candidates,pageLimit:Infinity,
  });
  assert.equal(result.links.length,2);
  assert.equal(result.attempted,2);
  assert.equal(result.reason,"DIRECT_ALL_REJECTED");
  const noCards=selectStorefrontRecoveryLinks({
    query:"galaxy s25 256gb",directOffers:[],hadStructuredCards:false,
    links:candidates,pageLimit:Infinity,
  });
  assert.equal(noCards.links.length,15);
});
