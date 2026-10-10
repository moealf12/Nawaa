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
 lease_until timestamptz, claim_token uuid, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
ALTER TABLE nawaa_v2_shadow_outbox ADD COLUMN IF NOT EXISTS claim_token uuid;
CREATE TABLE IF NOT EXISTS nawaa_v2_shadow_attempts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES nawaa_v2_shadow_outbox(event_id),
 claim_token uuid NOT NULL,
 attempt integer NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('completed','retry','dead','stale')),
 error text,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,claim_token)
);
CREATE INDEX IF NOT EXISTS nawaa_v2_shadow_attempts_event ON nawaa_v2_shadow_attempts(event_id,recorded_at);
CREATE INDEX IF NOT EXISTS nawaa_v2_shadow_outbox_ready ON nawaa_v2_shadow_outbox(status,next_attempt_at);
`);
}

// Accept a caller-owned PostgreSQL transaction. The caller must commit or
// roll back the legacy observation, canonical upsert and this intent together.
// Reusing the same event ID with different JSONB contents fails closed.
export async function enqueueShadowIntentTx(tx, offer, {eventId}={}) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(eventId||'')))
    throw new Error('invalid_shadow_event_id');
  deriveOfferIdentityV2(offer);
  const result=await tx.query(
    'INSERT INTO nawaa_v2_shadow_outbox(event_id,offer) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING event_id',
    [eventId,JSON.stringify(offer)]
  );
  if(result.rowCount===1)return {duplicate:false,eventId};
  const existing=await tx.query(
    'SELECT (offer=$2::jsonb) AS same FROM nawaa_v2_shadow_outbox WHERE event_id=$1',
    [eventId,JSON.stringify(offer)]
  );
  if(existing.rows[0]?.same!==true)throw new Error('event_id_payload_conflict');
  return {duplicate:true,eventId};
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
      const claimToken=randomUUID();
      await client.query(`UPDATE nawaa_v2_shadow_outbox
        SET status='processing', attempts=attempts+1,claim_token=$3,lease_until=$2::timestamptz+interval '60 seconds'
        WHERE event_id=$1`,[row.event_id,now,claimToken]);
      claimed.push({...row,claimToken});
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const outcomes=[];
  for(const row of claimed){
    // Hold the claimed row lock through the V2 write. A reclaiming worker
    // cannot supersede us between the token check and the persistent write.
    const owner=await pool.connect();
    try{
      await owner.query('BEGIN');
      const active=await owner.query(`SELECT claim_token,status,lease_until
        FROM nawaa_v2_shadow_outbox WHERE event_id=$1 FOR UPDATE`,[row.event_id]);
      const eligible=active.rows[0]?.status==='processing' &&
        active.rows[0]?.claim_token===row.claimToken &&
        new Date(active.rows[0].lease_until).getTime()>new Date(now).getTime();
      if(!eligible){
        await owner.query('ROLLBACK');
        outcomes.push({id:row.event_id,status:'stale'});
        continue;
      }
      // Shared SQL connection keeps token validation, V2 writes and acknowledgement atomic.
      const transactionPool={
        connect:async()=>({
          query:(...args)=>owner.query(...args),
          release:()=>{},
        }),
      };
      // The V2 worker starts a nested BEGIN/COMMIT in the original implementation.
      // Use a savepoint-aware adapter to avoid committing the outer outbox lock early.
      const nestedPool={
        connect:async()=>({
          query:async(sql,args)=>{
            const command=typeof sql==='string'?sql.trim().toUpperCase():'';
            if(command==='BEGIN')return owner.query('SAVEPOINT nawaa_v2_write');
            if(command==='COMMIT')return owner.query('RELEASE SAVEPOINT nawaa_v2_write');
            if(command==='ROLLBACK')return owner.query('ROLLBACK TO SAVEPOINT nawaa_v2_write');
            return owner.query(sql,args);
          },
          release:()=>{},
        }),
      };
      await worker(nestedPool,row.offer,{ingestionId:row.event_id});
      await owner.query(`UPDATE nawaa_v2_shadow_outbox
        SET status='completed',completed_at=now(),lease_until=NULL,claim_token=NULL,last_error=NULL
        WHERE event_id=$1 AND claim_token=$2`,[row.event_id,row.claimToken]);
      await owner.query(`INSERT INTO nawaa_v2_shadow_attempts(event_id,claim_token,attempt,outcome)
        VALUES($1,$2,$3,'completed')`,[row.event_id,row.claimToken,row.attempts+1]);
      await owner.query('COMMIT');
      outcomes.push({id:row.event_id,status:'completed'});
    }catch(e){
      try{await owner.query('ROLLBACK')}catch{}
      const dead=row.attempts+1>=row.max_attempts;
      const errorText=String(e?.message||e).slice(0,200);
      const result=await pool.query(`WITH claim AS (
        UPDATE nawaa_v2_shadow_outbox SET
          status=$2,lease_until=NULL,claim_token=NULL,
          next_attempt_at=now()+(power(2,LEAST(attempts,8))*interval '1 second'),
          last_error=$3
        WHERE event_id=$1 AND status='processing' AND claim_token=$4
        RETURNING event_id,attempts
      )
      INSERT INTO nawaa_v2_shadow_attempts(event_id,claim_token,attempt,outcome,error)
        SELECT event_id,$4,attempts,$5,$3 FROM claim RETURNING id`,
        [row.event_id,dead?'dead':'pending',errorText,row.claimToken,dead?'dead':'retry']);
      outcomes.push({id:row.event_id,status:result.rowCount===1?(dead?'dead':'pending'):'stale'});
    }finally{owner.release()}
  }
  return outcomes;
}
