import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSourceFailures,coverageStatusText} from '../src/search-coverage-status.mjs';

test('optional storefront HTTP, transport and unverified offers are classified without discarding originals',()=>{
  const errors=[
    {sourceId:'free-storefronts',market:'nike-sa',error:'HTTP 403'},
    {sourceId:'free-storefronts',market:'nike-sa',error:'fetch failed'},
    {sourceId:'free-storefronts',market:'walmart-us',error:'No verified structured-price product pages found'},
  ];
  const before=structuredClone(errors);
  assert.deepStrictEqual(summarizeSourceFailures(errors),{
    errorsReported:3,sourcesAffected:2,coreSourcesAffected:0,optionalSourcesAffected:2,
    searchErrors:0,types:{http:1,transport:1,timeout:0,unverifiedOffers:1,malformed:0,other:0},
  });
  assert.deepStrictEqual(errors,before);
  assert.match(coverageStatusText({partial:true,sourceFailures:summarizeSourceFailures(errors)},errors),/الإضافية/);
});
test('core and optional failures remain distinct from global request deadline errors',()=>{
  const errors=[
    {sourceId:'jarir-direct',error:'HTTP 503'},
    {sourceId:'extra-unbxd',error:'Malformed product response'},
    {sourceId:'free-storefronts:amazon-sa',error:'fetch failed'},
    {sourceId:'free-storefronts',market:'temu-global',error:'store_deadline_exceeded:temu-global'},
    {sourceId:'search',error:'search_stream_deadline_exceeded'},
  ];
  const result=summarizeSourceFailures(errors);
  assert.deepStrictEqual([result.sourcesAffected,result.coreSourcesAffected,result.optionalSourcesAffected,result.searchErrors],[4,3,1,1]);
  assert.deepStrictEqual(result.types,{http:1,transport:1,timeout:1,unverifiedOffers:0,malformed:1,other:0});
  assert.match(coverageStatusText({sourceFailures:result},errors),/الأساسية والإضافية/);
  assert.match(coverageStatusText({deadlineExceeded:true,sourceFailures:result},errors),/مهلة البحث/);
  assert.match(coverageStatusText({providersPending:1,sourceFailures:result},errors),/جاريًا/);
});
test('clean no-result completion stays clean; no error hiding or fabricated failure count',()=>{
  const empty=summarizeSourceFailures([]);
  assert.equal(empty.errorsReported,0);
  assert.equal(empty.sourcesAffected,0);
  assert.equal(coverageStatusText({partial:false,sourceFailures:empty},[]),"");
  assert.equal(coverageStatusText({partial:true,providersPending:0,sourceFailures:empty},[]),"");
  const bad={sourceId:'free-storefronts',market:'../../unexpected',error:'request failed'};
  assert.equal(summarizeSourceFailures([bad]).sourcesAffected,1);
  assert.equal(summarizeSourceFailures([{sourceId:'search',error:'search_stream_deadline_exceeded'}]).searchErrors,1);
});
test('preexisting partial metadata is never reclassified as complete by status helper',()=>{
  const failures=summarizeSourceFailures([{sourceId:'free-storefronts',market:'bestbuy-us',error:'HTTP 403'}]);
  const coverage={partial:true,complete:false,providersPending:0,sourceFailures:failures};
  assert.match(coverageStatusText(coverage,[]),/نتائج جزئية/);
  assert.equal(coverage.partial,true);assert.equal(coverage.complete,false);
});
