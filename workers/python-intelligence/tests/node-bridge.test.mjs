import test from "node:test";
import assert from "node:assert/strict";
import {runPythonExtraction} from "../../../src/python-worker-bridge.mjs";

const req=(expected,observed)=>({
  schemaVersion:"nawaa.python.extract.v1",
  requestId:"node-bridge-1",sourceId:"jarir-sa",operation:"classify",
  input:{expected,observed}
});

test("Node -> Python JSONL enforces conflicting PS5 variant",async()=>{
  const result=await runPythonExtraction(req({model:"PS5 Digital"},{model:"PS5 Disc"}));
  assert.equal(result.identity.decision,"REJECT");
  assert.deepEqual(result.identity.conflicts,["model"]);
  assert.equal(result.offerEvidence,null);
});
test("Python missing evidence never makes a verified offer",async()=>{
  const result=await runPythonExtraction(req({model:"iPhone 17",storageGb:256},{model:"iPhone 17"}));
  assert.equal(result.identity.decision,"INSUFFICIENT_EVIDENCE");
  assert.ok(result.identity.missing.includes("storageGb"));
  assert.equal(result.offerEvidence,null);
});
test("Node bridge rejects unbounded input and malformed identifiers before spawn",async()=>{
  await assert.rejects(runPythonExtraction(req({model:"x"},{model:"x"}),{timeoutMs:10}),/PYTHON_TIMEOUT_INVALID/);
  await assert.rejects(runPythonExtraction({...req({},{}),sourceId:"https://example.com"}),/PYTHON_INPUT_CONTRACT_INVALID/);
  await assert.rejects(runPythonExtraction({...req({},{}),input:{html:"x".repeat(2_300_000)}}),/PYTHON_INPUT_TOO_LARGE/);
});
test("Cancellation cannot promote a result",async()=>{
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(runPythonExtraction(req({model:"PS5"},{model:"PS5"}),{signal:controller.signal}),/PYTHON_ABORTED/);
});
