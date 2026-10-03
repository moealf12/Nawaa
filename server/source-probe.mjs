import { currentSources } from "./source-config.mjs";
import { auditSource } from "./audit-contract.mjs";
import { resolveProductUrl } from "./url-resolver.mjs";
import { searchExtraUnbxd } from "./providers/extra-unbxd.mjs";
import { searchJarir } from "./providers/jarir.mjs";
import { searchSharafDG } from "./providers/sharafdg.mjs";
import { searchSwarovskiSaudi } from "./providers/swarovski.mjs";
import { searchEbayWorldwide } from "./providers/ebay.mjs";
import { searchNoon } from "./providers/noon.mjs";
import { searchCarrefour } from "./providers/carrefour.mjs";
import { searchFreeStorefrontById } from "./providers/free-storefronts.mjs";
import { searchShopifyStore,configuredShopifyStores } from "./providers/shopify.mjs";
import { searchAmazonCreators } from "./providers/amazon-creators.mjs";

const directSearchers={
  "extra-unbxd":searchExtraUnbxd,"jarir-direct":searchJarir,"sharafdg-algolia":searchSharafDG,
  "swarovski-direct":searchSwarovskiSaudi,"ebay":searchEbayWorldwide,
  "noon-catalog":searchNoon,"carrefour-ksa":searchCarrefour,
};

export async function probeSource({sourceId,query,expected="results",revision=null,verifyPages=true,timeoutMs=null,sources=currentSources(),searchers=directSearchers,resolvePage=resolveProductUrl}) {
  const source=sources.find(item=>item.id===sourceId);
  if(!source) throw new Error("Unknown source ID");
  const search=async normalizedQuery=>{
    if(source.adapter?.startsWith("free-storefronts:")) return searchFreeStorefrontById(source.adapter.slice(17),normalizedQuery,{perStore:10});
    if(source.adapter?.startsWith("amazon-creators:")) return searchAmazonCreators(normalizedQuery,{marketId:source.id});
    if(source.adapter === "shopify") {
      const store=configuredShopifyStores().find(item=>"shopify:"+(item.id || item.name)===source.id);
      if(!store) throw new Error("Shopify store configuration unavailable");
      return searchShopifyStore(normalizedQuery,store);
    }
    const run=searchers[source.adapter];
    if(!run) throw new Error("Source search adapter unavailable");
    return run(normalizedQuery);
  };
  return auditSource({source,query,search,expected,revision,timeoutMs,verifyPage:verifyPages ? resolvePage : null});
}
