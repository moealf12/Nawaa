// R04 read-only, deterministic ranking benchmark; no production network access.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {selectDiverseOffers as baselineSelect} from "../engineering/execution/r04-baseline-offer-selection.mjs";
import {selectDiverseOffers as candidateSelect} from "../server/offer-selection.mjs";

const fixture=JSON.parse(readFileSync(new URL("../engineering/execution/r04-ranking-benchmark.json",import.meta.url),"utf8"));
const intents=JSON.parse(readFileSync(new URL("../engineering/execution/search-truth-corpus.json",import.meta.url),"utf8"));

const gain=grade=>Math.pow(2,grade)-1;
export const ndcgAt=(ranking,grades,k=10)=>{
  assert.ok(Number.isInteger(k)&&k>0);
  const dcg=arr=>arr.slice(0,k).reduce((sum,id,i)=>sum+gain(grades[id]??0)/Math.log2(i+2),0);
  const ideal=Object.values(grades).sort((a,b)=>b-a).slice(0,k).reduce(
    (sum,g,i)=>sum+gain(g)/Math.log2(i+2),0);
  return ideal ? dcg(ranking)/ideal : 1;
};
export const mrrAt=(ranking,grades,k=10)=>{
  assert.ok(Number.isInteger(k)&&k>0);
  const i=ranking.slice(0,k).findIndex(id=>(grades[id]??0)===3);
  return i<0?0:1/(i+1);
};
const round=x=>Math.round(x*1e6)/1e6;
const names=["sameHigh","sameLow","otherExact","nearVariant","accessory"];
const grade=(entry,name)=>entry.judgments[name].relevance;
export function buildRankingCase(entry,queryCase) {
  const price=entry.illustrativePriceSAR;
  assert.ok(Number.isFinite(price)&&price>0);
  return names.map(name=>{
    const same=name==="sameHigh"||name==="sameLow";
    const title=same||name==="otherExact"?entry.principalItem:
      name==="nearVariant"?entry.nearVariant:entry.accessory;
    const relative=name==="sameHigh"?1:name==="sameLow"?.9:
      name==="otherExact"?.95:name==="nearVariant"?.75:.1;
    const confidence=name==="sameHigh"?.99:name==="sameLow"?.98:
      name==="otherExact"?.96:name==="nearVariant"?.83:.99;
    const provider=name==="otherExact"?"fixture-b":name==="accessory"?"fixture-c":"fixture-a";
    return {
      id:queryCase.id+"-"+name,judgedGrade:grade(entry,name),
      title,sourceUrl:"https://fixture.invalid/"+queryCase.id+"/"+name,
      provider,providerMarket:"synthetic",
      merchant:provider==="fixture-a"?"Fixture A":provider==="fixture-b"?"Fixture B":"Fixture C",
      productPrice:Math.round(price*relative*100)/100,currency:"SAR",
      matchConfidence:confidence,
      exactMatch:grade(entry,name)===3,
      condition:"new",availability:"in_stock",
    };
  });
}
function regret(firstRanked,offers){
  const relevant=offers.filter(o=>o.judgedGrade===3&&o.currency==="SAR");
  const min=Math.min(...relevant.map(x=>x.productPrice));
  const first=firstRanked.find(o=>o.judgedGrade===3&&o.currency==="SAR");
  return first?round((first.productPrice-min)/min):null;
}
export function evaluateR04() {
  assert.equal(fixture.schemaVersion,"nawaa.r04-ranking-benchmark.v1");
  assert.equal(fixture.baselineSha,"69896f49c89a1534d62eb4a10a34da71ebfb6739");
  assert.equal(fixture.provenance,"SYNTHETIC_DESIGNED_FIXTURES_NOT_INDEPENDENTLY_ADJUDICATED");
  const actual=intents.queryCases;
  const expectedIds=new Set(actual.map(c=>c.id));
  const covered=fixture.cases.flatMap(c=>c.queryIds);
  assert.equal(actual.length,36);
  assert.equal(fixture.cases.length,18);
  assert.equal(covered.length,expectedIds.size);
  assert.equal(new Set(covered).size,expectedIds.size);
  assert.ok(covered.every(id=>expectedIds.has(id)));
  const rows=[];
  for(const scenario of fixture.cases) {
    const groupCases=scenario.queryIds.map(id=>actual.find(c=>c.id===id));
    assert.equal(groupCases.length,2);
    assert.equal(new Set(groupCases.map(x=>x.language)).size,2);
    for(const q of groupCases){
      const offers=buildRankingCase(scenario,q);
      const grades=Object.fromEntries(offers.map(o=>[o.id,o.judgedGrade]));
      for(const o of offers)assert.ok(Number.isInteger(o.judgedGrade)&&o.judgedGrade>=0&&o.judgedGrade<=3);
      const old=baselineSelect(offers,10);
      const candidate=candidateSelect(offers,10);
      assert.equal(old.length,offers.length);
      assert.equal(candidate.length,offers.length);
      assert.equal(new Set(candidate.map(x=>x.id)).size,offers.length);
      rows.push({
        id:q.id,language:q.language,query:q.query,scenario:scenario.id,
        baselineNdcg:round(ndcgAt(old.map(x=>x.id),grades)),
        candidateNdcg:round(ndcgAt(candidate.map(x=>x.id),grades)),
        baselineMrr:round(mrrAt(old.map(x=>x.id),grades)),
        candidateMrr:round(mrrAt(candidate.map(x=>x.id),grades)),
        baselineRegret:regret(old,offers),
        candidateRegret:regret(candidate,offers),
        baselineTop:old[0]?.id,candidateTop:candidate[0]?.id,
        accessoryFirst:candidate[0]?.judgedGrade===0,
      });
    }
  }
  const mean=key=>round(rows.reduce((sum,r)=>sum+r[key],0)/rows.length);
  return {
    schemaVersion:"nawaa.r04-ranking-evaluation.v1",
    baselineSha:fixture.baselineSha,
    sourceCorpusCases:actual.length,pairedScenarios:fixture.cases.length,
    provenance:fixture.provenance,
    scope:"Synthetic counterfactual of the selection policy; not merchant recall, production NDCG, or independent human labels.",
    aggregate:{
      baselineNdcgAt10:mean("baselineNdcg"),candidateNdcgAt10:mean("candidateNdcg"),
      baselineMrrAt10:mean("baselineMrr"),candidateMrrAt10:mean("candidateMrr"),
      baselineFirstComparablePriceRegret:mean("baselineRegret"),
      candidateFirstComparablePriceRegret:mean("candidateRegret"),
      improvedFirstPriceQueries:rows.filter(r=>r.candidateRegret<r.baselineRegret).length,
      degradedNdcgQueries:rows.filter(r=>r.candidateNdcg+1e-6<r.baselineNdcg).length,
      degradedMrrQueries:rows.filter(r=>r.candidateMrr+1e-6<r.baselineMrr).length,
      accessoryFirstQueries:rows.filter(r=>r.accessoryFirst).length,
    },cases:rows,
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=evaluateR04();
  console.log("NAWAA_R04_RANKING_EVALUATION "+JSON.stringify(result));
}
