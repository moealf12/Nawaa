import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {readFileSync} from "node:fs";
import {createSearchHttpLifecycleTrace} from "../server/search-http-lifecycle.mjs";
import {createSearchCache} from "../server/search-cache.mjs";

const fakeResponse=()=>Object.assign(new EventEmitter(),{headersSent:false,writableFinished:false});

test("slow finished HTTP response attributes pre-cache, shared lookup, post-cache and transport handoff",()=>{
  const res=fakeResponse(),events=[];let time=2000;
  const trace=createSearchHttpLifecycleTrace(res,{startedAt:2000,now:()=>time,
    thresholdMs:10500,onSlow:entry=>events.push(entry)});
  time=13000;
  trace.markPrepared({preCacheMs:20.5,cacheLookupMs:10000.1,postCacheMs:880.7,
    cacheMode:"miss",coalescedOnEntry:true,offers:19,query:"private shopper text",
    sourceUrl:"https://retailer.invalid/private"});
  time=13500;res.headersSent=true;res.writableFinished=true;res.emit("finish");
  res.emit("close");
  assert.equal(events.length,1,"finished then close must not log twice");
  assert.deepEqual(events[0],{
    status:"finished",totalHttpMs:11500,afterPreparedMs:500,
    preCacheMs:21,cacheLookupMs:10000,postCacheMs:881,
    cacheMode:"miss",coalescedOnEntry:true,cacheRefreshReplays:null,cacheInvalidationReason:null,offers:19,
    headersSent:true,writableFinished:true
  });
  const body=JSON.stringify(events[0]);
  assert.equal(body.includes("private shopper text"),false);
  assert.equal(body.includes("retailer.invalid"),false);
});

test("abandoned HTTP response is classified as a close, not successful delivery",()=>{
  let time=0,events=[];const res=fakeResponse();
  createSearchHttpLifecycleTrace(res,{startedAt:0,now:()=>time,
    thresholdMs:10500,onSlow:value=>events.push(value)});
  time=13000;res.emit("close");res.emit("finish");
  assert.equal(events.length,1);
  assert.equal(events[0].status,"client_closed");
  assert.equal(events[0].cacheLookupMs,null);
  assert.equal(events[0].headersSent,false);
});

test("short responses generate no logs; telemetry exceptions cannot abort a response",()=>{
  let time=100,called=0;const res=fakeResponse();
  const trace=createSearchHttpLifecycleTrace(res,{startedAt:100,now:()=>time,
    thresholdMs:10500,onSlow:()=>{called++;throw Error("logger offline")}});
  trace.markPrepared({cacheMode:"unsupported",offers:-1,coalescedOnEntry:"true"});
  time=300;res.writableFinished=true;assert.doesNotThrow(()=>res.emit("finish"));
  assert.equal(called,0);
  const late=fakeResponse();
  createSearchHttpLifecycleTrace(late,{startedAt:0,now:()=>time,
    thresholdMs:100,onSlow:()=>{called++;throw Error("logger offline")}});
  assert.doesNotThrow(()=>late.emit("close"));
  assert.equal(called,1);
});

test("read-only pending cache probe distinguishes shared refresh from fresh retrieval",async()=>{
  let release;const block=new Promise(resolve=>release=resolve);
  const cache=createSearchCache(async()=>{await block;return {offers:[{title:"PS5 Slim",productPrice:1599}],errors:[]};});
  assert.equal(cache.isPending("PS5"),false);
  const first=cache("PS5",{allowStale:false});
  // A synchronous second request sees pending before scheduling the task.
  assert.equal(cache.isPending("PS5"),true);
  const second=cache("PS5",{allowStale:false});
  release();
  const [a,b]=await Promise.all([first,second]);
  assert.deepEqual(a.offers,b.offers);
  assert.equal(cache.isPending("PS5"),false);
  assert.equal((await cache("PS5",{allowStale:false})).cache.mode,"fresh");
});

test("server lifecycle instrumentation stays on JSON route without changing offer selection",()=>{
  const s=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  const start=s.indexOf('if (req.method === "GET" && url.pathname === "/api/search")');
  const end=s.indexOf('if (req.method === "GET"',start+15);
  const route=s.slice(start,end>start?end:undefined);
  assert.match(route,/createSearchHttpLifecycleTrace\(res,/);
  assert.match(route,/cachedSearch\.isPending\(lookupKey\)/);
  assert.match(route,/httpTrace\.markPrepared\(/);
  assert.match(route,/jsonResponse\(res, 200,/);
  assert.equal(route.indexOf("httpTrace.markPrepared(")<route.indexOf("const response = jsonResponse("),true);
  assert.match(s,/providerWallMs:Math\.max\(0,dispatchAt-settled\.launchedAt\)/);
  assert.match(s,/providerTimings,/);
});
