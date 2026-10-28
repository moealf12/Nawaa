import assert from "node:assert/strict";
import test from "node:test";
import {
 authorizedBike24JsonConfig,parseAuthorizedBike24Json,
 searchAuthorizedBike24Json,
} from "../src/bike24-authorized-json.mjs";
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const base="https://www.bike24.com/p2735527.html";
const sample=(suffix="",id="2735527",price="247.05")=>({
 title:"Garmin Edge 540"+suffix+" GPS Cycling Computer - black",
 productUrl:"https://www.bike24.com/p"+id+".html",
 retailerProductId:id,
 mpn:"010-02694-01",gtin:"753759299811",
 priceEUR:price,currency:"EUR",
 image:"https://www.bike24.com/images/edge540.jpg",
 observedAt:new Date().toISOString(),
});
const payload=(...products)=>({source:"bike24-de",market:"DE",products});

test("G.2 disabled source makes exactly zero network requests, without HTML fallback",async()=>{
 let calls=0;
 const got=await searchAuthorizedBike24Json("garmin edge 540",{
   env:{},
   getJson:async()=>{calls++;throw Error("NO_NETWORK_PERMITTED")},
 });
 assert.equal(got.active,false);
 assert.equal(got.offers.length,0);
 assert.equal(got.diagnostics.mode,"NO_HTML_FALLBACK");
 assert.equal(calls,0);
 // The integrated merchant provider must also stop before any HTML request.
 const integrated=await searchFreeStorefrontById("bike24-de","garmin edge 540");
 assert.equal(integrated.candidates,0);
 assert.equal(integrated.offers.length,0);
 assert.equal(integrated.searchUrl,null);
 assert.equal(integrated.diagnostics.primarySearchError,"BIKE24_JSON_FEED_NOT_CONFIGURED");
 await assert.rejects(fetchHtmlSafe(base),/BIKE24_HTML_ROUTE_DISABLED/);
});

test("G.2 unknown/unapproved endpoint fails closed rather than probing guessed paths",()=>{
 assert.equal(authorizedBike24JsonConfig({}),null);
 const on={NAWAA_BIKE24_JSON_ENABLED:"1",NAWAA_BIKE24_JSON_ALLOWED_HOST:"partner.example.com"};
 assert.throws(()=>authorizedBike24JsonConfig(on),/CONFIG_MISSING_APPROVAL/);
 for(const raw of [
   "http://partner.example.com/garmin.json",
   "https://partner.example.com.evil.test/garmin.json",
   "https://u:p@partner.example.com/garmin.json",
   "https://partner.example.com/garmin.json?q=123",
   "https://partner.example.com:8443/garmin.json",
   "https://localhost/garmin.json",
 ])assert.throws(()=>authorizedBike24JsonConfig({...on,
   NAWAA_BIKE24_JSON_URL:raw,
 }),/NOT_APPROVED|HOST_NOT_PUBLIC/);
 assert.equal(authorizedBike24JsonConfig({...on,
   NAWAA_BIKE24_JSON_URL:"https://partner.example.com/feed/garmin.json",
 }).hostname,"partner.example.com");
});

test("G.2 respects BIKE24 published crawler route exclusions without contacting the store",()=>{
  const enabled={
    NAWAA_BIKE24_JSON_ENABLED:"1",
    NAWAA_BIKE24_JSON_ALLOWED_HOST:"www.bike24.com",
  };
  for(const path of ["/api/products.json","/search","/search-result-v2","/suche",
    "/ajax.php","/cdn-cgi/challenge","/checkout/order","/header"]){
    assert.throws(()=>authorizedBike24JsonConfig({...enabled,
      NAWAA_BIKE24_JSON_URL:"https://www.bike24.com"+path,
    }),/CRAWLER_ROUTE_DISALLOWED/);
  }
  // A separately approved partner host has its own contract and is not
  // incorrectly bound by a different site's robots.txt.
  assert.equal(authorizedBike24JsonConfig({
    ...enabled,
    NAWAA_BIKE24_JSON_ALLOWED_HOST:"partner.example.com",
    NAWAA_BIKE24_JSON_URL:"https://partner.example.com/api/v1/feed.json",
  }).hostname,"partner.example.com");
});

test("G.2 exact model and independent variant-hash preservation",()=>{
 const parsed=parseAuthorizedBike24Json(payload(
   sample(),sample(" Solar","2735528"),sample(" Sensor Bundle","2735529"),
   {...sample(),title:"Garmin Edge 540 Silicone Case"},
 ),"garmin edge 540");
 assert.equal(parsed.diagnostics.input,4);
 assert.equal(parsed.records.length,1);
 assert.equal(parsed.records[0].edition,"STANDARD");
 const solar=parseAuthorizedBike24Json(payload(sample(" Solar","2735528")),"garmin edge 540 solar");
 assert.equal(solar.records.length,1);
 assert.notEqual(parsed.records[0].identityHash,solar.records[0].identityHash);
});

test("G.2 zero cross-record enrichment: conflicting SKU, GTIN, price or currency fail closed",()=>{
 const badCurrency={...sample(),currency:"USD"};
 const wrongId={...sample(),retailerProductId:"9999999"};
 const mixed={...sample(),image:"https://untrusted.example/other.png"};
 const fake={...sample(),productUrl:"https://www.bike24.com.evil.test/p2735527.html"};
 const badPrice={...sample(),priceEUR:"1,999.00"};
 const stale={...sample(),observedAt:"2022-10-28T00:00:00Z"};
 const invalidGtin={...sample(),gtin:"not-a-barcode"};
 const records=parseAuthorizedBike24Json(payload(
   badCurrency,wrongId,mixed,fake,badPrice,stale,invalidGtin,
 ),"garmin edge 540");
 assert.equal(records.records.length,0);
 assert.equal(records.diagnostics.rejected,7);
 const conflict=parseAuthorizedBike24Json(payload(sample(),sample("","2735527","247.06")),"garmin edge 540");
 assert.equal(conflict.records.length,0);
 assert.equal(conflict.diagnostics.identityConflicts,1);
 const sibling=parseAuthorizedBike24Json(payload(sample(" Solar","2735528")),"garmin edge 540");
 assert.equal(sibling.records.length,0);
});

test("G.2 authorized JSON returns price with bounded SAR FX and no manufactured trust",async()=>{
 let requested=0,conversions=0;
 const result=await searchAuthorizedBike24Json("garmin edge 540",{
  env:{
   NAWAA_BIKE24_JSON_ENABLED:"1",
   NAWAA_BIKE24_JSON_ALLOWED_HOST:"partner.example.com",
   NAWAA_BIKE24_JSON_URL:"https://partner.example.com/feed/garmin.json",
  },
  getJson:async (cfg)=>{
    requested++;
    assert.equal(cfg.hostname,"partner.example.com");
    return payload(sample());
  },
  convert:async (value,currency)=>{
    conversions++;
    assert.equal(value,247.05);
    assert.equal(currency,"EUR");
    return {value:1092.45,rate:4.422,source:"test-fx",observedAt:new Date().toISOString()};
  },
 });
 assert.equal(requested,1);
 assert.equal(conversions,1);
 assert.equal(result.active,true);
 assert.equal(result.offers.length,1);
 const offer=result.offers[0];
 assert.equal(offer.originalProductPrice,247.05);
 assert.equal(offer.originalCurrency,"EUR");
 assert.equal(offer.currency,"SAR");
 assert.equal(offer.productPrice,1092.45);
 assert.equal(offer.sourceMeta.priceEvidence,"AUTHORIZED_FEED_RECORD_ONLY");
 assert.equal(offer.sourceMeta.verifiedByMerchant,false);
 assert.equal(offer.sourceMeta.priceParityConfirmed,false);
 assert.equal(offer.canShipToSaudi,null);
 assert.match(offer.identityHash,/^[a-f0-9]{64}$/);
});

test("G.2 failure is a real failure; 403 is never turned into empty inventory",async()=>{
 const env={
   NAWAA_BIKE24_JSON_ENABLED:"1",NAWAA_BIKE24_JSON_ALLOWED_HOST:"partner.example.com",
   NAWAA_BIKE24_JSON_URL:"https://partner.example.com/feed/garmin.json",
 };
 let calls=0;
 await assert.rejects(searchAuthorizedBike24Json("garmin edge 540",{
   env,
   getJson:async()=>{calls++;const err=Error("BIKE24_JSON_HTTP_403");err.status=403;throw err},
 }),/HTTP_403/);
 assert.equal(calls,1);
 await assert.rejects(searchAuthorizedBike24Json("garmin edge 540",{
   env,getJson:async()=>({source:"bike24-de",market:"DE",products:"not-an-array"}),
 }),/SCHEMA_REJECTED/);
});
