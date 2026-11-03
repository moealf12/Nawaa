import test from "node:test";
import assert from "node:assert/strict";
import {asosSearchUrl,verifyAsosSearchContext,parseAsosGBP,parseAsosSearchCards}
  from "../src/asos-search-cards.mjs";

const q="nike shoes";
const searchUrl=asosSearchUrl(q);
const esc=s=>String(s).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
const product=(id,title,{price="£109.99",was=null,variantId=id,image=true,url=null}={})=>{
  const href=url||"https://www.asos.com/nike/example-trainers/prd/"+id+"#colourWayId-"+variantId;
  const label=was?"Original price: "+was+", current price: "+price:"Price: "+price;
  const priceHtml=was
    ? '<span class="originalPrice_InLGX markedDown_G_tbw"><span class="price_m0bg_">'+was+'</span></span>'+
      '<span class="reducedPrice_tPJKj"><span class="saleAmount_Vem8U">'+price+'</span></span>'
    : '<span class="originalPrice_InLGX"><span class="price_m0bg_">'+price+'</span></span>';
  return '<li id="product-'+id+'" class="productTile_U0clN">'+
    '<a href="'+esc(href)+'" aria-label="'+esc(title+', '+label)+'" class="productLink_KM4PI">'+
    (image?'<div class="productMediaContainer_kmkXR"><img src="https://images.asos-media.com/products/example/'+id+'-1-black/?$n_480w$&amp;wid=476"></div>':'')+
    '<div class="productInfo_rwyH5"><p id="pta-product-'+id+'-0" class="productDescription_sryaw">'+esc(title)+'</p>'+
    '<p id="pta-product-'+id+'-1" aria-label="'+esc(label)+'" class="container_wL0So">'+priceHtml+
    '</p><span class="badge_juy1n">MORE COLOURS</span></div></a></li>';
};
function page(...cards){
  return '<!doctype html><html lang="en-GB" data-country-code="GB" data-store-code="COM">'+
    '<body><div class="carousel">£1.00 <a href="https://www.asos.com/example/prd/999999999">Sponsored</a></div>'+
    '<div class="results"><ul data-testid="listing-results-1" class="listingPage_HfNlp">'+
    cards.join("")+'</ul></div></body></html>';
}
const parse=(html,opts={})=>parseAsosSearchCards(html,q,
  {requestedUrl:searchUrl,finalUrl:searchUrl,...opts});

test("builds safe generic search URLs including Arabic and punctuation",()=>{
  assert.equal(new URL(asosSearchUrl("nike shoes")).searchParams.get("q"),"nike shoes");
  assert.equal(new URL(asosSearchUrl("فستان مقاس 40")).searchParams.get("q"),"فستان مقاس 40");
  assert.equal(new URL(asosSearchUrl("Nike + Adidas")).searchParams.get("q"),"Nike + Adidas");
  assert.throws(()=>asosSearchUrl(" "),/ASOS_INVALID_QUERY/);
  assert.throws(()=>asosSearchUrl("x".repeat(161)),/ASOS_INVALID_QUERY/);
});
test("strictly parses GBP without inventing a converted SAR price",()=>{
  assert.equal(parseAsosGBP("£1,029.95"),1029.95);
  assert.equal(parseAsosGBP("£89.99"),89.99);
  for(const bad of ["£0.00","$89.99","SAR 89.99","89.99","£1.029,95","£ 20.7"])
    assert.equal(parseAsosGBP(bad),null,bad);
});
test("original ASOS DOM conventions: standard and discounted prices",()=>{
  const html=page(
    product("206633512","Nike P-6000 trainers in white and silver"),
    product("202389207","Nike Air Force 1 '07 trainers in triple white",
      {price:"£89.99",was:"£109.99",variantId:"202389212"}),
    product("202506225","Nike Dunk Low unisex trainers",{price:"£39.99",was:"£109.99"})
  );
  const r=parse(html);
  assert.equal(r.diagnostics.status,"PARSED_GB_SEARCH");
  assert.equal(r.diagnostics.cardsSeen,3);
  assert.equal(r.candidates.length,3);
  assert.equal(r.candidates[0].price,109.99);
  assert.equal(r.candidates[0].listPrice,null);
  assert.equal(r.candidates[1].price,89.99);
  assert.equal(r.candidates[1].listPrice,109.99);
  assert.equal(r.candidates[1].currency,"GBP");
  assert.equal(r.candidates[1].variantId,"202389212");
  assert.equal(r.candidates[1].priceEvidence,"VISIBLE_SEARCH_CARD_GB");
  assert.equal(r.candidates[1].canShipToSaudi,null);
  assert.equal(r.candidates[1].availability,"unknown");
  assert.equal(r.diagnostics.customerPublishable,false);
  assert.equal(r.diagnostics.shippingToSaudiVerified,false);
});
test("rejects market and redirect mismatches, including unexpected locale",()=>{
  const item=page(product("206633512","Nike P-6000 trainers"));
  assert.equal(verifyAsosSearchContext({requestedUrl:searchUrl,finalUrl:searchUrl,query:q}),true);
  assert.equal(parse(item,{finalUrl:"https://www.asos.com/"}).candidates.length,0);
  assert.equal(parse(item,{finalUrl:"https://example.com/search/?q=nike%20shoes"}).candidates.length,0);
  assert.equal(parse(item,{finalUrl:"https://www.asos.com/search/?q=dress"}).diagnostics.status,"SEARCH_CONTEXT_MISMATCH");
  assert.equal(parse(item.replace('data-country-code="GB"','data-country-code="SA"')).candidates.length,0);
  assert.equal(parse(item.replace('lang="en-GB"','lang="en-SA"')).candidates.length,0);
  assert.equal(parse(item.replace('data-store-code="COM"','data-store-code="US"')).candidates.length,0);
});
test("rejects outside-store URLs, nonmatching product IDs and unsafe images",()=>{
  const good=product("206633512","Nike trainers");
  const outside=product("202389207","Outside trainers",
    {url:"https://attacker.example/nike/example/prd/202389207"});
  const wrong=product("202506225","Wrong product",
    {url:"https://www.asos.com/nike/example/prd/999999999"});
  const r=parse(page(good,outside,wrong));
  assert.equal(r.candidates.length,1);
  assert.equal(r.diagnostics.rejectedCards,2);
  assert.equal(r.candidates[0].sourceUrl.startsWith("https://www.asos.com/"),true);
  assert.equal(r.candidates[0].image.startsWith("https://images.asos-media.com/"),true);
});
test("never promote prices from carousel, rejected cards or invalid currency",()=>{
  const invalid=product("206633512","Nike trainers",{price:"$89.99"});
  const r=parse(page(invalid));
  assert.equal(r.candidates.length,0);
  assert.equal(r.diagnostics.rejectedCards,1);
  assert.equal(parse(page().replace('<ul data-testid="listing-results-1"','<ul data-testid="other"')).diagnostics.status,"SEARCH_LISTING_MISSING");
});
test("rejects inconsistent accessible sale prices and inverted discounts",()=>{
  const bad=product("206633512","Nike shoes",{price:"£139.99",was:"£109.99"});
  const inconsistent=product("202389207","Nike shoes",{price:"£89.99",was:"£109.99"})
    .replace('current price: £89.99','current price: £9.99');
  const r=parse(page(bad,inconsistent));
  assert.equal(r.candidates.length,0);
  assert.equal(r.diagnostics.rejectedCards,2);
});
test("deduplicates exact hits and fails closed when identical variants conflict",()=>{
  const a=product("206633512","Nike P-6000",{price:"£99.99"});
  const b=product("206633512","Nike P-6000",{price:"£79.99"});
  assert.equal(parse(page(a,a)).candidates.length,1);
  const r=parse(page(a,b,product("202389207","Nike Air Force 1")));
  assert.equal(r.diagnostics.conflicts,1);
  assert.deepEqual(r.candidates.map(x=>x.productId),["202389207"]);
});
test("variant identity is not collapsed, missing images remain unknown",()=>{
  const one=product("206633512","Nike shoe",{variantId:"206633514",image:false});
  const two=product("206633512","Nike shoe",{variantId:"206633515"});
  const r=parse(page(one,two));
  assert.equal(r.candidates.length,2);
  assert.equal(r.candidates[0].image,null);
  assert.notEqual(r.candidates[0].variantId,r.candidates[1].variantId);
  assert.ok(!("sizes" in r.candidates[0]));
  assert.ok(!("shipping" in r.candidates[0]));
});
test("bounded memory/card processing and zero-result handling",()=>{
  const many=page(...Array.from({length:20},(_,i)=>
    product(String(202389207+i),"Nike trainers "+i)));
  assert.equal(parse(many,{maxCards:3}).diagnostics.cardsSeen,3);
  assert.equal(parse(many,{maxCards:3}).candidates.length,3);
  assert.equal(parse(many,{maxCards:0}).candidates.length,0);
  assert.equal(parse("").diagnostics.status,"HTML_MISSING_OR_TOO_LARGE");
  assert.equal(parse("x".repeat(4_000_001)).candidates.length,0);
  assert.equal(parse('<html lang="en-GB" data-country-code="GB" data-store-code="COM"></html>').diagnostics.status,"SEARCH_LISTING_MISSING");
});
