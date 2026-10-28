import test from "node:test";
import assert from "node:assert/strict";
import {legacyNoonProviderActive} from "../server/noon-source-policy.mjs";
import {configuredProviders,currentSources} from "../server/source-config.mjs";

test("Noon Saudi official storefront has sole routing ownership when old env is true",()=>{
  const old=process.env.NOON_ENABLED;
  try{
    process.env.NOON_ENABLED="true";
    assert.equal(legacyNoonProviderActive(),false);
    const providers=configuredProviders();
    assert.ok(providers.includes("free-storefronts:noon-sa"));
    assert.equal(providers.includes("noon-catalog"),false);
    const source=currentSources().find(x=>x.id==="noon-sa");
    assert.equal(source.status,"configured");
    assert.equal(source.adapter,"free-storefronts:noon-sa");
    assert.equal(source.adapters.includes("noon-catalog"),true);
  }finally{if(old===undefined)delete process.env.NOON_ENABLED;else process.env.NOON_ENABLED=old}
});
