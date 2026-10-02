import { searchExtraUnbxd } from "../server/providers/extra-unbxd.mjs";
import { searchJarir } from "../server/providers/jarir.mjs";
import { searchSharafDG } from "../server/providers/sharafdg.mjs";
import { searchSwarovskiSaudi } from "../server/providers/swarovski.mjs";

const probes = [
  { id:"extra", name:"eXtra Saudi", query:"iphone", run:(q)=>searchExtraUnbxd(q, 24) },
  { id:"jarir", name:"Jarir Saudi", query:"iphone", run:(q)=>searchJarir(q, 24) },
  { id:"sharafdg-sa", name:"Sharaf DG Saudi", query:"iphone", run:(q)=>searchSharafDG(q, 32) },
  { id:"swarovski-sa", name:"Swarovski Saudi", query:"swarovski necklace", run:(q)=>searchSwarovskiSaudi(q, 32) },
];

function verifiedOffer(offer) {
  const price = Number(offer?.productPrice);
  return Boolean(
    offer &&
    /^https?:\/\//i.test(String(offer.sourceUrl || "")) &&
    Number.isFinite(price) && price > 0 &&
    String(offer.currency || "").toUpperCase() === "SAR"
  );
}

const results = [];
for (const probe of probes) {
  const started = Date.now();
  try {
    const response = await probe.run(probe.query);
    const offers = Array.isArray(response?.offers) ? response.offers : [];
    const verified = offers.filter(verifiedOffer);
    const errors = Array.isArray(response?.errors) ? response.errors : [];
    results.push({
      id:probe.id, name:probe.name, query:probe.query,
      status:verified.length ? "LIVE_VERIFIED" : (errors.length ? "FAILING" : "CONNECTED_NO_CANDIDATES"),
      candidates:offers.length, verifiedOffers:verified.length, durationMs:Date.now()-started,
      errors:errors.slice(0,3),
      sampleOffers:verified.slice(0,3).map((offer)=>({title:offer.title,price:offer.productPrice,currency:offer.currency,sourceUrl:offer.sourceUrl})),
    });
  } catch (error) {
    results.push({id:probe.id,name:probe.name,query:probe.query,status:"FAILING",candidates:0,verifiedOffers:0,durationMs:Date.now()-started,error:error instanceof Error ? error.message : String(error),sampleOffers:[]});
  }
}

const report={observedAt:new Date().toISOString(),audited:results.length,liveVerified:results.filter((r)=>r.status==="LIVE_VERIFIED").length,results};
console.log(JSON.stringify(report,null,2));
if (process.argv[2]) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(process.argv[2], JSON.stringify(report,null,2)+"\n", "utf8");
}