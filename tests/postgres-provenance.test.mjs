import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Runs only with an explicitly dedicated ephemeral CI PostgreSQL URL.
// Never default to production DATABASE_URL, and never log connection strings.
const connection=process.env.NAWAA_TEST_DATABASE_URL||'';
test('v15.19 RED real PostgreSQL two-process replay must not turn old Jarir observation into newer price/stock', {skip:!connection}, async()=>{
  const initial=String.raw`
    import {recordOffer,persistOffers} from './server/persistence.mjs';
    const now=Date.now();
    const current=new Date(now-3_000).toISOString();
    const old=new Date(now-24*60*60_000).toISOString();
    const game={
      sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-670688.html',
      title:'Sony PS5 Slim Disc Console Bundle with Fortnite Flowering Chaos',
      merchant:'Jarir',sourceName:'Jarir',currency:'SAR',condition:'new',
      sku:'670688',specs:{brand:'Sony',modelNumber:'CFI2116AFNTVC'},
      exactMatch:true,matchConfidence:1
    };
    // Simulated future source update; NOT an observed real Jarir price/stock.
    await recordOffer({...game,productPrice:2399,
      availability:'out_of_stock',observedAt:current});
    // Delayed old pipeline payload attempts to overwrite the newer evidence.
    await persistOffers('PS5',[{...game,productPrice:2299,
      availability:'in_stock',observedAt:old}]);
    const controller={
      sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-677770.html',
      title:'Sony PS5 Slim Disc Console Bundle with DualSense Wireless Controller',
      merchant:'Jarir',sourceName:'Jarir',currency:'SAR',condition:'new',
      sku:'677770',productPrice:3049,availability:'unknown',
      specs:{brand:'Sony',modelNumber:'CFI2116ACFIZC'},
      exactMatch:true,matchConfidence:1,observedAt:old
    };
    await persistOffers('PS5',[controller]);
    console.log('STAGE1 '+JSON.stringify({ok:true,current,old}));
    process.exit(0);
  `;
  const second=String.raw`
    import {searchPersistedOffers} from './server/persistence.mjs';
    import {assessOfferMatch} from './src/search-query.mjs';
    const rows=(await searchPersistedOffers('PS5',{maxAgeHours:168})).offers;
    const a=rows.find(x=>x.sku==='670688');
    const leaked=rows.some(x=>x.sku==='677770');
    // Audit durable storage directly, without routing the old document to
    // customer search. Historical price provenance should still exist in DB.
    const pg=(await import('pg')).default;
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
    const raw=await pool.query('select payload, observed_at from nawaa_offers where sku=$1',['677770']);
    await pool.end();
    const stored=raw.rows[0];
    const b=stored&&{...stored.payload,
      observedAt:stored.observed_at instanceof Date?stored.observed_at.toISOString():stored.observed_at};
    console.log('STAGE2 '+JSON.stringify({a:a&&{
      price:a.productPrice,stock:a.availability,observedAt:a.observedAt,
      exact:assessOfferMatch('PS5 DualSense Bundle',a).exactMatch},
      b:b&&{price:b.productPrice,stock:b.availability,
        observedAt:b.observedAt,exact:assessOfferMatch('PS5 DualSense Bundle',b).exactMatch},
      historicalLeakedToCustomer:leaked,count:rows.length}));
    process.exit(0);
  `;
  const run=async(script)=>{
    const env={...process.env,DATABASE_URL:connection,DATABASE_SSL:'false',
      NODE_ENV:'test',MEILI_HOST:'',MEILI_MASTER_KEY:''};
    const {stdout}=await promisify(execFile)(process.execPath,
      ['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),
      env,timeout:25000,maxBuffer:1024*1024});
    return stdout;
  };
  const run1=await run(initial);
  const line=run1.split('\n').find(x=>x.startsWith('STAGE1 '));
  assert.ok(line,'stage1 did not finish');
  const sourceTime=JSON.parse(line.slice(7));
  const run2=await run(second);
  const secondLine=run2.split('\n').find(x=>x.startsWith('STAGE2 '));
  assert.ok(secondLine,'stage2 did not finish');
  const actual=JSON.parse(secondLine.slice(7));
  assert.equal(actual.a?.price,2399,'older payload must never overwrite newer source price');
  assert.equal(actual.a?.stock,'out_of_stock','older payload must not resurrect a buyable stock claim');
  assert.equal(new Date(actual.a?.observedAt).getTime(),
    new Date(sourceTime.current).getTime(),'merchant observedAt must survive upsert unchanged');
  assert.equal(actual.a?.exact,false,'Fortnite-only game bundle cannot match DualSense intent');
  assert.equal(actual.historicalLeakedToCustomer,false,
    'seven-day old persisted offers must not be re-certified as fresh customer stock/price');
  assert.equal(actual.b?.price,3049);
  assert.equal(actual.b?.stock,'unknown');
  assert.equal(new Date(actual.b?.observedAt).getTime(),
    new Date(sourceTime.old).getTime(),'inserting old source must not mint a fresh database observation');
  assert.equal(actual.b?.exact,true,'genuine controller bundle remains distinct');
});
