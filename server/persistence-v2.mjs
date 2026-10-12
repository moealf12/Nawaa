import pg from 'pg';
import {createHash} from 'node:crypto';
import {deriveOfferIdentityV2} from './offer-identity-v2.mjs';

// Isolated opt-in foundation. No modifications to legacy nawaa_offers or /api/search.
export function assertEphemeralDatabase(env=process.env) {
  if(env.NAWAA_CI_EPHEMERAL_DB!=='1' ||
    !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||'') ||
    env.DATABASE_SSL!=='false') throw new Error('ephemeral_database_only');
}

// Verify the actual PostgreSQL session, not just the URL advertised by env.
 // This guards against an injected pool pointing to a different local database.
 // It is not cryptographic server authentication; CI must control localhost.
export async function attestEphemeralConnection(client,{env=process.env}={}) {
  assertEphemeralDatabase(env);
  if(!client||typeof client.query!=='function')throw new Error('ephemeral_database_connection_unverifiable');
  let result;
  try {
    result=await client.query(`SELECT current_database() AS database_name,
      current_user AS database_user, session_user AS login_user,
      host(inet_server_addr()) AS server_address,
      inet_server_port() AS server_port`);
  }catch(error){throw new Error('ephemeral_database_attestation_failed',{cause:error})}
  const row=result?.rows?.[0];
  // On GitHub Actions, TCP localhost:5432 is forwarded to a Docker service
  // with an RFC1918 bridge IP (usually 172.16/12), not server-side loopback.
  // The connection is still permitted only when env pins localhost:5432.
  const address=String(row?.server_address||'');
  const ipv4=address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  const octets=ipv4?.slice(1).map(Number);
  const privateV4=octets && octets.every(n=>n>=0&&n<=255) && (
    octets[0]===127 || octets[0]===10 ||
    (octets[0]===172 && octets[1]>=16 && octets[1]<=31) ||
    (octets[0]===192 && octets[1]===168)
  );
  const ciNetwork=address==='::1'||privateV4===true;
  // For actual pg clients, also verify the socket's peer is local.
  // Savepoint query adapters have no stream; their owning client is separately attested.
  const peer=client?.connection?.stream?.remoteAddress;
  const localPeer=peer===undefined||peer==='127.0.0.1'||peer==='::1'||peer==='::ffff:127.0.0.1';
  if(result?.rowCount!==1 ||
     row?.database_name!=='nawaa_ci' ||
     row?.database_user!=='nawaa' ||
     row?.login_user!=='nawaa' ||
     !ciNetwork || !localPeer ||
     Number(row?.server_port)!==5432)
    throw new Error('ephemeral_database_identity_mismatch');
}

export const CREATE_V2_SQL=`
CREATE TABLE IF NOT EXISTS nawaa_offer_v2 (
 offer_key text PRIMARY KEY,
 source_id text NOT NULL,
 source_url text NOT NULL,
 condition text NOT NULL,
 product_price numeric NOT NULL CHECK(product_price > 0),
 currency char(3) NOT NULL,
 observed_at timestamptz NOT NULL,
 payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS nawaa_observation_v2 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 offer_key text NOT NULL REFERENCES nawaa_offer_v2(offer_key),
 ingestion_id uuid NOT NULL UNIQUE,
 source_id text NOT NULL,
 product_price numeric NOT NULL CHECK(product_price > 0),
 currency char(3) NOT NULL,
 observed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS nawaa_observation_v2_offer_time_idx ON nawaa_observation_v2(offer_key,observed_at DESC);
CREATE OR REPLACE FUNCTION nawaa_v2_reject_observation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'v2_observations_immutable'; END; $$;
DROP TRIGGER IF EXISTS nawaa_v2_immutable ON nawaa_observation_v2;
CREATE TRIGGER nawaa_v2_immutable BEFORE UPDATE OR DELETE ON nawaa_observation_v2
FOR EACH ROW EXECUTE FUNCTION nawaa_v2_reject_observation_change();
`;

// Canonicalize object key order so semantically identical JSON payloads replay safely.
function receiptDigest(offerKey,price,currency,observedAt,offer) {
  const payload=JSON.stringify([offerKey,price,currency,observedAt,offer],(_key,value)=>
    value!==null && typeof value==='object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0))
      : value);
  return createHash('sha256').update(payload).digest('hex');
}

// Previous deployed-in-branch receipt format; accept exact byte-equivalent retries only.
function legacyReceiptDigest(offerKey,price,currency,observedAt,offer) {
  return createHash('sha256').update(JSON.stringify([offerKey,price,currency,observedAt,offer])).digest('hex');
}

export async function recordOfferV2(pool, offer, {ingestionId,failAfterObservation=false,env=process.env}={}) {
  assertEphemeralDatabase(env);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(ingestionId||''))) throw new Error('ingestion_id_required');
  const identity=deriveOfferIdentityV2(offer);
  const price=Number(offer.productPrice);
  const currency=String(offer.currency||'').toUpperCase();
  const at=new Date(offer.observedAt);
  if(!Number.isFinite(price)||price<=0||!/^[A-Z]{3}$/.test(currency)||Number.isNaN(at.getTime())) throw new Error('invalid_observation');
  const client=await pool.connect();
  try {
    await attestEphemeralConnection(client,{env});
    await client.query('BEGIN');
    // The unique receipt is taken first to serialize identical retries.
    const receipt=await client.query('INSERT INTO nawaa_v2_receipts(ingestion_id,offer_key,content_digest) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING ingestion_id',[ingestionId,identity.offerKey,receiptDigest(identity.offerKey,price,currency,at.toISOString(),offer)]);
    if(!receipt.rowCount) {
      const old=await client.query('SELECT offer_key,content_digest FROM nawaa_v2_receipts WHERE ingestion_id=$1',[ingestionId]);
      const hash=receiptDigest(identity.offerKey,price,currency,at.toISOString(),offer);
      if(old.rows[0]?.offer_key!==identity.offerKey || (old.rows[0]?.content_digest!==hash && old.rows[0]?.content_digest!==legacyReceiptDigest(identity.offerKey,price,currency,at.toISOString(),offer))) throw new Error('ingestion_id_payload_conflict');
      await client.query('COMMIT');
      return {duplicate:true,updated:false,offerKey:identity.offerKey};
    }
    // FK requires current offer row to exist before immutable observation.
    const canonical=await client.query(`INSERT INTO nawaa_offer_v2(offer_key,source_id,source_url,condition,product_price,currency,observed_at,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT(offer_key) DO UPDATE SET
      product_price=EXCLUDED.product_price,currency=EXCLUDED.currency,
      observed_at=EXCLUDED.observed_at,payload=EXCLUDED.payload
      WHERE nawaa_offer_v2.observed_at < EXCLUDED.observed_at
      RETURNING offer_key`,[identity.offerKey,identity.sourceId,identity.sourceUrl,identity.condition,price,currency,at,JSON.stringify(offer)]);
    await client.query('INSERT INTO nawaa_observation_v2(offer_key,ingestion_id,source_id,product_price,currency,observed_at) VALUES($1,$2,$3,$4,$5,$6)',[identity.offerKey,ingestionId,identity.sourceId,price,currency,at]);
    if(failAfterObservation) throw new Error('injected_mid_transaction_failure');
    await client.query('COMMIT');
    return {duplicate:false,updated:canonical.rowCount>0,offerKey:identity.offerKey};
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function initV2(pool,{env=process.env}={}) {
  // Validate BEFORE opening a connection or executing any schema-changing SQL.
  assertEphemeralDatabase(env);
  // PostgreSQL CREATE TABLE IF NOT EXISTS does not serialize concurrent first
  // creators: catalog uniqueness can still fail with SQLSTATE 23505.
  // The dedicated advisory xact lock covers both tables and trigger DDL.
  const client=await pool.connect();
  try {
    await attestEphemeralConnection(client,{env});
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1,$2)',[17033,1]);
    await client.query(CREATE_V2_SQL);
    await client.query('CREATE TABLE IF NOT EXISTS nawaa_v2_receipts(ingestion_id uuid PRIMARY KEY,offer_key text NOT NULL, content_digest text NOT NULL)');
    await client.query('COMMIT');
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    throw error;
  }finally{client.release()}
}
export function createEphemeralPool(env=process.env) {
  assertEphemeralDatabase(env);
  return new pg.Pool({connectionString:env.DATABASE_URL,ssl:false,max:8});
}
