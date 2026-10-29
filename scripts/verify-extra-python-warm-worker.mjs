// Real Python JSONL process lifecycle: one source request, no writes or proxies.
import assert from "node:assert/strict";
import {
  warmExtraPythonPdp,extraPythonWarmStatus,runExtraPythonPdp,
  shutdownExtraPythonWarmWorker
} from "../src/python-extra-bridge.mjs";
const sku="100462492";
const url="https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492";
assert.equal(extraPythonWarmStatus().enabled,true);
warmExtraPythonPdp();
try{
  let ready=false;
  for(let i=0;i<500;i++){
    if(extraPythonWarmStatus().ready){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.equal(ready,true,"warm worker did not import in 20 seconds");
  const first=runExtraPythonPdp({url,expectedSku:sku},{timeoutMs:5500});
  await assert.rejects(
    runExtraPythonPdp({url,expectedSku:sku},{timeoutMs:5500}),
    /PYTHON_EXTRA_BUSY/
  );
  const evidence=await first;
  assert.equal(evidence.sku,sku);
  assert.equal(evidence.currency,"SAR");
  assert.ok(Number(evidence.price)>0);
  assert.equal(extraPythonWarmStatus().ready,true);
  assert.equal(extraPythonWarmStatus().completed,1);
  process.stdout.write("NAWAA_EXTRA_WARM_LIVE "+JSON.stringify({
    ready:true,completed:1,sourceId:"extra-sa",status:"EVIDENCE_FOUND",
    published:false,persisted:false
  })+"\n");
}finally{
  shutdownExtraPythonWarmWorker();
}
