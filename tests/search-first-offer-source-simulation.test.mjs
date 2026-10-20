import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Exercise the actual HTTP/SSE server under isolated deterministic transport.
// Zero real merchant calls and no production credentials.
const scenarios = [
  {name:'extra-first', extraDelay:0, jarirDelay:180, first:'extra-sa', exact:'extra-sa'},
  {name:'jarir-first', extraDelay:180, jarirDelay:0, first:'jarir-sa', exact:'jarir-sa'},
  {name:'unrelated-first', extraDelay:0, jarirDelay:180, extraTitle:'Unrelated Kitchen Blender', first:'jarir-sa', exact:'jarir-sa'},
  {name:'related-before-exact', extraDelay:180, jarirDelay:0, jarirTitle:'Sony PlayStation 5 Pro Console 1TB', first:'jarir-sa', exact:'extra-sa', expectTwoMilestones:true},
  {name:'extra-fails', extraStatus:503, extraDelay:0, jarirDelay:120, first:'jarir-sa', exact:'jarir-sa', expectErrors:true},
  {name:'empty-both', extraTitle:null, jarirTitle:null, first:null, exact:null},
  {name:'cancel', extraDelay:0, jarirDelay:5000, first:'extra-sa', exact:'extra-sa', cancel:true},
  {name:'concurrent-arabic-english', concurrent:true},
];

const simScript=new URL('../scripts/simulate-source-first-offer.mjs',import.meta.url).pathname;

for(const scenario of scenarios){
  test('isolated cross-source SSE: '+scenario.name,async()=>{
    const {stdout,stderr}=await promisify(execFile)(process.execPath,[simScript],{
      cwd:new URL('..',import.meta.url),
      env:{...process.env,NAWAA_SCENARIO:JSON.stringify(scenario)},
      timeout:14000,maxBuffer:4*1024*1024,
    });
    const error=stdout.split('\n').find(line=>line.startsWith('SIMULATION_ERROR '));
    assert.equal(error,undefined,error||stderr);
    const output=stdout.split('\n').find(line=>line.startsWith('SOURCE_SIMULATION '));
    assert.ok(output,stdout+'\n'+stderr);
    const result=JSON.parse(output.slice('SOURCE_SIMULATION '.length)).result;
    if(scenario.concurrent){
      assert.equal(result.length,2);
      assert.ok(result.every(item=>item.done&&item.firstValid&&item.firstExact));
      assert.match(result[0].firstExact.title,/iphone 17/i);
      assert.match(result[1].firstExact.title,/playstation 5/i);
      assert.ok(result.every(item=>item.finalCount>=2));
      assert.ok(result.every(item=>item.firstPartial===true));
    }else{
      assert.equal(result.firstValid?.source||null,scenario.first);
      assert.equal(result.firstExact?.source||null,scenario.exact);
      if(scenario.cancel){
        assert.equal(result.done,false);
        assert.equal(result.canceled,true);
        assert.ok(result.canceledUpstream>=1,'client disconnect must abort slow source');
      }else{
        assert.equal(result.done,true);
        assert.ok(result.snapshots>=1);
        if(scenario.first){
          assert.equal(result.firstPartial,true,'early result must preserve partial coverage');
          assert.ok(result.finalSources.includes('jarir-sa')||scenario.expectErrors);
        }
        if(scenario.expectErrors)assert.ok(result.last.errors.some(e=>e.sourceId==='extra-unbxd'));
      }
      if(scenario.expectTwoMilestones){
        assert.equal(result.firstValid.exact,false);
        assert.ok(result.firstExactMs>=result.firstValidMs);
        assert.notEqual(result.firstExact.source,result.firstValid.source);
      }
      if(scenario.name==='unrelated-first'){
        assert.ok(!result.last.offers.some(o=>/blender/i.test(o.title)),
          'irrelevant provider result must not become a first offer');
      }
      if(scenario.first){
        assert.ok(result.firstValid.price>0);
        assert.ok(result.firstExact.price>0);
      }else assert.equal(result.finalCount,0);
    }
    console.log('SOURCE_SIMULATION_VERIFIED '+JSON.stringify({name:scenario.name,
      validSource:scenario.concurrent?result.map(x=>x.firstValid?.source):result.firstValid?.source||null,
      exactSource:scenario.concurrent?result.map(x=>x.firstExact?.source):result.firstExact?.source||null,
      firstValidMs:scenario.concurrent?result.map(x=>x.firstValidMs):result.firstValidMs,
      firstExactMs:scenario.concurrent?result.map(x=>x.firstExactMs):result.firstExactMs}));
  });
}
