import test from "node:test";
import assert from "node:assert/strict";
import {auditDecathlonAjaxFeasibility} from "../scripts/audit-decathlon-ajax-feasibility.mjs";

const base="https://decathlon.com.sa",pdpUrl=base+"/products/test-shoes";
const sitemap='<urlset><url><loc>'+pdpUrl+'</loc></url></urlset>';
const robots="User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\n";
const blockedRobots="User-agent: *\nDisallow: /products/*.js$\n";
function page(){
  const graph={"@type":"Product",name:"Test Shoes",url:pdpUrl};
  const variant={productVariants:[{
    id:"12345",sku:"SKU-ABC",price:{amount:"49.00",currencyCode:"SAR"},
    product:{url:"/products/test-shoes",title:"Test Shoes"},
  }]};
  return '<html><head><link rel="canonical" href="'+pdpUrl+'">'+
    '<meta property="og:title" content="Test Shoes">'+
    '<meta name="twitter:image" content="https://decathlon.com.sa/cdn/test.jpg"></head>'+
    '<body><main><span data-sku="SKU-ABC"></span>'+
    '<form action="/cart/add"><input name="id" value="12345"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(graph)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify(variant)+' });</script></body></html>';
}
const respond=(body,type="text/plain")=>new Response(body,{status:200,headers:{"content-type":type}});
const sitemapResponse=()=>respond(sitemap,"application/xml");
const ajaxBody=(available=true)=>JSON.stringify({handle:"test-shoes",title:"Test Shoes",variants:[
  {id:12345,sku:"SKU-ABC",price:4900,available},
]});
const validate=report=>{
  for(const k of ["inventoryVerified","shippingVerified","checkoutVerified","quoteAllowed",
    "customerVisible"])assert.equal(report[k],false);
  assert.equal(report.publishedOfferCount,0);
  const serialized=JSON.stringify(report);
  for(const secret of ["49.00","SKU-ABC","12345","test-shoes","https://"])
    assert.equal(serialized.includes(secret),false,secret);
};
test("default OFF: zero sitemap, robots, PDP or Ajax calls",async()=>{
  let sitemapCount=0,robotsCount=0,pdpCount=0,ajaxCount=0;
  const r=await auditDecathlonAjaxFeasibility({
    liveProbeEnabled:false,
    fetchSitemap:async()=>{sitemapCount++;return sitemapResponse();},
    fetchRobots:async()=>{robotsCount++;return respond(robots)},
    fetchPdp:async()=>{pdpCount++;return {html:page(),finalUrl:pdpUrl}},
    fetchAjax:async()=>{ajaxCount++;return respond(ajaxBody(),"application/json")},
  });
  assert.equal(r.ajaxStatus,"PROBE_EXPLICITLY_DISABLED");
  assert.deepEqual([sitemapCount,robotsCount,pdpCount,ajaxCount],[0,0,0,0]);validate(r);
});
test("robots disallows Ajax endpoint: one policy read and zero PDP/Ajax calls",async()=>{
  let robot=0,pdp=0,ajax=0;
  const r=await auditDecathlonAjaxFeasibility({
    liveProbeEnabled:true,fetchSitemap:async()=>sitemapResponse(),
    fetchRobots:async(_url,o)=>{robot++;assert.equal(o.redirect,"manual");return respond(blockedRobots);},
    fetchPdp:async()=>{pdp++;throw Error("must not fetch")},
    fetchAjax:async()=>{ajax++;throw Error("must not fetch")},
  });
  assert.deepEqual([robot,pdp,ajax],[1,0,0]);
  assert.equal(r.robotsStatus,"ROBOTS_DISALLOW");validate(r);
});
test("positive limited read: one robots/PDP/Ajax, exact source price signal only",async()=>{
  let calls={sitemap:0,robots:0,pdp:0,ajax:0};
  const r=await auditDecathlonAjaxFeasibility({
    liveProbeEnabled:true,
    fetchSitemap:async()=>{calls.sitemap++;return sitemapResponse();},
    fetchRobots:async()=>{calls.robots++;return respond(robots)},
    fetchPdp:async()=>{calls.pdp++;return {html:page(),finalUrl:pdpUrl};},
    fetchAjax:async(u,o)=>{
      calls.ajax++;assert.equal(u,pdpUrl+".js");assert.equal(o.redirect,"manual");
      return respond(ajaxBody(),"application/json");
    },
  });
  assert.deepEqual(calls,{sitemap:1,robots:1,pdp:1,ajax:1});
  assert.equal(r.ajaxStatus,"AJAX_VARIANT_AVAILABLE_SIGNAL");
  assert.equal(r.selectedVariantMatched,true);
  assert.equal(r.variantPriceCentsMatched,true);
  assert.equal(r.merchantAvailableSignal,true);
  assert.equal(r.ajaxPresentmentCurrencyVerified,false);validate(r);
});
test("robots 429, 403, 404 and 302 fail closed with no Ajax requests",async()=>{
  for(const status of [429,403,404,302]){
    let calls=0;
    const r=await auditDecathlonAjaxFeasibility({
      liveProbeEnabled:true,fetchSitemap:async()=>sitemapResponse(),
      fetchRobots:async()=>new Response(null,{status,headers:{location:"https://evil.example"}}),
      fetchPdp:async()=>{calls++;throw Error("no PDP")},
      fetchAjax:async()=>{calls++;throw Error("no Ajax")},
    });
    assert.equal(calls,0);validate(r);
    assert.equal(r.ajaxPathPermitted,false);
  }
});
test("Ajax 403/429/404 and untrusted redirect are terminal with one attempt",async()=>{
  for(const status of [403,429,404,302]){
    let calls=0;
    const r=await auditDecathlonAjaxFeasibility({
      liveProbeEnabled:true,fetchSitemap:async()=>sitemapResponse(),
      fetchRobots:async()=>respond(robots),
      fetchPdp:async()=>({html:page(),finalUrl:pdpUrl}),
      fetchAjax:async()=>{calls++;return new Response(null,{status});},
    });
    assert.equal(calls,1);validate(r);
    assert.equal(r.variantPriceCentsMatched,false);
  }
});
test("Ajax HTML shell and huge response cannot be interpreted as source inventory",async()=>{
  for(const body of ["<html>JS required</html>","x".repeat(513_000)]){
    const r=await auditDecathlonAjaxFeasibility({
      liveProbeEnabled:true,fetchSitemap:async()=>sitemapResponse(),
      fetchRobots:async()=>respond(robots),
      fetchPdp:async()=>({html:page(),finalUrl:pdpUrl}),
      fetchAjax:async()=>respond(body,"application/json"),
    });
    assert.equal(r.variantPriceCentsMatched,false);validate(r);
  }
});
