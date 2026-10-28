// NAWAA v22.06 — no-network source-readiness evidence for release review.
// Never reads secrets, uploads payloads, contacts third parties, or installs
// unauthorized grant metadata. Output is source-level status only.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  PARTNER_SOURCE_ACCESS,assessAuthorizedMerchantFeed,
} from "../server/merchant-feed-authorization-gate.mjs";

export function auditDecathlonSaudiPartnerReadiness(){
  const source=PARTNER_SOURCE_ACCESS["decathlon-sa"];
  const evaluation=assessAuthorizedMerchantFeed({sourceId:"decathlon-sa"});
  return {
    schemaVersion:"nawaa.merchant.partner-onboarding.v1",
    sourceId:source.sourceId,
    region:source.merchantCountry,
    officialSaudiGrantStatus:source.dataFeedPermission,
    merchantFeedEnabled:source.feedEnabled,
    operatorVerifiedGrantInstalled:source.operatorVerifiedGrantInstalled,
    authorizationGate:evaluation.status,
    networkRequests:0,
    sourceFeedBytesImported:0,
    sourcePriceCurrencyVerified:false,
    inventoryVerified:false,
    shippingVerified:false,
    bindingQuoteEligible:false,
    customerOfferPromotionEnabled:source.customerOfferPromotionEnabled,
    trustedOffersCreated:0,
    operationalNextStep:"Obtain written Saudi merchant permission, scope and feed specification from the source owner.",
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.stdout.write(JSON.stringify(auditDecathlonSaudiPartnerReadiness(),null,2)+"\n");
