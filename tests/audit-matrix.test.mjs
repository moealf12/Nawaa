import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sourceQueries,buildAuditMatrix,summarizeAuditMatrix} from '../server/audit-matrix.mjs';
const revision='test-sha';
const report=entry=>({...entry,source:{id:entry.sourceId},schemaVersion:'nawaa.source-audit.v1',revision,observedAt:new Date().toISOString(),durationMs:1,samples:entry.expected==='empty'?[]:[{product:{}}],rejections:[],executionEnvironment:'render-service-worker',cachePolicy:'direct-provider-request',status:entry.expected==='empty'?'NEGATIVE_CONTROL_PASS':'VERIFIED_SAMPLE',counts:{raw:entry.expected==='empty'?0:1,accepted:entry.expected==='empty'?0:1,rejected:0,duplicates:0},pageVerification:{attempted:1,verified:1,failed:0},errorCodes:[]});
test('matrix covers each of 29 sources with 2 positive and 1 negative queries across 3 rounds',()=>{
 const matrix=buildAuditMatrix();assert.equal(Object.keys(sourceQueries).length,29);assert.equal(matrix.length,261);
 assert.equal(matrix.filter(x=>x.expected==='results').length,174);assert.equal(matrix.filter(x=>x.expected==='empty').length,87);
 assert.equal(new Set(matrix.map(x=>`${x.round}|${x.sourceId}|${x.query}`)).size,261);
});
test('certification rejects incomplete structure and fractional page evidence',()=>{
 const matrix=buildAuditMatrix().filter(x=>x.sourceId==='extra');const records=matrix.map(report);
 for(const change of [{observedAt:undefined},{durationMs:undefined},{samples:undefined},{rejections:undefined},{counts:{raw:1,accepted:1,rejected:0}},{counts:{raw:2,accepted:1,rejected:0,duplicates:0}},{pageVerification:{attempted:0.5,verified:0.5,failed:0}},{samples:[]}]) {
  assert.equal(summarizeAuditMatrix(matrix,records.map((r,i)=>i?r:{...r,...change}),revision).sources[0].verified,false);
 }
});
test('fatal guard persists evidence, drains active request, stops scheduling and writes summary',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'nawaa-matrix-'));
 try {
  const mock=path.join(dir,'mock.mjs'),tokenFile=path.join(dir,'token'),calls=path.join(dir,'calls.jsonl'),output=path.join(dir,'results');
  writeFileSync(tokenFile,'fixture'.repeat(8));
  writeFileSync(mock,`import {appendFileSync} from 'node:fs';
  const ids=${JSON.stringify(Object.keys(sourceQueries))};const revision='a'.repeat(40);
  globalThis.fetch=async(url,opts)=>{
   if(String(url).endsWith('/health'))return Response.json({revision});
   if(String(url).endsWith('/api/sources'))return Response.json({sources:ids.map(id=>({id,status:'configured'}))});
   const e=JSON.parse(opts.body);appendFileSync(${JSON.stringify(calls)},JSON.stringify(e)+'\\n');
   if(e.sourceId==='jarir')return Response.json({error:'unauthorized'},{status:401});
   await new Promise(r=>setTimeout(r,10));
   return Response.json({schemaVersion:'nawaa.source-audit.v1',source:{id:e.sourceId},query:e.query,expected:e.expected,revision,status:'NO_RESULTS',counts:{raw:0,accepted:0,rejected:0,duplicates:0},samples:[],rejections:[],errorCodes:[]});
  };`);
  const result=spawnSync(process.execPath,['--import',pathToFileURL(mock).href,'scripts/audit-matrix.mjs','--base','https://mock.example','--revision','a'.repeat(40),'--token-file',tokenFile,'--output',output],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);
  const requests=readFileSync(calls,'utf8').trim().split('\n');assert.ok(requests.length<=2,'scheduled '+requests.length+' requests');
  const saved=readdirSync(path.join(output,'results')).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(readFileSync(path.join(output,'results',x),'utf8')));
  assert.ok(saved.some(x=>x.sourceId==='jarir'&&x.status==='CLIENT_FAILURE'&&x.failureCode==='endpoint_guard_401'));
  const summary=JSON.parse(readFileSync(path.join(output,'summary.json'),'utf8'));assert.equal(summary.abortedReason,'endpoint_guard_401');assert.equal(summary.completed,saved.length);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('source certification requires all nine distinct reports on the target revision and live environment',()=>{
 const matrix=buildAuditMatrix().filter(x=>x.sourceId==='extra');const records=matrix.map(report);
 assert.equal(summarizeAuditMatrix(matrix,records,revision).sources[0].verified,true);
 for(const altered of [records.slice(1),[...records.slice(1),records[1]],records.map((r,i)=>i? r:{...r,revision:'old'}),records.map((r,i)=>i? r:{...r,status:'VALID_CATALOG_SAMPLE'}),records.map((r,i)=>i? r:{...r,cachePolicy:'unknown'})]) assert.equal(summarizeAuditMatrix(matrix,altered,revision).sources[0].verified,false);
});
test('page failures, raw negative hits and malformed successful reports cannot certify sources',()=>{
 const matrix=buildAuditMatrix().filter(x=>x.sourceId==='extra');const records=matrix.map(report);
 for(const change of [{pageVerification:{attempted:1,verified:0,failed:1}},{counts:{raw:0,accepted:0,rejected:0,duplicates:0}},{errorCodes:['HTTP_403']}]) {
  assert.equal(summarizeAuditMatrix(matrix,records.map((r,i)=>i?r:{...r,...change}),revision).sources[0].verified,false);
 }
 const badControl=records.map(r=>r.expected==='empty'?{...r,counts:{raw:1,accepted:0,rejected:1,duplicates:0}}:r);
 assert.equal(summarizeAuditMatrix(matrix,badControl,revision).sources[0].verified,false);
});
