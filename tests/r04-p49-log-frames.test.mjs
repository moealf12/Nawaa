import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createBoundedLogFrameParser} from "../scripts/r04-p49-log-frames.mjs";

test("reconstructs real-shape generation trace >32KiB split across Node stdout chunks",()=>{
  const events=[],drops=[];
  const parser=createBoundedLogFrameParser(line=>events.push(line),
    {onDrop:()=>drops.push("oversize")});
  const payload={
    generationId:"a".repeat(16),ownerRequestId:"b".repeat(16),
    storefrontSpans:Array.from({length:64},(_,i)=>({
      storeId:"merchant-"+i,
      stages:Array.from({length:6},(_,j)=>({
        stage:"html_complete",atMs:100+j,counts:{cards:j,finalOffers:0},
      })),
      pdpPhases:{phaseMs:{tlsReadyToCancellationLowerBound:{
        p50:5400,p95:5500,observations:4,
      }}},
    })),
  };
  const line="NAWAA_SEARCH_CRITICAL_PATH "+JSON.stringify(payload);
  assert.ok(line.length>32768,"must reproduce historic truncated-buffer failure");
  assert.ok(line.length<262144,"must remain within configured safe line bound");
  const input=line+"\nNAWAA_SEARCH_HTTP_LIFECYCLE {\"requestId\":\"c\"}\n";
  for(let i=0;i<input.length;i+=3917)
    parser.push(input.slice(i,i+3917));
  assert.equal(events.length,2);
  assert.equal(drops.length,0);
  assert.equal(events[0],line);
  const trace=JSON.parse(events[0].slice(events[0].indexOf(" ")+1));
  assert.equal(trace.storefrontSpans.length,64);
  assert.equal(trace.generationId,"a".repeat(16));
  assert.equal(parser.incomplete(),false);
});
test("oversized attack line is dropped once and following exact trace survives",()=>{
  let dropped=0;
  const seen=[],parser=createBoundedLogFrameParser(x=>seen.push(x),
    {maxLineChars:1024,onDrop:()=>dropped++});
  parser.push("x".repeat(930));
  parser.push("x".repeat(300));
  assert.equal(parser.incomplete(),true);
  parser.push("x".repeat(12000));
  parser.push("\nNAWAA_SEARCH_HTTP_LIFECYCLE {}\n");
  assert.equal(dropped,1);
  assert.deepEqual(seen,["NAWAA_SEARCH_HTTP_LIFECYCLE {}"]);
  assert.equal(parser.incomplete(),false);
  assert.equal(parser.pendingChars(),0);
});
test("newline boundary between fragments and unterminated tail never fabricate events",()=>{
  const lines=[],parser=createBoundedLogFrameParser(line=>lines.push(line));
  parser.push("ONE");
  assert.equal(parser.incomplete(),true);
  parser.push("\nTWO\nTHREE");
  assert.deepEqual(lines,["ONE","TWO"]);
  assert.equal(parser.pendingChars(),5);
  parser.push("\n");
  assert.deepEqual(lines,["ONE","TWO","THREE"]);
  assert.equal(parser.incomplete(),false);
});
test("untrusted parser bounds fail closed and candidate uses bounded framing",()=>{
  assert.throws(()=>createBoundedLogFrameParser(()=>{},{
    maxLineChars:1073741824,
  }),/INVALID_LIVE_LOG_FRAME_CONFIG/);
  const source=readFileSync(
    new URL("../scripts/r04-p36-candidate-36.mjs",import.meta.url),"utf8");
  assert.match(source,/createBoundedLogFrameParser\(line=>/);
  assert.match(source,/child\.stdout\.on\("data",chunk=>frameParser\.push\(chunk\)\)/);
  assert.doesNotMatch(source,/outputBuffer\.slice\(-16384\)/);
});
