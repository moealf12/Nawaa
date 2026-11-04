#!/usr/bin/env node
// Ephemeral stdin parser for a LIVE Noon Saudi HTTP response from curl_cffi.
// Never stores raw source HTML. The existing strict extractors own all evidence.
import {readFileSync} from "node:fs";
import {extractNoonSaudiCatalogCards} from "../src/noon-sa-catalog.mjs";
import {extractNoonSaudiSearchCardEvidence} from "../src/noon-sa-search-card-evidence.mjs";

const query="iPhone 17 256GB";
let result={state:"NO_VALID_PRICE_EVIDENCE",catalogOffers:0,searchCards:0,conflicts:0};
try{
  const html=readFileSync(0,"utf8");
  if(Buffer.byteLength(html,"utf8")>8_000_000)throw new Error("HTML_TOO_LARGE");
  const catalog=extractNoonSaudiCatalogCards(html,query,8);
  const search=extractNoonSaudiSearchCardEvidence(html,query,{limit:8});
  const catalogOffers=Array.isArray(catalog)?catalog.length:0;
  const searchCards=Array.isArray(search.candidates)?search.candidates.length:0;
  result={
    state:catalogOffers||searchCards?"SOURCE_PRICE_EVIDENCE_OBSERVED":"NO_VALID_PRICE_EVIDENCE",
    catalogOffers,searchCards,
    searchState:search.status||null,
    conflicts:Array.isArray(search.conflicts)?search.conflicts.length:0,
  };
}catch{result.state="PARSER_FAILED"}
process.stdout.write(JSON.stringify(result)+"\n");
process.exitCode=result.state==="SOURCE_PRICE_EVIDENCE_OBSERVED"?0:1;
