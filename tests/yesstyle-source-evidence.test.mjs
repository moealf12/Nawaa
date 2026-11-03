import test from "node:test";
import assert from "node:assert/strict";
import {yesstyleSearchUrl,verifyYesstyleSearchContext,parseYesstyleUSD,
  yesstyleProductIdentity,extractYesstyleSearchCards} from "../src/yesstyle-search-cards.mjs";
import {verifyYesstylePdp} from "../src/yesstyle-pdp-evidence.mjs";
import {evaluateYesstyleSearch,yesstyleLiveConfigured} from "../server/providers/yesstyle-live.mjs";
import {merchantRequestHeaders,NAWAA_INDEXER_USER_AGENT} from "../src/source-http-profile.mjs";
import {searchFreeStorefrontById,routeFreeStorefronts,configuredFreeStorefronts}
  from "../server/providers/free-storefronts.mjs";

const q="sunscreen",url=yesstyleSearchUrl(q),pid="1137266754";
const prod="https://www.yesstyle.com/en/anua-zero-cast-moisturizing-finish-sunscreen/info.html/pid."+pid;
const escape=x=>String(x).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
function tile(id=pid,title="Anua - Zero-Cast Moisturizing Finish Sunscreen",{
  price="US$ 11.70",was="US$ 18.00",href=null}={}){
  return '<a class="listImageGrid-module-scss-module__xx__itemContainer" href="'+escape(href||prod.replace(pid,id))+'">'+
    '<div class="__itemCover"><img src="https://d1flfk77wl2xk4.cloudfront.net/Assets/22/693/M_p0223869322.jpeg"></div>'+
    '<div class="__itemContent"><div class="__itemTitle">'+escape(title)+'</div>'+
    '<div class="__itemPriceWrapper"><b class="__itemPrice notranslate">'+escape(price)+'</b>'+
    (was?'<span class="__itemSellPrice notranslate">'+escape(was)+'</span>':'')+
    '</div></div><b class="__discountBadge">35% OFF</b></a>';
}
function list(...cards){
  return '<html lang="en"><body><aside>US$ 1.99</aside>'+
  '<main class="__mainWrapper"><h1>"sunscreen"</h1>'+
  '<section class="listImageGrid-module__imageGridWrapper">'+cards.join("")+
  '</section></main><footer>US$ 4.99</footer></body></html>';
}
const candidate={productId:pid,sourceUrl:prod,
  title:"Anua - Zero-Cast Moisturizing Finish Sunscreen",price:11.70};
function pdp({price="US$ 11.70",variant="50ml",stock="In-Stock",dest="United States",title=candidate.title}={}){
  return '<html lang="en"><body><main><div class="productDetailPage-module__PDPContainer">'+
    '<h1>'+escape(title)+'</h1><div class="__priceContainer">'+
    '<span class="__sellingPrice">'+escape(price)+'</span></div>'+
    '<div class="__unitPrice"><span class="__listPrice">US$ 18.00</span></div>'+
    '<div class="buyOptions-module__roundCornerSelect"><span class="__option-title">'+escape(variant)+'</span>'+
    '<span class="__option-additional-info">'+escape(stock)+'</span></div>'+
    '<button>Add to Bag</button><div class="__shippingInfo"><h6>Shipping to '+escape(dest)+'</h6></div>'+
    '</div></main></body></html>';
}
const parse=(html,opts={})=>extractYesstyleSearchCards(html,q,{requestedUrl:url,finalUrl:url,...opts});
const pdpVerify=(html,c=candidate,override={})=>verifyYesstylePdp(html,c,{finalUrl:c.sourceUrl,observedAt:"2026-11-03T02:00:00Z",...override});

test("generic English, Arabic and punctuation queries create canonical first-party listing URL",()=>{
  assert.equal(new URL(yesstyleSearchUrl("skin cream")).searchParams.get("q"),"skin cream");
  assert.equal(new URL(yesstyleSearchUrl("شنطة 2026")).searchParams.get("q"),"شنطة 2026");
  assert.equal(new URL(yesstyleSearchUrl("Nike + bag")).searchParams.get("q"),"Nike + bag");
  assert.throws(()=>yesstyleSearchUrl(" "),/INVALID_QUERY/);
  assert.throws(()=>yesstyleSearchUrl("x".repeat(161)),/INVALID_QUERY/);
});
test("USD price parser refuses currency and locale ambiguity",()=>{
  assert.equal(parseYesstyleUSD("US$\u00a011.70"),11.70);
  assert.equal(parseYesstyleUSD("US$ 1,299.95"),1299.95);
  for(const s of ["$11.70","11.70","SAR 11.70","US$ 0.00","US$ 1.299,95","US$ 8.9"])
    assert.equal(parseYesstyleUSD(s),null,s);
});
test("real YesStyle DOM conventions yield bounded distinct product candidates",()=>{
  const r=parse(list(tile(),tile("1137266752","Anua - Invisible Glow Stick")));
  assert.equal(r.diagnostics.status,"PARSED_USD_SEARCH");
  assert.equal(r.candidates.length,2);
  assert.equal(r.candidates[0].price,11.7);
  assert.equal(r.candidates[0].listPrice,18);
  assert.equal(r.candidates[0].currency,"USD");
  assert.equal(r.candidates[0].availability,"unknown");
  assert.equal(r.candidates[0].canShipToSaudi,null);
  assert.equal(r.diagnostics.customerPublishable,false);
  assert.equal(r.candidates[0].image.startsWith("https://d1flfk77wl2xk4.cloudfront.net/Assets/"),true);
});
test("query redirect, origin and visible query heading must attest the user intent",()=>{
  assert.equal(verifyYesstyleSearchContext({query:q,requestedUrl:url,finalUrl:url}),true);
  assert.equal(parse(list(tile()),{finalUrl:"https://example.org/en/list.html?bpt=48&q=sunscreen"}).candidates.length,0);
  assert.equal(parse(list(tile()),{finalUrl:yesstyleSearchUrl("bag")}).diagnostics.status,"SEARCH_CONTEXT_MISMATCH");
  assert.equal(parse(list(tile()).replace('"sunscreen"','"bag"')).diagnostics.status,"QUERY_HEADER_MISMATCH");
});
test("rejects cross-domain product links, off-page promotions and invalid prices",()=>{
  assert.equal(yesstyleProductIdentity("https://attacker.test/en/shoes/info.html/pid.1137266754"),null);
  const r=parse(list(tile(pid,candidate.title,{href:"https://attacker.test/en/test/info.html/pid.1137266754"}),
    tile("1137266752","Wrong currency",{price:"EUR 11.70"})));
  assert.equal(r.candidates.length,0);
  assert.equal(r.diagnostics.rejected,2);
  assert.equal(parse(list()).candidates.length,0);
});
test("duplicate SKU conflicts cannot silently overwrite a price",()=>{
  const a=tile(pid,candidate.title,{price:"US$ 11.70"});
  const b=tile(pid,candidate.title,{price:"US$ 9.70"});
  assert.equal(parse(list(a,a)).candidates.length,1);
  const r=parse(list(a,b));
  assert.equal(r.candidates.length,0);
  assert.equal(r.diagnostics.conflicts,1);
});
test("enforces card limits and oversized HTML rejection",()=>{
  const cards=Array.from({length:7},(_,i)=>tile(String(1137266750+i)));
  assert.equal(parse(list(...cards),{maxCards:3}).candidates.length,3);
  assert.equal(parse(list(...cards),{maxCards:0}).candidates.length,0);
  assert.equal(parse("z".repeat(4_000_001)).diagnostics.status,"HTML_MISSING_OR_OVERSIZED");
});
test("PDP checks exact URL, same SKU, title and USD search price parity",()=>{
  const r=pdpVerify(pdp());
  assert.equal(r.verified,true);
  assert.equal(r.price,11.7);
  assert.equal(r.variant,"50ml");
  assert.equal(r.variantAvailability,"in_stock");
  assert.equal(r.destination,"United States");
  assert.equal(r.availability,"unknown");
  assert.equal(r.shippingToSaudiVerified,false);
  assert.equal(r.customerPublishable,false);
});
test("PDP invalid currency, mismatched title, identity and price fail closed",()=>{
  assert.equal(pdpVerify(pdp({price:"US$ 12.70"})).reason,"SEARCH_PDP_PRICE_MISMATCH");
  assert.equal(pdpVerify(pdp({price:"SAR 11.70"})).verified,false);
  assert.equal(pdpVerify(pdp({title:"Nike trainers model 2026"})).verified,false);
  assert.equal(pdpVerify(pdp(),candidate,{finalUrl:"https://www.yesstyle.com/en/shoe/info.html/pid.1137266752"}).verified,false);
});
test("variant-level status is not proof of Saudi delivery, even when shipping heading says Saudi",()=>{
  const yes=pdpVerify(pdp({dest:"Saudi Arabia"}));
  assert.equal(yes.shippingToSaudiVerified,false);
  assert.equal(yes.canShipToSaudi,null);
  assert.equal(pdpVerify(pdp({stock:"Sold Out"})).variantAvailability,"out_of_stock");
  assert.equal(pdpVerify(pdp({stock:"Available soon"})).verified,false);
});
test("200 neterror or missing selected option and destination fail closed",()=>{
  assert.equal(pdpVerify(pdp().replace('<body>','<body class="neterror">')).verified,false);
  assert.equal(pdpVerify(pdp().replace('class="buyOptions-module__roundCornerSelect"','class="other"')).verified,false);
  assert.equal(pdpVerify(pdp().replace("Shipping to United States","Shipping unavailable")).verified,false);
});
test("on-demand coordinator checks only one PDP and cannot publish unverified shipping",async()=>{
  const fetched=[];
  const result=await evaluateYesstyleSearch({query:q,html:list(tile()),searchUrl:url,finalUrl:url,
    fetchPdp:async url=>{fetched.push(url);return {html:pdp(),finalUrl:url}}});
  assert.deepEqual(fetched,[prod]);
  assert.equal(result.verified.length,1);
  assert.equal(result.diagnostics.customerPublishable,false);
  assert.equal(result.diagnostics.shippingToSaudiVerified,false);
});
test("denial stops on-demand PDP checks without retry or fallback",async()=>{
  for(const status of [403,429]){
    let calls=0;
    const r=await evaluateYesstyleSearch({
      query:q,html:list(tile(),tile("1137266752","More sunscreen")),searchUrl:url,finalUrl:url,
      fetchPdp:async()=>{calls++;const e=new Error("HTTP "+status);e.status=status;throw e},
    });
    assert.equal(calls,1);
    assert.equal(r.verified.length,0);
    assert.equal(r.results[0].reason,status===403?"HTTP_403_DENIED":"HTTP_429_RATE_LIMITED");
  }
});
test("YesStyle remains registered but disabled by default, and truthful headers are scoped",async()=>{
  const a=process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED,b=process.env.NAWAA_YESSTYLE_LIVE_ENABLED;
  try{
    delete process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED;
    delete process.env.NAWAA_YESSTYLE_LIVE_ENABLED;
    assert.equal(yesstyleLiveConfigured(),false);
    assert.equal(configuredFreeStorefronts().some(s=>s.id==="yesstyle-global"),true);
    assert.equal(routeFreeStorefronts("yesstyle sunscreen").some(s=>s.store.id==="yesstyle-global"),false);
    const r=await searchFreeStorefrontById("yesstyle-global",q);
    assert.equal(r.diagnostics.status,"SOURCE_DISABLED");
    process.env.NAWAA_YESSTYLE_LIVE_ENABLED="1";
    assert.equal(yesstyleLiveConfigured(),false);
    const headers=merchantRequestHeaders("yesstyle-global",{"user-agent":"Chrome/145","sec-ch-ua":"x"});
    assert.equal(headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
    assert.equal(headers["sec-ch-ua"],undefined);
    assert.deepEqual(merchantRequestHeaders("amazon-sa",{accept:"foo"}),{accept:"foo"});
  }finally{
    if(a===undefined)delete process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED;
    else process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED=a;
    if(b===undefined)delete process.env.NAWAA_YESSTYLE_LIVE_ENABLED;
    else process.env.NAWAA_YESSTYLE_LIVE_ENABLED=b;
  }
});
