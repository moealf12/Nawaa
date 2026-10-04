import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIngestBatch, normalizeIngestOffer, INGEST_BATCH_LIMIT } from "../server/ingestion.mjs";

test("ingestion rejects unverifiable offers",()=>{
  assert.equal(normalizeIngestOffer({title:"HP",sourceUrl:"http://example.com/p",productPrice:10}),null);
  assert.equal(normalizeIngestOffer({title:"HP Laptop",sourceUrl:"https://example.com/p",productPrice:0}),null);
  assert.equal(normalizeIngestOffer({title:"x",sourceUrl:"https://example.com/p",productPrice:10}),null);
});

test("ingestion normalizes accepted crawler offers",()=>{
  const o=normalizeIngestOffer({title:"  HP Laptop  ",sourceUrl:"https://example.com/p",productPrice:"2499",currency:"sar",condition:"NEW"});
  assert.equal(o.title,"HP Laptop");
  assert.equal(o.productPrice,2499);
  assert.equal(o.currency,"SAR");
  assert.equal(o.condition,"new");
  assert.equal(o.dataKind,"ingested");
});

test("ingestion bounds batch size",()=>{
  const rows=Array.from({length:INGEST_BATCH_LIMIT+20},(_,i)=>({title:"Product "+i,sourceUrl:"https://example.com/"+i,productPrice:i+1}));
  assert.equal(normalizeIngestBatch(rows).length,INGEST_BATCH_LIMIT);
});
