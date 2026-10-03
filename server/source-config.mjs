import { buildSourceRegistry } from "../src/source-registry.mjs";
import { ebayConfigured } from "./providers/ebay.mjs";
import { shopifyConfigured, configuredShopifyStores } from "./providers/shopify.mjs";
import { amazonCreatorsConfigured, configuredAmazonCreatorMarkets } from "./providers/amazon-creators.mjs";
import { configuredFreeStorefronts } from "./providers/free-storefronts.mjs";
import { noonConfigured } from "./providers/noon.mjs";
import { carrefourConfigured } from "./providers/carrefour.mjs";

export function configuredProviders() {
  return ["extra-unbxd","jarir-direct","sharafdg-algolia","swarovski-direct",
    ...(amazonCreatorsConfigured() ? configuredAmazonCreatorMarkets().map(market=>"amazon-creators:"+market.id) : []),
    ...configuredFreeStorefronts().map(store=>"free-storefronts:"+store.id),
    ...(carrefourConfigured() ? ["carrefour-ksa"] : []),
    ...(noonConfigured() ? ["noon-catalog"] : []),
    ...(ebayConfigured() ? ["ebay"] : []),
    ...(shopifyConfigured() ? ["shopify"] : [])];
}
export function currentSources() {
  return buildSourceRegistry({configuredProviders:configuredProviders(),shopifyStores:configuredShopifyStores()});
}
