// R04-P54. Unknown product vocabulary must not be artificially limited to
// general marketplaces. Discover *existing approved specialist storefronts*
// without new hosts, translation guesses or additional request retries.
// Merchants are selected using source-declared categories; product truth is
// still established exclusively by the original buyer's query and PDP evidence.
import {createHash} from "node:crypto";
import {normalizeSearchQuery,parseSearchIntent} from "../src/search-query.mjs";

const MAX_SPECIALISTS=6;
const ALL_CATEGORIES=new Set([
  "phone","tablet","laptop","desktop","monitor","audio","camera","tv",
  "console","game","accessory","network","appliance","book","tool",
  "beauty","perfume","jewelry","watch","shoes","clothing","bag","toy",
  "baby","home","furniture","kitchen","office","sports","grocery",
  "pet","automotive","coffee","vacuum","printer","projector",
]);
function safeStoreId(value){
  return typeof value==="string"&&/^[a-z0-9][a-z0-9-]{1,79}$/.test(value);
}
function eligibleCategories(store){
  if(!Array.isArray(store?.categories))return [];
  return [...new Set(store.categories.filter(v=>
    typeof v==="string"&&ALL_CATEGORIES.has(v)))];
}
function hashIndex(input,n){
  return n?createHash("sha256").update(input).digest().readUInt32BE(0)%n:0;
}
function rotate(list,shift){
  return [...list.slice(shift),...list.slice(0,shift)];
}
/**
 * @param {object} options
 * @returns immutable low-cardinality plan; never raw query or offer details.
 * Categories unknown to the registry are not silently invented as a match.
 */
export function planUnknownCategorySpecialists({
  query,stores=[],alreadySearchedIds=[],excludedStoreIds=[],
  maxStores=MAX_SPECIALISTS,
}={}){
  const normalized=normalizeSearchQuery(query||"");
  if(!normalized)return {storeIds:[],reason:"EMPTY_QUERY",categoryBuckets:0,chosenBuckets:0};
  const intent=parseSearchIntent(normalized);
  if(intent.category || intent.brand){
    return {storeIds:[],reason:"CLASSIFIED_QUERY",categoryBuckets:0,chosenBuckets:0};
  }
  if(!Array.isArray(stores)||stores.length>500||
     !Array.isArray(alreadySearchedIds)||!Array.isArray(excludedStoreIds))
    throw Error("R04_P54_INVALID_SOURCE_REGISTRY");
  const maximum=Number.isInteger(maxStores)
    ? Math.max(0,Math.min(MAX_SPECIALISTS,maxStores)):0;
  if(maximum===0)return {storeIds:[],reason:"BUDGET_DISABLED",categoryBuckets:0,chosenBuckets:0};
  const blocked=new Set([...alreadySearchedIds,...excludedStoreIds]);
  const candidates=stores.filter(s=>safeStoreId(s?.id)&&
    !blocked.has(s.id)&&eligibleCategories(s).length);
  const byCategory=new Map();
  for(const store of candidates){
    for(const category of eligibleCategories(store)){
      if(!byCategory.has(category))byCategory.set(category,[]);
      byCategory.get(category).push(store.id);
    }
  }
  // Stable, seeded rotation gives different UNKNOWN queries exploratory
  // coverage across categories instead of always selecting the first tech
  // retailer. Repeating an identical query selects the identical window.
  const buckets=[...byCategory.keys()].sort();
  const order=rotate(buckets,hashIndex(normalized,buckets.length));
  const chosen=[],chosenSet=new Set(),chosenBuckets=new Set();
  // First attempt one approved specialist from distinct category buckets;
  // later slots never repeat a merchant because it serves several categories.
  for(const category of order){
    const storesForCategory=byCategory.get(category).filter(id=>!chosenSet.has(id));
    if(!storesForCategory.length)continue;
    const id=storesForCategory[hashIndex(normalized+"|"+category,storesForCategory.length)];
    if(chosenSet.has(id))continue;
    chosen.push(id);chosenSet.add(id);chosenBuckets.add(category);
    if(chosen.length>=maximum)break;
  }
  return {
    storeIds:chosen.slice(0,maximum),reason:chosen.length?"CATEGORY_DIVERSITY_EXPLORATION":"NO_ACCESSIBLE_SPECIALISTS",
    categoryBuckets:buckets.length,chosenBuckets:chosenBuckets.size,
    selection:"QUERY_STABLE_APPROVED_SOURCE_CATEGORY_ROUND_ROBIN",
  };
}

// Source-native model recall is the ONLY reversible query shortening allowed
// without a multilingual dictionary or verified merchant language contract.
// A manufacturer-like ASCII model token in an otherwise unfamiliar-script
// query is exact source-owned RETRIEVAL syntax, not translation of meaning.
// Original shopper query is ALWAYS the matching/condition/identity contract.
export function planSourceNativeModelQuery(query,{allowModelRecall=false}={}){
  const raw=typeof query==="string"?query:"";
  const primary=normalizeSearchQuery(raw);
  // An ORIGINAL query must remain byte-for-byte unchanged. Search APIs may
  // treat case or accent differences as material (e.g. Noon q=Laptop).
  const fallback={query:raw,mode:"ORIGINAL_QUERY",constraintsPreserved:true};
  if(!allowModelRecall||!primary)return fallback;
  const intent=parseSearchIntent(primary);
  if(intent.category||intent.brand)return fallback;
  const foreignScript=/[\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}]/u.test(primary);
  if(!foreignScript)return fallback;
  const tokens=primary.split(" ");
  const ids=[...new Set(tokens.filter(t=>t.length>=5&&t.length<=24&&
    /^[a-z0-9]+$/.test(t)&&/[a-z]/.test(t)&&/[0-9]/.test(t) &&
    !/^(?:iphone|galaxy|ps5)/.test(t)))];
  if(ids.length!==1)return fallback;
  return {query:ids[0],mode:"SOURCE_NATIVE_EXACT_MODEL_TOKEN",
    constraintsPreserved:false,
    // This is a discovery-only broadening. Do not send this shortened query
    // to classification, source-price identity or final ranking.
    finalMatchMustUseOriginal:true,
  };
}
