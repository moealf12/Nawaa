// NAWAA v22.01 — source-bound SKU + selected-variant price attribution.
// Research only. Never writes/returns price amounts, identifiers or offers.
// No change to production resolver; only source-owned already-acquired HTML.
import {extractDecathlonScopedIdentity} from "./decathlon-product-evidence.mjs";
import {extractShopifyVariantState} from "./shopify-page-variant.mjs";
import {extractionCandidates} from "./url-resolver.mjs";

const HOST="decathlon.com.sa";
const norm=x=>String(x||"").normalize("NFKC").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();
const state=(status,other={})=>({
  status,variantPriceOwned:false,trustedOfferEligible:false,
  inventoryVerified:false,shippingVerified:false,
  ...other,
});
const validProductUrl=(raw)=>{
  try{
    const u=new URL(raw);
    return u.protocol==="https:"&&u.hostname===HOST&&!u.username&&!u.password&&
      (!u.port||u.port==="443")&&!u.search&&!u.hash&&
      /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname);
  }catch{return false;}
};
export function attestDecathlonVariantPrice(html,productUrl){
  if(!validProductUrl(productUrl))return state("SOURCE_URL_INVALID");
  // Existing experimental PDP identity policy must pass first.
  const identity=extractDecathlonScopedIdentity(html,productUrl);
  if(identity.status!=="SCOPED_IDENTITY_OBSERVED")
    return state("IDENTITY_NOT_VERIFIED",{identityReason:identity.status});
  const source=String(html||"").slice(0,1_500_000);
  const probes={
    hasVariantPayloadMarker:/\bproductVariants\b/.test(source),
    hasShopifyLoader:/\bwpmLoader\b/.test(source),
    hasMetaPrice:extractionCandidates(source,productUrl).some(x=>
      x.strategy==="meta" && Number.isFinite(Number(x.product?.offers?.price))&&
      Number(x.product.offers.price)>0 && x.product.offers.priceCurrency==="SAR"),
  };
  const chosen=new URL(productUrl);
  chosen.searchParams.set("variant",identity.selectedVariant);
  const extracted=extractShopifyVariantState(source,chosen.href);
  if(!extracted)return state("NO_SELECTED_VARIANT_PRICE_RECORD",{probes});
  const offer=extracted.offers||{};
  if(!extracted.shopifyVariantEvidence)return state("VARIANT_SOURCE_UNCONFIRMED",{probes});
  const skuAgrees=String(offer.sku||"").trim()===String(identity.sku);
  if(!skuAgrees)return state("VARIANT_SKU_CONFLICT",{probes});
  if(norm(extracted.name)!==norm(identity.title))
    return state("VARIANT_PRODUCT_TITLE_CONFLICT",{probes});
  try{
    const target=new URL(offer.url);
    if(target.protocol!=="https:"||target.hostname!==HOST||
       target.pathname.replace(/\/+$/,"")!==new URL(productUrl).pathname.replace(/\/+$/,"")||
       target.searchParams.getAll("variant").length!==1||
       target.searchParams.get("variant")!==identity.selectedVariant ||
       [...target.searchParams.keys()].some(k=>k!=="variant"))
      return state("VARIANT_URL_CONFLICT",{probes});
  }catch{return state("VARIANT_URL_CONFLICT",{probes});}
  if(!Number.isFinite(offer.price)||offer.price<=0||offer.priceCurrency!=="SAR")
    return state("SELECTED_VARIANT_PRICE_NOT_SAR",{probes});
  // A singular Shopify variant object with price & SKU matching the DOM
  // proves observed variant attribution, not stock/checkout/freshness/shipping.
  return state("EXPLICIT_VARIANT_SKU_PRICE_OWNERSHIP",{
    probes,variantPriceOwned:true,
    source:"shopify_wpm_initData_productVariants",
  });
}
