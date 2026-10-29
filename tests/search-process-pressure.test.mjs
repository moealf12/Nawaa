import test from "node:test";
import assert from "node:assert/strict";
import {beginProcessPressure,endProcessPressure,normalizeProcessPressure} from "../server/search-process-pressure.mjs";

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
