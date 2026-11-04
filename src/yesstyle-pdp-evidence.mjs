// Offline YesStyle PDP truth gate. Uses only product-scoped HTML,
// never a site-wide promo, review or shipping policy as offer evidence.
import {load} from "cheerio";
import {parseYesstyleUSD,yesstyleProductIdentity} from "./yesstyle-search-cards.mjs";
const clean=v=>String(v??"").replace(/[\u00a0\u202f\s]+/g," ").trim();
export function verifyYesstylePdp(html,candidate,{finalUrl,observedAt=new Date().toISOString()}={}){
  const reject=reason=>({verified:false,reason,availability:"unknown",
    price:null,variant:null,destination:null,canShipToSaudi:null,
    shippingToSaudiVerified:false,customerPublishable:false});
  const listing=yesstyleProductIdentity(candidate?.sourceUrl);
  const actual=yesstyleProductIdentity(finalUrl);
  if(!listing||!actual||listing.productId!==actual.productId||
    listing.productId!==candidate?.productId)return reject("PDP_IDENTITY_MISMATCH");
  if(typeof html!=="string"||!html||html.length>4_000_000)
    return reject("PDP_HTML_MISSING_OR_OVERSIZED");
  const $=load(html);
  if($("body.neterror").length ||
    /(?:access denied|verify you are human|network error|captcha)/i.test($("title").first().text()))
    return reject("PDP_ERROR_OR_CHALLENGE");
  const main=$('main [class*="__PDPContainer"]').first();
  if(!main.length)return reject("PDP_CONTAINER_MISSING");
  const title=clean(main.find("h1").first().text());
  if(!title)return reject("PDP_PRODUCT_TITLE_MISSING");
  // A live URL response is not sufficient evidence if its rendered product
  // title does not correspond to the selected search result.
  const terms=x=>new Set(clean(x).toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ").filter(t=>t.length>=3));
  const a=terms(candidate?.title),b=terms(title);
  if(a.size && [...a].filter(t=>b.has(t)).length/Math.max(1,a.size)<0.6)
    return reject("PDP_PRODUCT_TITLE_MISMATCH");
  const price=parseYesstyleUSD(main.find('[class*="__priceContainer"] [class*="__sellingPrice"]').first().text());
  if(price===null)return reject("PDP_PRICE_UNATTESTED");
  if(price!==candidate.price)return reject("SEARCH_PDP_PRICE_MISMATCH");
  const selectors=main.find('[class*="__roundCornerSelect"]');
  if(selectors.length!==1)return reject("PDP_SELECTED_VARIANT_AMBIGUOUS");
  const chosen=selectors.first();
  const variant=clean(chosen.find('[class*="__option-title"]').first().text());
  const stock=clean(chosen.find('[class*="__option-additional-info"]').first().text());
  if(!variant||!/^(?:In-Stock|Out of Stock|Sold Out)$/i.test(stock))
    return reject("PDP_VARIANT_STOCK_UNATTESTED");
  const shippingLabel=clean(main.find('[class*="__shippingInfo"] h6').first().text());
  const destination=shippingLabel.match(/^Shipping to (.+)$/i)?.[1]||null;
  if(!destination)return reject("PDP_DESTINATION_UNATTESTED");
  const now=Date.parse(observedAt);
  if(!Number.isFinite(now))return reject("PDP_OBSERVED_AT_INVALID");
  // Destination display alone does not prove SKU-level Saudi eligibility,
  // checkout fees, or delivery. Variant stock is a momentary observation.
  return {verified:true,reason:"PDP_VARIANT_USD_PRICE_PARITY",
    price,currency:"USD",variant,
    variantAvailability:stock.toLowerCase()==="in-stock"?"in_stock":"out_of_stock",
    availability:"unknown",destination,
    canShipToSaudi:null,shippingToSaudiVerified:false,customerPublishable:false,
    observedAt:new Date(now).toISOString()};
}
