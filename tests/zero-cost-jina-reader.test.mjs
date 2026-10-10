import test from "node:test";
import assert from "node:assert/strict";
import {validateJinaTarget,readJinaPage} from "../server/tooling/jina-reader.mjs";

test("Jina adapter only accepts explicitly allowlisted HTTPS merchant URLs",()=>{
 assert.equal(validateJinaTarget("https://www.ikea.com/sa/en/search/?q=chair#product",{allowedHosts:["ikea.com"]}),"https://www.ikea.com/sa/en/search/?q=chair");
 for(const url of ["http://ikea.com/","https://localhost/","https://127.0.0.1/","https://other.com/","https://ikea.com:8443/","https://user:pass@ikea.com/","file:///etc/passwd"]){
  assert.throws(()=>validateJinaTarget(url,{allowedHosts:["ikea.com"]}));
 }
 assert.throws(()=>validateJinaTarget("https://ikea.com/"),/allowlist_required/);
});
test("Jina sends key only to Reader endpoint and never returns it in result",async()=>{
 const key="private_test_key";
 const calls=[];
 const result=await readJinaPage("https://www.ikea.com/sa/en/search/?q=chair",{
  allowedHosts:["ikea.com"],env:{JINA_API_KEY:key},
  fetchImpl:async (url,opts)=>{
   calls.push({url,opts});return new Response("# chairs\n- chair one",{status:200});
  },
 });
 assert.equal(result.ok,true);assert.match(result.markdown,/chair/);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://r.jina.ai/https://www.ikea.com/sa/en/search/?q=chair");
 assert.equal(calls[0].opts.headers.authorization,"Bearer "+key);
 assert.equal(calls[0].opts.redirect,"error");
 assert.ok(!JSON.stringify(result).includes(key));
});
test("Jina API 429 is handled as limited, not faked offers",async()=>{
 const out=await readJinaPage("https://ikea.com/sa/",{
  allowedHosts:["ikea.com"],env:{JINA_API_KEY:"test"},
  fetchImpl:async()=>new Response("slow down",{status:429,headers:{"retry-after":"30"}}),
 });
 assert.deepEqual(out,{ok:false,status:"rate_limited",retryAfter:"30"});
});
test("Jina disabled with no credentials and oversized payload rejected",async()=>{
 await assert.rejects(readJinaPage("https://ikea.com/",{allowedHosts:["ikea.com"],env:{}}),/not_configured/);
 const out=await readJinaPage("https://ikea.com/",{allowedHosts:["ikea.com"],env:{JINA_API_KEY:"test"},fetchImpl:async()=>new Response("x".repeat(600000))});
 assert.equal(out.status,"too_large");
});
