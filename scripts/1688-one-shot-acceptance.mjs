// Source read-only diagnostic acceptance: a valid HTTP response without a
// first-party product listing cannot count as successful catalog acquisition.
import {readFile} from "node:fs/promises";
const [node,py]=await Promise.all([
  readFile("1688-one-shot-jarir.json","utf8").then(JSON.parse),
  readFile("1688-one-shot-noon-uae.json","utf8").then(JSON.parse),
]);
const pySearch=(py.stages||[]).find(s=>s.id==="actual_search")||null;
const nodeLinks=Number(node.evidence?.links)||0;
const pyLinks=Number(pySearch?.evidence?.independentParserIntersection)||0;
const nodeAccept=node.status===200&&node.evidence?.challenge===false&&nodeLinks>0;
const pyAccept=pySearch?.http===200 && pySearch?.evidence?.challengeShell===false&&
  pySearch?.evidence?.parserAgreement===true&&pyLinks>0;
const decision={
  schema:"nawaa.1688.one-shot-method-differential.v1",
  node:{http:node.status||null,searchAttempted:node.requests===1,
    searchLinks:nodeLinks,accessState:node.state},
  python:{homeHttp:py.stages?.[0]?.http||null,
    searchHttp:pySearch?.http||null,searchAttempted:Boolean(pySearch),
    searchLinks:pyLinks,accessState:pySearch?.state||py.verdict},
  liveSearchLinkAcquisition:nodeAccept||pyAccept,
  independentOneUnitPdpPriceVerified:false,
  releaseReady:false,customerPublishable:false,
  classification:nodeAccept||pyAccept?"LIVE_LINKS_ONLY_MOQ_AND_PDP_NOT_VERIFIED":
    "LIVE_SEARCH_ACCESS_OR_DATA_UNVERIFIED",
};
console.log(JSON.stringify(decision,null,2));
if(!decision.liveSearchLinkAcquisition) process.exitCode=1;
