import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {fetchNoonUaePythonCards,noonUaePythonEnabled} from "../src/noon-ae-python-acquisition.mjs";

const pythonBin="python3";
const url="https://www.noon.com/uae-en/search/?q=laptop";
const CARD={productId:"N70312362V",offerCode:"offerA01",
  sourceUrl:"https://www.noon.com/uae-en/laptop-16gb-512gb/N70312362V/p/?o=offerA01",
  title:"Pro Laptop 16GB 512GB",priceText:"2,499.50",priceAED:2499.5,
  currency:"AED",image:"https://f.nooncdn.com/p/pzsku/item.jpg?width=800"};
const goodReply=r=>({schemaVersion:r.schemaVersion,requestId:r.requestId,
  sourceId:"noon-ae",status:"OK",language:"en-AE",heading:"laptop",
  cards:[CARD],finalUrl:url});
function fakeSpawn(reply, {hang=false}={}){
  let calls=0,kills=0;
  const impl=(bin,args,config)=>{
    calls++;
    assert.equal(bin,pythonBin);
    assert.deepEqual(args,["-m","nawaa_py.noon_ae_search"]);
    assert.equal(config.shell,false);
    assert.equal(config.cwd.endsWith("/workers/python-intelligence/"),true);
    const child=new EventEmitter();
    child.stdout=new EventEmitter();
    child.stderr=new EventEmitter();
    child.stdin=new EventEmitter();
    child.killed=false;
    child.kill=()=>{kills++;child.killed=true;return true;};
    child.stdin.end=(text)=>{
      const request=JSON.parse(text);
      assert.equal(request.query,"laptop");
      assert.equal(request.sourceId,"noon-ae");
      if(!hang)queueMicrotask(()=>{
        const response=reply(request);
        child.stdout.emit("data",Buffer.from(JSON.stringify(response)+"\n"));
        child.emit("close",0);
      });
    };
    return child;
  };
  return {impl,get calls(){return calls;},get kills(){return kills;}};
}
test("Noon UAE Python transport is opt-in and uses fixed source-only Python module",async()=>{
  assert.equal(noonUaePythonEnabled({NAWAA_NOON_AE_PYTHON:"0"}),false);
  assert.equal(noonUaePythonEnabled({NAWAA_NOON_AE_PYTHON:"1"}),true);
  const child=fakeSpawn(goodReply);
  const result=await fetchNoonUaePythonCards("laptop",{pythonBin,spawnImpl:child.impl});
  assert.equal(result.finalUrl,url);
  assert.deepEqual(result.cards,[CARD]);
  assert.equal(result.language,"en-AE");
  assert.equal(result.transport,"PYTHON_NOON_AE_JSON");
  assert.equal("html" in result,false);
  assert.equal(child.calls,1);
});

test("Noon UAE Python rejects cross-merchant and cross-query final URLs",async()=>{
  for(const finalUrl of [
    "https://attacker.invalid/uae-en/search/?q=laptop",
    "https://www.noon.com/saudi-en/search/?q=laptop",
    "https://www.noon.com/uae-en/search/?q=phone",
    "http://www.noon.com/uae-en/search/?q=laptop"
  ]){
    const child=fakeSpawn(r=>({...goodReply(r),finalUrl}));
    await assert.rejects(fetchNoonUaePythonCards("laptop",{
      pythonBin,spawnImpl:child.impl
    }),/SOURCE_SEARCH_URL_MISMATCH/);
  }
});

test("Noon UAE Python classifies live 403 instead of retrying or turning it into zero products",async()=>{
  const child=fakeSpawn(r=>({schemaVersion:r.schemaVersion,requestId:r.requestId,
    sourceId:"noon-ae",status:"ERROR",errorCode:"HTTP_403_ACCESS_DENIED"}));
  await assert.rejects(fetchNoonUaePythonCards("laptop",{
    pythonBin,spawnImpl:child.impl
  }),e=>e.failureClass==="HTTP_403_ACCESS_DENIED");
  assert.equal(child.calls,1);
});

test("Noon UAE Python rejects invalid user query before spawning child",async()=>{
  let called=false;
  for(const query of ["x","x\nmore","x".repeat(121)]){
    await assert.rejects(fetchNoonUaePythonCards(query,{pythonBin,spawnImpl:()=>{
      called=true;throw Error("should-not-run");
    }}),/NOON_AE_QUERY_INVALID/);
  }
  assert.equal(called,false);
});

test("Noon UAE Python one-child rule rejects concurrency and abort kills running worker",async()=>{
  const child=fakeSpawn(()=>{}, {hang:true});
  const c=new AbortController();
  const running=fetchNoonUaePythonCards("laptop",{
    pythonBin,spawnImpl:child.impl,signal:c.signal
  });
  await assert.rejects(fetchNoonUaePythonCards("laptop",{
    pythonBin,spawnImpl:child.impl
  }),/NOON_AE_PYTHON_BUSY/);
  c.abort(Error("test_client_disconnect"));
  await assert.rejects(running,/test_client_disconnect/);
  assert.equal(child.kills,1);
  assert.equal(child.calls,1);
});

test("Noon UAE Python JSON bridge rejects oversized or malformed card responses",async()=>{
  for(const altered of [
    {cards:"not an array"},
    {cards:Array.from({length:251},()=>CARD)},
    {cards:[{...CARD,priceAED:"2499.5"}]},
    {cards:[{...CARD,currency:"USD"}]},
    {cards:[{...CARD,sourceUrl:"x".repeat(2501)}]},
    {language:"en-SA"},
  ]){
    const child=fakeSpawn(r=>({...goodReply(r),...altered}));
    await assert.rejects(fetchNoonUaePythonCards("laptop",{pythonBin,spawnImpl:child.impl}),
      /NOON_AE_PYTHON_RESULT_INVALID|NOON_AE_PYTHON_OUTPUT_LIMIT/);
  }
});
test("Noon UAE Python JSON worker supports empty verified search pages without Node retry",async()=>{
  const child=fakeSpawn(r=>({...goodReply(r),cards:[]}));
  const result=await fetchNoonUaePythonCards("laptop",{pythonBin,spawnImpl:child.impl});
  assert.equal(result.cards.length,0);
  assert.equal(child.calls,1);
});

test("Noon UAE Python records precisely which merchant stage returned 403",async()=>{
  for(const stage of ["warmup_uae","uae_search_html"]){
    const child=fakeSpawn(r=>({
      schemaVersion:r.schemaVersion,requestId:r.requestId,
      sourceId:"noon-ae",status:"ERROR",errorCode:"HTTP_403_ACCESS_DENIED",
      sourceDiagnostic:{stage,httpStatus:403,elapsedMs:124},
    }));
    await assert.rejects(fetchNoonUaePythonCards("laptop",{
      pythonBin,spawnImpl:child.impl,
    }),e=>{
      assert.equal(e.failureClass,"HTTP_403_ACCESS_DENIED");
      assert.equal(e.sourceStage,stage);
      assert.equal(e.sourceHttpStatus,403);
      assert.equal(e.sourceElapsedMs,124);
      return true;
    });
    assert.equal(child.calls,1);
  }
});
test("Noon UAE Python drops untrusted free-text and impossible source diagnostic fields",async()=>{
  const child=fakeSpawn(r=>({
    schemaVersion:r.schemaVersion,requestId:r.requestId,
    sourceId:"noon-ae",status:"ERROR",errorCode:"HTTP_403_ACCESS_DENIED",
    sourceDiagnostic:{stage:"https://untrusted.example/secret?query=laptop",
      httpStatus:999,elapsedMs:-150,requestUrl:"https://secrets.example"},
  }));
  await assert.rejects(fetchNoonUaePythonCards("laptop",{
    pythonBin,spawnImpl:child.impl,
  }),e=>{
    assert.equal(e.failureClass,"HTTP_403_ACCESS_DENIED");
    assert.equal(e.sourceStage,undefined);
    assert.equal(e.sourceHttpStatus,undefined);
    assert.equal(e.sourceElapsedMs,undefined);
    assert.equal("requestUrl" in e,false);
    return true;
  });
});
