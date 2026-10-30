import test from "node:test";
import assert from "node:assert/strict";
import { extractAmazonSearchOffers, fetchAmazonSearchPages, isAmazonSearchChallengeHtml, classifyAmazonPageFailure, amazonAttemptTimeoutMs } from "../server/providers/free-storefronts.mjs";

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

test("HTTP 200 explicit Amazon Robot Check is classified as denial, not a sellable product page",async()=>{
 const challenge='<html><title>Robot Check</title><form action="/errors/validateCaptcha"><input name="amzn-captcha"></form></html>';
 assert.equal(isAmazonSearchChallengeHtml(challenge),true);
 assert.equal(isAmazonSearchChallengeHtml("<html><title>iPhone results</title><div>No results</div></html>"),false);
 let calls=0,trace;
 const pages=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=iPhone",{
   pageCount:2,deadlineMs:500,wait:async()=>{},
   fetchPage:async url=>{
     calls++;
     return {html:new URL(url).searchParams.get("page")==="1"?challenge:"<div data-asin='B012345678'></div>"};
   },onDiagnostic:x=>{trace=x;},
 });
 assert.equal(calls,2,"challenge must not be retried as a network failure");
 assert.equal(pages.length,1);
 assert.equal(trace.pagesFetched,1);
 assert.equal(trace.failureClasses.CHALLENGE_200,1);
 assert.equal(trace.pagesRetried,0);
});

test("all Amazon 200 challenges fail rather than appear as healthy empty search",async()=>{
 await assert.rejects(fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
   pageCount:2,deadlineMs:500,
   fetchPage:async()=>({html:'<title>Robot Check</title><div>captcha</div>'}),
 }),/amazon_html_challenge/);
});

test("Amazon page errors are counted by bounded categories without raw response data",async()=>{
 const error=Object.assign(new Error("PRIVATE_PRODUCT_QUERY"),{status:503});
 assert.equal(classifyAmazonPageFailure(error), "UPSTREAM_5XX");
 assert.equal(classifyAmazonPageFailure(new TypeError("socket private URL")), "TRANSPORT_NETWORK");
 assert.equal(classifyAmazonPageFailure(Object.assign(new Error("challenge"),{failureClass:"HTTP_200_CHALLENGE"})),"CHALLENGE_200");
 let trace;
 await fetchAmazonSearchPages("https://www.amazon.sa/s?k=iPhone",{
   pageCount:2,deadlineMs:500,wait:async()=>{},
   fetchPage:async (url,{onTransportDiagnostic})=>{
     const page=new URL(url).searchParams.get("page");
     if(page==="1"){
       onTransportDiagnostic?.({outcome:"success",phase:"complete",headersMs:120,bodyMs:23,htmlBytes:700,elapsedMs:143});
       return {html:"valid"};
     }
     throw Object.assign(new Error("HTTP 403 PRIVATE"),{status:403});
   },onDiagnostic:x=>{trace=x;},
 });
 assert.equal(trace.avgHeadersMs,120);
 assert.equal(trace.avgBodyMs,23);
 assert.equal(trace.failureClasses.ACCESS_DENIED,1);
 assert.equal(trace.pagesRetried,0);
 assert.equal(trace.htmlBytesReceived,700);
 assert.equal(JSON.stringify(trace).includes("PRIVATE"),false);
});

test("Amazon normal empty HTML remains a valid zero-product page, never called a challenge",async()=>{
 assert.equal(isAmazonSearchChallengeHtml("<html><title>Amazon Search</title>No results for your search</html>"),false);
 const pages=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=unlikely",{
   pageCount:1,fetchPage:async()=>({html:"<html>no results</html>"}),deadlineMs:300,
 });
 assert.equal(pages.length,1);
});

test("Amazon request-time budgeting spends the full progressing 10s window without exceeding it",()=>{
 assert.equal(amazonAttemptTimeoutMs(10000),9750);
 assert.equal(amazonAttemptTimeoutMs(9600),9575);
 assert.equal(amazonAttemptTimeoutMs(4000),3975);
 assert.equal(amazonAttemptTimeoutMs(75),50);
 assert.equal(amazonAttemptTimeoutMs(25),0);
 assert.equal(amazonAttemptTimeoutMs(-5),0);
 assert.equal(amazonAttemptTimeoutMs(NaN),0);
 assert.equal(amazonAttemptTimeoutMs(Infinity),0);
});

test("Amazon first attempt receives near-batch deadline instead of legacy 8s timeout",async()=>{
 const budgets=[];let diagnostic;
 const results=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=iphone",{
   pageCount:5,deadlineMs:10000,
   fetchPage:async (url,{requestTimeoutMs})=>{
     budgets.push(requestTimeoutMs);
     return {html:"verified-"+new URL(url).searchParams.get("page")};
   },onDiagnostic:x=>{diagnostic=x;},
 });
 assert.equal(budgets.length,5);
 assert.ok(budgets.every(x=>x>=9000&&x<=9750),JSON.stringify(budgets));
 assert.deepEqual(results.map(x=>x.html),["verified-1","verified-2","verified-3","verified-4","verified-5"]);
 assert.equal(diagnostic.pagesRetried,0);
 assert.ok(diagnostic.firstAttemptMaxBudgetMs>9000);
 assert.equal(diagnostic.retryMaxBudgetMs,0);
});

test("early retry gets only remaining budget and never restarts full timeout",async()=>{
 let hits=0,diagnostic;const budgets=[];
 const found=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
   pageCount:1,deadlineMs:700,wait:async()=>{},
   fetchPage:async(_url,{requestTimeoutMs})=>{
     budgets.push(requestTimeoutMs);
     if(++hits===1){
       await new Promise(r=>setTimeout(r,75));
       throw new TypeError("transient network error");
     }
     return {html:"legitimate completed HTML"};
   },onDiagnostic:x=>{diagnostic=x;},
 });
 assert.equal(hits,2);
 assert.ok(budgets[0]<=675&&budgets[0]>=400);
 assert.ok(budgets[1]<budgets[0],"retry must not reset absolute deadline");
 assert.equal(found[0].html,"legitimate completed HTML");
 assert.equal(diagnostic.pagesRetried,1);
 assert.equal(diagnostic.pagesFetched,1);
 assert.ok(diagnostic.retryMaxBudgetMs<diagnostic.firstAttemptMaxBudgetMs);
});

test("near-deadline failure cannot launch an unbudgeted replacement request",async()=>{
 let attempts=0,metrics;
 await assert.rejects(fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
   pageCount:1,deadlineMs:80,
   fetchPage:async()=>{attempts++;await new Promise(r=>setTimeout(r,70));throw new TypeError("late failure");},
   wait:async()=>{},onDiagnostic:x=>{metrics=x;},
 }),/late failure|amazon_page_deadline_exceeded/);
 assert.equal(attempts,1);
 assert.equal(metrics.pagesRetried,0);
});

test("403 and 429 remain non-retryable after extending first attempt window",async()=>{
 const counts={};let metrics;
 const pages=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=laptop",{
   pageCount:3,deadlineMs:1000,
   fetchPage:async(url)=>{
     const page=new URL(url).searchParams.get("page");
     counts[page]=(counts[page]||0)+1;
     if(page==="1"||page==="2")
       throw Object.assign(new Error("denied"),{status:page==="1"?403:429});
     return {html:"valid complete HTML"};
   },onDiagnostic:x=>{metrics=x;},
 });
 assert.deepEqual(counts,{"1":1,"2":1,"3":1});
 assert.deepEqual(pages.map(x=>x.html),["valid complete HTML"]);
 assert.equal(metrics.pagesRetried,0);
});

test("starved deadline timer never admits a late Amazon HTML page",async()=>{
 let mono=0,diagnostic;
 const pages=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=phone",{
   pageCount:2,deadlineMs:80,now:()=>mono,
   fetchPage:async url=>{
     if(new URL(url).searchParams.get("page")==="1")
       return {html:"completed-before-deadline"};
     // Simulate an event-loop-delayed resolution while timeout callback
     // has not fired. The wall-clock deadline is already exceeded.
     await new Promise(resolve=>setImmediate(resolve));
     mono=125;
     return {html:"late-must-not-publish"};
   },
   onDiagnostic:x=>{diagnostic=x;},
 });
 assert.deepEqual(pages.map(x=>x.html),["completed-before-deadline"]);
 assert.equal(diagnostic.pagesFetched,1);
 assert.equal(diagnostic.pagesFailed,1);
 assert.equal(diagnostic.deadlineExceeded,true);
 assert.equal(diagnostic.actualOverrunMs,45);
 assert.equal(diagnostic.pagesRetried,0);
});

test("all late arrivals are denied even if Node deadline callback has not fired",async()=>{
 let mono=0,diag;
 await assert.rejects(fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
   pageCount:1,deadlineMs:80,now:()=>mono,
   fetchPage:async()=>{
     await new Promise(resolve=>setImmediate(resolve));
     mono=130;
     return {html:"late-completed-html"};
   },
   onDiagnostic:x=>{diag=x;},
 }),/amazon_page_deadline_exceeded/);
 assert.equal(diag.pagesFetched,0);
 assert.equal(diag.deadlineExceeded,true);
 assert.equal(diag.actualOverrunMs,50);
 assert.equal(diag.pagesRetried,0);
});

test("monotonic deadline ignores Date.now jumps and retains valid pages",async()=>{
 const old=Date.now;
 try{
   Date.now=()=>Number.MAX_SAFE_INTEGER;
   let t=0,diag;
   const pages=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=tablet",{
     pageCount:1,deadlineMs:500,now:()=>t,
     fetchPage:async()=>({html:"verified"}),
     onDiagnostic:x=>{diag=x;},
   });
   assert.deepEqual(pages.map(x=>x.html),["verified"]);
   assert.equal(diag.deadlineExceeded,false);
   assert.equal(diag.pagesFetched,1);
 }finally{Date.now=old;}
});

test("blocked main thread cannot publish over-budget HTML even before timer callback",async()=>{
 let diag;
 await assert.rejects(fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
   pageCount:1,deadlineMs:60,
   fetchPage:async()=>{
     const until=performance.now()+100;
     while(performance.now()<until){} // Deterministic short CPU-stall fixture
     return {html:"late-after-event-loop-stall"};
   },
   onDiagnostic:x=>{diag=x;},
 }),/amazon_page_deadline_exceeded/);
 assert.equal(diag.pagesFetched,0);
 assert.equal(diag.deadlineExceeded,true);
 assert.ok(diag.actualOverrunMs>=25);
});
