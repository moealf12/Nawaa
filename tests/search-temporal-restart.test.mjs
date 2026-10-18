import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Two independent short-lived real Node+HTTP server processes. The merchant
// price transition is a *fixture*, not a claim about a real merchant.
test('v15.18 real process restart resets in-memory evidence and preserves test-only signed cursor',async()=>{
 const script="\nimport http from 'node:http';\nprocess.env.PORT='0';process.env.DATABASE_URL='';process.env.MEILI_HOST='';\nprocess.env.MEILI_MASTER_KEY='';process.env.NODE_ENV='test';\nprocess.env.NAWAA_CURSOR_SECRET='cross-process-temporal-test-only-key-never-production';\nprocess.env.SEARCH_STREAM_DEADLINE_MS='1400';\nprocess.env.SEARCH_REQUEST_DEADLINE_MS='1400';\nconst second=process.env.NAWAA_TEMPORAL_SECOND==='true';\nconst sourcePrice=second?3699:2799;\nglobalThis.fetch=async url=>{\n const u=String(url);\n if(u.startsWith('https://search.unbxd.io/'))return Response.json({response:{products:[{\n    id:'qa-hp-laptop',name:'HP Pavilion Laptop 16GB RAM',currentPrice:sourcePrice,\n    featureEnBrandName:'HP',featureEnDeviceType:'Laptop',available:true\n }]}});\n if(u.startsWith('https://ac.cnstrc.com/'))return Response.json({response:{results:[]}});\n return new Response('',{headers:{'content-type':'text/html'}});\n};\nconst request=(port,path)=>new Promise((resolve,reject)=>{\n http.get({host:'127.0.0.1',port,path},res=>{\n  let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body}));\n }).on('error',reject);\n});\nconst listen=http.Server.prototype.listen;\nhttp.Server.prototype.listen=function(...args){\n this.once('listening',async()=>{\n  const port=this.address().port,q='hp laptop',base='/api/search?q=hp+laptop';\n  try{\n    if(!second){\n      const raw=await request(port,'/api/search/stream?q=hp+laptop');\n      const snapshots=raw.body.split(/\\r?\\n\\r?\\n/)\n        .filter(x=>x.startsWith('event: snapshot'))\n        .map(x=>JSON.parse(x.match(/^data: (.*)$/m)?.[1]||'{}'));\n      const found=snapshots.find(x=>x.offers?.some(o=>o.productPrice===2799));\n      const cursor=snapshots.at(-1)?.nextCursor;\n      if(raw.status!==200||!found||!cursor)throw Error('process_one_missing_signed_snapshot');\n      console.log('RESULT '+JSON.stringify({stage:1,pid:process.pid,cursor,price:2799}));\n    }else{\n      const original=await request(port,base);\n      const result=JSON.parse(original.body);\n      if(original.status!==200 || !result.offers?.some(o=>o.productPrice===3699)||\n        result.offers.some(o=>o.productPrice===2799))\n        throw Error('process_two_new_source_evidence_not_acquired');\n      const replay=await request(port,base+'&cursor='+encodeURIComponent(process.env.NAWAA_TEMPORAL_CURSOR));\n      if(replay.status!==200)throw Error('signed_cursor_rejected_after_process_restart_'+replay.status);\n      const wrong=await request(port,'/api/search?q=PS5&cursor='+encodeURIComponent(process.env.NAWAA_TEMPORAL_CURSOR));\n      if(wrong.status!==400)throw Error('cross_query_cursor_accepted_after_restart');\n      console.log('RESULT '+JSON.stringify({stage:2,pid:process.pid,price:3699,\n        cursorAccepted:true,cursorQueryBound:true,newProcess:true}));\n    }\n  }catch(err){console.log('FAIL '+String(err?.stack||err));process.exitCode=1}\n  finally{this.close(()=>process.exit(process.exitCode||0))}\n });\n return listen.apply(this,args);\n};\nawait import('./server/server.mjs');\n";
 const exec=promisify(execFile);
 const run=async (second,cursor)=>{
   const env={...process.env,NODE_ENV:'test',DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:'',
      NAWAA_TEMPORAL_SECOND:second?'true':'false',NAWAA_TEMPORAL_CURSOR:cursor||''};
   const {stdout}=await exec(process.execPath,['--input-type=module','-e',script],{
      cwd:new URL('..',import.meta.url),timeout:25000,maxBuffer:4*1024*1024,env});
   const failure=stdout.split('\n').find(x=>x.startsWith('FAIL '));
   assert.equal(failure,undefined,failure);
   const marker=stdout.split('\n').find(x=>x.startsWith('RESULT '));
   assert.ok(marker,stdout.slice(-2000));
   return JSON.parse(marker.slice(7));
 };
 const a=await run(false);const b=await run(true,a.cursor);
 assert.notEqual(a.pid,b.pid,'test demands two real server processes');
 assert.equal(a.price,2799);assert.equal(b.price,3699);
 assert.equal(b.cursorAccepted,true);assert.equal(b.cursorQueryBound,true);
});
