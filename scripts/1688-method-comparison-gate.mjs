// Distinguish a successful live diagnostic run from evidence of catalog access.
// Never pass on HTTP 200 alone, a redirect, a JS/login shell, or synthetic tests.
import {readFile} from "node:fs/promises";
const files=["1688-jarir-style-live.json","1688-noon-uae-style-live.json"];
const [jarir,noon]=await Promise.all(files.map(async file=>JSON.parse(await readFile(file,"utf8"))));
const jarirLive=jarir.searchesAttempted>0&&jarir.searchHttp===200&&
  jarir.evidence?.state==="UNPRICED_CATALOG_LINKS_OBSERVED"&&
  jarir.evidence?.links>0;
const noonLive=(noon.stages||[]).some(s=>
  s.id!=="www_warmup"&&s.status===200&&
  s.state==="PRODUCT_LINKS_OBSERVED_UNPRICED"&&
  s.evidence?.parserAgreement===true&&
  s.evidence?.intersectionProductLinks>0);
const evidence={
  schema:"nawaa.1688.method-comparison.acceptance.v1",
  jarir:{searchAttempted:jarir.searchesAttempted>0,
    productLinksObserved:jarir.evidence?.links||0,qualified:jarirLive},
  noonUae:{searchAttempted:(noon.stages||[]).some(x=>x.id.includes("search")),
    productLinksObserved:(noon.stages||[]).reduce((n,x)=>n+(x.evidence?.intersectionProductLinks||0),0),
    qualified:noonLive},
  methodsAttempted:["jarir_html","noon_uae_html_session"],
  diagnosticCollected:true,
  liveSearchLinkAcquisitionPassed:jarirLive||noonLive,
  independentlyVerifiedUnitPrices:0,
  customerPublishable:false,
  verdict:jarirLive||noonLive?"UNPRICED_LIVE_DISCOVERY_ONLY":"LIVE_ACQUISITION_NOT_PROVEN",
};
console.log(JSON.stringify(evidence,null,2));
if(!evidence.liveSearchLinkAcquisitionPassed)process.exitCode=1;
