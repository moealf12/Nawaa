export const DEFAULT_SEARCH_CASES=Object.freeze(["broad-brand","popular-product","exact-model","exact-sku","zero-result"]);
export function evaluateSearchRuns(runs=[]){
 const byType=Object.fromEntries(runs.map(r=>[r.type,r]));
 const checks=DEFAULT_SEARCH_CASES.map(type=>{const r=byType[type];const expectedZero=type==="zero-result";return {type,passed:!!r && (expectedZero ? Number(r.resultCount||0)===0 : Number(r.resultCount||0)>0) && Number(r.duplicateRate||0)<=.05 && Number(r.latencyMs||0)>=0};});
 return {passed:checks.every(x=>x.passed),checks,resultCount:runs.reduce((n,r)=>n+Number(r.resultCount||0),0)};
}
