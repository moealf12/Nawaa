import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// E1 SKU/MPN/title/price come from official 2026-10-18 Jarir observations.
// The aging and merchant status transition below are TEST FIXTURES, not
// assertions that Jarir changed a price or stock. No Meili service/paid APIs.
test('v15.19 RED actual Meili client preserves merchant observation and rejects expired indexed stock and exact flags',async()=>{
  const script=String.raw`
    import assert from 'node:assert/strict';
    process.env.MEILI_HOST='http://127.0.0.1:7719';
    process.env.MEILI_MASTER_KEY='test-only-no-service';
    process.env.MEILI_INDEX='offers';
    const sourceTime=new Date(Date.now()-8*60*60*1000).toISOString();
    let sent=null,queryCalls=0;
    const original={
      sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-670688.html',
      title:'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with Fornite Flowering Chaos, White',
      productPrice:2299,currency:'SAR',availability:'in_stock',
      merchant:'Jarir',merchantCountryCode:'SA',condition:'new',
      observedAt:sourceTime,exactMatch:true,matchConfidence:1,
      specs:{brand:'Sony',modelNumber:'CFI2116AFNTVC'},
      sourceMeta:{productId:'670688'}
    };
    globalThis.fetch=async(input,options={})=>{
      const method=options.method||input?.method||'GET';
      const url=String(input?.url||input);
      if(method==='POST'&&url.includes('/documents')){
        const data=typeof options.body==='string'?options.body:await options.body?.text?.();
        sent=JSON.parse(data);
        return Response.json({taskUid:1,indexUid:'offers',status:'enqueued',
          type:'documentAdditionOrUpdate',enqueuedAt:new Date().toISOString()},{status:202});
      }
      if(url.includes('/search')){
        queryCalls++;
        return Response.json({hits:[{
          ...sent[0],dataKind:'indexed'
        },{...original,sourceUrl:original.sourceUrl.replace('670688','677770'),
          title:'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with DualSense Wireless Controller, White',
          sourceMeta:{productId:'677770'},specs:{brand:'Sony',modelNumber:'CFI2116ACFIZC'},
          productPrice:3049,observedAt:sourceTime,exactMatch:true
        }],estimatedTotalHits:2});
      }
      throw Error('unwanted outbound request '+method+' '+url);
    };
    const {indexOffers,searchIndexedOffers}=await import('./server/search-index.mjs');
    await indexOffers([original]);
    assert.ok(Array.isArray(sent)&&sent.length===1,'Meili SDK must submit one document');
    assert.equal(sent[0].observedAt,sourceTime,
      'indexing must NEVER mint current merchant observation timestamp');
    assert.equal(sent[0].sourceMeta?.productId,'670688',
      'merchant SKU must remain recoverable from the durable index');
    assert.equal(sent[0].specs?.modelNumber,'CFI2116AFNTVC',
      'different PS5 retail chassis must remain distinct');
    const read=await searchIndexedOffers('PS5');
    assert.equal(read.offers.length,0,
      'stale records must not become fresh customer offers after a reread/reindex');
    const recentTime=new Date(Date.now()-2000).toISOString();
    const genuine={
      ...original,sourceUrl:original.sourceUrl.replace('670688','677770'),
      title:'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with DualSense Wireless Controller, White',
      sourceMeta:{productId:'677770'},
      specs:{brand:'Sony',modelNumber:'CFI2116ACFIZC'},
      productPrice:3049,availability:'unknown',observedAt:recentTime
    };
    await indexOffers([genuine]);
    const fresh=await searchIndexedOffers('PS5');
    assert.equal(fresh.offers.length,1,'only genuinely fresh indexed row survives');
    assert.equal(fresh.offers[0].sourceMeta.productId,'677770');
    assert.equal(fresh.offers[0].specs.modelNumber,'CFI2116ACFIZC');
    assert.equal(fresh.offers[0].observedAt,recentTime);
    assert.equal(fresh.offers[0].productPrice,3049);
    assert.equal(fresh.offers[0].availability,'unknown',
      'Constructor unknown stock must not be promoted to in_stock');
    assert.equal(fresh.offers[0].exactMatch,false,
      'persisted query-specific exactMatch:true must be removed on read');
    assert.equal(fresh.offers[0].matchConfidence,0);
    const previousSent=sent;
    const skipped=await indexOffers([{...genuine,observedAt:undefined}]);
    assert.equal(skipped.indexed,0,'unknown merchant observation must not mint current timestamp');
    assert.equal(sent,previousSent);
    console.log('RESULT '+JSON.stringify({preservedObservedAt:true,
      skuPreserved:true,mpnPreserved:true,expiredRejected:true,
      freshRetained:true,unknownStockPreserved:true,oldExactReset:true,queryCalls}));
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:12000,maxBuffer:1024*1024,
    env:{...process.env,DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:''}
  });
  const marker=stdout.split('\n').find(x=>x.startsWith('RESULT '));
  assert.ok(marker,stdout);
  const result=JSON.parse(marker.slice(7));
  assert.equal(result.expiredRejected,true);
});
