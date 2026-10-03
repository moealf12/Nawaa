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
    // SKU is useful identity metadata, but it is not a requirement for a usable price result.
    // A live source must return the shopper-facing essentials: product, URL, image and price.
    const valid = offers.filter(o =>
      typeof o.title === "string" && o.title.trim().length >= 3 &&
      typeof o.sourceUrl === "string" && /^https:\/\//i.test(o.sourceUrl) &&
      typeof o.image === "string" && /^https?:\/\//i.test(o.image) &&
      Number.isFinite(o.productPrice) && o.productPrice > 0
    );
    const status = valid.length ? "LIVE_VALIDATED" : "PROBED";
    if (valid.length) live++;
    rows.push({store,query,status,candidates:result.candidates,offers:offers.length,valid:valid.length,ms:Date.now()-started,error:result.diagnostics?.primarySearchError || null});
  } catch (error) {
    rows.push({store,query,status:"PROBED_FAILED",candidates:0,offers:0,valid:0,ms:Date.now()-started,error:error?.message || String(error)});
  }
}
console.table(rows);
const failed = rows.filter((row) => row.status === "PROBED_FAILED").length;
const probedOnly = rows.filter((row) => row.status === "PROBED").length;
const report = {checked:CASES.length,liveValidated:live,probedOnly,failed,rows};
console.log(JSON.stringify(report,null,2));
await import("node:fs").then(({writeFileSync}) => writeFileSync("live-source-validation.json", JSON.stringify(report,null,2)));
if (live === 0) {
  console.error("VALIDATION_GATE_FAILED: zero sources reached LIVE_VALIDATED. Discovery entries must not be promoted to production.");
  process.exitCode = 1;
}
