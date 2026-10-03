import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {buildAuditMatrix,sourceQueries,summarizeAuditMatrix} from '../server/audit-matrix.mjs';

const args=process.argv.slice(2);const options={};
try {
 for(let i=0;i<args.length;i+=2) {
  if(!['--base','--revision','--token-file','--output','--round-gap-ms','--sources'].includes(args[i]) || !args[i+1]) throw Error('arguments');
  options[args[i]]=args[i+1];
 }
 const base=options['--base'] || 'https://nawaa-search-api.onrender.com';
 if(new URL(base).protocol!=='https:') throw Error('https_required');
 const revision=options['--revision'];if(!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('revision_required');
 const token=options['--token-file']?(await readFile(options['--token-file'],'utf8')).trim():process.env.NAWAA_AUDIT_TOKEN;
 if(!token || token.length<32 || !options['--output']) throw Error('configuration_required');
 const gap=Number(options['--round-gap-ms'] || 60000);if(!Number.isInteger(gap)||gap<60000||gap>300000) throw Error('invalid_round_gap');
 const matrix=options['--sources'] ? buildAuditMatrix(options['--sources'].split(',')) : buildAuditMatrix();
 const ids=[...new Set(matrix.map(entry=>entry.sourceId))];
 const output=path.resolve(options['--output']);await mkdir(path.join(output,'results'),{recursive:true});
 const get=async route=>{const r=await fetch(new URL(route,base),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('health_unavailable');return r.json();};
 const health=await get('/health');if(health.revision!==revision) throw Error('revision_mismatch');
 const catalog=await get('/api/sources');
 if(!ids.every(id=>catalog.sources?.some(s=>s.id===id&&s.status==='configured'))) throw Error('configured_roster_mismatch');
 const records=[];
 let fatal=null;
 const atomic=async(file,value)=>{await writeFile(file+'.tmp',JSON.stringify(value,null,2)+'\n');await rename(file+'.tmp',file);};
 const metadataPath=path.join(output,'metadata.json');
 try {
  const prior=JSON.parse(await readFile(metadataPath,'utf8'));
  if(prior.revision!==revision || prior.base!==base || JSON.stringify(prior.matrix)!==JSON.stringify(matrix)) throw Error('resume_mismatch');
 }catch(error){if(error.code!=='ENOENT')throw error;await atomic(metadataPath,{revision,base,startedAt:new Date().toISOString(),roundGapMs:gap,health,catalog,matrix});}
 for(let round=1;round<=3;round++) {
  let cursor=0;
  const worker=async()=>{
   while(cursor<ids.length && !fatal) {
    const sourceId=ids[cursor++];const statuses=[];
    for(const entry of matrix.filter(x=>x.round===round&&x.sourceId===sourceId)) {
     if(fatal) break;
     const index=matrix.indexOf(entry);const file=path.join(output,'results',String(index).padStart(3,'0')+'.json');let report;
     try {
      report=JSON.parse(await readFile(file,'utf8'));
      if(report.round!==entry.round || report.sourceId!==entry.sourceId || report.query!==entry.query || report.expected!==entry.expected || (report.revision!==revision && report.targetRevision!==revision)) throw Error('resume_mismatch');
     }catch(error) {
      if(error.code!=='ENOENT')throw error;
      try {
       const r=await fetch(new URL('/internal/source-audit',base),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({sourceId:entry.sourceId,query:entry.query,expected:entry.expected}),signal:AbortSignal.timeout(97000)});
       if([401,403,404,409,429].includes(r.status)) throw Error('endpoint_guard_'+r.status);
       if(!r.ok) throw Error('http_'+r.status);
       report=await r.json();
       if(report.revision!==revision || report.source?.id!==entry.sourceId || report.query!==entry.query || report.expected!==entry.expected || report.schemaVersion!=='nawaa.source-audit.v1') throw Error('audit_response_mismatch');
      }catch(error) {
       const stop=/^endpoint_guard_|audit_response_mismatch/.test(error.message);
       if(stop) fatal ||= error.message;
       const evidence=report?{schemaVersion:report.schemaVersion,status:report.status,revision:report.revision,sourceId:report.source?.id}:null;
       report={schemaVersion:'nawaa.audit-client-failure.v1',status:'CLIENT_FAILURE',revision:null,targetRevision:revision,observedAt:new Date().toISOString(),failureCode:stop?error.message:/timeout|abort/i.test(error.name+error.message)?'CLIENT_TIMEOUT':/^http_\d+$/.test(error.message)?error.message:'CLIENT_NETWORK_ERROR',responseEvidence:evidence};
      }
      report={...report,...entry};await atomic(file,report);
     }
     records.push(report);statuses.push(report.status);
    }
    console.log(JSON.stringify({round,completed:records.length,total:matrix.length,sourceId,statuses}));
   }
  };
  const guarded=()=>worker().catch(error=>{fatal ||= error.message==='resume_mismatch'?error.message:'matrix_failed';throw error;});
  const settled=await Promise.allSettled([guarded(),guarded()]);
  const rejected=settled.find(x=>x.status==='rejected');
  if(rejected) fatal ||= /^(resume_mismatch)$/.test(rejected.reason?.message)?rejected.reason.message:'matrix_failed';
  await atomic(path.join(output,'summary.json'),{...summarizeAuditMatrix(matrix,records,revision),...(fatal?{abortedReason:fatal}:{} )});
  if(fatal) throw Error(fatal);
  console.log(JSON.stringify({roundComplete:round,completed:records.length}));
  if(round<3) await new Promise(r=>setTimeout(r,gap));
 }
 await atomic(path.join(output,'summary.json'),{...summarizeAuditMatrix(matrix,records,revision),finishedAt:new Date().toISOString()});
 console.log(JSON.stringify({done:true,completed:records.length,output}));
}catch(error) {
 const known=/^(arguments|https_required|revision_required|configuration_required|invalid_round_gap|invalid_sources|health_unavailable|revision_mismatch|configured_roster_mismatch|resume_mismatch|endpoint_guard_\d+|audit_response_mismatch)$/;
 console.error(known.test(error.message)?error.message:'matrix_failed');process.exitCode=1;
}
