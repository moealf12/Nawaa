// Manual/CI-only read-only proof. Does NOT run from /api/search or write persistence.
import { writeFile } from "node:fs/promises";
import { searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";
import { proveCarrefourAeImages, verifyCarrefourAeImageHead } from "../server/source-inspector/carrefour-ae-image-proof.mjs";

const QUERIES = ["iPhone 17", "Laptop"];
const SAMPLE_PER_QUERY = 4; // 8 total PDP reads maximum
const report = {
  source:"carrefour-ae", mode:"isolated-read-only",
  observedAt:new Date().toISOString(), searches:[], limits:{
    queries:2, perQuery:4, maxPdpFetches:8, maxPdpConcurrency:2,
  },
};
let totalOffers = 0, checked = 0, accepted = 0;
for (const query of QUERIES) {
  try {
    const search = await searchFreeStorefrontById("carrefour-ae", query, {perStore:64});
    const offers = search.offers || [];
    const proof = await proveCarrefourAeImages(offers,{
      limit:SAMPLE_PER_QUERY, concurrency:2,
      imageHead:verifyCarrefourAeImageHead,
    });
    totalOffers += offers.length;
    checked += proof.attempted;
    accepted += proof.accepted;
    report.searches.push({
      query, candidates:search.candidates,
      extracted:offers.length, sampled:proof.attempted,
      imagesAccepted:proof.accepted, imagesRejected:proof.rejected,
      rejectionReasons:proof.results.filter(x=>!x.accepted).reduce((out,item)=>{
        out[item.reason] = (out[item.reason] || 0) + 1;
        return out;
      },{}),
      // Audit small samples without leaking page HTML or seller data.
      samples:offers.slice(0,SAMPLE_PER_QUERY).map((offer,index)=>({
        productId:offer.sourceUrl?.match(/\/p\/(\d+)/)?.[1] || null,
        sourceUrl:offer.sourceUrl, originalPriceAED:offer.originalProductPrice,
        title:offer.title, image:proof.results[index]?.image || null,
        accepted:Boolean(proof.results[index]?.accepted),
        imageHttpVerified:Boolean(proof.results[index]?.imageHttpVerified),
        imageContentType:proof.results[index]?.imageContentType || null,
        reason:proof.results[index]?.reason || "not_checked",
      })),
    });
  } catch (error) {
    report.searches.push({
      query, error:String(error?.message || error).slice(0, 240),
      extracted:0, sampled:0, imagesAccepted:0,
    });
  }
}
report.totals = {
  extracted:totalOffers, sampled:checked, imagesAccepted:accepted,
  imagesRejected:checked-accepted,
  sampledImageCoverage:checked ? accepted / checked : 0,
};
report.certified = false; // Sampling alone NEVER enables a merchant source.
const file = process.argv[2] || "carrefour-ae-image-proof.json";
await writeFile(file, JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report.totals));
console.log("Evidence artifact: "+file);
if (checked === 0 || accepted === 0) process.exitCode = 1;
