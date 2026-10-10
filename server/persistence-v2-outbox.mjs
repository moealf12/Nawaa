import {randomUUID} from 'node:crypto';
import {deriveOfferIdentityV2} from './offer-identity-v2.mjs';
import {recordOfferV2,assertEphemeralDatabase} from './persistence-v2.mjs';

// Explicitly isolated CI prototype; NOT wired into current recordOffer or customer search.
// Both the legacy insert and outbox intent are committed by the SAME SQL transaction.
export async function initShadowOutbox(pool,{env=process.env}={}) {
  assertEphemeralDatabase(env);
  await pool.query(`
CREATE TABLE IF NOT EXISTS nawaa_v2_shadow_outbox(
 event_id uuid PRIMARY KEY, offer jsonb NOT NULL, status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','processing','completed','dead')),
 attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS nawaa_v2_shadow_outbox_ready ON nawaa_v2_shadow_outbox(status,next_attempt_at);
`);
}

export async function commitLegacyAndOutbox(pool,offer,{eventId=randomUUID(),env=process.env}={}) {
  assertEphemeralDatabase(env);
  // Require an actual verified variant before the legacy side may commit.
  deriveOfferIdentityV2(offer);
  const price=Number(offer.productPrice),at=new Date(offer.observedAt);
  if(!Number.isFinite(price)||price<=0||!/^[A-Z]{3}$/.test(String(offer.currency||''))||Number.isNaN(at.getTime()))
    throw new Error('invalid_legacy_offer');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const prior=await client.query('SELECT offer FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[eventId]);
    if(prior.rowCount){
      if(JSON.stringify(prior.rows[0].offer)!==JSON.stringify(offer)) throw new Error('event_id_payload_conflict');
      await client.query('COMMIT');
      return {eventId,duplicate:true};
    }
    // This isolated writer is a proof of atomic intent; production legacy recordOffer
    // currently owns its own transaction and MUST NOT be called within this transaction.
    await client.query(`INSERT INTO nawaa_offers(offer_key,source_url,title,merchant,sku,condition,product_price,currency,observed_at,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT(offer_key) DO UPDATE SET product_price=excluded.product_price,
      observed_at=excluded.observed_at,payload=excluded.payload
      WHERE nawaa_offers.observed_at < excluded.observed_at`,
      [offer.legacyOfferKey,offer.sourceUrl,offer.title||'Shadow fixture',offer.merchant||null,offer.sku||null,
      offer.condition||'new',price,offer.currency,at,JSON.stringify(offer)]);
    await client.query('INSERT INTO nawaa_v2_shadow_outbox(event_id,offer) VALUES($1,$2::jsonb)',[eventId,JSON.stringify(offer)]);
    await client.query('COMMIT');
    return {eventId,duplicate:false};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function processShadowOutbox(pool,{env=process.env,worker=recordOfferV2,max=10,now=new Date()}={}) {
  assertEphemeralDatabase(env);
  if(!Number.isInteger(max)||max<1||max>100)throw new Error('invalid_batch_size');
  const client=await pool.connect();
  const claimed=[];
  try{
    await client.query('BEGIN');
    const rows=await client.query(`
      SELECT event_id,offer,attempts,max_attempts FROM nawaa_v2_shadow_outbox
      WHERE ((status='pending' AND next_attempt_at<=$1) OR (status='processing' AND lease_until<=$1))
      ORDER BY created_at,event_id FOR UPDATE SKIP LOCKED LIMIT $2`,[now,max]);
    for(const row of rows.rows){
      await client.query(`UPDATE nawaa_v2_shadow_outbox
        SET status='processing', attempts=attempts+1,lease_until=$2::timestamptz+interval '60 seconds'
        WHERE event_id=$1`,[row.event_id,now]);
      claimed.push(row);
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const outcomes=[];
  for(const row of claimed){
    try{
      await worker(pool,row.offer,{ingestionId:row.event_id});
      await pool.query(`UPDATE nawaa_v2_shadow_outbox SET status='completed',completed_at=now(),lease_until=NULL,last_error=NULL
        WHERE event_id=$1 AND status='processing'`,[row.event_id]);
      outcomes.push({id:row.event_id,status:'completed'});
    }catch(e){
      const dead=row.attempts+1>=row.max_attempts;
      await pool.query(`UPDATE nawaa_v2_shadow_outbox SET status=$2,lease_until=NULL,
        next_attempt_at=$3::timestamptz+(power(2,LEAST(attempts,8))*interval '1 second'),
        last_error=$4 WHERE event_id=$1 AND status='processing'`,
        [row.event_id,dead?'dead':'pending',now,String(e?.message||e).slice(0,200)]);
      outcomes.push({id:row.event_id,status:dead?'dead':'pending'});
    }
  }
  return outcomes;
}
