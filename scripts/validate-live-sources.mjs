import { searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";

const CASES = [
  ["goldenscent-sa","dior perfume"],["ounass-sa","nike shoes"],["sunandsand-sa","nike shoes"],
  ["virgin-sa","airpods"],["homecentre-sa","office chair"],["mumzworld-sa","baby stroller"],
  ["netaporter-global","nike shoes"],["mrporter-global","nike shoes"],["mytheresa-global","nike shoes"],
  ["ssense-global","nike shoes"],["jomashop-global","seiko watch"],["fragrancex-global","dior perfume"],
  ["lookfantastic-global","skincare"],["cultbeauty-global","skincare"],["stockx-global","nike shoes"],["goat-global","nike shoes"],
];

let live = 0;
const rows = [];
for (const [store, query] of CASES) {
  const started = Date.now();
  try {
    const result = await searchFreeStorefrontById(store, query, { perStore: 3 });
    const offers = result.offers || [];
    const valid = offers.filter(o => o.title && o.sourceUrl && o.image && Number.isFinite(o.productPrice) && o.productPrice > 0);
    const status = valid.length ? "LIVE_VALIDATED" : "PROBED";
    if (valid.length) live++;
    rows.push({store,query,status,candidates:result.candidates,offers:offers.length,valid:valid.length,ms:Date.now()-started,error:result.diagnostics?.primarySearchError || null});
  } catch (error) {
    rows.push({store,query,status:"PROBED_FAILED",candidates:0,offers:0,valid:0,ms:Date.now()-started,error:error?.message || String(error)});
  }
}
console.table(rows);
console.log(JSON.stringify({checked:CASES.length,liveValidated:live,rows},null,2));
// Network/storefront failures are evidence, not a CI code regression. This workflow
// records them so a source is never promoted merely because it exists in the catalog.
