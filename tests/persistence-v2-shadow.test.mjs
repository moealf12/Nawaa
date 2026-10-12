import test from 'node:test';
import assert from 'node:assert/strict';
import {recordOfferWithV2Shadow} from '../server/persistence-v2-shadow.mjs';
import {initV2} from '../server/persistence-v2.mjs';
import {initShadowOutbox} from '../server/persistence-v2-outbox.mjs';
const offer={title:'Demo',sourceUrl:'https://example.com/a',productPrice:50,currency:'SAR'};
test('shadow is disabled by default and legacy always runs',async()=>{
 let legacy=0,shadow=0;
 const result=await recordOfferWithV2Shadow(offer,{env:{},legacy:async()=>{legacy++;return {recorded:true}},v2:async()=>{shadow++}});
 assert.equal(legacy,1);assert.equal(shadow,0);assert.equal(result.shadow.enabled,false);
});
test('explicit enabled shadow requires isolated CI pool',async()=>{
 await assert.rejects(recordOfferWithV2Shadow(offer,{env:{NAWAA_PERSISTENCE_V2_SHADOW:'1'},legacy:async()=>({recorded:true}),v2:async()=>{}}),/ephemeral_pool/);
});
test('enabled shadow leaves successful legacy result untouched when shadow fails',async()=>{
 const r=await recordOfferWithV2Shadow(offer,{env:{NAWAA_PERSISTENCE_V2_SHADOW:'1',NAWAA_CI_EPHEMERAL_DB:'1'},v2Pool:{},legacy:async()=>({recorded:true}),v2:async()=>{throw new Error('test_failure')}});
 assert.equal(r.legacyResult.recorded,true);assert.equal(r.shadow.ok,false);
});
test('enabled shadow receives stable supplied job id',async()=>{
 let captured;const id='00000000-0000-4000-8000-000000000001';
 const r=await recordOfferWithV2Shadow(offer,{env:{NAWAA_PERSISTENCE_V2_SHADOW:'1',NAWAA_CI_EPHEMERAL_DB:'1'},v2Pool:{},ingestionId:id,legacy:async()=>({recorded:true}),v2:async(_p,_o,args)=>{captured=args.ingestionId;return {duplicate:false}}});
 assert.equal(captured,id);assert.equal(r.shadow.ok,true);
});

test('V2 schema bootstrap rejects production-like database before opening connection',async()=>{
 let connects=0;
 const unsafePool={connect:async()=>{connects++;throw new Error('unsafe_connection_opened')}};
 const env={NAWAA_CI_EPHEMERAL_DB:'1',DATABASE_URL:'postgresql://nawaa:nawaa_ci@db.example.net:5432/nawaa_ci',DATABASE_SSL:'false'};
 await assert.rejects(initV2(unsafePool,{env}),/ephemeral_database_only/);
 await assert.rejects(initShadowOutbox(unsafePool,{env}),/ephemeral_database_only/);
 assert.equal(connects,0,'invalid environment must not open SQL connections');
});
