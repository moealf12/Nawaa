import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('SSE snapshots expose signed search-expansion cursor usable by the JSON API',async()=>{
  const script=`
    import http from 'node:http';
    import dns from 'node:dns/promises';
    dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
    process.env.PORT='0';
    process.env.SEARCH_REQUEST_DEADLINE_MS='10000';
    globalThis.fetch=async url=>{
      const u=String(url);
      if(u.startsWith('https://search.unbxd.io/'))return Response.json({response:{products:[{id:'hp-test-001',name:'HP Pavilion Laptop',price:2799,url:'https://www.extra.com/sa-en/hp-test-001'}]}});
      if(u.startsWith('https://ac.cnstrc.com/'))return Response.json({response:{results:[]}});
      return new Response('',{headers:{'content-type':'text/html'}});
    };
    const fetchLocal=(port,path)=>new Promise((resolve,reject)=>{
      http.get({host:'127.0.0.1',port,path},res=>{
        let text='';res.on('data',x=>text+=x);
        res.on('end',()=>resolve({status:res.statusCode,body:text}));
      }).on('error',reject);
    });
    const snapshots=sse=>sse.split('\\n\\n')
      .filter(block=>block.startsWith('event: snapshot\\n'))
      .map(block=>JSON.parse(block.match(/^data: (.*)$/m)[1]));
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once('listening',async()=>{
        const port=this.address().port;
        const query='hp laptop';
        try{
          const sse=await fetchLocal(port,'/api/search/stream?q='+encodeURIComponent(query));
          const emitted=snapshots(sse.body);
          const snapshot=emitted.at(-1);
          if(sse.status!==200 || !snapshot?.nextCursor || emitted.some(x=>x.nextCursor!==snapshot.nextCursor))
            throw Error('sse_missing_consistent_cursor');
          const next=await fetchLocal(port,'/api/search?q='+encodeURIComponent(query)+'&cursor='+encodeURIComponent(snapshot.nextCursor));
          const expanded=JSON.parse(next.body);
          if(next.status!==200 || expanded.coverage?.acquisitionDepth!==1 || !expanded.nextCursor)
            throw Error('sse_cursor_not_accepted');
          const wrong=await fetchLocal(port,'/api/search?q=ps5&cursor='+encodeURIComponent(snapshot.nextCursor));
          if(wrong.status!==400)throw Error('cursor_not_bound_to_original_query');
          const json=await fetchLocal(port,'/api/search?q='+encodeURIComponent(query));
          if(json.status!==200)throw Error('plain_search_failed');
          const cached=await fetchLocal(port,'/api/search/stream?q='+encodeURIComponent(query));
          const cachedLast=snapshots(cached.body).at(-1);
          if(!cachedLast?.nextCursor)throw Error('cached_sse_missing_cursor');
          console.log('RESULT '+JSON.stringify({
            cursor:true,expansionDepth:expanded.coverage.acquisitionDepth,
            nextCursor:true,wrongQueryRejected:true,
            cachedCursor:true,cachedMode:cachedLast.cache?.mode||null,
          }));
        } catch(e){console.log('FAIL '+e.stack);process.exitCode=1}
        finally{this.close(()=>process.exit(process.exitCode||0))}
      });
      return listen.apply(this,args);
    };
    await import('./server/server.mjs');
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:50000,
  });
  const failure=stdout.split('\n').find(x=>x.startsWith('FAIL '));
  assert.equal(failure,undefined,failure);
  const line=stdout.split('\n').find(x=>x.startsWith('RESULT '));
  assert.ok(line,stdout);
  const result=JSON.parse(line.slice(7));
  assert.equal(result.cursor,true);
  assert.equal(result.expansionDepth,1);
  assert.equal(result.nextCursor,true);
  assert.equal(result.wrongQueryRejected,true);
  assert.equal(result.cachedCursor,true);
});
