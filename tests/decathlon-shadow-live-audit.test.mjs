import test from "node:test";
import assert from "node:assert/strict";
import {auditDecathlonShadowSearch} from "../scripts/audit-decathlon-shadow-search.mjs";
const host="https://decathlon.com.sa",a=host+"/products/first-shoe",b=host+"/products/second-shoe";
const xml=urls=>'<urlset>'+urls.map(x=>'<url><loc>'+x+'</loc></url>').join("")+'</urlset>';
const page=html=>new Response(html,{status:200,headers:{"content-type":"application/xml"}});
test("auditor performs one sitemap and at most two PDP reads, never creates offers",async()=>{
  let sitemapCalls=0,pdpCalls=0,observed=0;
  const r=await auditDecathlonShadowSearch({
    fetchSitemap:async()=>{sitemapCalls++;return page(xml([a,b]));},
    fetchPdp:async u=>{pdpCalls++;return {finalUrl:u,html:"<html>existing PDP</html>"};},
    inspect:async(_f,_u,{onDecathlonShadow})=>{
      observed++;
      onDecathlonShadow({status:"EXPLICIT_VARIANT_SKU_PRICE_OWNERSHIP",variantPriceOwned:true});
    },
  });
  assert.deepEqual([sitemapCalls,pdpCalls,observed],[1,2,2]);
  assert.deepEqual([r.sampledPdp,r.observations,r.variantPriceOwnedCount],[2,2,2]);
  assert.equal(r.trustedOffersCreated,0);
  assert.equal(r.publicOfferChanges,0);
  assert.equal(r.inventoryVerified,false);
  assert.equal(r.sourceFreshnessCertified,0);
  assert.equal(JSON.stringify(r).includes("first-shoe"),false);
});
test("auditor blocks redirects to different product before performing shadow inspection",async()=>{
  let called=0;
  const r=await auditDecathlonShadowSearch({
    fetchSitemap:async()=>page(xml([a])),
    fetchPdp:async()=>({finalUrl:b,html:"does not matter"}),
    inspect:async()=>{called++;}
  });
  assert.equal(called,0);
  assert.deepEqual(r.statuses,["PDP_URL_IDENTITY_CONFLICT"]);
});
test("auditor respects 403/429 sitemap refusal with zero PDP requests",async()=>{
  for(const status of [403,429]){
    let pdpCalls=0;
    const r=await auditDecathlonShadowSearch({
      fetchSitemap:async()=>new Response(null,{status}),
      fetchPdp:async()=>{pdpCalls++;throw Error("must not call PDP");},
    });
    assert.equal(pdpCalls,0);
    assert.equal(r.sampledPdp,0);
    assert.equal(r.trustedOffersCreated,0);
  }
});
