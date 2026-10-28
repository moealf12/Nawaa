// NAWAA v22.05 — one authorized, source-owned Shopify Ajax product candidate.
// RESEARCH ONLY. The merchant's policy must be evaluated before any .js GET.
// Source PDP price identity != currency of Ajax presentment price, stock,
// shipping, binding quote or checkout; no customer offer is ever promoted.
import {extractDecathlonScopedIdentity} from "./decathlon-product-evidence.mjs";
import {attestDecathlonVariantPrice} from "./decathlon-variant-price-ownership.mjs";
import {extractShopifyVariantState} from "./shopify-page-variant.mjs";

const HOST="decathlon.com.sa";
const MAX_AJAX_JSON_BYTES=512_000;
const MAX_ROBOTS_BYTES=128_000;
const ROBOT_UA="NawaaSourceAudit";

export const decathlonAjaxPolicyLimits=Object.freeze({
  maxAjaxJsonBytes:MAX_AJAX_JSON_BYTES,maxRobotsBytes:MAX_ROBOTS_BYTES,
  userAgent:ROBOT_UA,
  ajaxRequestsPerRun:1,
});
const safePath=raw=>{
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.hostname!==HOST||u.port&&u.port!=="443"||
       u.username||u.password||u.hash||u.search||
       !/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname))
      return null;
    return u.pathname.replace(/\/+$/,"");
  }catch{return null;}
};
export function deriveDecathlonAjaxUrl(pdpUrl){
  const p=safePath(pdpUrl);
  return p ? "https://"+HOST+p+".js":null;
}
function ruleMatches(path,pattern){
  if(!pattern)return false;
  const literal=pattern.endsWith("$")?pattern.slice(0,-1):pattern;
  const rx="^"+literal.split("*").map(x=>x.replace(/[|\\{}()[\]^$+?.]/g,"\\$&")).join(".*")+
    (pattern.endsWith("$")?"$":"");
  try{return new RegExp(rx).test(path);}catch{return false;}
}
/**
 * Policy evaluation is deliberately conservative. Missing/unreadable robot
 * rules are NOT permission. This is a crawler-compliance gate, not legal
 * permission to use any arbitrary endpoint or to bypass access controls.
 */
export function evaluateDecathlonRobotsPolicy(robotsText,ajaxUrl,{
  userAgent=ROBOT_UA
}={}){
  const denied=status=>({status,permitted:false});
  const target=safePath(ajaxUrl?.replace(/\.js$/,""));
  if(!target||!ajaxUrl?.endsWith(".js"))return denied("AJAX_TARGET_INVALID");
  if(typeof robotsText!=="string"||!robotsText.trim()||
     Buffer.byteLength(robotsText,"utf8")>MAX_ROBOTS_BYTES)
    return denied("ROBOTS_UNVERIFIED");
  const groups=[];let agents=[],rules=[],seenRule=false;
  const flush=()=>{if(agents.length)groups.push({agents:[...agents],rules:[...rules]});
    agents=[];rules=[];seenRule=false;};
  let sawUserAgent=false;
  for(const line of robotsText.split(/\r?\n/)){
    const cleaned=line.replace(/#.*$/,"").trim();
    if(!cleaned)continue;
    const m=cleaned.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if(!m)continue;
    const tag=m[1].toLowerCase(),value=m[2].trim();
    if(tag==="user-agent"){
      sawUserAgent=true;
      if(seenRule)flush();
      agents.push(value.toLowerCase());continue;
    }
    if(tag!=="allow"&&tag!=="disallow")continue;
    if(!agents.length)continue;
    seenRule=true;
    rules.push({type:tag,path:value});
  }
  flush();
  if(!sawUserAgent)return denied("ROBOTS_UNVERIFIED");
  const ua=String(userAgent).toLowerCase();
  const matched=groups.map(g=>({
    spec:Math.max(...g.agents.map(a=>a==="*"?0:ua.includes(a)?a.length:-1)),
    rules:g.rules,
  })).filter(g=>g.spec>=0);
  if(!matched.length)return denied("ROBOTS_AGENT_NOT_COVERED");
  const highest=Math.max(...matched.map(g=>g.spec));
  const rules=matched.filter(g=>g.spec===highest).flatMap(g=>g.rules);
  const path=new URL(ajaxUrl).pathname;
  let winner=null;
  for(const rule of rules){
    if(!rule.path||!ruleMatches(path,rule.path))continue;
    const specificity=rule.path.replace(/\*/g,"").replace(/\$$/,"").length;
    if(!winner||specificity>winner.specificity||
       specificity===winner.specificity&&rule.type==="allow"){
      winner={type:rule.type,specificity};
    }
  }
  return winner?.type==="disallow"?denied("ROBOTS_DISALLOW"):
    {status:"ROBOTS_PATH_ALLOWED",permitted:true};
}
const result=(status,extra={})=>Object.freeze({
  status,productOwned:false,selectedVariantMatched:false,
  variantPriceCentsMatched:false,ajaxPresentmentCurrencyVerified:false,
  merchantAvailableSignal:null,
  inventoryVerified:false,shippingVerified:false,
  deliveryDestinationVerified:false,shippingFeeVerified:false,
  checkoutVerified:false,quoteAllowed:false,
  trustedOfferEligible:false,customerVisible:false,
  sourceFreshnessCertified:false,
  ...extra,
});
const normalize=s=>String(s||"").normalize("NFKC").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();

export function compareDecathlonAjaxProductWithPdp({pdpHtml,pdpUrl,ajaxBody}={}){
  if(!safePath(pdpUrl))return result("INVALID_SOURCE_URL");
  const identity=extractDecathlonScopedIdentity(pdpHtml,pdpUrl);
  if(identity.status!=="SCOPED_IDENTITY_OBSERVED")
    return result("PDP_IDENTITY_UNVERIFIED");
  if(attestDecathlonVariantPrice(pdpHtml,pdpUrl).variantPriceOwned!==true)
    return result("PDP_VARIANT_PRICE_UNVERIFIED");
  if(typeof ajaxBody!=="string"||Buffer.byteLength(ajaxBody,"utf8")>MAX_AJAX_JSON_BYTES)
    return result("AJAX_BODY_INVALID");
  let doc;
  try{doc=JSON.parse(ajaxBody);}catch{return result("AJAX_BODY_INVALID");}
  if(!doc||typeof doc!=="object"||Array.isArray(doc)||!Array.isArray(doc.variants)||
     doc.variants.length===0||doc.variants.length>250)
    return result("AJAX_PRODUCT_INVALID");
  // Family IDs and title fields must not override a selected SKU identity.
  if(typeof doc.handle!=="string"||
     doc.handle!==safePath(pdpUrl).split("/").at(-1)||
     typeof doc.title!=="string"||
     normalize(doc.title)!==normalize(identity.title))
    return result("AJAX_PRODUCT_IDENTITY_CONFLICT");
  const matches=doc.variants.filter(v=>v&&String(v.id)===identity.selectedVariant);
  if(matches.length!==1)return result("AJAX_SELECTED_VARIANT_AMBIGUOUS");
  const chosen=matches[0];
  if(String(chosen.sku||"")!==identity.sku)
    return result("AJAX_SKU_CONFLICT");
  const url=new URL(pdpUrl);
  url.searchParams.set("variant",identity.selectedVariant);
  const variantPdp=extractShopifyVariantState(pdpHtml,url.href);
  if(!variantPdp?.shopifyVariantEvidence||
    variantPdp.offers?.sku!==identity.sku||
    variantPdp.offers?.priceCurrency!=="SAR"||
    !Number.isFinite(variantPdp.offers.price)||
    variantPdp.offers.price<=0)
    return result("PDP_VARIANT_PRICE_UNVERIFIED");
  // Shopify Ajax "price" is an integer in minor units of PRESENTMENT
  // currency. It does not include an independently validated currency code.
  // Never label this field SAR just because the PDP happens to use SAR.
  const price=chosen.price;
  if(!Number.isSafeInteger(price)||price<=0)
    return result("AJAX_PRICE_INVALID",{productOwned:true,selectedVariantMatched:true});
  const expectedMinor=Math.round(variantPdp.offers.price*100);
  const matched=Number.isSafeInteger(expectedMinor)&&price===expectedMinor;
  if(!matched)return result("PDP_AJAX_PRICE_MISMATCH",{
    productOwned:true,selectedVariantMatched:true,
  });
  const hasFlag=typeof chosen.available==="boolean";
  return result(hasFlag?"AJAX_VARIANT_AVAILABLE_SIGNAL":"AJAX_VARIANT_AVAILABILITY_UNKNOWN",{
    productOwned:true,selectedVariantMatched:true,
    variantPriceCentsMatched:true,
    merchantAvailableSignal:hasFlag?chosen.available:null,
  });
}
