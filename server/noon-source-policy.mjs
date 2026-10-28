import {noonConfigured} from "./providers/noon.mjs";
import {configuredFreeStorefronts} from "./providers/free-storefronts.mjs";

// Once the evidence-bound official Saudi source exists, a legacy catalog
// connector cannot independently inject a duplicate/unchecked Noon price.
// Honor the existing env without making a second merchant network request.
export function legacyNoonProviderActive(){
  return noonConfigured() &&
    !configuredFreeStorefronts().some(store=>store.id==="noon-sa");
}
