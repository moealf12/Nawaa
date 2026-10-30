import test from "node:test";
import assert from "node:assert/strict";
import {sourceFiles,checkRoutingContract,verifyPublishedWiring,PAGES,API} from "../scripts/verify-production-wiring.mjs";

const SHA="55cdc9499fa1b34a75ab18e3802fd284557e3b04";
const original=sourceFiles();

function fakeFetch({modifyAsset,revision=SHA}={}){
  const calls=[];
  const fn=async (url,options={})=>{
    calls.push({url,origin:options.headers?.origin||null});
    const pathname=new URL(url).pathname;
    if(pathname==="/health")return new Response(JSON.stringify({
      ok:true,revision,liveProviders:{extra:true,jarir:true},
    }),{status:200,headers:{"access-control-allow-origin":"*"}});
    if(pathname==="/api/sources")return new Response(JSON.stringify({sources:[]}),{
      status:200,headers:{"access-control-allow-origin":"*"}});
    const local=pathname.startsWith("/Nawaa/")?pathname.slice("/Nawaa/".length):pathname.slice(1);
    const originalBody=original[local];
    assert.equal(typeof originalBody,"string","unexpected endpoint "+url);
    const body=modifyAsset?modifyAsset(url,originalBody):originalBody;
    return new Response(body,{status:200,headers:{"content-type":local.endsWith(".html")?"text/html; charset=utf-8":"text/javascript; charset=utf-8"}});
  };
  return {fn,calls};
}

test("both published entrypoints resolve to the same Render API and local candidate remains isolated",()=>{
  const resolved=checkRoutingContract(original);
  assert.equal(resolved.pagesApi,API);
  assert.equal(resolved.pagesCanonicalSearch,API+"/search.html");
  assert.equal(resolved.renderApi,API);
  assert.equal(resolved.localApi,"http://127.0.0.1:3000");
  assert.equal(resolved.quoteHost,"nawaa-store-jeddah.moezz12.chatgpt.site");
});

test("live wiring audit verifies twenty-two published asset copies plus revision and CORS, without merchant requests",async()=>{
  const {fn,calls}=fakeFetch();
  const res=await verifyPublishedWiring({fetchImpl:fn,files:original,expectedSha:SHA});
  assert.equal(res.result,"PASS");
  assert.equal(res.assetPairsVerified,22);
  assert.equal(calls.length,24);
  assert.ok(calls.every(x=>x.url.startsWith(PAGES+"/")||x.url.startsWith(API+"/")));
  assert.equal(calls.some(x=>x.url.includes("/api/search")),false);
  assert.equal(calls.some(x=>x.url.includes("unbxd")||x.url.includes("jarir.com")),false);
  assert.ok(calls.filter(x=>x.url.endsWith("/health")||x.url.endsWith("/api/sources"))
    .every(x=>x.origin==="https://moealf12.github.io"));
});

test("live wiring audit fails closed when Pages serves a different frontend configuration",async()=>{
  const {fn}=fakeFetch({modifyAsset:(url,body)=>
    url===PAGES+"/config.js" ? body.replace(API,"https://wrong.invalid") : body});
  await assert.rejects(verifyPublishedWiring({fetchImpl:fn,files:original,expectedSha:SHA}),
    /ASSET_MISMATCH_pages_config_js/);
});

test("live wiring audit rejects a different deployed API revision",async()=>{
  const {fn}=fakeFetch({revision:"0".repeat(40)});
  await assert.rejects(verifyPublishedWiring({fetchImpl:fn,files:original,expectedSha:SHA}),
    /LIVE_REVISION_NOT_MAIN/);
});

test("live wiring audit rejects missing and malformed release identity",async()=>{
  const {fn}=fakeFetch();
  await assert.rejects(verifyPublishedWiring({fetchImpl:fn,files:original}),
    /EXPECTED_SHA_REQUIRED/);
  assert.throws(()=>checkRoutingContract({...original,"config.js":"window.NAWAA_API_BASE='https://incorrect.invalid';"}),
    /PAGES_API_WRONG_ORIGIN/);
});

test("published frontend module MIME errors fail the wiring contract",async()=>{
  const {fn}=fakeFetch();
  const bad=async (url,options)=>{
    const response=await fn(url,options);
    if(url===PAGES+"/src/search-stream.mjs")
      return new Response(await response.text(),{status:200,headers:{"content-type":"application/octet-stream"}});
    return response;
  };
  await assert.rejects(verifyPublishedWiring({fetchImpl:bad,files:original,expectedSha:SHA}),
    /SCRIPT_OR_HTML_MIME_MISMATCH_pages_src_search_stream_mjs/);
});
