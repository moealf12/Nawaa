import test from "node:test";
import assert from "node:assert/strict";
import {neweggSearchUrl,verifyNeweggSearchContext,extractNeweggSearchCards} from "../src/newegg-search-cards.mjs";

const query="samsung ssd",searchUrl=neweggSearchUrl(query);
function card(id,title,dollars,cents=".99",symbol="$"){
  return '<div class="grid-col" data-item-position="1"><div class="goods-container">'+
    '<a class="goods-img" href="https://www.newegg.com/test/p/'+id+'"><img src="https://c1.neweggimages.com/productimage/nb300/20-147-922-02.jpg"></a>'+
    '<a class="goods-title" href="https://www.newegg.com/test/p/'+id+'">'+title+'</a>'+
    '<div class="goods-price-current"><span class="goods-price-symbol">'+symbol+'</span>'+
    '<span class="goods-price-value"><strong>'+dollars+'</strong><sup>'+cents+'</sup></span></div>'+
    '<div class="goods-price-was">$9,999.99</div></div></div>';
}
function page(){
  return '<html lang="en-us"><div class="sidebar"><a href="https://www.newegg.com/other/p/N82E16820147922">ad</a>$0.01</div>'+
    '<div class="plp-results-section">'+Array.from(arguments).join("")+'</div></html>';
}
const parse=(html,opts={})=>extractNeweggSearchCards(html,query,{requestedUrl:searchUrl,finalUrl:searchUrl,...opts});

test("search URL is generic and encodes Unicode",()=>{
  assert.equal(new URL(neweggSearchUrl("2TB SSD + NVMe")).searchParams.get("d"),"2TB SSD + NVMe");
  assert.equal(new URL(neweggSearchUrl("سماعات بلوتوث")).searchParams.get("d"),"سماعات بلوتوث");
  assert.throws(()=>neweggSearchUrl(" "),/INVALID_QUERY/);
});
test("only a matching first-party listing context can be parsed",()=>{
  assert.equal(verifyNeweggSearchContext({requestedUrl:searchUrl,finalUrl:searchUrl,query}),true);
  assert.equal(parse(page(card("N82E16820147922","Samsung SSD 990 1TB","189")),{...parse(page(card("N82E16820147922","Samsung SSD 990 1TB","189")))});
  assert.equal(parse(page(card("N82E16820147922","Samsung SSD","189")),{finalUrl:"https://www.newegg.com/"}).offers.length,0);
  assert.equal(parse(page(card("N82E16820147922","Samsung SSD","189")),{finalUrl:"https://bad.example/p/pl?d=samsung%20ssd"}).offers.length,0);
});
test("accurate USD current prices and distinct product variants",()=>{
  const x=parse(page(card("N82E16820147922","Samsung SSD 990 1TB","189"),card("N82E16820147861","Samsung SSD 990 PRO 2TB","389")));
  assert.equal(x.offers.length,2);
  assert.equal(x.offers[0].price,189.99);
  assert.equal(x.offers[0].currency,"USD");
  assert.equal(x.offers[0].productId,"N82E16820147922");
  assert.equal(x.diagnostics.customerShippingVerified,false);
});
test("never use sidebar prices, crossed-out prices or ambiguous currencies",()=>{
  const wrong=card("N82E16820147922","Samsung SSD","", "");
  const other=card("N82E16820147861","Samsung SSD","89").replaceAll("www.newegg.com/test","untrusted.example/test");
  assert.equal(parse(page(wrong,other)).offers.length,0);
  assert.equal(parse(page(card("N82E16820147922","Samsung SSD","189",".99","SAR"))).offers.length,0);
});
test("foreign market, broken layout and duplicate-price conflicts fail closed",()=>{
  const html=page(card("N82E16820147922","Samsung SSD 1TB","189"),card("N82E16820147922","Samsung SSD 1TB","139"),card("N82E16820147861","Samsung SSD 2TB","389"));
  const r=parse(html);
  assert.equal(r.offers.length,1);assert.equal(r.offers[0].productId,"N82E16820147861");
  assert.equal(r.diagnostics.conflicts,1);
  assert.equal(parse(html.replace('lang="en-us"','lang="ar-sa"')).offers.length,0);
  assert.equal(parse(html.replace("plp-results-section","something-else")).offers.length,0);
});
test("conditions distinguished without stock or Saudi shipping assertions",()=>{
  const offer=parse(page(card("N82E16820147922","Samsung SSD Open Box 1TB","89"))).offers[0];
  assert.equal(offer.condition,"open_box");
  assert.equal(offer.availability,undefined);
  assert.equal(offer.canShipToSaudi,undefined);
});


test("Newegg is disabled from the NAWAA router and direct acquisition by default",async()=>{
  const {configuredFreeStorefronts,routeFreeStorefronts,searchFreeStorefrontById}=await import("../server/providers/free-storefronts.mjs");
  const previous=process.env.NAWAA_NEWEGG_SCRAPING_ENABLED;
  try{
    delete process.env.NAWAA_NEWEGG_SCRAPING_ENABLED;
    assert.equal(configuredFreeStorefronts().some(x=>x.id==="newegg-global"),false);
    assert.equal(routeFreeStorefronts("ssd").some(x=>x.store.id==="newegg-global"),false);
    const disabled=await searchFreeStorefrontById("newegg-global","ssd");
    assert.equal(disabled.offers.length,0);
    assert.equal(disabled.diagnostics.status,"SOURCE_DISABLED");
    process.env.NAWAA_NEWEGG_SCRAPING_ENABLED="1";
    assert.equal(configuredFreeStorefronts().some(x=>x.id==="newegg-global"),true);
    assert.equal(routeFreeStorefronts("ssd").some(x=>x.store.id==="newegg-global"),true);
  }finally{
    if(previous===undefined)delete process.env.NAWAA_NEWEGG_SCRAPING_ENABLED;
    else process.env.NAWAA_NEWEGG_SCRAPING_ENABLED=previous;
  }
});
