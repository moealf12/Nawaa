// Targeted Saudi-retailer source coverage check. No price promotion, PDP fetch,
// stock assertion, persistence, new source adapter or production search changes.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { searchJarir } from "../server/providers/jarir.mjs";
import { searchExtraUnbxd } from "../server/providers/extra-unbxd.mjs";
import { normalizeSearchQuery, queryMatchReasons } from "../src/search-query.mjs";
import { sameOfferIdentity } from "../server/product-identity.mjs";
import { resolveProductUrl } from "../server/url-resolver.mjs";

const SOURCE_RULES=Object.freeze({
  "jarir-direct":Object.freeze({
    merchant:"Jarir",hostname:"www.jarir.com",
    path:/^\/sa-en\/[^?#]+-\d{5,8}\.html$/i,
  }),
  "extra-unbxd":Object.freeze({
    merchant:"eXtra",hostname:"www.extra.com",
    path:/^\/en-sa\/(?:p\/\d+|[^?#]+\/p\/\d+)\/?$/i,
  }),
});
const QUERY="galaxy s25";
const LIMIT=24;

export function classifyS25CatalogOffer(provider, offer){
  const invalid=reason=>({eligible:false,reason,priceVerifiedAgainstPdp:false,deliveryVerified:false});
  const rule=SOURCE_RULES[provider];
  if(!rule || offer?.provider!==provider || offer?.merchant!==rule.merchant)
    return invalid("MERCHANT_IDENTITY_CONFLICT");
  let parsed;
  try {parsed=new URL(offer?.sourceUrl||"");} catch {return invalid("UNSAFE_SOURCE_URL");}
  if(parsed.protocol!=="https:" || parsed.hostname!==rule.hostname ||
     parsed.username || parsed.password || (parsed.port&&parsed.port!=="443") ||
     !rule.path.test(parsed.pathname))return invalid("UNSAFE_SOURCE_URL");

  const title=normalizeSearchQuery(offer?.title||"");
  if(!/\bgalaxy s25\b/.test(title) ||
     /\bgalaxy s25 (?:ultra|fe|edge|plus)\b/.test(title) ||
     /\b(?:case|cover|protector|compatible with|replacement|screen protector)\b/.test(title))
    return invalid("PRODUCT_SUBJECT_MISMATCH");
  const titleAndStorage=normalizeSearchQuery([offer?.title,offer?.specs?.storage].filter(Boolean).join(" "));
  if(!/\b256\s*gb\b/.test(titleAndStorage) ||
     /\b(?:128|512|1024)\s*gb\b/.test(titleAndStorage))
    return invalid("STORAGE_CONFLICT");
  const model=String(offer?.specs?.modelNumber||"").replace(/[^a-z0-9]/gi,"").toUpperCase();
  if(model && !model.startsWith("SMS931"))return invalid("MODEL_CODE_CONFLICT");
  if(queryMatchReasons("galaxy s25 256gb",offer).length)
    return invalid("QUERY_MODEL_CONFLICT");
  if(offer?.condition!=="new" ||
     offer?.currency!=="SAR" || offer?.originalCurrency!=="SAR" ||
     !Number.isFinite(offer?.productPrice) || offer.productPrice<=0 ||
     !Number.isFinite(offer?.originalProductPrice) ||
     offer.originalProductPrice!==offer.productPrice)
    return invalid("CATALOG_PRICE_INCONSISTENT");
  return {eligible:true,reason:"SOURCE_CATALOG_CANDIDATE",
    priceVerifiedAgainstPdp:false,deliveryVerified:false};
}

// Page truth must be the *same* source-owned selected product, not the S25
// family landing price, sibling variant, struck-through RRP or instalments.
export function assessS25PdpCorroboration(provider,catalog,page){
  if(!classifyS25CatalogOffer(provider,catalog).eligible)
    return "CATALOG_IDENTITY_INVALID";
  if(!page || !sameOfferIdentity(catalog,page))
    return "IDENTITY_MISMATCH";
  if(queryMatchReasons("galaxy s25 256gb",page).length)
    return "PDP_MODEL_OR_STORAGE_CONFLICT";
  if(!Number.isFinite(page.productPrice) || page.productPrice<=0 ||
     !Number.isFinite(page.originalProductPrice) ||
     page.currency!=="SAR" || page.originalCurrency!=="SAR")
    return "UNPRICED_PDP";
  if(page.productPrice!==catalog.productPrice ||
     page.originalProductPrice!==catalog.originalProductPrice)
    return "PRICE_MISMATCH";
  return "PDP_PRICE_CORROBORATED";
}

const callJarir=(q,signal)=>searchJarir(q,LIMIT,q,{signal});
const callExtra=(q,signal)=>searchExtraUnbxd(q,LIMIT,q,{signal});

export async function auditS25Sources({searchJarir:jarir=callJarir,
  searchExtraUnbxd:extra=callExtra,resolvePage=null}={}){
  const defs=[
    {provider:"jarir-direct",searcher:jarir},
    {provider:"extra-unbxd",searcher:extra},
  ];
  const sources=await Promise.all(defs.map(async ({provider,searcher})=>{
    let result;
    try {
      // Shared per-adapter timeout; provider's own abort handling remains in charge.
      result=await searcher(QUERY,AbortSignal.timeout(9500));
      if(!result || !Array.isArray(result.offers))throw Error("UNEXPECTED_SOURCE_RESPONSE");
      if(result.offers.length===0 && Array.isArray(result.errors) && result.errors.length)
        throw Error("SOURCE_TRANSPORT_OR_PARSING_FAILURE");
    } catch {
      return {provider,status:"UNAVAILABLE",returned:null,eligible:null,
        strictRejected:null,duplicates:null,hasCatalogPricingEvidence:false};
    }
    const seen=new Set();
    let accepted=0,rejected=0,duplicates=0,firstCandidate=null;
    for(const item of result.offers.slice(0,LIMIT)){
      const evaluation=classifyS25CatalogOffer(provider,item);
      if(!evaluation.eligible){rejected++;continue;}
      // Deduplicate one SKU URL per merchant, without conflating distinct
      // storage/colour variant IDs or fabricating prices.
      const key=item.sourceUrl;
      if(seen.has(key)){duplicates++;continue;}
      seen.add(key);
      if(!firstCandidate)firstCandidate=item;
      accepted++;
    }
    let pdpProbe={attempted:0,status:"NOT_REQUESTED"};
    if(resolvePage && firstCandidate){
      try {
        // At most one PDP per source and only after model/SKU catalog gates.
        const page=await resolvePage(firstCandidate,AbortSignal.timeout(6500));
        pdpProbe={attempted:1,status:assessS25PdpCorroboration(provider,firstCandidate,page)};
      } catch {
        pdpProbe={attempted:1,status:"PDP_UNAVAILABLE"};
      }
    }
    return {
      provider,status:accepted?"CATALOG_CANDIDATES":"NO_CATALOG_CANDIDATE",
      returned:result.offers.length,eligible:accepted,
      strictRejected:rejected,duplicates,
      hasCatalogPricingEvidence:accepted>0,pdpProbe,
    };
  }));
  return {
    schemaVersion:"nawaa.s25-source-coverage.v1",queryModel:"galaxy s25",
    targetStorage:"256 GB",market:"SA",
    sources,
    claims:{merchantInventoryVerified:false,s25DeliveryVerified:false,
      pdpPriceVerified:sources.some(x=>x.pdpProbe?.status==="PDP_PRICE_CORROBORATED"),
      canPromoteToTrustedOffer:false},
    caveat:sources.some(x=>x.pdpProbe?.status==="PDP_PRICE_CORROBORATED")
      ? "One sampled SKU at each eligible source was checked; corroboration applies only to exact tested SKU(s). Availability, delivery and all other variants remain unverified."
      : "Catalog-price candidates have NOT been certified against live product PDPs, delivery or availability.",
  };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await auditS25Sources({
    resolvePage:(offer,signal)=>resolveProductUrl(offer.sourceUrl,{signal}),
  });
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
