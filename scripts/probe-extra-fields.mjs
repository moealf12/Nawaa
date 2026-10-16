// Disposable eXtra field-projection experiment. NEVER turn on in production
// from this script. Assert complete offer parity and record only aggregates.
// The reference returns every merchant field; candidate requests only the
// attributes explicitly used by the current normalizer.
// Source: official Unbxd Search API docs, 'fields' request parameter.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {searchExtraUnbxd, EXTRA_PROJECTION_FIELDS} from '../server/providers/extra-unbxd.mjs';

if(process.env.NODE_ENV!=='test')throw Error('probe_requires_test_environment');
assert.ok(EXTRA_PROJECTION_FIELDS.length>=35);
assert.equal(new Set(EXTRA_PROJECTION_FIELDS).size,EXTRA_PROJECTION_FIELDS.length);
const queries=[['iphone','iPhone 17'],['console','PS5'],['laptop','HP laptop']];
const previousFetch=globalThis.fetch;
const oldLog=console.log;
const oldProfile=process.env.NAWAA_PROFILE_EXTRA;
const oldSplit=process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;
const timings=[];
process.env.NAWAA_PROFILE_EXTRA='1';
process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON='1';
console.log=(...args)=>{
  const line=String(args[0]||'');
  if(line.startsWith('EXTRA_PHASE_TIMING '))timings.push(JSON.parse(line.slice('EXTRA_PHASE_TIMING '.length)));
  else oldLog(...args);
};
function stripNonSemantic(value){
  if(Array.isArray(value))return value.map(stripNonSemantic);
  if(value&&typeof value==='object')
    return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='observedAt')
      .map(([key,val])=>[key,stripNonSemantic(val)]));
  return value;
}
async function observe(query,fields){
  const start=performance.now(),at=timings.length;
  const response=await searchExtraUnbxd(query,100,query,fields?{probeFields:EXTRA_PROJECTION_FIELDS}:{});
  assert.equal(timings.length,at+1,'required diagnostic telemetry missing');
  assert.ok(Array.isArray(response.offers));
  assert.ok(response.offers.length>0,'provider returned no offers');
  assert.equal(response.errors.length,0,'unexpected source errors');
  const t=timings.at(-1);
  assert.ok(t.decodedBodyBytes>0,'missing body size');
  return {response,ms:performance.now()-start,
    size:t.decodedBodyBytes,headersMs:t.headersMs,bodyReadDecodeMs:t.bodyReadDecodeMs,
    jsonParseMs:t.jsonParseMs,filterMs:t.filterMs,
    returned:t.offers,products:t.products};
}
try{
  const summary=[];
  for(const [label,q] of queries){
    for(let round=0;round<2;round++){
      const order=round?['projected','full']:['full','projected'];
      const result={};
      for(const variant of order)
        result[variant]=await observe(q,variant==='projected');
      const before=result.full,after=result.projected;
      // Strict equality protects completeness, ordering, prices, model and
      // capacity specs, merchant identity, sourceMeta and stock signals.
      assert.deepStrictEqual(stripNonSemantic(after.response),
        stripNonSemantic(before.response),
        'projection changes offers, ranking or metadata: '+label);
      const ratio=Number((after.size/before.size).toFixed(3));
      summary.push({label,round,sourceProducts:before.products,
        validOffers:before.returned,byteRatio:ratio,
        fullDecodedBytes:before.size,projectedDecodedBytes:after.size,
        fullHeaderMs:Math.round(before.headersMs),
        projectedHeaderMs:Math.round(after.headersMs),
        fullBodyReadMs:Math.round(before.bodyReadDecodeMs),
        projectedBodyReadMs:Math.round(after.bodyReadDecodeMs),
        fullJsonMs:Math.round(before.jsonParseMs),
        projectedJsonMs:Math.round(after.jsonParseMs),
        fullFilterMs:Math.round(before.filterMs),
        projectedFilterMs:Math.round(after.filterMs)});
    }
  }
  oldLog('EXTRA_FIELDS_PARITY '+JSON.stringify({passed:true,queries:queries.length,
    pairedRounds:summary.length,fieldCount:EXTRA_PROJECTION_FIELDS.length,summary}));
}catch(error){
  oldLog('EXTRA_FIELDS_PARITY '+JSON.stringify({passed:false,errorName:error?.name||'Error',
    reason:String(error?.message||error).slice(0,220)}));
  process.exitCode=1;
}finally{
  globalThis.fetch=previousFetch;console.log=oldLog;
  if(oldProfile===undefined)delete process.env.NAWAA_PROFILE_EXTRA;
  else process.env.NAWAA_PROFILE_EXTRA=oldProfile;
  if(oldSplit===undefined)delete process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;
  else process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON=oldSplit;
}
