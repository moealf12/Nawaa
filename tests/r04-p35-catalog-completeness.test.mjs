import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  guardCatalogRecallCompleteness,
  catalogRecallFailureClass,
  summarizeCatalogRecall,
} from "../server/catalog-recall-evidence.mjs";
import {classifySearchCacheAdmission} from "../server/search-cache.mjs";

function cleanCoverage() {
  return {
    partial:false,complete:true,deadlineExceeded:false,providersPending:0,
    sourceFailures:{errorsReported:0},catalogRecall:{
      configured:true,status:"observed",error:null,
      sourceObservationOnly:true,exhaustive:false,
    },
  };
}
function cacheable(coverage) {
  return classifySearchCacheAdmission({
    offers:[{title:"source verified",productPrice:499,currency:"SAR"}],
    errors:[],coverage,
  },{requireExplicitComplete:true});
}

test("R04-P3.5 RED: failed optional catalog recall cannot falsely certify an otherwise healthy search or enter the strict cache",()=>{
  const baseline=cleanCoverage();
  assert.equal(cacheable(baseline).cacheable,true);
  for (const error of ["catalog_recall_busy","catalog_recall_budget_exceeded","catalog_recall_aborted","catalog_recall_unavailable"]) {
    const catalog=summarizeCatalogRecall({configured:true,offers:[],error},{offset:0,limit:120});
    const coverage=guardCatalogRecallCompleteness({...baseline,catalogRecall:catalog});
    assert.equal(coverage.partial,true,error);
    assert.equal(coverage.complete,false,error);
    assert.equal(cacheable(coverage).cacheable,false,error);
    assert.equal(coverage.sourceFailures.errorsReported,0,"database failure is not a merchant transport error");
    assert.equal(coverage.catalogRecall.error,"catalog_recall_unavailable","keep backward-compatible public schema");
  }
});

test("R04-P3.5: absent DB is not a failed merchant and successful source evidence remains cacheable",()=>{
  for(const catalog of [
    {configured:false,status:"unconfigured",error:null},
    {configured:true,status:"observed",error:null,acceptedFresh:0},
    {configured:true,status:"observed",error:null,acceptedFresh:3},
  ]) {
    const coverage=guardCatalogRecallCompleteness({...cleanCoverage(),catalogRecall:catalog});
    assert.equal(coverage.partial,false);
    assert.equal(coverage.complete,true);
    assert.equal(cacheable(coverage).cacheable,true);
  }
});

test("R04-P3.5: source failure, pending providers and request deadline remain noncacheable regardless of a healthy catalog",()=>{
  const parts=[
    {...cleanCoverage(),partial:true,complete:false},
    {...cleanCoverage(),partial:true,complete:false,providersPending:2},
    {...cleanCoverage(),partial:true,complete:false,deadlineExceeded:true},
  ];
  for(const coverage of parts){
    const guarded=guardCatalogRecallCompleteness(coverage);
    assert.equal(guarded.partial,true);
    assert.equal(guarded.complete,false);
    assert.equal(cacheable(guarded).cacheable,false);
  }
});

test("R04-P3.5: contradictory or malformed configured catalog success evidence cannot certify complete",()=>{
  for(const c of [
    {configured:true,status:"failed"},
    {configured:true,status:"unconfigured"},
    {configured:true,status:"unknown"},
    {configured:true,status:"observed",error:"unexpected_error"},
    {configured:false,status:"failed",error:"unexpected_error"},
  ]) {
    const guarded=guardCatalogRecallCompleteness({...cleanCoverage(),catalogRecall:c});
    assert.equal(guarded.partial,true);
    assert.equal(guarded.complete,false);
  }
});

test("R04-P3.5: only bounded diagnostic failure classes, never driver error text, URL or query",()=>{
  const cases=[
    ["catalog_recall_busy","busy"],
    ["catalog_recall_budget_exceeded","budget_exceeded"],
    ["catalog_recall_aborted","aborted"],
    ["catalog_deadline_exceeded","request_deadline"],
    ["catalog_recall_unavailable","query_failure"],
    ["password=secret postgres://user:password@host/private?query=iPhone","query_failure"],
  ];
  for(const [error,expected] of cases) {
    const klass=catalogRecallFailureClass({configured:true,error});
    assert.equal(klass,expected);
    assert.ok(/^[a-z_]{3,32}$/.test(klass));
    assert.equal(klass.includes("secret"),false);
  }
  assert.equal(catalogRecallFailureClass({configured:false,error:null}),null);
  assert.equal(catalogRecallFailureClass({configured:true,offers:[]}),null);
});

test("R04-P3.5: all JSON/SSE/expansion responses pass through the same final completeness gate",()=>{
  const src=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  assert.match(src,/function withWavePagination\(/);
  assert.match(src,/guardCatalogRecallCompleteness\(result\.coverage\)/);
  const uses=(src.match(/return withWavePagination\(/g)||[]).length;
  assert.equal(uses,3,"depth expansion, streaming and synchronous JSON must all be guarded");
  assert.match(src,/catalogRecallFailureClass\(persisted\)/,"low-cardinality production diagnostics distinguish DB overload from query failure");
});
