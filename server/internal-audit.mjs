import {createHash,timingSafeEqual} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {currentSources} from './source-config.mjs';
import {auditSource} from './audit-contract.mjs';

const digest=value=>createHash('sha256').update(value).digest();
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};

async function bodyOf(req) {
  let bytes=0;const chunks=[];
  const timer=setTimeout(()=>req.destroy(),5000);
  try {
    for await(const chunk of req) {
      bytes+=chunk.length;
      if(bytes>2048) {const error=new Error('body_too_large');error.status=413;throw error;}
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {clearTimeout(timer);}
}

export async function runAuditWorker({source,query,expected,revision,timeoutMs=90000}) {
  const started=Date.now();
  const worker=new Worker(new URL('../scripts/audit-worker.mjs',import.meta.url),{workerData:{sourceId:source.id,query,expected,revision,timeoutMs},execArgv:[]});
  let timer;
  try {
    return await new Promise((resolve,reject)=>{
      worker.once('message',data=>data?.report?resolve(data.report):reject(new Error('audit_worker_failed')));
      worker.once('error',()=>reject(new Error('audit_worker_failed')));
      worker.once('exit',()=>reject(new Error('audit_worker_exited')));
      timer=setTimeout(async()=>{
        const report=await auditSource({source,query,expected,revision,search:()=>{throw new Error('Audit worker timeout');}});
        resolve({...report,observedAt:new Date(started).toISOString(),durationMs:Date.now()-started,failureStage:'worker_watchdog'});
      },timeoutMs+3000);
    });
  } finally {clearTimeout(timer);await worker.terminate();}
}

export function createInternalAuditHandler({token=process.env.NAWAA_INTERNAL_AUDIT_TOKEN || '',expiresAt=process.env.NAWAA_INTERNAL_AUDIT_EXPIRES_AT,revision=process.env.RENDER_GIT_COMMIT,sources=currentSources,run=runAuditWorker}={}) {
  const inFlight=new Set();
  return async(req,res)=>{
    if(token.length<32 || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now()) return send(res,404,{error:'not_found'});
    const authorization=req.headers.authorization;
    if(typeof authorization!=='string' || !timingSafeEqual(digest(authorization),digest('Bearer '+token))) return send(res,401,{error:'unauthorized'});
    if(req.headers.origin) return send(res,403,{error:'origin_not_allowed'});
    if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(res,415,{error:'json_required'});
    if(!revision) return send(res,503,{error:'revision_unavailable'});
    let body;
    try {body=await bodyOf(req);}catch(error){if(!res.destroyed)send(res,error.status || 400,{error:error.status===413?'body_too_large':'invalid_request'});return;}
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!['sourceId','query','expected'].includes(key)) || typeof body.sourceId!=='string' || typeof body.query!=='string' || body.query.trim().length<2 || body.query.length>180 || (body.expected!==undefined && !['results','empty'].includes(body.expected))) return send(res,400,{error:'invalid_request'});
    const source=sources().find(item=>item.id===body.sourceId);
    if(!source) return send(res,400,{error:'unknown_source'});
    if(inFlight.has(source.id)) return send(res,409,{error:'source_busy'});
    if(inFlight.size>=2) return send(res,429,{error:'audit_busy'});
    inFlight.add(source.id);
    try {
      const report=await run({source,query:body.query.trim(),expected:body.expected || 'results',revision});
      return send(res,200,{...report,revision,executionEnvironment:'render-service-worker',cachePolicy:'direct-provider-request'});
    } catch {if(!res.destroyed)send(res,503,{error:'audit_worker_failed'});}
    finally {inFlight.delete(source.id);}
  };
}
