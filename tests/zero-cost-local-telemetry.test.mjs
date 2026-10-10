import test from "node:test";
import assert from "node:assert/strict";
import {InMemorySpanExporter} from "@opentelemetry/sdk-trace-base";
import {createLocalTelemetry} from "../server/tooling/local-telemetry.mjs";

test("telemetry disabled means no exporter, no provider, original async result",async()=>{
 const local=createLocalTelemetry();
 assert.equal(local.enabled,false);
 assert.equal(await local.withSpan("nawaa.test",{},async()=>42),42);
 await local.shutdown();
});
test("isolated exporter receives minimal metadata and no source secrets",async()=>{
 const exporter=new InMemorySpanExporter();
 const local=createLocalTelemetry({enabled:true,exporter});
 const outcome=await local.withSpan("nawaa.offer.ingest",{
   source_id:"ikea-sa",strategy:"crawlee",price:1500,
   source_url:"https://www.ikea.com/sa/en/p/abc",
   api_key:"must-never-leak",
 },async()=>({ok:true}));
 assert.equal(outcome.ok,true);
 const spans=exporter.getFinishedSpans();
 assert.equal(spans.length,1);
 assert.equal(spans[0].attributes.source_id,"ikea-sa");
 assert.equal(spans[0].attributes.outcome,"success");
 assert.equal(spans[0].attributes.price,undefined);
 assert.equal(spans[0].attributes.source_url,undefined);
 assert.equal(spans[0].attributes.api_key,undefined);
 await local.shutdown();
});
test("failed background operations record safe status and rethrow original error",async()=>{
 const exporter=new InMemorySpanExporter();
 const local=createLocalTelemetry({enabled:true,exporter});
 await assert.rejects(local.withSpan("nawaa.offer.ingest",{source_id:"ikea-sa"},async()=>{
   throw new Error("https://secret.example.com?token=sensitive");
 }),/secret\.example/);
 const [span]=exporter.getFinishedSpans();
 assert.equal(span.attributes.outcome,"failed");
 assert.equal(span.events.length,0);
 await local.shutdown();
});
