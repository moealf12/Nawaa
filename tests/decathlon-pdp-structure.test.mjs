import test from "node:test";
import assert from "node:assert/strict";
import {inspectDecathlonHtmlStructure,auditDecathlonPdpStructure} from "../scripts/audit-decathlon-pdp-structure.mjs";
const host="https://decathlon.com.sa";
const url=host+"/products/kalenji-sport-shoes";
const xml='<urlset><url><loc>'+url+'</loc></url></urlset>';
test("structure: only source-owned product URL can be diagnosed",()=>{
  assert.equal(inspectDecathlonHtmlStructure("<html/>","https://evil.example/products/x").status,"INVALID_SOURCE_URL");
  assert.equal(inspectDecathlonHtmlStructure("<html/>",host+"/private").status,"INVALID_SOURCE_URL");
});
test("structure: mixed JSON/hydration/image tags produce field-presence only",()=>{
  const html='<html lang="ar"><head><title>Product</title><meta property="og:image" content="https://cdn.test/private.png"></head>'+
    '<body><h1>Product</h1><img data-src="https://cdn.test/x.png"><div data-sku="secret"/></body></html>';
  const out=inspectDecathlonHtmlStructure(html,url);
  assert.equal(out.status,"HTML_OBSERVED");
  assert.equal(out.ogImageMeta,true);
  assert.equal(out.imageDataAttributes,1);
  assert.equal(out.skuAttributeCount,1);
  assert.equal(out.trustCertified,undefined);
  assert.equal(JSON.stringify(out).includes("private.png"),false);
  assert.equal(JSON.stringify(out).includes("secret"),false);
});
test("structure: one sitemap + one owned PDP and no data promotion",async()=>{
  let req=0,pdp=0;
  const report=await auditDecathlonPdpStructure({
    fetchSitemap:async()=>{req++;return new Response(xml,{status:200,headers:{"content-type":"application/xml"}});},
    fetchPdp:async u=>{pdp++;assert.equal(u,url);return {html:"<h1>Kalenji</h1>",finalUrl:u};},
  });
  assert.equal(req,1);assert.equal(pdp,1);assert.equal(report.pages[0].status,"HTML_OBSERVED");
  assert.equal(report.trustCertified,false);
});
test("structure: cross-product redirect blocked",async()=>{
  const report=await auditDecathlonPdpStructure({
    fetchSitemap:async()=>new Response(xml,{status:200,headers:{"content-type":"application/xml"}}),
    fetchPdp:async()=>({html:"<html/>",finalUrl:host+"/products/another"}),
  });
  assert.equal(report.pages[0].status,"PDP_IDENTITY_REDIRECT_REJECTED");
  assert.equal(report.trustCertified,false);
});
test("structure: 429 returns no PDP request",async()=>{
  let count=0;
  const report=await auditDecathlonPdpStructure({
    fetchSitemap:async()=>new Response(null,{status:429,headers:{"retry-after":"60"}}),
    fetchPdp:async()=>{count++;throw Error("unexpected");},
  });
  assert.equal(report.sitemapStatus,"SOURCE_RATE_LIMITED");
  assert.equal(count,0);
});
