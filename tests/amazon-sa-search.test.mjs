import test from "node:test";
import assert from "node:assert/strict";
import { extractAmazonSearchOffers, fetchAmazonSearchPages } from "../server/providers/free-storefronts.mjs";

test("Amazon Saudi search cards produce verified price offers without product-page fetch",()=>{
 const html=`<div data-component-type="s-search-result" data-asin="B0ABC12345">
 <h2><a href="/HP-Laptop/dp/B0ABC12345/ref=sr_1_1"><span>HP OmniBook 5 Laptop 16GB 512GB</span></a></h2>
 <img src="https://m.media-amazon.com/images/I/example.jpg">
 <span class="a-price"><span class="a-offscreen">SAR 2,999.50</span><span class="a-price-whole">2,999</span><span class="a-price-fraction">50</span></span>
 </div>`;
 const offers=extractAmazonSearchOffers(html,"HP");
 assert.equal(offers.length,1);
 assert.equal(offers[0].productId,"B0ABC12345");
 assert.equal(offers[0].price,2999.5);
 assert.equal(offers[0].currency,"SAR");
 assert.match(offers[0].sourceUrl,/amazon\.sa/);
});

test("per-page retry starts before an unrelated slow Amazon page settles",async()=>{
 let releaseOther,signalRetried,attempts=0,observation;
 const slow=new Promise(resolve=>{releaseOther=resolve;});
 const retried=new Promise(resolve=>{signalRetried=resolve;});
 const pending=fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
   pageCount:2,deadlineMs:1300,wait:async()=>{},
   fetchPage:async(url)=>{
     if(new URL(url).searchParams.get("page")==="2"){await slow;return {html:"two"};}
     if(++attempts===1)throw new TypeError("network reset");
     signalRetried();return {html:"one"};
   },onDiagnostic:x=>{observation=x;},
 });
 await Promise.race([retried,new Promise((_,reject)=>setTimeout(()=>reject(Error("retry waited for sibling")),500))]);
 assert.equal(attempts,2);
 releaseOther();
 assert.deepEqual((await pending).map(x=>x.html),["one","two"]);
 assert.equal(observation.pagesRetried,1);
 assert.equal(observation.pagesFetched,2);
});

test("Amazon access denials do not retry and do not erase another successful page",async()=>{
 const counts={};let d;
 const result=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=phone",{
   pageCount:3,deadlineMs:500,wait:async()=>{},
   fetchPage:async(url)=>{
     const p=new URL(url).searchParams.get("page");counts[p]=(counts[p]||0)+1;
     if(p==="1"||p==="2")throw Object.assign(new Error("HTTP "+(p==="1"?403:429)),{status:p==="1"?403:429});
     return {html:"valid"};
   },onDiagnostic:x=>{d=x;},
 });
 assert.deepEqual(result.map(x=>x.html),["valid"]);
 assert.deepEqual(counts,{"1":1,"2":1,"3":1});
 assert.equal(d.pagesRetried,0);
});

test("global Amazon deadline permits partial results when other transports ignore abort",async()=>{
 let d;const started=Date.now();
 const result=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=headphones",{
   pageCount:2,deadlineMs:85,
   fetchPage:async url=>new URL(url).searchParams.get("page")==="1"?{html:"known"}:new Promise(()=>{}),
   onDiagnostic:x=>{d=x;},
 });
 assert.deepEqual(result.map(x=>x.html),["known"]);
 assert.ok(Date.now()-started<650);
 assert.equal(d.pagesFetched,1);
 assert.equal(d.pagesFailed,1);
 assert.equal(d.deadlineExceeded,true);
});

test("caller abort never publishes a completed old-generation Amazon page",async()=>{
 const ctrl=new AbortController();let notify;
 const started=new Promise(resolve=>{notify=resolve;});
 const request=fetchAmazonSearchPages("https://www.amazon.sa/s?k=tablet",{
   pageCount:2,deadlineMs:1000,signal:ctrl.signal,
   fetchPage:async url=>{
     if(new URL(url).searchParams.get("page")==="1")return {html:"old"};
     notify();return new Promise(()=>{});
   },
 });
 await started;ctrl.abort(new Error("cache_generation_invalidated"));
 await assert.rejects(request,/cache_generation_invalidated/);
});

test("direct Amazon acquisition request clamps its requested range",async()=>{
 const pages=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
   pageStart:7,pageCount:1000,deadlineMs:500,
   fetchPage:async url=>({html:new URL(url).searchParams.get("page")}),
 });
 assert.deepEqual(pages.map(x=>x.html),["7","8"]);
});

test("source only invokes one bounded Amazon batch per search",async()=>{
 const {readFileSync}=await import("node:fs");
 const text=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
 const source=text.slice(text.indexOf("async function searchStore("),text.indexOf("export function configuredFreeStorefronts",text.indexOf("async function searchStore(")));
 assert.equal((source.match(/await fetchAmazonSearchPages\(/g)||[]).length,1);
});
