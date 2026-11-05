#!/usr/bin/env node
// Compare Node's real production-path AliExpress structured extraction against
// Python's successful live probe ON THE IDENTICAL HTTP response bytes.
// No network requests, raw HTML logging, session headers or publication.
import {readFileSync} from "node:fs";
import {extractAliExpressSearchEvidence} from "../src/aliexpress-search-evidence.mjs";

const id = String(process.env.ALIEXPRESS_QUERY_ID || "");
const query = String(process.env.ALIEXPRESS_SEARCH_QUERY || "");
if (!/^[a-z0-9-]{2,36}$/.test(id) || !query || query.length > 100)
  throw new Error("PARITY_INPUT_INVALID");

const html=readFileSync("nawaa-aliexpress-parity-"+id+".html","utf8");
const py=JSON.parse(readFileSync("nawaa-aliexpress-parity-"+id+".cards.json","utf8"));
if (!Array.isArray(py) || html.length > 5_000_000)
  throw new Error("PARITY_INPUT_INVALID");

const diagnostics={};
const js=extractAliExpressSearchEvidence(
  html,query,diagnostics,value=>String(value||"").toLowerCase().trim().replace(/\s+/g," ")
);
const key=item=>{
  try {
    const url=new URL(item.sourceUrl);
    const image=new URL(item.image);
    if (!item.productId || !item.currency || !Number.isFinite(Number(item.price??item.priceOriginal)))
      return null;
    return [
      String(item.productId),String(item.currency),
      Number(item.price??item.priceOriginal).toFixed(2),
      url.hostname+url.pathname,image.hostname+image.pathname,
    ].join("|");
  } catch {return null;}
};
const pyKeys=py.map(key),jsKeys=js.map(key);
const pySet=new Set(pyKeys),jsSet=new Set(jsKeys);
const missingFromNode=pyKeys.filter(x=>!jsSet.has(x)).length;
const extraInNode=jsKeys.filter(x=>!pySet.has(x)).length;
const report={
  schema:"nawaa.aliexpress.native-source-parity.v1",
  queryId:id,pythonAccepted:py.length,nodeAccepted:js.length,
  sameIdentitiesAndPrices:missingFromNode===0&&extraInNode===0&&
    pyKeys.length===pySet.size&&jsKeys.length===jsSet.size&&!pyKeys.includes(null)&&!jsKeys.includes(null),
  missingFromNode,extraInNode,
  parser:diagnostics.parser,sourceCandidates:diagnostics.structuredCandidates,
  rejectedProductLinks:diagnostics.rejectedProductLinks,
  customerPublishable:false,
};
console.log("NAWAA_ALIEXPRESS_LIVE_PARITY "+JSON.stringify(report));
if (!report.sameIdentitiesAndPrices||py.length===0)
  process.exitCode=1;
