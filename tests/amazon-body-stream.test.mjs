import test from "node:test";
import assert from "node:assert/strict";
import {readAmazonHtmlStream} from "../server/amazon-body-stream.mjs";

function streamOf(chunks){
 return new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(Buffer.from(chunk));c.close();}});
}
test("streamed HTML preserves UTF-8 characters across split chunks",async()=>{
 const input=Buffer.from("سماعات Apple 🎧","utf8");
 const body=streamOf([input.subarray(0,3),input.subarray(3,9),input.subarray(9)]);
 const result=await readAmazonHtmlStream({body},{idleTimeoutMs:300});
 assert.equal(result.text,"سماعات Apple 🎧");
 assert.equal(result.progress.chunksReceived,3);
 assert.equal(result.progress.bytesReceived,input.length);
 assert.equal(result.progress.idleTimeoutTriggered,false);
});
test("a genuinely stalled body aborts promptly and returns bounded progress",async()=>{
 const controller=new AbortController();
 let sawData;
 const seen=new Promise(resolve=>{sawData=resolve;});
 const body=new ReadableStream({start(c){c.enqueue(Buffer.from("legit-partial"));sawData();}});
 const request=readAmazonHtmlStream({body},{
   signal:controller.signal,idleTimeoutMs:45,abortOnIdle:e=>controller.abort(e),
 });
 await seen;
 await assert.rejects(request,error=>{
   assert.equal(error.failureClass,"BODY_IDLE_TIMEOUT");
   assert.equal(error.bodyProgress.bytesReceived,13);
   assert.equal(error.bodyProgress.idleTimeoutTriggered,true);
   return true;
 });
});
test("progressing stream never triggers idle cancellation",async()=>{
 const text="abcde";let controller;
 const body=new ReadableStream({
   start(c){
     controller=c;c.enqueue(Buffer.from("a"));
     setTimeout(()=>c.enqueue(Buffer.from("bcd")),15);
     setTimeout(()=>{c.enqueue(Buffer.from("e"));c.close();},30);
   }
 });
 const result=await readAmazonHtmlStream({body},{idleTimeoutMs:120});
 assert.equal(result.text,text);
 assert.equal(result.progress.chunksReceived,3);
 assert.equal(result.progress.idleTimeoutTriggered,false);
});
test("unknown or oversized Content-Length cannot bypass actual byte cap",async()=>{
 const body=streamOf(["abc","de"]);
 await assert.rejects(readAmazonHtmlStream({body},{maxBytes:4,idleTimeoutMs:100}),e=>{
   assert.equal(e.failureClass,"RESPONSE_TOO_LARGE");
   assert.equal(e.bodyProgress.bytesReceived,5);
   return true;
 });
});
test("caller cancellation does not publish an obsolete partial HTML document",async()=>{
 const ctrl=new AbortController();
 const body=new ReadableStream({start(c){c.enqueue(Buffer.from("old document"));}});
 const promise=readAmazonHtmlStream({body},{signal:ctrl.signal,idleTimeoutMs:200});
 setTimeout(()=>ctrl.abort(new Error("cache_generation_invalidated")),15);
 await assert.rejects(promise,/cache_generation_invalidated/);
});
test("Amazon stream fallback supports response mocks without a readable body",async()=>{
 const result=await readAmazonHtmlStream({text:async()=>"<title>valid</title>"},{maxBytes:100});
 assert.equal(result.text,"<title>valid</title>");
 assert.equal(result.progress.chunksReceived,1);
});

test("stalled body terminates even without caller-provided abort callback",async()=>{
 const body=new ReadableStream({start(c){c.enqueue(Buffer.from("partial"));}});
 const t=Date.now();
 await assert.rejects(readAmazonHtmlStream({body},{idleTimeoutMs:50}),e=>{
   assert.equal(e.failureClass,"BODY_IDLE_TIMEOUT");
   assert.equal(e.bodyProgress.bytesReceived,7);
   assert.equal(e.bodyProgress.idleTimeoutTriggered,true);
   return true;
 });
 assert.ok(Date.now()-t<600);
});
test("zero-length chunks never count as progress against idle deadline",async()=>{
 let ctrl;
 const body=new ReadableStream({start(c){ctrl=c;}});
 const interval=setInterval(()=>{try{ctrl.enqueue(new Uint8Array(0));}catch{}},10);
 try{
   await assert.rejects(readAmazonHtmlStream({body},{idleTimeoutMs:70}),e=>{
     assert.equal(e.failureClass,"BODY_IDLE_TIMEOUT");
     assert.equal(e.bodyProgress.chunksReceived,0);
     return true;
   });
 }finally{clearInterval(interval);}
});
test("real Amazon page acquisition retries one stalled stream and never exposes partial HTML",async()=>{
 const {fetchAmazonSearchPages}=await import("../server/providers/free-storefronts.mjs");
 const before=globalThis.fetch;
 let calls=0,diag;
 globalThis.fetch=async()=>{
   calls++;
   if(calls===1)return new Response(new ReadableStream({
     start(c){c.enqueue(Buffer.from("<div>obsolete partial"));},
   }),{status:200,headers:{"content-type":"text/html"}});
   return new Response('<div data-component-type="s-search-result" data-asin="B012345678">complete</div>',{
     status:200,headers:{"content-type":"text/html"},
   });
 };
 try{
   const pages=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=PS5",{
     pageCount:1,deadlineMs:7500,wait:async()=>{},
     onDiagnostic:x=>{diag=x;},
   });
   assert.equal(calls,2,"only one allowed same-page retry");
   assert.equal(pages.length,1);
   assert.match(pages[0].html,/complete/);
   assert.doesNotMatch(pages[0].html,/obsolete partial/);
   assert.equal(diag.pagesRetried,1);
   assert.equal(diag.streamIdleTimeouts,1);
   assert.equal(diag.transportFailureClasses.BODY_IDLE_TIMEOUT,1);
   assert.equal(diag.pagesFetched,1);
 }finally{globalThis.fetch=before;}
});
