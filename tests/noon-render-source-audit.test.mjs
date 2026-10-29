import test from "node:test";
import assert from "node:assert/strict";
import {auditFreeStorefronts} from "../server/source-audit.mjs";

test("Render Noon 403 is access denied, not zero stock or a verified catalog",{
  concurrency:false
},async()=>{
  const previous=globalThis.fetch;
  let requests=0;
  try{
    globalThis.fetch=async()=>{requests++;return new Response("Access denied",{status:403});};
    const report=await auditFreeStorefronts({storeId:"noon-sa",query:"laptop"});
    assert.equal(report.audited,1);
    assert.equal(report.failing,1);
    assert.equal(report.liveVerified,0);
    assert.equal(report.totalVerifiedOffers,0);
    assert.equal(requests,1,"no retries or secondary endpoint on access refusal");
    const result=report.results[0];
    assert.equal(result.status,"FAILING");
    assert.equal(result.id,"noon-sa");
    assert.equal(result.failureClass,"HTTP_403_ACCESS_DENIED");
    assert.equal(result.productAvailability,"unknown");
    assert.equal(result.customerPublishable,false);
    assert.equal(result.verifiedOffers,0);
    assert.ok(!JSON.stringify(result).includes("Access denied"),"no merchant HTML in diagnostics");
  }finally{globalThis.fetch=previous;}
});

test("200 JS shell cannot be called an accessible priced Noon catalog",{
  concurrency:false
},async()=>{
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response("<html><div id='root'></div><script src='/bundle.js'></script></html>",{
      status:200,headers:{"content-type":"text/html"}
    });
    const report=await auditFreeStorefronts({storeId:"noon-sa",query:"laptop"});
    const result=report.results[0];
    assert.equal(result.verifiedOffers,0);
    assert.equal(result.sampleOffers.length,0);
    assert.equal(result.diagnostics?.noonSearchCards?.customerPublishable,false);
    assert.equal(result.diagnostics?.noonSearchCards?.uniqueOfferCandidates,0);
  }finally{globalThis.fetch=previous;}
});

test("Source audit distinguishes live HTML advertised prices from independently verified offers",{
  concurrency:false
},async()=>{
  const previous=globalThis.fetch;
  const html='<html><h1>laptop</h1><a href="https://www.noon.com/saudi-en/huawei-matebook-d16-laptop/N70312362V/p/?o=test">'+
    '<h2 data-qa="plp-product-box-name">Huawei MateBook D16 Laptop 16GB</h2>'+
    '<div data-qa="plp-product-box-price"><strong class="amount">2489</strong></div>'+
    '<img src="https://f.nooncdn.com/p/test.jpg"></a></html>';
  try{
    globalThis.fetch=async()=>new Response(html,{status:200,headers:{"content-type":"text/html"}});
    const report=await auditFreeStorefronts({storeId:"noon-sa",query:"laptop"});
    const result=report.results[0];
    assert.equal(result.diagnostics?.noonSearchCards?.parsedCards,1);
    assert.equal(result.diagnostics?.noonSearchCards?.uniqueOfferCandidates,1);
    assert.equal(result.diagnostics?.noonSearchCards?.customerPublishable,false);
    assert.equal(result.status,"LIVE_HTML_PRICE_OBSERVED");
    assert.equal(result.advertisedHtmlOffers,1);
    assert.equal(result.verifiedOffers,0);
    assert.equal(result.sampleOffers.length,1);
    assert.equal(result.sampleOffers[0].price,2489);
    assert.ok(!JSON.stringify(result.diagnostics.noonSearchCards).includes("2489"));
  }finally{globalThis.fetch=previous;}
});
