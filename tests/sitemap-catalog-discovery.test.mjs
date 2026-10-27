import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCatalogSitemap,
  diffCatalogSitemapObservations,
  auditDecathlonSitemap,
} from "../scripts/audit-sitemap-discovery.mjs";

const domain="https://decathlon.com.sa";
const prod=(id)=>domain+"/products/"+id;
const urlset=(urls)=>'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
  urls.map(url=>"<url><loc>"+url+"</loc><lastmod>2021-01-01</lastmod></url>").join("")+"</urlset>";
const index=(urls)=>'<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
  urls.map(url=>"<sitemap><loc>"+url+"</loc></sitemap>").join("")+"</sitemapindex>";

test("RED E.1.5: sitemap URLSET yields only HTTPS source-owned product candidates, never offers",()=>{
  const doc=urlset([prod("running-shoes"),prod("sports-shirt"),domain+"/pages/about",
    "https://decathlon.com.sa.evil.example/products/foreign",
    "http://decathlon.com.sa/products/untrusted",
    "https://example.com/products/untrusted",
    domain+"/products/strange?token=secret"]);
  const parsed=parseCatalogSitemap(doc,domain+"/sitemap_products_1.xml");
  assert.equal(parsed.kind,"urlset");
  assert.deepEqual(parsed.productUrls,[prod("running-shoes"),prod("sports-shirt")]);
  assert.equal(parsed.complete,true);
  assert.equal(JSON.stringify(parsed).includes("secret"),false);
  assert.equal("offers" in parsed,false);
  assert.equal("price" in parsed,false);
});

test("RED E.1.5: reject DTD, entities and oversize XML safely",()=>{
  assert.equal(parseCatalogSitemap('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><urlset/>',domain+"/sitemap.xml").kind,"INVALID");
  assert.equal(parseCatalogSitemap("x".repeat(600_000),domain+"/sitemap.xml").kind,"INVALID");
  assert.equal(parseCatalogSitemap("<html>nothing</html>",domain+"/sitemap.xml").kind,"INVALID");
});

test("RED E.1.5: sitemap index accepts one same-origin product sitemap, ignores pages/foreign",()=>{
  const xml=index([domain+"/sitemap_products_1.xml?from=official",
    domain+"/sitemap_pages_1.xml",
    "https://unrelated.example/sitemap_products_1.xml",
    domain+"/sitemap_products_2.xml"]);
  const parsed=parseCatalogSitemap(xml,domain+"/sitemap.xml");
  assert.equal(parsed.kind,"sitemapindex");
  assert.equal(parsed.childSitemaps.length,2);
  assert.ok(parsed.childSitemaps[0].startsWith(domain+"/sitemap_products_1.xml"));
  assert.equal(parsed.complete,true);
});

test("RED E.1.5: missing URL never marks a product out of stock or deletes price records",()=>{
  const before={complete:true,productUrls:[prod("a"),prod("b")]};
  const after={complete:true,productUrls:[prod("b"),prod("c")]};
  const delta=diffCatalogSitemapObservations(before,after);
  assert.deepEqual(delta.newCandidates,[prod("c")]);
  assert.deepEqual(delta.notObservedInLatest,[prod("a")]);
  assert.equal(delta.inventoryChanges.length,0);
  assert.equal(delta.priceUpdates.length,0);
  assert.equal(delta.allowTrustedOfferPromotion,false);
  assert.equal(delta.missingUrlMeaning,"NOT_OBSERVED_IN_LATEST_SITEMAP");
});

test("RED E.1.5: partial samples cannot provide missing-URL evidence",()=>{
  const before={complete:true,productUrls:[prod("a"),prod("b")]};
  const after={complete:false,productUrls:[prod("a")]};
  const delta=diffCatalogSitemapObservations(before,after);
  assert.deepEqual(delta.notObservedInLatest,[]);
  assert.equal(delta.missingUrlMeaning,"INSUFFICIENT_COVERAGE");
  assert.equal(delta.allowTrustedOfferPromotion,false);
});

test("RED E.1.5: live reader does not follow external redirect or attempt to contact destination",async()=>{
  const attempted=[];
  const report=await auditDecathlonSitemap({
    fetchPage:async(url,opts)=>{
      attempted.push(url);
      assert.equal(opts.redirect,"manual");
      return new Response(null,{status:302,headers:{location:"https://evil.example/internal"}});
    }
  });
  assert.deepEqual(attempted,[domain+"/sitemap.xml"]);
  assert.equal(report.status,"SOURCE_UNAVAILABLE");
  assert.equal(report.productCandidates,0);
  assert.equal(report.offerPricesCertified,0);
});

test("RED E.1.5: bounded index uses one child only, never asserts full catalog coverage",async()=>{
  const attempted=[];
  const report=await auditDecathlonSitemap({
    fetchPage:async url=>{
      attempted.push(url);
      if(url===domain+"/sitemap.xml")
        return new Response(index([domain+"/sitemap_products_1.xml",
          domain+"/sitemap_products_2.xml"]),{status:200,headers:{"content-type":"application/xml"}});
      if(url===domain+"/sitemap_products_1.xml")
        return new Response(urlset([prod("running-shoes"),prod("sports-shirt")]),{
          status:200,headers:{"content-type":"text/xml"}});
      throw Error("unexpected fetch");
    },
  });
  assert.deepEqual(attempted,[domain+"/sitemap.xml",domain+"/sitemap_products_1.xml"]);
  assert.equal(report.status,"PARTIAL_SAMPLE");
  assert.equal(report.productCandidates,2);
  assert.equal(report.complete,false);
  assert.equal(report.offerPricesCertified,0);
  assert.equal(report.inventoryVerified,false);
  assert.equal(JSON.stringify(report).includes("running-shoes"),false,"public report aggregate-only");
});

test("RED E.1.5: valid empty sitemap is not 'out of stock'",async()=>{
  const report=await auditDecathlonSitemap({fetchPage:async()=>new Response(urlset([]),{
    status:200,headers:{"content-type":"application/xml"}})});
  assert.equal(report.status,"NO_CANDIDATES_OBSERVED");
  assert.equal(report.productCandidates,0);
  assert.equal(report.inventoryVerified,false);
});

test("RED E.1.5: blocked 429 makes zero retry attempts",async()=>{
  let calls=0;
  const report=await auditDecathlonSitemap({fetchPage:async()=>{calls++;return new Response(null,{status:429,headers:{"retry-after":"120"}})}});
  assert.equal(calls,1);
  assert.equal(report.status,"SOURCE_RATE_LIMITED");
  assert.equal(report.offerPricesCertified,0);
});
