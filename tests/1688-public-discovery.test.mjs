import test from "node:test";
import assert from "node:assert/strict";
import {robotsDecision,inspect1688Html} from "../src/1688-public-discovery.mjs";

const search="https://s.1688.com/selloffer/offer_search.htm?keywords=%E8%80%B3%E6%9C%BA";

test("1688: deny empty permissions when robots cannot be read",()=>{
  assert.equal(robotsDecision(null,search).allowed,false);
  assert.equal(robotsDecision({},search).allowed,false);
});
test("1688: wildcard denial halts public search",()=>{
  const decision=robotsDecision("User-agent: *\nDisallow: /\n",search);
  assert.equal(decision.allowed,false);
  assert.equal(decision.reason,"ROBOTS_DISALLOWED");
});
test("1688: path-specific allow takes precedence at equal specific agent",()=>{
  const policy="User-agent: *\nDisallow: /selloffer/\nAllow: /selloffer/offer_search.htm\n";
  assert.equal(robotsDecision(policy,search).allowed,true);
  assert.equal(robotsDecision(policy,"https://s.1688.com/selloffer/private").allowed,false);
});
test("1688: explicit agent overrides wildcard group",()=>{
  const policy="User-agent: *\nDisallow: /\n\nUser-agent: NAWAA-PublicSourceIndexer\nAllow: /\n";
  assert.equal(robotsDecision(policy,search).allowed,true);
});
test("1688: public product hyperlinks alone never become priced offers",()=>{
  const html='<a href="https://detail.1688.com/offer/123456789012.html">商品</a>';
  const result=inspect1688Html(html,{status:200,contentType:"text/html; charset=utf-8",
    finalUrl:search,query:"耳机"});
  assert.equal(result.candidateProductIdCount,1);
  assert.equal(result.priceVerifiedCount,0);
  assert.equal(result.itemPublishedCount,0);
  assert.equal(result.state,"UNPRICED_PRODUCT_LINKS_OBSERVED");
});
test("1688: login/JS challenge and HTTP denial never certify source",()=>{
  for(const [status,html] of [[403,"Forbidden"],[200,"请登录"],[429,"retry later"]]){
    const result=inspect1688Html(html,{status,contentType:"text/html",finalUrl:search});
    assert.notEqual(result.state,"UNPRICED_PRODUCT_LINKS_OBSERVED");
    assert.ok(result.blockedReason);
  }
});
