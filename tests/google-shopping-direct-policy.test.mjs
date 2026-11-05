import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  googleShoppingDirectCandidates,
  parseGoogleRobotsCommonRules,
  googleRobotsAdmission,
  evaluateGoogleShoppingDirectPaths,
  GOOGLE_ALLOWED_NON_SEARCH_LANDING,
} from "../src/google-shopping-direct-policy.mjs";

// Grounded in Google public robots at https://www.google.com/robots.txt.
// This is a policy regression fixture, NOT a source/product/results fixture.
const ROBOTS=[
  "User-agent: *",
  "User-agent: Yandex",
  "Disallow: /search",
  "Disallow: /shopping?",
  "Disallow: /shopping/product/",
  "Disallow: /shopping/search",
  "Allow: /shopping?udm=28$",
  "Allow: /search?*tbm=map",
  "",
  "User-agent: AdsBot-Google",
  "Allow: /search",
  "User-agent: facebookexternalhit",
  "Allow: /search",
].join("\n");

test("direct Shopping: Arabic/English/mixed arbitrary user queries produce only fixed first-party paths",()=>{
  for(const query of ["سماعات بلوتوث","iPhone 17 256GB","PS5 ديجيتال","لابتوب HP 16GB"]){
    const urls=googleShoppingDirectCandidates(query);
    assert.equal(urls.length,3);
    for(const item of urls){
      const url=new URL(item.url);
      assert.equal(url.origin,"https://www.google.com");
      assert.equal(url.searchParams.get("q"),query);
      assert.equal(item.searchQuery,true);
    }
  }
  assert.deepEqual(googleShoppingDirectCandidates("https://example.com/?token=secret"),[]);
  assert.deepEqual(googleShoppingDirectCandidates("A"),[]);
  assert.deepEqual(googleShoppingDirectCandidates("x".repeat(141)),[]);
});

test("direct Shopping: global wildcard group is authoritative; Googlebot/AdsBot exceptions are NOT borrowed",()=>{
  const rules=parseGoogleRobotsCommonRules(ROBOTS);
  assert.ok(rules.find(r=>r.path==="/shopping/search"));
  assert.ok(!rules.find(r=>r.type==="allow"&&r.path==="/search"));
});

test("direct Shopping: /search?tbm=shop is forbidden, even with Arabic input",()=>{
  const url=googleShoppingDirectCandidates("سماعات بلوتوث")[0].url;
  const e=googleRobotsAdmission(ROBOTS,url);
  assert.equal(e.allowed,false);
  assert.deepEqual(e.matchedRule,{type:"disallow",path:"/search"});
});

test("direct Shopping: /shopping/search and /shopping?udm=28&q... are forbidden",()=>{
  const urls=googleShoppingDirectCandidates("iPhone 17 Pro");
  assert.equal(googleRobotsAdmission(ROBOTS,urls[1].url).allowed,false);
  assert.deepEqual(googleRobotsAdmission(ROBOTS,urls[2].url).matchedRule,
    {type:"disallow",path:"/shopping?"});
});

test("direct Shopping: only exact /shopping?udm=28 landing is admitted; adding query loses exception",()=>{
  const exact=googleRobotsAdmission(ROBOTS,GOOGLE_ALLOWED_NON_SEARCH_LANDING);
  assert.equal(exact.allowed,true);
  assert.deepEqual(exact.matchedRule,{type:"allow",path:"/shopping?udm=28$"});
  for(const added of ["&q=iphone","&hl=ar","&gl=sa"]){
    const e=googleRobotsAdmission(ROBOTS,GOOGLE_ALLOWED_NON_SEARCH_LANDING+added);
    assert.equal(e.allowed,false);
  }
});

test("direct Shopping: PDP and redirects are not eligible for automated verification",()=>{
  assert.equal(googleRobotsAdmission(ROBOTS,"https://www.google.com/shopping/product/123456789").allowed,false);
  assert.equal(googleRobotsAdmission(ROBOTS,"https://www.google.com/url?q=https%3A%2F%2Fexample.com").allowed,true,
    "robot admission alone is not a PDP verification or acquisition permission");
  for(const other of [
    "https://www.google.com.evil.test/search?tbm=shop",
    "https://www.google.co.uk/search?tbm=shop",
    "http://www.google.com/search?tbm=shop",
  ])assert.equal(googleRobotsAdmission(ROBOTS,other).allowed,false);
});

test("direct Shopping: all Shopping search paths blocked for every accepted query, no fabricated results",()=>{
  for(const q of ["سماعات Bluetooth","laptop","PS5","iPhone 17"]){
    const r=evaluateGoogleShoppingDirectPaths(ROBOTS,q);
    assert.equal(r.status,"DIRECT_SEARCH_ROBOTS_BLOCKED");
    assert.equal(r.allowedSearchPaths,0);
    assert.equal(r.totalSearchPaths,3);
    assert.equal(r.publishableProducts,0);
    assert.equal(r.verifiedPrices,0);
    assert.ok(r.paths.every(item=>item.admission.allowed===false));
  }
});

test("direct Shopping: network/robots uncertainty fails closed instead of attempting scraping",()=>{
  for(const text of ["","<html>CAPTCHA</html>",null]){
    const result=evaluateGoogleShoppingDirectPaths(text,"JBL headphones");
    assert.equal(result.status,"ROBOTS_UNAVAILABLE");
    assert.ok(result.paths.every(p=>!p.admission.allowed));
  }
});

test("direct Shopping: independent probe never fetches robot-disallowed query or imports production ranking",async()=>{
  const script=await readFile(new URL("../scripts/google-shopping-direct-live.mjs",import.meta.url),"utf8");
  assert.match(script,/googleRobotsAdmission\(robots\.text,GOOGLE_ALLOWED_NON_SEARCH_LANDING\)/);
  assert.match(script,/getBounded\(GOOGLE_ALLOWED_NON_SEARCH_LANDING,MAX_HTML\)/);
  assert.doesNotMatch(script,/getBounded\((?:normal|shopping|mode|item|candidate|searchUrl)/);
  assert.doesNotMatch(script,/persistOffers|recordOffer|\/api\/ingest\/offers|searchAll\(/);
});
