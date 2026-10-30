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
