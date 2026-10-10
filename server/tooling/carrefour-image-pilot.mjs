// Deliberately isolated, one-SKU staging verification: no background tasks,
// no live customer search import, no database, no offers/price mutations.
// The real merchant request is DISABLED unless explicitly enabled by an
// ephemeral CI-only caller. Tests inject an offline mocked fetch implementation.
import {fetchHtmlSafe} from "../url-resolver.mjs";
import {proveCarrefourPdpImage} from "./carrefour-product-image-proof.mjs";
import {reconcileCarrefourImageEvidence} from "./carrefour-staged-image-evidence.mjs";
const KNOWN_CARREFOUR_PILOT_URL="https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-sage/p/2258790?offer=offer_1005819044&sid=DEFAULT&sellerId=19044";
function permitted(env){
 return env.NAWAA_CI_EPHEMERAL_SOURCE_PROBE==="1"&&
 env.NAWAA_ENABLE_EXPLICIT_CARREFOUR_IMAGE_PILOT==="1"&&
 !env.DATABASE_URL&&env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"&&
 env.NAWAA_ENABLE_CERTIFIED_INGESTION!=="1";
}
export async function inspectOneCarrefourImageFromPdp({
 offer,searchHtml=null,fetchPage=fetchHtmlSafe,env=process.env
}={}){
 if(!permitted(env))throw new Error("explicit_carrefour_image_pilot_disabled");
 // A fixture may inject flags only alongside a mocked transport. Never let
 // caller-supplied environment values activate a real merchant request.
 if(fetchPage===fetchHtmlSafe&&!permitted(process.env))
  throw new Error("real_carrefour_pilot_requires_process_flags");
 if(!offer||offer.sourceUrl!==KNOWN_CARREFOUR_PILOT_URL||
   offer.providerMarket!=="carrefour-ae"||offer.originalCurrency!=="AED"||
   offer.image!=null||typeof offer.title!=="string"||
   !Number.isFinite(offer.originalProductPrice)||offer.originalProductPrice<=0)
  throw new Error("unapproved_carrefour_pilot_offer");
 const page=await fetchPage(KNOWN_CARREFOUR_PILOT_URL,0,{maxRedirects:0});
 if(page?.finalUrl!==KNOWN_CARREFOUR_PILOT_URL)
  return {verified:false,status:"merchant_unexpected_page_redirect",requestsAttempted:1,offerUnchanged:true};
 if(typeof page?.html!=="string"||Buffer.byteLength(page.html)<5000)
  return {verified:false,status:"merchant_incomplete_product_html",requestsAttempted:1,offerUnchanged:true};
 const result=typeof searchHtml==="string"?
  reconcileCarrefourImageEvidence({offer,searchHtml,pdpHtml:page.html}):
  proveCarrefourPdpImage(page.html,{
    sourceUrl:offer.sourceUrl,title:offer.title,priceAED:offer.originalProductPrice
  });
 return {verified:result.verified,status:result.status,
  proposedImageUrl:result.verified?(result.proposedImageUrl||result.imageUrl):null,
  requestsAttempted:1,offerUnchanged:true};
}
