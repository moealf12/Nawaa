import test from 'node:test';
import assert from 'node:assert/strict';
import {searchExtraUnbxd,EXTRA_PROJECTION_FIELDS} from '../server/providers/extra-unbxd.mjs';

// A fresh WHATWG Response exercises Node's real text/json body readers.
const payloads=[
  {response:{numberOfProducts:3,products:[
    {uniqueId:'1',name:'Apple iPhone 17 256GB Black',currentPrice:3999,available:true,featureEnBrandName:'Apple',featureEnMemoryInternal:'256GB'},
    {uniqueId:'2',name:'Protective Case for iPhone 17',currentPrice:99,available:true},
    {uniqueId:'3',name:'ايفون 17 512GB White',currentPrice:4299,available:false}
  ]}},
  {response:{numberOfProducts:0,products:[]}},
  {response:{numberOfProducts:3,products:[
    {uniqueId:'3',name:'iPhone 17 256GB',price:'not-a-price'},
    {uniqueId:'4',name:'Apple iPhone 17 256GB',price:3499,featureEnColor:'Black'},
    {uniqueId:'4',name:'Apple iPhone 17 256GB',price:3499,featureEnColor:'Black'}
  ]}},
  {response:{numberOfProducts:1,products:[]}},
  {response:{numberOfProducts:3,products:[{uniqueId:'ar',name:'آيفون 17 256 جيجابايت',price:3799}]}},
  {response:{numberOfProducts:1,products:'wrong-shape'}},
];
const normalizeResult = value => JSON.parse(JSON.stringify(value,(key,item)=>key==='observedAt'?'FIXED_IN_TEST':item));
async function attempt({split,body,status=200,signal}){
  const originalFetch=globalThis.fetch;
  const extra=process.env.NAWAA_PROFILE_EXTRA,detail=process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;
  const originalLog=console.log;
  const records=[];
  process.env.NAWAA_PROFILE_EXTRA='1';
  if(split)process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON='1';
  else delete process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(body,{status,headers:{'content-type':'application/json'}})};
  console.log=(...parts)=>{if(typeof parts[0]==='string'&&parts[0].startsWith('EXTRA_PHASE_TIMING '))records.push(JSON.parse(parts[0].slice('EXTRA_PHASE_TIMING '.length)))};
  try{
    const result=await searchExtraUnbxd('iPhone 17',12,'iPhone 17',{signal});
    return {ok:true,value:normalizeResult(result),calls,records};
  }catch(error){return {ok:false,errorName:error.name,errorMessage:error.message,calls,records}}
  finally{
    globalThis.fetch=originalFetch;
    console.log=originalLog;
    if(extra===undefined)delete process.env.NAWAA_PROFILE_EXTRA;else process.env.NAWAA_PROFILE_EXTRA=extra;
    if(detail===undefined)delete process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;else process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON=detail;
  }
}
test('diagnostic text plus JSON.parse yields identical eXtra offers, provenance and errors',async()=>{
  for(const payload of payloads){
    const body=JSON.stringify(payload);
    const a=await attempt({split:false,body});
    const b=await attempt({split:true,body});
    assert.deepStrictEqual({ok:b.ok,value:b.value,errorName:b.errorName,errorMessage:b.errorMessage,calls:b.calls},
      {ok:a.ok,value:a.value,errorName:a.errorName,errorMessage:a.errorMessage,calls:a.calls});
    if(a.ok){
      assert.equal(a.records.length,1);
      assert.equal(b.records.length,1);
      assert.ok(Number.isFinite(b.records[0].bodyReadDecodeMs));
      assert.ok(Number.isFinite(b.records[0].jsonParseMs));
      assert.ok(b.records[0].bodyReadDecodeMs>=0);
      assert.ok(b.records[0].jsonParseMs>=0);
      assert.equal(b.records[0].products,a.records[0].products);
      assert.equal(b.records[0].offers,a.records[0].offers);
    }
  }
});
test('malformed JSON, invalid encoding replacement, status failures and pre-aborted requests retain outcomes',async()=>{
  const inputs=[
    {body:'{"response":'},
    {body:'null'},
    {body:'not-json'},
    {body:'{"response":{"numberOfProducts":0,"products":[]}}\n'},
    {body:JSON.stringify(payloads[0]),status:503},
  ];
  for(const input of inputs){
    const a=await attempt({...input,split:false});
    const b=await attempt({...input,split:true});
    assert.deepStrictEqual({ok:b.ok,value:b.value,errorName:b.errorName,errorMessage:b.errorMessage,calls:b.calls},
      {ok:a.ok,value:a.value,errorName:a.errorName,errorMessage:a.errorMessage,calls:a.calls});
  }
  const controller=new AbortController();
  controller.abort(new Error('synthetic-cancel'));
  const a=await attempt({body:JSON.stringify(payloads[0]),split:false,signal:controller.signal});
  const b=await attempt({body:JSON.stringify(payloads[0]),split:true,signal:controller.signal});
  assert.deepStrictEqual({ok:b.ok,errorName:b.errorName,errorMessage:b.errorMessage,calls:b.calls},
    {ok:a.ok,errorName:a.errorName,errorMessage:a.errorMessage,calls:a.calls});
  assert.equal(a.calls,0);
});

test('eXtra projects all mapped fields by default while diagnostic opt-out retains full response',async()=>{
  const original=globalThis.fetch;
  const previousLog=console.log;
  const profile=process.env.NAWAA_PROFILE_EXTRA;
  const split=process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;
  const seen=[];
  delete process.env.NAWAA_PROFILE_EXTRA;
  delete process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    seen.push(u.searchParams.get('fields'));
    return new Response(JSON.stringify({response:{numberOfProducts:0,products:[]}}),{
      status:200,headers:{'content-type':'application/json'}
    });
  };
  try{
    const a=await searchExtraUnbxd('PS5',100,'PS5');
    const b=await searchExtraUnbxd('PS5',100,'PS5',{probeFields:[]});
    assert.deepStrictEqual(a,b);
    assert.equal(seen.length,2);
    assert.deepStrictEqual(seen[0].split(','),[...EXTRA_PROJECTION_FIELDS]);
    assert.equal(seen[1],null);
    for(const required of ['_root_','uniqueId','name','currentPrice','imageUrl',
      'available','featureEnMemoryInternal','modelNumber','barCode','nameAr']){
      assert.ok(EXTRA_PROJECTION_FIELDS.includes(required),'essential field '+required);
    }
  }finally{
    globalThis.fetch=original;
    console.log=previousLog;
    if(profile===undefined)delete process.env.NAWAA_PROFILE_EXTRA;
    else process.env.NAWAA_PROFILE_EXTRA=profile;
    if(split===undefined)delete process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON;
    else process.env.NAWAA_PROFILE_EXTRA_SPLIT_JSON=split;
  }
});
