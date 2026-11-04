import test from "node:test";
import assert from "node:assert/strict";
import {cosrxSearchUrl,cosrxSuggestUrl,parseCosrxSuggestCards} from "../src/cosrx-evidence.mjs";
import {evaluateCosrxSearch,fetchCosrxPublicSuggestJson} from "../server/providers/cosrx-live.mjs";
import {NAWAA_INDEXER_USER_AGENT} from "../src/source-http-profile.mjs";

const q="sunscreen",searchUrl=cosrxSearchUrl(q),suggestUrl=cosrxSuggestUrl(q);
const handle="vitamin-e-vitalizing-sunscreen-spf-50";
const productUrl="https://www.cosrx.com/products/"+handle;
const card={id:9074593464536,handle,available:true,
  vendor:"COSRX Official",title:"Vitamin E Vitalizing Sunscreen SPF 50+",
  url:"/products/"+handle+"?_pos=1&_psq=sunscreen&_ss=e",
  price:"23.00",price_min:"23.00",price_max:"23.00",
  image:"https://cdn.shopify.com/s/files/1/0513/3775/6828/files/VitaminE_SunScreen_00.jpg?v=1"};
const product={id:card.id,handle:card.handle,title:card.title,available:true,
  variants:[{id:51101999038680,title:"Default Title",price:2300,
    compare_at_price:2300,available:true}]};
const payload=(...products)=>JSON.stringify({resources:{results:{products}}});
const parse=(json,opts={})=>parseCosrxSuggestCards(json,q,{
  requestedUrl:suggestUrl,finalUrl:suggestUrl,...opts});
const shell='<html><head><title>Search: 78 results found for "sunscreen" – COSRX Official</title></head>'+
  '<body><div class="collection-listing"><div class="product-list"></div></div></body></html>';

test("native Shopify predictive search URL exactly binds query and product limit",()=>{
  const u=new URL(suggestUrl);
  assert.equal(u.pathname,"/search/suggest.json");
  assert.equal(u.searchParams.get("q"),q);
  assert.equal(u.searchParams.get("resources[type]"),"product");
  assert.equal(u.searchParams.get("resources[limit]"),"10");
  assert.equal(new URL(cosrxSuggestUrl("كريم")).searchParams.get("q"),"كريم");
});
test("genuine predictive product metadata yields first-party USD candidates without offer publication",()=>{
  const r=parse(payload(card));
  assert.equal(r.diagnostics.status,"QUERY_BOUND_SHOPIFY_SUGGEST_CARDS");
  assert.equal(r.candidates.length,1);
  assert.equal(r.candidates[0].sourceUrl,productUrl);
  assert.equal(r.candidates[0].price,23);
  assert.equal(r.candidates[0].image,card.image);
  assert.equal(r.candidates[0].availability,"unknown");
  assert.equal(r.candidates[0].shippingToSaudiVerified,false);
  assert.equal(r.candidates[0].customerPublishable,false);
});
test("predictive results cannot be attached to a different user query or redirect",()=>{
  assert.equal(parse(payload(card),{finalUrl:"https://www.cosrx.com/search/suggest.json?q=shoes"}).candidates.length,0);
  assert.equal(parse(payload(card),{requestedUrl:"https://evil.test/search/suggest.json"}).candidates.length,0);
  assert.equal(parse("not JSON").diagnostics.status,"SUGGEST_JSON_INVALID");
});
test("counterfeit seller, malformed price, off-domain SKU and variant ranges are rejected",()=>{
  for(const edited of [
    {...card,vendor:"Other Store"},
    {...card,url:"https://evil.test/products/"+handle},
    {...card,price:"23.0"},
    {...card,price_min:"19.00"},
    {...card,id:"abc"},
  ])assert.equal(parse(payload(edited)).candidates.length,0);
  const conflict=parse(payload(card,{...card,price:"19.00",price_min:"19.00",price_max:"19.00"}));
  assert.equal(conflict.candidates.length,0);
  assert.equal(conflict.diagnostics.conflicts,1);
});
test("native JSON query fallback activates once when valid SSR search yields zero cards",async()=>{
  let suggest=0,pdp=0;
  const r=await evaluateCosrxSearch({
    query:q,html:shell,searchUrl,finalUrl:searchUrl,
    fetchSuggestJson:async provided=>{
      suggest++;assert.equal(provided,q);
      return {text:payload(card),finalUrl:suggestUrl};
    },
    fetchProductJson:async provided=>{
      pdp++;assert.equal(provided,productUrl);
      return {text:JSON.stringify(product)};
    },
  });
  assert.equal(suggest,1);
  assert.equal(pdp,1);
  assert.equal(r.diagnostics.discoveryMethod,"SHOPIFY_PREDICTIVE_JSON");
  assert.equal(r.diagnostics.validated,1);
  assert.equal(r.verified[0].variantId,"51101999038680");
  assert.equal(r.verified[0].customerPublishable,false);
  assert.equal(r.verified[0].shippingToSaudiVerified,false);
});
test("no fallback after invalid search context, and denied suggestion makes no product fetch",async()=>{
  let suggest=0,pdp=0;
  const bad=await evaluateCosrxSearch({
    query:q,html:shell,searchUrl,finalUrl:cosrxSearchUrl("other"),
    fetchSuggestJson:async()=>{suggest++;throw Error("should not call")},
    fetchProductJson:async()=>{pdp++;throw Error("should not call")},
  });
  assert.equal(bad.diagnostics.status,"SEARCH_CONTEXT_MISMATCH");
  const denied=await evaluateCosrxSearch({
    query:q,html:shell,searchUrl,finalUrl:searchUrl,
    fetchSuggestJson:async()=>{
      suggest++;const e=new Error("HTTP 403");e.status=403;throw e;
    },
    fetchProductJson:async()=>{pdp++;throw Error("should not call")},
  });
  assert.equal(suggest,1);
  assert.equal(pdp,0);
  assert.equal(denied.diagnostics.suggestError,"SUGGEST_HTTP_403_DENIED");
  assert.equal(denied.verified.length,0);
});
test("public predictive fetch is one strict pinned GET, redirects and HTML challenges fail closed",async()=>{
  let calls=0;
  const out=await fetchCosrxPublicSuggestJson(q,{
    fetchImpl:async (url,init)=>{
      calls++;
      assert.equal(url,suggestUrl);
      assert.equal(init.method,"GET");
      assert.equal(init.redirect,"manual");
      assert.equal(init.headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
      return new Response(payload(card),{status:200,
        headers:{"content-type":"application/json"}});
    },
  });
  assert.equal(calls,1);
  assert.equal(out.finalUrl,suggestUrl);
  await assert.rejects(fetchCosrxPublicSuggestJson(q,{
    fetchImpl:async()=>new Response("<html>challenge</html>",{
      status:200,headers:{"content-type":"text/html"}})
  }),/BAD_CONTENT_TYPE/);
  await assert.rejects(fetchCosrxPublicSuggestJson(q,{
    fetchImpl:async()=>new Response(null,{status:302,headers:{location:"https://evil.test"}})
  }),/HTTP_302/);
});
