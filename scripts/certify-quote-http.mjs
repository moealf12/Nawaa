import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import pg from 'pg';
const db=process.env.NAWAA_TEST_DATABASE_URL;
assert.equal(process.env.NODE_ENV,'test');
assert.equal(new URL(db).hostname,'127.0.0.1');
assert.equal(new URL(db).pathname,'/omega_ci');
const admin='omega_quote_disposable_admin_test_token_only_2026',port=17893;
const child=spawn(process.execPath,['server/server.mjs'],{env:{...process.env,PORT:String(port),NAWAA_QUOTE_TEST_ENABLED:'1',NAWAA_QUOTE_TEST_ADMIN_TOKEN:admin,DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',b=>log+=String(b));child.stderr.on('data',b=>log+=String(b));
async function req(path,method='GET',body,token){
 const headers={};if(token)headers.authorization='Bearer '+token;
 if(body!==undefined)headers['content-type']='application/json';
 const r=await fetch('http://127.0.0.1:'+port+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 return {code:r.status,data:await r.json(),cache:r.headers.get('cache-control')};
}
const pool=new pg.Pool({connectionString:db,ssl:false});
const create=(name='Sony PS5 Slim')=>req('/api/quotes','POST',{productName:name,model:'CFI2116A',sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5.html'});
const price=(id,priceSAR='3499.95')=>req('/api/quote-admin/'+id+'/quote','POST',{priceSAR,etaDays:7,terms:'عرض تجريبي لا يتم الدفع',validForSeconds:3600},admin);
const decide=(id,token,revision,decision)=>req('/api/quotes/'+id+'/decision','POST',{revision,decision},token);
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await req('/health')).code===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
 assert.ok(ready,log.slice(-350));
 assert.equal((await req('/api/quotes','POST',{productName:'a'})).code,422);
 const first=await create();assert.equal(first.code,201,JSON.stringify(first.data));
 const {id,token}=first.data;assert.match(id,/^[a-f0-9-]{36}$/);assert.ok(token.length>=40);
 assert.equal((await req('/api/quotes/'+id)).code,404);
 assert.equal((await req('/api/quotes/'+id,'GET',undefined,'wrong')).code,404);
 const mine=await req('/api/quotes/'+id,'GET',undefined,token);
 assert.equal(mine.code,200);assert.equal(mine.data.status,'requested');
 assert.match(mine.cache||'',/no-store/);assert.ok(!JSON.stringify(mine.data).includes('token_sha'));
 assert.equal((await req('/api/quote-admin/requests')).code,401);
 const list=await req('/api/quote-admin/requests','GET',undefined,admin);
 assert.equal(list.code,200);assert.ok(list.data.requests.some(x=>x.id===id));
 assert.equal((await req('/api/quote-admin/'+id+'/quote','POST',{priceSAR:'3499.95',etaDays:7,terms:'abc',validForSeconds:3600},'wrong')).code,401);
 const quoted=await price(id);assert.equal(quoted.code,200,JSON.stringify(quoted.data));
 assert.equal(quoted.data.revision,1);assert.equal(quoted.data.priceSAR,3499.95);
 assert.equal((await decide(id,token,0,'accepted')).code,409);
 const race=await Promise.all([decide(id,token,1,'accepted'),decide(id,token,1,'declined')]);
 assert.deepEqual(race.map(x=>x.code).sort(),[200,409]);
 assert.equal((await price(id)).code,409);
 const second=await create('Apple iPhone 17');assert.equal(second.code,201);
 assert.equal((await price(second.data.id)).code,200);
 await pool.query("UPDATE nawaa_ci_quote_requests SET valid_until=now()-interval '1 second' WHERE id=$1",[second.data.id]);
 assert.equal((await decide(second.data.id,second.data.token,1,'accepted')).code,409);
 assert.equal((await req('/api/quotes/'+second.data.id,'GET',undefined,second.data.token)).data.status,'expired');
 const revised=await price(second.data.id,'3299.50');assert.equal(revised.code,200);assert.equal(revised.data.revision,2);
 assert.equal((await decide(second.data.id,second.data.token,1,'accepted')).code,409);
 assert.equal((await decide(second.data.id,second.data.token,2,'accepted')).code,200);
 // New P0: a timed-out client retry must not create duplicate durable requests.
 const sameKey='omega-idempotency-customer-test-key-2026-001';
 const customerPayload={productName:'Sony PlayStation 5 Slim',model:'CFI2116A',
  sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5.html'};
 const createWithKey=async (payload=customerPayload,key=sameKey)=>{
  const r=await fetch('http://127.0.0.1:'+port+'/api/quotes',{method:'POST',
   headers:{'content-type':'application/json','idempotency-key':key},
   body:JSON.stringify(payload)});
  return {code:r.status,data:await r.json()};
 };
 const duplicates=await Promise.all(Array.from({length:8},()=>createWithKey()));
 assert.ok(duplicates.every(r=>[200,201].includes(r.code)),
  '8 parallel client retries must all receive a valid persisted request');
 const ids=new Set(duplicates.map(r=>r.data.id));
 const tokens=new Set(duplicates.map(r=>r.data.token));
 assert.equal(ids.size,1,'exactly one persisted request identity under racing retries');
 assert.equal(tokens.size,1,'retried request must recover the same authorized customer capability');
 const keyRow=(await pool.query('SELECT count(*)::int AS n FROM nawaa_ci_quote_requests WHERE id=$1',
  [duplicates[0].data.id])).rows[0];
 assert.equal(keyRow.n,1,'real PostgreSQL enforces exactly one durable row');
 const replay=await createWithKey();
 assert.equal(replay.code,200,'replayed request must not be called a new creation');
 assert.equal(replay.data.id,duplicates[0].data.id);
 assert.equal(replay.data.token,duplicates[0].data.token);
 const keyConflict=await createWithKey({...customerPayload,productName:'Different model'});
 assert.equal(keyConflict.code,409,'same key with altered customer payload must conflict');
 const invalidKey=await createWithKey(customerPayload,'short');
 assert.equal(invalidKey.code,422,'weak idempotency keys are not accepted');
 console.log('REAL_QUOTE_IDEMPOTENCY '+JSON.stringify({actualHTTP:true,postgres16:true,
  concurrentRetries:8,uniqueRequests:ids.size,stableCapability:tokens.size===1,
  conflictRejected:true,weakKeyRejected:true}));
 console.log('REAL_QUOTE_LIFECYCLE '+JSON.stringify({actualHTTP:true,postgres16:true,persistedRequests:2,authorization:true,revisionCAS:true,concurrentSingleWinner:true,expiredRejected:true,revisedAccepted:true,disposableOnly:true}));
}finally{child.kill('SIGKILL');await pool.end()}
