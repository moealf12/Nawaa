import test from "node:test";
import assert from "node:assert/strict";
import {inspect1688MobileHomepage} from "../src/1688-mobile-home-evidence.mjs";

const home = ({link="https://dj.1688.com/ci_bb?a=123", price="￥40", title="2026口袋迷你超大风力半导体制冷冰敷旋转折叠背夹挂腰手持小风扇"}={}) =>
  '<html><div class="product-list"><a class="goods-container" href="'+link+'">' +
  '<img src="https://cbu01.alicdn.com/img/ibank/photo.jpg"/>'+
  '<span class="goods-title">'+title+'</span><span class="price">'+price+'</span>'+
  '<span>已售1619件</span></a></div></html>';

test("1688 mobile: first-party tracking cards are observational, never PDP verified",()=>{
 const r=inspect1688MobileHomepage(home(),{finalUrl:"https://m.1688.com/",httpStatus:200});
 assert.equal(r.state,"PROMOTIONAL_PRODUCT_EVIDENCE_ONLY");
 assert.equal(r.promotionalCards,1);
 assert.equal(r.visiblePriceCandidatesCny,1);
 assert.equal(r.cardsWithImages,1);
 assert.equal(r.trackingOnlyLinks,1);
 assert.equal(r.canonicalOfferIds,0);
 assert.equal(r.pdpPriceVerified,0);
 assert.equal(r.customerPublishable,false);
 assert.equal(r.samples[0].displayedPriceCny,40);
});
test("1688 mobile: conflicting price strings are not a single valid price",()=>{
 const r=inspect1688MobileHomepage(home({price:"￥40-￥60"}));
 assert.equal(r.visiblePriceCandidatesCny,0);
 assert.equal(r.samples[0].displayedPriceCny,null);
 assert.equal(r.customerPublishable,false);
});
test("1688 mobile: site redirect to login or security punishment is fail closed",()=>{
 for(const url of ["https://login.taobao.com/","https://m.1688.com/offer/123456789012.html/_____tmd_____/punish"])
  assert.equal(inspect1688MobileHomepage(home(),{finalUrl:url}).state,
    "LOGIN_OR_PUNISH_REDIRECT");
});
test("1688 mobile: spoofed image, price and off-domain link never certify product",()=>{
 const r=inspect1688MobileHomepage(home({
   link:"https://dj.1688.com.evil.test/ci_bb",price:"$99",
   title:"蓝牙耳机新款无线运动户外耳机防水充电盒"}));
 assert.equal(r.trackingOnlyLinks,0);
 assert.equal(r.visiblePriceCandidatesCny,0);
 assert.equal(r.customerPublishable,false);
});
test("1688 mobile: response limits and rate/access denials",()=>{
 assert.equal(inspect1688MobileHomepage(home(),{httpStatus:403}).state,"HTTP_403_DENIED");
 assert.equal(inspect1688MobileHomepage(home(),{httpStatus:429}).state,"HTTP_429_RATE_LIMITED");
 assert.equal(inspect1688MobileHomepage("").state,"NO_HTML");
});
