// CI-only PostgreSQL append-only receipt store shared by synthetic and live
// provenance tests. Explicitly NEVER connects to DATABASE_URL or production.
import pg from 'pg';
export const CI_SIGNING_KEY='ci-only-nawaa-v21-65-private-journal-secret-unsafe-for-production';
const T='nawaa_ci_trusted_journal',H='nawaa_ci_trusted_source_head',
  HISTORY='nawaa_ci_trusted_source_head_history';
const HEX=/^[a-f0-9]{64}$/;
function bindingOk(b){
  return b&&HEX.test(b.sourceKey||'')&&HEX.test(b.revision||'')&&
    HEX.test(b.recordId||'')&&typeof b.observedAt==='string'&&
    Number.isFinite(Date.parse(b.observedAt));
}
export function createIsolatedTrustedJournalStore(){
  if(process.env.NODE_ENV!=='test'||!process.env.NAWAA_TEST_DATABASE_URL||
    process.env.DATABASE_URL&&process.env.DATABASE_URL===process.env.NAWAA_TEST_DATABASE_URL)
    throw Error('trusted_journal_disposable_postgres_only');
  const pool=new pg.Pool({connectionString:process.env.NAWAA_TEST_DATABASE_URL,
    ssl:false,max:2});
  async function bind(tx,b){
    if(!bindingOk(b))throw Error('invalid_source_head_binding');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[b.sourceKey]);
    const rows=(await tx.query('SELECT source_key,observed_at,revision,record_id,is_conflicted FROM '+
      H+' WHERE source_key=$1 FOR UPDATE',[b.sourceKey])).rows;
    const old=rows[0],next=Date.parse(b.observedAt);
    if(old){
      if(old.is_conflicted)return false;
      const previous=new Date(old.observed_at).getTime();
      // observedAt measures acquisition, NOT the merchant's revision order.
      // A replay of the *same document* cannot renew an older source head or
      // extend receipt TTL merely by attaching a newer wall-clock timestamp.
      if(old.record_id===b.recordId){
        return old.revision===b.revision&&previous===next;
      }
      // Different source document for one sellable subject, at ANY observed
      // timestamp, is incomparable without a merchant-issued revision order.
      // Do not nominate either observation as the latest. Preserve the old
      // row as a tombstoned historical anchor and append the contradictory
      // observation, inside the existing per-subject PostgreSQL transaction.
      await tx.query('UPDATE '+H+' SET is_conflicted=true WHERE source_key=$1',
        [b.sourceKey]);
      await tx.query('INSERT INTO '+HISTORY+
        '(source_key,observed_at,revision,record_id,is_conflicted) VALUES($1,$2,$3,$4,true)',
        [b.sourceKey,b.observedAt,b.revision,b.recordId]);
      return false;
    }else{
      await tx.query('INSERT INTO '+H+
        '(source_key,observed_at,revision,record_id) VALUES($1,$2,$3,$4)',
        [b.sourceKey,b.observedAt,b.revision,b.recordId]);
    }
    await tx.query('INSERT INTO '+HISTORY+
      '(source_key,observed_at,revision,record_id) VALUES($1,$2,$3,$4)',
      [b.sourceKey,b.observedAt,b.revision,b.recordId]);
    return true;
  }
  async function transaction(work){
    const tx=await pool.connect();
    try{
      await tx.query('BEGIN');
      const result=await work(tx);
      await tx.query('COMMIT');
      return result;
    }catch(err){try{await tx.query('ROLLBACK')}catch{}throw err}
    finally{tx.release()}
  }
  const store={
    append:async e=>{await pool.query('INSERT INTO '+T+
      '(receipt_ref,kind,key_id,payload_text,signature) VALUES($1,$2,$3,$4,$5)',
      [e.ref,e.kind,e.keyId,e.payload,e.signature])},
    events:async ref=>(await pool.query(
      'SELECT receipt_ref AS ref,kind,key_id AS "keyId",payload_text AS payload,signature FROM '+
      T+' WHERE receipt_ref=$1 ORDER BY id ASC',[ref])).rows,
    currentHead:async sourceKey=>{
      if(!HEX.test(sourceKey||''))throw Error('invalid_source_head_key');
      const rows=(await pool.query('SELECT observed_at AS "observedAt",revision,is_conflicted AS conflicted,'+
        'record_id AS "recordId" FROM '+H+' WHERE source_key=$1',[sourceKey])).rows;
      return rows[0]?{...rows[0],observedAt:new Date(rows[0].observedAt).toISOString()}:null;
    },
    appendCapture:(e,b)=>transaction(async tx=>{
      const current=await bind(tx,b);
      if(!current)return false;
      await tx.query('INSERT INTO '+T+
        '(receipt_ref,kind,key_id,payload_text,signature) VALUES($1,$2,$3,$4,$5)',
        [e.ref,e.kind,e.keyId,e.payload,e.signature]);
      return true;
    }),
    advanceHead:b=>transaction(tx=>bind(tx,b))
  };
  async function initialize(){
    await pool.query('CREATE TABLE IF NOT EXISTS '+T+'('+
      'id bigserial PRIMARY KEY,receipt_ref text NOT NULL,'+
      "kind text NOT NULL CHECK(kind IN ('capture','revoke')),"+
      'key_id text NOT NULL,payload_text text NOT NULL,signature text NOT NULL,'+
      'inserted_at timestamptz NOT NULL DEFAULT now())');
    await pool.query('CREATE TABLE IF NOT EXISTS '+H+'('+
      'source_key text PRIMARY KEY,observed_at timestamptz NOT NULL,'+
      'revision text NOT NULL,record_id text NOT NULL,is_conflicted boolean NOT NULL DEFAULT false)');
    await pool.query('CREATE TABLE IF NOT EXISTS '+HISTORY+'('+
      'id bigserial PRIMARY KEY,source_key text NOT NULL,'+
      'observed_at timestamptz NOT NULL,revision text NOT NULL,record_id text NOT NULL,'+
      'is_conflicted boolean NOT NULL DEFAULT false)');
    await pool.query('CREATE OR REPLACE FUNCTION nawaa_ci_reject_source_history_mutation() '+
      "RETURNS trigger LANGUAGE plpgsql AS $trusted_history$ BEGIN RAISE EXCEPTION 'append-only source head history'; END; $trusted_history$");
    await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_head_history_immutable ON '+HISTORY);
    await pool.query('CREATE TRIGGER nawaa_ci_head_history_immutable BEFORE UPDATE OR DELETE ON '+
      HISTORY+' FOR EACH ROW EXECUTE FUNCTION nawaa_ci_reject_source_history_mutation()');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS nawaa_ci_journal_unique_capture ON '+
      T+"(receipt_ref) WHERE kind='capture'");
    await pool.query('CREATE OR REPLACE FUNCTION nawaa_ci_reject_journal_mutation() '+
      "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only trusted journal'; END; $$");
    await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_journal_immutable ON '+T);
    await pool.query('CREATE TRIGGER nawaa_ci_journal_immutable BEFORE UPDATE OR DELETE ON '+
      T+' FOR EACH ROW EXECUTE FUNCTION nawaa_ci_reject_journal_mutation()');
  }
  return Object.freeze({pool,store,initialize,close:()=>pool.end()});
}
