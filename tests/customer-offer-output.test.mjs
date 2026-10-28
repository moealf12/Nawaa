import test from "node:test";
import assert from "node:assert/strict";
import {enforceCustomerOfferPublication} from "../server/customer-offer-output.mjs";

const sa={provider:"jarir-direct",providerMarket:"jarir-sa",merchant:"Jarir",
  title:"Sample phone",productPrice:2500,sourceUrl:"https://www.jarir.com/sa-en/example.html"};
const de={provider:"free-storefronts",providerMarket:"amazon-de",merchant:"Amazon Germany",
  title:"Same phone",productPrice:1,originalProductPrice:0.2,currency:"SAR",
  sourceUrl:"https://www.amazon.de/dp/B0FQFW3423",
  exactMatch:true,priceConfidence:"confirmed",canShipToSaudi:true,
  sourceMeta:{priceEvidence:"VERIFIED",trustBadge:true,buyerVisiblePriceParity:true}};
test("JSON/SSE shared final boundary removes cached and claimed verified Amazon DE offers",()=>{
  const result={offers:[de,sa],coverage:{returnedOffers:2,availableOffers:99,returnedMerchants:2},nextCursor:"valid"};
  const safe=enforceCustomerOfferPublication(result);
  assert.deepEqual(safe.offers,[sa]);
  assert.equal(safe.coverage.returnedOffers,1);
  assert.equal(safe.coverage.availableOffers,1);
  assert.equal(safe.coverage.returnedMerchants,1);
  assert.equal(safe.nextCursor,"valid");
  assert.equal(result.offers.length,2,"never mutate cache contents");
  assert.equal(JSON.stringify(safe).includes("B0FQFW3423"),false);
});
test("Unrelated retailer records are retained unchanged",()=>{
  const result={offers:[sa],coverage:{returnedOffers:1}};
  assert.equal(enforceCustomerOfferPublication(result),result);
  assert.equal(enforceCustomerOfferPublication(null),null);
});
test("Provider aliases cannot launder an Amazon DE PDP into shopper JSON",()=>{
  const disguised={...de,providerMarket:"mystery-market",merchant:"Sample seller"};
  const safe=enforceCustomerOfferPublication({offers:[disguised,sa]});
  assert.deepEqual(safe.offers,[sa]);
});

test("Alternate Amazon DE paths cannot bypass the cached customer response gate",()=>{
  const alt={...de,providerMarket:"other-market",
    sourceUrl:"https://www.amazon.de/gp/aw/d/B0FQFW3423"};
  const safe=enforceCustomerOfferPublication({offers:[alt,sa]});
  assert.deepEqual(safe.offers,[sa]);
});
