import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
const cwd=new URL('..',import.meta.url);

async function runPersistence(body,{failUpsert=false}={}){
  const pgModule=`
    export default {Pool:class {
      constructor(){globalThis.calls.push(['pool']);}
      async query(sql){globalThis.calls.push(['init',String(sql)]);return {rows:[]};}
      async connect(){
        globalThis.calls.push(['connect']);
        return {
          async query(sql,params){
            const text=String(sql);
            globalThis.calls.push(['tx',text,params]);
            if(${JSON.stringify(failUpsert)}&&text.includes('insert into nawaa_offers'))throw new Error('upsert_failed');
            if(text.includes('insert into offer_observations'))return {rows:[{id:'42',validation_timestamp:new Date('2026-10-05T01:02:03.000Z')}]};
            return {rows:[]};
          },
          release(){globalThis.calls.push(['release']);}
        };
      }
    }};
  `;
  const script=`
    import {registerHooks} from 'node:module';
    globalThis.calls=[];
    registerHooks({resolve(specifier,context,next){
      if(specifier==='pg')return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(pgModule)}),shortCircuit:true};
      return next(specifier,context);
    }});
    process.env.DATABASE_URL='postgres://fixture';
    const {recordOffer}=await import('./server/persistence.mjs');
    try{
      const result=await recordOffer(${JSON.stringify(body)});
      console.log(JSON.stringify({ok:true,result,calls:globalThis.calls}));
    }catch(error){
      console.log(JSON.stringify({ok:false,error:error.message,calls:globalThis.calls}));
    }
  `;
  const {stdout}=await execFileAsync(process.execPath,['--input-type=module','-e',script],{cwd,timeout:10000});
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

test('recordOffer commits an immutable observation and canonical upsert in one transaction',async()=>{
  const result=await runPersistence({
    title:'HP Laptop',sourceUrl:'https://www.example.com/p?utm_source=test',productPrice:2499,
    currency:'sar',sourceName:'crawler-a',observedAt:'2026-10-05T01:02:03.000Z',condition:'NEW',
  });
  assert.equal(result.ok,true);
  const tx=result.calls.filter(call=>call[0]==='tx');
  assert.equal(tx[0][1],'BEGIN');
  assert.match(tx[1][1],/insert into offer_observations/);
  assert.match(tx[2][1],/insert into nawaa_offers/);
  assert.match(tx[2][1],/where nawaa_offers\.observed_at <= excluded\.observed_at/);
  assert.equal(tx[3][1],'COMMIT');
  assert.deepEqual(result.calls.at(-1),['release']);
  assert.equal(tx[1][2][0],'https://example.com/p');
  assert.equal(tx[1][2][3],'SAR');
  assert.equal(tx[2][2][0],'https://example.com/p|new');
});

test('concurrent persistence initialization executes schema DDL once',async()=>{
  const pgModule=`export default {Pool:class {async query(){globalThis.initCalls+=1;await new Promise(resolve=>setTimeout(resolve,20));return {rows:[]};}}};`;
  const script=`
    import {registerHooks} from 'node:module';
    globalThis.initCalls=0;
    registerHooks({resolve(specifier,context,next){if(specifier==='pg')return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(pgModule)}),shortCircuit:true};return next(specifier,context);}});
    process.env.DATABASE_URL='postgres://fixture';
    const {initPersistence}=await import('./server/persistence.mjs');
    const result=await Promise.all([initPersistence(),initPersistence(),initPersistence()]);
    console.log(JSON.stringify({initCalls:globalThis.initCalls,result}));
  `;
  const {stdout}=await execFileAsync(process.execPath,['--input-type=module','-e',script],{cwd,timeout:10000});
  const result=JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.initCalls,1);
  assert.ok(result.result.every(entry=>entry.configured&&entry.ready));
});

test('recordOffer rolls back and releases the connection when canonical upsert fails',async()=>{
  const result=await runPersistence({title:'HP Laptop',sourceUrl:'https://example.com/p',productPrice:2499,currency:'SAR'},{failUpsert:true});
  assert.equal(result.ok,false);
  assert.equal(result.error,'upsert_failed');
  const commands=result.calls.filter(call=>call[0]==='tx').map(call=>call[1]);
  assert.ok(commands.some(command=>command.includes('insert into offer_observations')));
  assert.ok(commands.some(command=>command.includes('insert into nawaa_offers')));
  assert.equal(commands.at(-1),'ROLLBACK');
  assert.ok(!commands.includes('COMMIT'));
  assert.deepEqual(result.calls.at(-1),['release']);
});

test('recordOffer rejects malformed URLs and currencies before opening the database',async()=>{
  for(const body of [
    {title:'HP Laptop',sourceUrl:'not-a-url',productPrice:2499,currency:'SAR'},
    {title:'HP Laptop',sourceUrl:'http://example.com/p',productPrice:2499,currency:'SAR'},
    {title:'HP Laptop',sourceUrl:'https://example.com/p',productPrice:2499,currency:'RIAL'},
  ]){
    const result=await runPersistence(body);
    assert.equal(result.ok,false);
    assert.equal(result.error,'invalid_offer_record');
    assert.deepEqual(result.calls,[]);
  }
});
