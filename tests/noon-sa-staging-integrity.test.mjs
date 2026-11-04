// Pure contract/property tests. All products below are deliberately synthetic:
// NOT live merchant acceptance, not indexed, not published to customers.
// Real-source evidence remains required in separate GitHub Actions LIVE gates.
import test from "node:test";
import assert from "node:assert/strict";
import {inspectNoonExistingExport} from "../src/noon-sa-existing-export.mjs";
import {
  inspectNoonApprovedFeedPage,NOON_APPROVED_FEED_SCHEMA,
} from "../src/noon-sa-approved-feed.mjs";

const SKU="N12345678A"; // synthetic identifier only for invariant checks
const URL="https://www.noon.com/saudi-en/neutral-device/"+SKU+"/p/?o=offer-1";
const TIME="2026-11-04T19:58:00Z";
const NOW=Date.parse("2026-11-04T20:00:00Z");
const csvHeader="title,product_url,price,currency,sku,observed_at\n";
const csv=(price="3299.00",currency="SAR",url=URL,sku=SKU)=>
  csvHeader + '"Neutral Device","'+url+'","'+price+'","'+currency+'","'+sku+'","'+TIME+'"\n';

test("existing CSV normalizes valid SAR price while never authorizing publication",()=>{
  const result=inspectNoonExistingExport(csv());
  assert.equal(result.state,"EXISTING_EXPORT_PARSED_DIAGNOSTIC_ONLY");
  assert.equal(result.accepted,1);
  assert.equal(result.sourcePriceObservations,1);
  assert.equal(result.records[0].price,3299);
  assert.equal(result.records[0].customerPublishable,false);
  assert.equal(result.priceFreshnessVerified,false);
  assert.equal(result.feedScopeVerified,false);
});
test("correctly grouped thousands in Saudi price accepted, ambiguous grouping rejected",()=>{
  for(const value of ["3,299.00","٣٬٢٩٩٫٠٠"]){
    const ok=inspectNoonExistingExport(csv(value,"sar"));
    assert.equal(ok.sourcePriceObservations,1,value);
    assert.equal(ok.records[0].price,3299);
  }
  for(const value of ["3,29","3.299,00","1e3","3,29,9","-3299","0","Infinity"]){
    const invalid=inspectNoonExistingExport(csv(value));
    assert.equal(invalid.sourcePriceObservations,0,value);
    assert.equal(invalid.identityOnly,1,value);
  }
});
test("non-Noon and non-Saudi product links never enter the catalog",()=>{
  const links=[
    "https://www.noon.com/uae-en/neutral-device/"+SKU+"/p/?o=offer-1",
    "https://evil.example/saudi-en/neutral-device/"+SKU+"/p/?o=offer-1",
    "http://www.noon.com/saudi-en/neutral-device/"+SKU+"/p/?o=offer-1",
    "https://noon.com.evil.example/saudi-en/neutral-device/"+SKU+"/p/?o=offer-1",
  ];
  for(const link of links){
    const r=inspectNoonExistingExport(csv("3299","SAR",link));
    assert.equal(r.accepted,0,link);
    assert.equal(r.rejections.NON_NOON_SAUDI_PRODUCT_URL,1,link);
  }
});
test("SKU and offer-code mismatch cannot silently be normalized",()=>{
  assert.equal(inspectNoonExistingExport(csv("3299","SAR",URL,"N99999999A")).accepted,0);
  const value=JSON.stringify([{title:"Neutral Device",product_url:URL,
    offer_code:"offer-2",currency:"SAR",price:"3299",sku:SKU}]);
  const r=inspectNoonExistingExport(value,{format:"json"});
  assert.equal(r.accepted,0);
  assert.equal(r.rejections.OFFER_CODE_MISMATCH,1);
});
test("missing offer code keeps product-only evidence, never fake price",()=>{
  const noOffer=URL.split("?")[0];
  const r=inspectNoonExistingExport(csv("3299","SAR",noOffer));
  assert.equal(r.accepted,1);
  assert.equal(r.identityOnly,1);
  assert.equal(r.records[0].price,null);
  assert.equal(r.customerPublishable,false);
});
test("conflicting prices for identical SKU and offer are discarded, not last-write-wins",()=>{
  const r=inspectNoonExistingExport(csv()+"\"Neutral Device\",\""+URL+
    "\",\"3099\",\"SAR\",\""+SKU+"\",\""+TIME+"\"\n");
  assert.equal(r.conflicts,1);
  assert.equal(r.accepted,0);
  assert.equal(r.sourcePriceObservations,0);
});
test("CSV escaped quotes and malformed quotes are handled deterministically",()=>{
  const r=inspectNoonExistingExport(csv().replace('"Neutral Device"','"Neutral ""Device"""'));
  assert.equal(r.accepted,1);
  assert.equal(r.records[0].title,'Neutral "Device"');
  const malformed=inspectNoonExistingExport(csv().replace('"Neutral Device"','"Neutral" Device"'));
  assert.equal(malformed.accepted,0);
  assert.equal(malformed.state,"MALFORMED_CSV_QUOTE");
});
test("TSV and existing JSON array formats are parsed without merchant schema changes",()=>{
  const data=[{title:"Neutral Device",product_url:URL,price:"3299",currency:"SAR",sku:SKU}];
  const j=inspectNoonExistingExport(JSON.stringify({items:data}),{format:"json"});
  assert.equal(j.accepted,1);
  const tsv=inspectNoonExistingExport(
    "product_name\tproduct_link\tsale_price\tcurrency_code\n"+
    "Neutral Device\t"+URL+"\t3299\tSAR\n",
    {format:"tsv"},
  );
  assert.equal(tsv.accepted,1);
});
test("duplicate/oversized inputs fail closed and are never presented as live",()=>{
  const duplicate=inspectNoonExistingExport("title,title,product_url\nfoo,bar,"+URL+"\n");
  assert.equal(duplicate.state,"DUPLICATE_COLUMNS");
  const huge=inspectNoonExistingExport("x".repeat(8_000_001));
  assert.equal(huge.state,"INVALID_OR_OVERSIZED_BODY");
  assert.equal(huge.customerPublishable,undefined);
});
const feedRecord={
  sku:SKU,product_url:URL,offer_code:"offer-1",title:"Neutral Device",
  price:3299,currency:"SAR",observed_at:TIME,
};
const feed=(records=[feedRecord],override={})=>({
  schema:NOON_APPROVED_FEED_SCHEMA,market:"SA",scope:"marketplace",
  generated_at:"2026-11-04T19:59:00Z",records,...override,
});
test("approved feed contract is diagnostic-only regardless of record count",()=>{
  const r=inspectNoonApprovedFeedPage(feed(),{now:NOW});
  assert.equal(r.accepted,1);
  assert.equal(r.freshOffers,1);
  assert.equal(r.records[0].pdpVerified,false);
  assert.equal(r.records[0].customerPublishable,false);
  assert.equal(r.scopeIndependentlyVerified,false);
  assert.equal(r.customerPublishable,false);
});
test("seller-only scope, non-SA currency and stale timestamp are rejected",()=>{
  assert.equal(inspectNoonApprovedFeedPage(feed([],{scope:"seller"}),{now:NOW}).state,
    "UNSUITABLE_PARTNER_ONLY_SCOPE");
  assert.equal(inspectNoonApprovedFeedPage(feed([{...feedRecord,currency:"AED"}]),{now:NOW}).accepted,0);
  assert.equal(inspectNoonApprovedFeedPage(feed([],{generated_at:"2026-11-04T18:00:00Z"}),{now:NOW}).state,
    "FEED_GENERATION_STALE_OR_INVALID");
});
test("malformed and contradictory feed records do not reach publication",()=>{
  const r=inspectNoonApprovedFeedPage(feed([feedRecord,{...feedRecord,price:3000}]),{now:NOW});
  assert.equal(r.accepted,0);
  assert.equal(r.conflicts,1);
  assert.equal(r.customerPublishable,false);
});
