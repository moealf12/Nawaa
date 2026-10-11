import {createHash} from 'node:crypto';
import {recordOfferV2,assertEphemeralDatabase} from './persistence-v2.mjs';

// Re-runnable isolated migration of legacy canonical snapshots. Never mutates
// legacy tables or claims to reconstruct missing historical observations.
export async function backfillV2Snapshots(pool,{env=process.env,batchSize=25,stopAfter=Infinity}={}) {
  assertEphemeralDatabase(env);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw new Error('invalid_batch_size');
  await pool.query(`CREATE TABLE IF NOT EXISTS nawaa_v2_backfill_progress(
    legacy_id bigint PRIMARY KEY, outcome text NOT NULL CHECK(outcome IN ('copied','unresolved')),
    processed_at timestamptz NOT NULL DEFAULT now())`);
  let copied=0,unresolved=0;
  while(copied+unresolved<stopAfter){
    const items=await pool.query(`SELECT id,source_url,merchant,sku,condition,product_price,currency,observed_at,payload
      FROM nawaa_offers WHERE id NOT IN(SELECT legacy_id FROM nawaa_v2_backfill_progress)
      ORDER BY id ASC LIMIT $1`,[Math.min(batchSize,stopAfter-copied-unresolved)]);
    if(!items.rows.length)break;
    for(const row of items.rows) {
      // Per-row advisory lock makes separate workers serialize before checking
      // progress; the lock and marker are committed with the V2 observation.
      const client=await pool.connect();
      try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1,$2)',[17031,Number(row.id)%2147483647]);
      const existing=await client.query('SELECT 1 FROM nawaa_v2_backfill_progress WHERE legacy_id=$1',[row.id]);
      if(existing.rowCount){await client.query('COMMIT');continue;}
      // Lock and reread the canonical row after obtaining the migration lock. 
      // Otherwise a concurrent legacy price update can make the prefetched row stale. 
      const freshResult=await client.query(`SELECT source_url,merchant,sku,condition,product_price,currency,observed_at,payload 
        FROM nawaa_offers WHERE id=$1 FOR UPDATE`,[row.id]); 
      if(!freshResult.rowCount)throw new Error('legacy_row_disappeared'); 
      const current=freshResult.rows[0]; 
      const payload=current.payload||{};
      const sourceId=payload.sourceId||payload.sourceName;
      const sourceListingId=payload.sourceListingId||payload.sourceProductId;
      const sourceVariantId=payload.sourceVariantId||payload.variantId;
      const sku=payload.sku||current.sku;
      // Do not invent source IDs or variant keys for unresolved historical data.
      if(!sourceId||!(sourceVariantId||sku)){
        await client.query("INSERT INTO nawaa_v2_backfill_progress(legacy_id,outcome) VALUES($1,'unresolved') ON CONFLICT DO NOTHING",[row.id]);
        unresolved++;await client.query('COMMIT');continue;
      }
      const identityInput={...payload,sourceId,sourceListingId,sourceVariantId,sku,
        sourceUrl:current.source_url,condition:current.condition||'new',
        productPrice:Number(current.product_price),currency:current.currency,observedAt:current.observed_at};
      const ingestionId=deterministicUUID('legacy:'+row.id);
      try {
        const txPool={connect:async()=>({query:async(sql,args)=>{
          const cmd=typeof sql==='string'?sql.trim().toUpperCase():'';
          if(cmd==='BEGIN')return client.query('SAVEPOINT nawaa_backfill_v2');
          if(cmd==='COMMIT')return client.query('RELEASE SAVEPOINT nawaa_backfill_v2');
          if(cmd==='ROLLBACK')return client.query('ROLLBACK TO SAVEPOINT nawaa_backfill_v2');
          return client.query(sql,args);
        },release:()=>{}})};
        await recordOfferV2(txPool,identityInput,{ingestionId});
        await client.query("INSERT INTO nawaa_v2_backfill_progress(legacy_id,outcome) VALUES($1,'copied') ON CONFLICT DO NOTHING",[row.id]);
        copied++;await client.query('COMMIT');
      }catch(error){
        if(['missing_variant_disambiguator','unresolved_variant_identity','invalid_source_id'].includes(error.message)){
          await client.query("INSERT INTO nawaa_v2_backfill_progress(legacy_id,outcome) VALUES($1,'unresolved') ON CONFLICT DO NOTHING",[row.id]);
          unresolved++;await client.query('COMMIT');continue;
        }
        throw error; // Do not mark a broken import complete.
      }
      }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
      finally{client.release()}
    }
  }
  return {copied,unresolved};
}
function deterministicUUID(input){
 const h=createHash('sha256').update('nawaa-v2:'+input).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
