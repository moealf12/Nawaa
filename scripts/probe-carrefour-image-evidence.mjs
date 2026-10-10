// One controlled, network-bounded diagnostic probe. No DB, price writes, worker,
// scheduled job, customer API changes, or image downloading.
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {extractCarrefourSearchOffers} from "../server/providers/free-storefronts.mjs";
import {inspectCarrefourImageEvidence} from "../server/tooling/carrefour-image-evidence.mjs";
const EXPECTED="https://www.carrefouruae.com/mafuae/en/search?keyword=iphone%2017";
if(process.env.NAWAA_SINGLE_CARREFOUR_IMAGE_PROBE!=="1"||
 process.env.DATABASE_URL||process.env.NAWAA_ENABLE_BACKGROUND_JOBS==="1")
 throw new Error("offline_single_source_probe_disabled");
const response=await fetchHtmlSafe(EXPECTED,0,{maxRedirects:0});
if(response.finalUrl!==EXPECTED)throw new Error("carrefour_unexpected_final_url");
const html=response.html;
const offers=extractCarrefourSearchOffers(html,"iphone 17");
const cases=offers.slice(0,5).map(offer=>({
 title:offer.title.slice(0,130),pdpId:offer.productId,
 originalSearchImagePresent:typeof offer.image==="string"&&offer.image.startsWith("https://"),
 evidence:inspectCarrefourImageEvidence(html,{sourceUrl:offer.sourceUrl,title:offer.title})
}));
const result={mode:"one_off_carrefour_html_image_evidence",
 oneHttpGet:true,redirectsAllowed:0,bytes:Buffer.byteLength(html),
 inspected:cases.length,offersOnPage:offers.length,
 productionChanges:0,merchantImageDownloads:0,cases};
console.log(JSON.stringify(result,null,2));
if(cases.length===0)process.exitCode=1;
