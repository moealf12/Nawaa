// NAWAA R04: strict 36-intent coverage + judgment accounting.
// Synthetic corpus describes intended searches, NEVER external relevance truth.
export function validateR04Corpus(corpus){
  if(corpus?.schemaVersion!=="nawaa.search-corpus.v1" ||
     !Array.isArray(corpus.queryCases)||corpus.queryCases.length!==36)
    return {pass:false,reason:"CORPUS_SCHEMA_OR_LENGTH"};
  const seen=new Set();
  for(let index=0;index<36;index+=2){
    const first=corpus.queryCases[index],second=corpus.queryCases[index+1];
    for(const [offset,item] of [[0,first],[1,second]]){
      if(!item||item.id!==`Q${String(index+offset+1).padStart(2,"0")}`||
        !["en","ar"].includes(item.language)||typeof item.query!=="string"||
        !item.query.trim()||seen.has(item.query.normalize("NFKC").trim().toLowerCase()))
        return {pass:false,reason:"CORPUS_ID_LANGUAGE_QUERY_DUPLICATE"};
      seen.add(item.query.normalize("NFKC").trim().toLowerCase());
    }
    if(first.language!=="en"||second.language!=="ar")
      return {pass:false,reason:"CORPUS_PAIR_LANGUAGE"};
  }
  return {pass:true,pairs:18,queries:36};
}

export function summarizeR04Judgments(judgments){
  const rows=Array.isArray(judgments)?judgments:[];
  const values=rows.map(x=>x?.grade);
  const known=values.filter(x=>Number.isInteger(x)&&x>=0&&x<=3);
  const unknown=values.length-known.length;
  if(!rows.length)return {status:"NO_RESULTS",ndcg10:null,mrr10:null,judged:0,unjudged:0};
  if(unknown)return {status:"INCOMPLETE_INDEPENDENT_JUDGMENTS",ndcg10:null,mrr10:null,
    judged:known.length,unjudged:unknown};
  const gains=known.map(x=>Math.pow(2,x)-1);
  const dcg=(list)=>list.reduce((sum,v,i)=>sum+v/Math.log2(i+2),0);
  const ideal=dcg([...gains].sort((a,b)=>b-a));
  const ndcg=ideal>0?dcg(gains)/ideal:null;
  const mrrIndex=known.indexOf(3);
  return {status:"FULLY_RULE_JUDGED_NOT_HUMAN_CERTIFIED",
    ndcg10:ndcg===null?null:Number(ndcg.toFixed(6)),
    mrr10:mrrIndex<0?0:Number((1/(mrrIndex+1)).toFixed(6)),
    judged:known.length,unjudged:0};
}

export function summarizeR04LiveEvidence(rows,{expectedSha,observedSha}={}){
  const list=Array.isArray(rows)?rows:[];
  const seen=new Set(list.map(x=>x?.id));
  const attempted=list.length,observed=list.filter(x=>x.status==="OBSERVED").length;
  const unknown=list.reduce((total,x)=>total+(x?.judgments?.unjudged||0),0);
  const partial=list.filter(x=>x.partial===true).length;
  const failures=list.filter(x=>x.status!=="OBSERVED").map(x=>x.id);
  const wrongTopOne=list.filter(x=>x.firstTen?.[0]?.judgment?.grade===0).map(x=>x.id);
  const eligibleRows=list.filter(x=>x.judgments?.ndcg10!==null&&
    Number.isFinite(x.judgments?.ndcg10));
  const missingSourceErrorCounters=list.filter(x=>x.status==="OBSERVED" &&
    (!Number.isSafeInteger(x.sourceErrors)||x.sourceErrors<0)).map(x=>x.id);
  const sourceErrorEvents=list.reduce((n,x)=>n+
    (Number.isSafeInteger(x.sourceErrors)&&x.sourceErrors>=0?x.sourceErrors:0),0);
  const exactRevision=typeof expectedSha==="string"&&expectedSha.length===40&&expectedSha===observedSha;
  const evidenceCollected=attempted===36&&seen.size===36&&observed===36&&
    exactRevision&&missingSourceErrorCounters.length===0;
  return {attempted,observed,partial,requestFailures:failures,
    unknownJudgments:unknown,wrongTopOne,ruleNdcgQueries:eligibleRows.length,
    sourceErrorEvents,missingSourceErrorCounters,exactRevision,evidenceCollected,
    humanJudgmentCertified:false,rankingRoundCertified:false,
    evidenceState:evidenceCollected?"EVIDENCE_COLLECTED_NOT_CERTIFIED":"COLLECTION_INCOMPLETE"};
}
