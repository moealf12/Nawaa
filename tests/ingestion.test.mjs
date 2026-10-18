import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIngestBatch, normalizeIngestOffer, INGEST_BATCH_LIMIT } from "../server/ingestion.mjs";

test("ingestion rejects unverifiable offers",()=>{
  assert.equal(normalizeIngestOffer({title:"HP",sourceUrl:"http://example.com/p",productPrice:10}),null);
  assert.equal(normalizeIngestOffer({title:"HP Laptop",sourceUrl:"https://example.com/p",productPrice:0}),null);
  assert.equal(normalizeIngestOffer({title:"x",sourceUrl:"https://example.com/p",productPrice:10}),null);
});

test("ingestion normalizes accepted crawler offers",()=>{
  const o=normalizeIngestOffer({title:"  HP Laptop  ",sourceUrl:"https://example.com/p",productPrice:"2499",currency:"sar",condition:"NEW",observedAt:"2026-10-05T01:02:03.000Z"});
  assert.equal(o.title,"HP Laptop");
  assert.equal(o.productPrice,2499);
  assert.equal(o.currency,"SAR");
  assert.equal(o.condition,"new");
  assert.equal(o.dataKind,"ingested");
});

test("ingestion bounds batch size",()=>{
  const rows=Array.from({length:INGEST_BATCH_LIMIT+20},(_,i)=>({title:"Product "+i,sourceUrl:"https://example.com/"+i,productPrice:i+1,observedAt:"2026-10-05T01:02:03.000Z"}));
  assert.equal(normalizeIngestBatch(rows).length,INGEST_BATCH_LIMIT);
});


test("ingestion preserves crawler observation metadata",()=>{
  const observedAt="2026-10-05T01:02:03.000Z";
  const o=normalizeIngestOffer({title:"HP Laptop",sourceUrl:"https://example.com/p",productPrice:2499,currency:"sar",observedAt,healthStatus:"healthy"});
  assert.equal(o.observedAt,observedAt);
  assert.equal(o.healthStatus,"healthy");
});


test("missing, invalid, or future merchant observation must never be minted at ingestion",()=>{
  const input={title:"HP Laptop",sourceUrl:"https://example.com/p",productPrice:2499,currency:"SAR"};
  assert.equal(normalizeIngestOffer(input),null,"ingestion time is not merchant observation");
  assert.equal(normalizeIngestOffer({...input,observedAt:"not-a-timestamp"}),null);
  assert.equal(normalizeIngestOffer({...input,observedAt:new Date(Date.now()+120_000).toISOString()}),null);
});
