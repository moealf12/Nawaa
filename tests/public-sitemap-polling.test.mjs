import test from "node:test";
import assert from "node:assert/strict";
import {parsePublicSitemapXml} from "../src/public-sitemap-evidence.mjs";
import {pollSitemapSource,pollConfiguredSitemaps} from "../scripts/poll-public-sitemaps.mjs";

const source={id:"test-shop",merchantHost:"merchant.example",
  sitemapUrl:"https://merchant.example/sitemap.xml",
  baselineUrls:["https://merchant.example/p/one","https://merchant.example/p/two"]};
const xml=urls=>'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
  urls.map(u=>'<url><loc>'+u.replaceAll("&","&amp;")+'</loc></url>').join("")+
  '</urlset>';

test("sitemap parser accepts complete same-host urlset but strips tracking fragment",()=>{
  const result=parsePublicSitemapXml(xml([
    "https://merchant.example/p/one#section",
    "https://merchant.example/p/two?variant=blue&foo=bar",
    "https://hostile.invalid/inject",
  ]),{merchantHost:"merchant.example"});
  assert.equal(result.complete,true);
  assert.deepEqual(result.urls,[
    "https://merchant.example/p/one",
    "https://merchant.example/p/two?variant=blue&foo=bar",
  ]);
});

test("sitemap parser refuses dangerous XML entities, indexes, HTML and overly long snapshots",()=>{
  const inputs=[
    "<!DOCTYPE foo [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><urlset><url><loc>&x;</loc></url></urlset>",
    "<sitemapindex><sitemap><loc>https://merchant.example/child.xml</loc></sitemap></sitemapindex>",
    "<html>not sitemap</html>",
    "<urlset>"+("x".repeat(2_000_001))+"</urlset>",
  ];
  for(const value of inputs)
    assert.equal(parsePublicSitemapXml(value,{merchantHost:"merchant.example"}).complete,false);
});

test("sitemap poll observes a missing URL as reverify-only, not deletion or stock outage",async()=>{
  const calls=[];
  const result=await pollSitemapSource(source,{fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return new Response(xml(["https://merchant.example/p/two"]),{
      status:200,headers:{"content-type":"application/xml"}});
  }});
  assert.equal(result.status,"OBSERVED");
  assert.equal(result.indexMutated,false);
  assert.equal(result.productAvailability,"unknown");
  assert.deepEqual(result.missing.map(x=>x.url),["https://merchant.example/p/one"]);
  assert.equal(result.missing[0].removeFromIndex,false);
  assert.equal(result.missing[0].productAvailability,"unknown");
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.redirect,"manual");
});

test("sitemap poll never re-routes access-denied or rate-limited source",async()=>{
  for(const status of [403,429]){
    let calls=0;
    const result=await pollSitemapSource(source,{fetchImpl:async()=>{
      calls++;
      return new Response("Blocked",{status});
    }});
    assert.equal(calls,1);
    assert.equal(result.status,"SOURCE_ACCESS_DENIED_OR_LIMITED");
    assert.equal(result.complete,false);
    assert.deepEqual(result.missing,[]);
  }
});

test("sitemap 404 and 500 do not manufacture deletions or out-of-stock",async()=>{
  for(const status of [404,500]){
    const result=await pollSitemapSource(source,{fetchImpl:async()=>new Response("missing",{status})});
    assert.equal(result.status,"SITEMAP_NOT_AVAILABLE");
    assert.deepEqual(result.missing,[]);
    assert.equal(result.complete,false);
  }
});

test("sitemap index needs all children; no partial URL set is ever diffed",async()=>{
  const result=await pollSitemapSource(source,{fetchImpl:async()=>new Response(
    '<sitemapindex><sitemap><loc>https://merchant.example/part.xml</loc></sitemap></sitemapindex>',
    {status:200})});
  assert.equal(result.complete,false);
  assert.equal(result.status,"SITEMAP_INDEX_REQUIRES_CHILDREN");
  assert.deepEqual(result.missing,[]);
});

test("sitemap source and host are maintainer approved; SSRF and redirects fail closed",async()=>{
  const bad=[
    {...source,sitemapUrl:"http://merchant.example/sitemap.xml"},
    {...source,sitemapUrl:"https://127.0.0.1/sitemap.xml",merchantHost:"127.0.0.1"},
    {...source,sitemapUrl:"https://evil.example/sitemap.xml"},
    {...source,sitemapUrl:"https://merchant.example/sitemap.xml.gz"},
  ];
  for(const item of bad){
    const result=await pollSitemapSource(item,{fetchImpl:async()=>{throw Error("MUST_NOT_FETCH")}});
    assert.equal(result.status,"INVALID_SOURCE_CONFIG");
  }
  const redirect=await pollSitemapSource(source,{fetchImpl:async()=>new Response("",{
    status:302,headers:{location:"https://elsewhere.invalid/sitemap.xml"}})});
  assert.equal(redirect.status,"SITEMAP_NOT_AVAILABLE");
  assert.deepEqual(redirect.missing,[]);
});

test("sitemap cap, incomplete response, timeout and bad configuration do not generate removals",async()=>{
  const oversized=await pollSitemapSource(source,{fetchImpl:async()=>new Response("A",{
    status:200,headers:{"content-length":"9000000"}})});
  assert.equal(oversized.status,"SITEMAP_REQUEST_FAILED");
  assert.equal(oversized.failureClass,"SIZE_LIMIT");
  const invalid=await pollSitemapSource({...source,baselineUrls:[]},{fetchImpl:async()=>new Response("not valid XML")});
  assert.equal(invalid.complete,false);
  await assert.rejects(pollConfiguredSitemaps(Array(9).fill(source)),/INVALID_SITEMAP_CONFIGURATION/);
  const none=await pollConfiguredSitemaps([],{fetchImpl:async()=>{throw Error("unexpected fetch")}});
  assert.equal(none.sourceCount,0);
  assert.equal(none.indexMutated,false);
});
