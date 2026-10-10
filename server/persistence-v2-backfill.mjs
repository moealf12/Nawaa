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
      const payload=row.payload||{};
      const sourceId=payload.sourceId||payload.sourceName;
      const sourceListingId=payload.sourceListingId||payload.sourceProductId;
      const sourceVariantId=payload.sourceVariantId||payload.variantId;
      const sku=payload.sku||row.sku;
      // Do not invent source IDs or variant keys for unresolved historical data.
      if(!sourceId||!(sourceVariantId||sku)){
        await pool.query("INSERT INTO nawaa_v2_backfill_progress(legacy_id,outcome) VALUES($1,'unresolved') ON CONFLICT DO NOTHING",[row.id]);
        unresolved++;continue;
      }
      const identityInput={...payload,sourceId,sourceListingId,sourceVariantId,sku,
        sourceUrl:row.source_url,condition:row.condition||'new',
        productPrice:Number(row.product_price),currency:row.currency,observedAt:row.observed_at};
      const ingestionId=deterministicUUID('legacy:'+row.id);
      try {
        await recordOfferV2(pool,identityInput,{ingestionId});
        await pool.query("INSERT INTO nawaa_v2_backfill_progress(legacy_id,outcome) VALUES($1,'copied') ON CONFLICT DO NOTHING",[row.id]);
        copied++;
      }catch(error){
        if(['missing_variant_disambiguator','unresolved_variant_identity','invalid_source_id'].includes(error.message)){
          await pool.query("INSERT INTO nawaa_v2_backfill_progress(legacy_id,outcome) VALUES($1,'unresolved') ON CONFLICT DO NOTHING",[row.id]);
          unresolved++;continue;
        }
        throw error; // Do not mark a broken import complete.
      }
    }
  }
  return {copied,unresolved};
}
function deterministicUUID(input){
 const h=createHash('sha256').update('nawaa-v2:'+input).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
