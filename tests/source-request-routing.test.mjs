import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseSourceTransport,
  nextSourceRequestAction,
  reconcilePublicSitemap,
} from "../src/source-request-routing.mjs";
import {createApprovedSourceFetcher} from "../server/source-transport.mjs";

test("source policy: no approved merchant silently uses a different network route",()=>{
  assert.equal(chooseSourceTransport({sourceId:"amazon-de",approvedSourceIds:[],optIn:true}),"native");
  assert.equal(chooseSourceTransport({sourceId:"amazon-de",approvedSourceIds:["amazon-de"],optIn:false}),"native");
  assert.equal(chooseSourceTransport({sourceId:"amazon-de",approvedSourceIds:["amazon-de"],optIn:true}),"impit");
});

test("source policy: 403 and 429 never trigger alternate network or new-runner retries",()=>{
  for(const status of [403,429]){
    const step=nextSourceRequestAction({status,attempt:0,retryAfterMs:120000});
    assert.equal(step.transportAction,"stop");
    assert.equal(step.productAvailability,"unknown");
    assert.equal(step.routeAfterFailure,false);
    if(status===429)assert.equal(step.retryAfterMs,120000);
  }
});

test("source policy: HTTP 404, 410 and sitemap disappearance are not out-of-stock evidence",()=>{
  for(const status of [404,410]){
    const step=nextSourceRequestAction({status,attempt:0});
    assert.equal(step.transportAction,"reverify_later");
    assert.equal(step.productAvailability,"unknown");
    assert.equal(step.removeFromIndex,false);
  }
  const state=reconcilePublicSitemap({
    indexedUrls:["https://merchant.example/p/123","https://merchant.example/p/456"],
    observedUrls:["https://merchant.example/p/456"],
    sitemapObserved:true,
  });
  assert.equal(state.missing.length,1);
  assert.equal(state.missing[0].status,"SITEMAP_ABSENT_REVERIFY");
  assert.equal(state.missing[0].productAvailability,"unknown");
  assert.equal(state.missing[0].removeFromIndex,false);
});

test("source policy: partial/incomplete sitemap and foreign links cannot generate removal signals",()=>{
  const state=reconcilePublicSitemap({
    indexedUrls:["https://merchant.example/p/1"],
    observedUrls:[],
    sitemapObserved:false,
  });
  assert.deepEqual(state.missing,[]);
  assert.equal(state.complete,false);
  const foreign=reconcilePublicSitemap({
    indexedUrls:["https://merchant.example/p/1"],
    observedUrls:["https://other.invalid/p/1"],
    sitemapObserved:true,
  });
  assert.equal(foreign.missing[0].status,"SITEMAP_ABSENT_REVERIFY");
});

test("source policy: 503 one bounded same-transport retry; 429 never retries",()=>{
  assert.equal(nextSourceRequestAction({status:503,attempt:0,maxRetries:1}).transportAction,"retry_same_transport");
  assert.equal(nextSourceRequestAction({status:503,attempt:1,maxRetries:1}).transportAction,"stop");
  assert.equal(nextSourceRequestAction({status:429,attempt:0,maxRetries:5}).transportAction,"stop");
});

test("transport: native fetch remains default with exact failure propagation",async()=>{
  const hits=[];
  const wrapped=createApprovedSourceFetcher({
    fetchImpl:async (url,opts)=>{
      hits.push({url,opts});
      return new Response("denied",{status:403,headers:{"content-type":"text/html"}});
    },
    approvedSourceIds:[],
    optIn:true,
    impitFetch:async()=>{throw Error("must not invoke another network")},
  });
  const response=await wrapped("https://merchant.example/search",{method:"GET"},{sourceId:"merchant"});
  assert.equal(response.status,403);
  assert.equal(hits.length,1);
});

test("transport: explicit owner-approved source uses injected got adapter on first request only",async()=>{
  let impitCalls=0,normalCalls=0;
  const wrapped=createApprovedSourceFetcher({
    fetchImpl:async()=>{normalCalls++;throw Error("native should not be selected")},
    impitFetch:async(url,opts)=>{impitCalls++;return new Response("<html>sample</html>",{status:200,headers:{"content-type":"text/html"}})},
    approvedSourceIds:["fixture-source"],approvedSourceHosts:{"fixture-source":["merchant.example"]},optIn:true,
  });
  const response=await wrapped("https://merchant.example/search",{method:"GET"},{sourceId:"fixture-source"});
  assert.equal(response.status,200);
  assert.equal(await response.text(),"<html>sample</html>");
  assert.equal(impitCalls,1);assert.equal(normalCalls,0);
});

test("transport: failed approved got client does not silently reroute; no arbitrary unsafe protocols",async()=>{
  const wrapped=createApprovedSourceFetcher({
    fetchImpl:async()=>{throw Error("unapproved reroute")},
    impitFetch:async()=>{throw Error("UNAVAILABLE")},
    approvedSourceIds:["fixture-source"],approvedSourceHosts:{"fixture-source":["merchant.example"]},optIn:true,
  });
  await assert.rejects(wrapped("https://merchant.example/search",{method:"GET"},{sourceId:"fixture-source"}),/UNAVAILABLE/);
  await assert.rejects(wrapped("http://merchant.example/search",{method:"GET"},{sourceId:"fixture-source"}),/HTTPS_REQUIRED/);
  await assert.rejects(wrapped("https://127.0.0.1/private",{method:"GET"},{sourceId:"fixture-source"}),/PUBLIC_DNS_REQUIRED/);
});

test("transport: configured got rejects cross-site URL, non-GET and credentials",async()=>{
  const wrapped=createApprovedSourceFetcher({
    fetchImpl:async()=>{throw Error("should not call fetch")},
    impitFetch:async()=>{throw Error("should not call got")},
    approvedSourceIds:["fixture-source"],approvedSourceHosts:{"fixture-source":["merchant.example"]},optIn:true,
    approvedSourceHosts:{"fixture-source":["merchant.example"]},
  });
  await assert.rejects(wrapped("https://elsewhere.example/search",{method:"GET"},{sourceId:"fixture-source"}),/HOST_NOT_ALLOWED/);
  await assert.rejects(wrapped("https://merchant.example/search",{method:"POST"},{sourceId:"fixture-source"}),/GET_ONLY/);
  await assert.rejects(wrapped("https://user:pass@merchant.example/search",{method:"GET"},{sourceId:"fixture-source"}),/CREDENTIALS_FORBIDDEN/);
});


test("bike24: approved non-browser client retains explicit indexer identity without fallbacks",async()=>{
  const requests=[];
  let nativeCalls=0;
  const approved=createApprovedSourceFetcher({
    fetchImpl:async()=>{nativeCalls++;throw Error("NATIVE_RETRY_FORBIDDEN");},
    impitFetch:async(url,options)=>{
      requests.push({url,options});
      return new Response("Forbidden",{status:403});
    },
    approvedSourceIds:["bike24-de"],
    approvedSourceHosts:{"bike24-de":["www.bike24.com"]},
    optIn:true,
  });
  const response=await approved("https://www.bike24.com/p2735527.html",{method:"GET",
    headers:{"user-agent":"DO_NOT_TRUST_CALLER","sec-fetch-site":"same-origin"}},
    {sourceId:"bike24-de"});
  assert.equal(response.status,403);
  assert.equal(requests.length,1);
  assert.equal(nativeCalls,0);
  assert.equal(requests[0].options.redirect,"error");
  assert.equal(requests[0].options.headers["user-agent"],
    "NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)");
  assert.equal(requests[0].options.headers["sec-fetch-site"],undefined);
  assert.equal(requests[0].options.headers["accept-language"],"en-GB,en;q=0.9,de;q=0.4");
  await assert.rejects(
    approved("https://other.example/p2735527.html",{method:"GET"},{sourceId:"bike24-de"}),
    /HOST_NOT_ALLOWED/
  );
  const nonApproved=createApprovedSourceFetcher({
    fetchImpl:async()=>{nativeCalls++;return new Response("native");},
    impitFetch:async()=>{throw Error("IMPERSONATION_NOT_ALLOWED")},
    approvedSourceIds:["bike24-de"],
    approvedSourceHosts:{"bike24-de":["www.bike24.com"]},optIn:true,
  });
  await nonApproved("https://www.thomann.de/de/x.htm",{},
    {sourceId:"thomann-de"});
  assert.equal(nativeCalls,1);
});
