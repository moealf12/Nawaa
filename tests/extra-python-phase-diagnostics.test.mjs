import test from "node:test";
import assert from "node:assert/strict";
import {parseExtraWorkerPhase} from "../src/python-extra-bridge.mjs";

test("phase telemetry accepts only bounded fixed enum and monotonic integer",()=>{
  assert.deepEqual(parseExtraWorkerPhase(
    'NAWAA_EXTRA_PHASE {"stage":"robots_start","sinceBootMs":2250}'
  ),{stage:"robots_start",sinceBootMs:2250});
  for(const line of [
    "", "traceback: https://private.example/path?token=secret",
    'NAWAA_EXTRA_PHASE {"stage":"secret","sinceBootMs":4}',
    'NAWAA_EXTRA_PHASE {"stage":"pdp_start","sinceBootMs":-1}',
    'NAWAA_EXTRA_PHASE {"stage":"pdp_start","sinceBootMs":9999999}',
    'NAWAA_EXTRA_PHASE {"stage":"pdp_start","sinceBootMs":"5"}',
    'NAWAA_EXTRA_PHASE {"stage":"pdp_start","sinceBootMs":5,"url":"secret"}',
    'NAWAA_EXTRA_PHASE {"stage":"pdp_start","sinceBootMs":5,"price":3299}',
    'NAWAA_EXTRA_PHASE {"stage":"pdp_start","sinceBootMs":5,"requestId":"secret"}',
  ])assert.equal(parseExtraWorkerPhase(line),null,line);
});
