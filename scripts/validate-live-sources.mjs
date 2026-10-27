import { searchFreeStorefrontById, inspectSamsungSearchDiscovery, extractSamsungSearchOffers } from "../server/providers/free-storefronts.mjs";

const CASES = [
  // Saudi/GCC certification batch: prioritize sources that can materially
  // increase shopper recall before the wider global validation matrix.
  ["amazon-sa","iphone 17"],["lulu-sa","iphone 17"],["samsung-sa","galaxy s25"],
  ["virgin-sa","airpods"],["amazon-ae","iphone 17"],["noon-ae","iphone 17"],
  ["sharafdg-ae","hp laptop"],["virgin-ae","iphone 17"],["virgin-ae","airpods"],["virgin-ae","apple watch"],["virgin-ae","macbook"],["virgin-ae","playstation 5"],["xcite-kw","hp laptop"],
  ["lulu-ae","iphone 17"],["carrefour-ae","iphone 17"],["microless-ae","iphone 17"],["jumbo-ae","iphone 17"],
  ["goldenscent-sa","dior sauvage"],["ounass-sa","nike shoes"],["sunandsand-sa","nike shoes"],
  ["virgin-sa","airpods"],["homecentre-sa","office chair"],["mumzworld-sa","stroller"],
  ["asos-global","nike air max"],["farfetch-sa","gucci shoes"],["etsy-global","silver necklace"],
  ["newegg-global","gaming laptop"],["bhphoto-us","canon camera"],["walmart-us","airpods"],
  ["bestbuy-us","apple airpods 4"],["nike-sa","nike shoes"],["adidas-sa","adidas shoes"],
  ["sephora-sa","dior perfume"],["namshi-sa","nike v5 runner"],["centrepoint-sa","leather chair"],
  ["maxfashion-sa","shoes"],["decathlon-sa","running shoes"],["niceone-sa","dior perfume"],
  ["netaporter-global","nike shoes"],["mrporter-global","nike shoes"],["mytheresa-global","gucci shoes"],
  ["ssense-global","nike shoes"],["jomashop-global","seiko watch"],["fragrancex-global","dior perfume"],
  ["lookfantastic-global","cerave cleanser"],["cultbeauty-global","niod serum"],["stockx-global","nike shoes"],["goat-global","nike shoes"],
  ["amazon-ae","airpods"],["noon-ae","airpods"],["sharafdg-ae","airpods"],
  ["virgin-ae","airpods"],["xcite-kw","airpods"],["lulu-ae","airpods"],
];

// One-time bounded source-discovery research within CI, not a production
// crawler or pricing fallback. Alternative query variants do not certify any
// offer unless the ordinary price, product and source evidence gates do so.
async function probeSamsungSearchVariants() {
  const alternatives=["s25","SM-S931B"]; // known first-party S25 series SKU prefix
  const results=[];
  for(const alternative of alternatives) {
    const endpoint=new URL("https://www.samsung.com/sa_en/search/");
    endpoint.searchParams.set("searchvalue",alternative);
    try {
      const response=await fetch(endpoint.href,{
        headers:{ accept:"text/html,application/xhtml+xml", "accept-language":"en-US,en;q=0.9" },
        signal:AbortSignal.timeout(7000),
      });
      const type=response.headers.get("content-type") || "";
      if(!response.ok || !/text\/html|application\/xhtml\+xml/i.test(type)) {
        results.push({searchTerm:alternative,status:"UNAVAILABLE",httpStatus:response.status});continue;
      }
      const html=await response.text();
      if(html.length>5000000) {
        results.push({searchTerm:alternative,status:"OVERSIZE"});continue;
      }
      const links=inspectSamsungSearchDiscovery(html,endpoint.href,"galaxy s25");
      const priced=extractSamsungSearchOffers(html,"galaxy s25");
      results.push({
        searchTerm:alternative,
        status:"PROBED",
        htmlBytes:new TextEncoder().encode(html).byteLength,
        exactModelBuyPdp:links.exactModelBuyPdp,
        offModelBuyPdp:links.offModelBuyPdp,
        unknownModelBuyPdp:links.unknownModelBuyPdp,
        candidateSampleTruncated:links.sampleTruncated,
        exactModelPaths:links.exactModelPaths,
        pricedStructuredCandidates:priced.length,
      });
    } catch(error) {
      results.push({searchTerm:alternative,status:"UNAVAILABLE",
        reason:error?.name==="TimeoutError"?"TIMEOUT":"FETCH_FAILED"});
    }
  }
  return results;
}

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
    rows.push({store,query,status,candidates:result.candidates,offers:offers.length,valid:valid.length,ms:Date.now()-started,error:result.diagnostics?.primarySearchError || null,
      candidateSamples:result.diagnostics?.candidateSamples || [],
      failureSamples:result.diagnostics?.failureSamples || [],
      unpricedSamples:result.diagnostics?.unpricedSamples || [],
      queryFilter:result.diagnostics?.queryFilter || null,
      // Sanitary, bounded URL-path evidence to diagnose model recall. Never
      // infer a product price from an unselected Samsung family buy page.
      ...(store==="samsung-sa" ? { samsungDiscovery:result.diagnostics?.samsungDiscovery || null } : {}),
      // Preserve bounded source-provided rejection evidence. Without these
      // first-five titles/reasons a 51→0 Amazon run cannot distinguish a
      // relevance filter from a source response change.
      queryFilterSamples:result.diagnostics?.queryFilterSamples || [],
      ...(store==="samsung-sa" && valid.length===0
        ? {alternateSearchDiagnostics:await probeSamsungSearchVariants()} : {})});
  } catch (error) {
    rows.push({store,query,status:"PROBED_FAILED",candidates:0,offers:0,valid:0,ms:Date.now()-started,error:error?.message || String(error)});
  }
}
console.table(rows);
const failed = rows.filter((row) => row.status === "PROBED_FAILED").length;
const probedOnly = rows.filter((row) => row.status === "PROBED").length;
const liveSources = rows.filter((row) => row.status === "LIVE_VALIDATED").map((row) => row.store);
const report = {checked:CASES.length,liveValidated:live,liveSources,probedOnly,failed,rows};
console.log(JSON.stringify(report,null,2));
await import("node:fs").then(({writeFileSync}) => writeFileSync("live-source-validation.json", JSON.stringify(report,null,2)));
const minimumLive = Number(process.env.MIN_LIVE_SOURCES || 8);
if (live < minimumLive) {
  console.error(`VALIDATION_GATE_FAILED: ${live}/${minimumLive} required sources reached LIVE_VALIDATED.`);
  process.exitCode = 1;
}
