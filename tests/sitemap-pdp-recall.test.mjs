import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDecathlonPdpEvidence,
  compareSitemapWithStoreSearch,
  auditSitemapPdpRecall,
} from "../scripts/audit-sitemap-pdp-recall.mjs";

const base="https://decathlon.com.sa";
const product=base+"/products/kalenji-running-shoes-100";
const other=base+"/products/kipsta-training-shirt";
const xml=(entries)=>'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
  entries.map(u=>'<url><loc>'+u+'</loc></url>').join("")+"</urlset>";
const pdp=(changes={})=>({
  title:"Kalenji Running Shoes 100",
  sourceUrl:product,
  resolvedPageUrl:product,
  productPrice:99,
  originalProductPrice:99,
  currency:"SAR",
  originalCurrency:"SAR",
  sku:"RUN-100-BLACK",
  image:"https://decathlon.com.sa/cdn/shop/files/shoes.jpg",
  variantId:"12345",
  extraction:{conflicts:[]},
  ...changes,
});

test("RED: independently extracted exact-PDP price still is NOT a sellable offer",()=>{
  const v=validateDecathlonPdpEvidence(product,pdp());
  assert.equal(v.status,"PDP_IDENTIFIED_PRICE_OBSERVED");
  assert.equal(v.priceObserved,true);
  assert.equal(v.priceCorroboratedBySearch,false);
  assert.equal(v.trustedOfferEligible,false);
  assert.equal("price" in v,false,"no price is emitted in diagnostic");
});

test("RED: reject cross-product redirect, foreign domain and other source price",()=>{
  for(const changes of [
    {resolvedPageUrl:other},
    {sourceUrl:other},
    {resolvedPageUrl:"https://evil.example/products/kalenji-running-shoes-100"},
    {sourceUrl:"https://decathlon.com.sa.evil.example/products/kalenji-running-shoes-100"},
  ]){
    const result=validateDecathlonPdpEvidence(product,pdp(changes));
    assert.equal(result.status,"PDP_IDENTITY_MISMATCH");
    assert.equal(result.priceObserved,false);
  }
});

test("RED: stale/family prices, missing source variant and explicit conflicts cannot pass",()=>{
  const cases=[
    [pdp({sku:null,variantId:null}),"PDP_VARIANT_UNCERTAIN"],
    [pdp({productPrice:null}),"PDP_PRICE_UNAVAILABLE"],
    [pdp({currency:"USD"}),"PDP_PRICE_UNAVAILABLE"],
    [pdp({productPrice:0}),"PDP_PRICE_UNAVAILABLE"],
    [pdp({extraction:{conflicts:[{field:"price"}]}}),"PDP_PRICE_CONFLICT"],
    [pdp({title:"",image:null}),"PDP_SUBJECT_UNCERTAIN"],
  ];
  for(const [source,status] of cases)assert.equal(validateDecathlonPdpEvidence(product,source).status,status);
});

test("RED: search comparison distinguishes exact URL and price from merely similar item",()=>{
  const page=pdp();
  assert.equal(compareSitemapWithStoreSearch(product,page,{offers:[{...page}]}).status,"SEARCH_SAME_ITEM_PRICE_MATCH");
  assert.equal(compareSitemapWithStoreSearch(product,page,{offers:[{...page,productPrice:199}]}).status,"SEARCH_PRICE_CONFLICT");
  assert.equal(compareSitemapWithStoreSearch(product,page,{offers:[{...page,sourceUrl:other}]}).status,"NOT_FOUND_IN_THIS_SEARCH");
  assert.equal(compareSitemapWithStoreSearch(product,page,{offers:[],diagnostics:{primarySearchError:"HTTP 403"}}).status,"SEARCH_UNAVAILABLE");
});

test("RED: one sitemap response and two PDP samples, zero search when PDP untrusted",async()=>{
  const counts={map:0,pdp:0,search:0};
  const report=await auditSitemapPdpRecall({
    fetchPage:async()=>{counts.map++;return new Response(xml([product,other,base+"/pages/about"]),{
      status:200,headers:{"content-type":"text/xml"}})},
    resolvePdp:async url=>{
      counts.pdp++;
      return url===product?pdp():pdp({sourceUrl:product,resolvedPageUrl:product});
    },
    searchStore:async()=>{counts.search++;return {offers:[],diagnostics:{}}},
  });
  assert.deepEqual(counts,{map:1,pdp:2,search:1});
  assert.equal(report.sampledPdp,2);
  assert.equal(report.pdpIdentityAndPriceObserved,1);
  assert.equal(report.searchQueries,1);
  assert.equal(report.notObservedInSampledSearch,1);
  assert.equal(report.trustedOffersCreated,0);
  assert.equal(report.inventoryVerified,false);
  assert.equal(report.catalogCompleteness,true);
  assert.equal(JSON.stringify(report).includes("99"),false);
  assert.equal(JSON.stringify(report).includes("running-shoes"),false);
});

test("RED: sitemap index is sampled incompletely, never claim full catalog recall",async()=>{
  const root='<sitemapindex><sitemap><loc>'+base+'/sitemap_products_1.xml</loc></sitemap><sitemap><loc>'+base+'/sitemap_products_2.xml</loc></sitemap></sitemapindex>';
  let hits=0;
  const report=await auditSitemapPdpRecall({
    fetchPage:async u=>{hits++;return new Response(u.endsWith("/sitemap.xml")?root:xml([product]),{status:200,headers:{"content-type":"text/xml"}})},
    resolvePdp:async()=>pdp(),searchStore:async()=>({offers:[],diagnostics:{}}),
  });
  assert.equal(hits,2);
  assert.equal(report.catalogCompleteness,false);
  assert.equal(report.notObservedInSampledSearch,1);
  assert.equal(report.verifiedGlobalRecallUplift,false);
});

test("RED: 403/429 sitemap denies access; no PDP, search or retry",async()=>{
  for(const status of [403,429]){
    const n={map:0,pdp:0,search:0};
    const result=await auditSitemapPdpRecall({
      fetchPage:async()=>{n.map++;return new Response(null,{status})},
      resolvePdp:async()=>{n.pdp++;throw Error("unexpected PDP")},
      searchStore:async()=>{n.search++;throw Error("unexpected search")},
    });
    assert.deepEqual(n,{map:1,pdp:0,search:0});
    assert.equal(result.trustedOffersCreated,0);
    assert.equal(result.catalogCompleteness,false);
  }
});
