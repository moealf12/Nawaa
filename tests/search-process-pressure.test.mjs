import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {beginProcessPressure,endProcessPressure,normalizeProcessPressure,processPressureBetween} from "../server/search-process-pressure.mjs";

test("process pressure normalizes CPU microseconds and event loop utilization",()=>{
  assert.deepEqual(normalizeProcessPressure({user:50000,system:20000},{utilization:0.515}),{
    processCpuMs:70,eventLoopUtilizationPct:52,
  });
  assert.deepEqual(normalizeProcessPressure({user:0,system:0},{utilization:0}),{
    processCpuMs:0,eventLoopUtilizationPct:0,
  });
});

test("process pressure excludes invalid values rather than fabricating percentages",()=>{
  assert.deepEqual(normalizeProcessPressure({user:-100,system:NaN},{utilization:NaN}),{
    processCpuMs:0,eventLoopUtilizationPct:null,
  });
  assert.equal(normalizeProcessPressure({user:1000,system:1000},{utilization:2}).eventLoopUtilizationPct,100);
  assert.equal(normalizeProcessPressure({user:1000,system:0},{utilization:-1}).eventLoopUtilizationPct,0);
});

test("process pressure samples do not require a third-party agent or network",()=>{
  const snapshot=beginProcessPressure();
  const measured=endProcessPressure(snapshot);
  assert.ok(Number.isInteger(measured.processCpuMs) && measured.processCpuMs>=0);
  assert.ok(measured.eventLoopUtilizationPct===null ||
    (measured.eventLoopUtilizationPct>=0 && measured.eventLoopUtilizationPct<=100));
});

test("bounded process phase differences are nonnegative and do not invent per-request CPU",()=>{
  const a=beginProcessPressure();
  let work=0;
  for(let i=0;i<10000;i++)work+=Math.sqrt(i);
  const b=beginProcessPressure();
  for(let i=0;i<10000;i++)work+=Math.sqrt(i);
  const c=beginProcessPressure();
  assert.ok(Number.isFinite(work));
  const first=processPressureBetween(a,b);
  const second=processPressureBetween(b,c);
  const total=processPressureBetween(a,c);
  for(const item of [first,second,total]){
    assert.ok(Number.isInteger(item.processCpuMs)&&item.processCpuMs>=0);
    assert.ok(item.eventLoopUtilizationPct===null ||
      (item.eventLoopUtilizationPct>=0&&item.eventLoopUtilizationPct<=100));
  }
  // Snapshot intervals partition the same process CPU; integer rounding
  // permits a 1ms deviation, not an extra CPU allocation.
  assert.ok(Math.abs(first.processCpuMs+second.processCpuMs-total.processCpuMs)<=1);
});

test("phase instrumentation is limited to slow JSON logs, not merchant payloads",()=>{
  const source=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  const tag=source.indexOf('console.info("NAWAA_SEARCH_JSON_PIPELINE "');
  assert.ok(tag>0);
  const guard=source.slice(Math.max(0,tag-750),tag);
  assert.match(guard,/if \(pipelineMs >= 10500\)/);
  assert.match(source,/phasePressure:\s*\{\s*primary:processPressureBetween/);
});
