// CI-only PostgreSQL append-only receipt store shared by synthetic and live
// provenance tests. Explicitly NEVER connects to DATABASE_URL or production.
import pg from 'pg';
export const CI_SIGNING_KEY='ci-only-nawaa-v21-65-private-journal-secret-unsafe-for-production';
const T='nawaa_ci_trusted_journal';
export function createIsolatedTrustedJournalStore(){
  if(process.env.NODE_ENV!=='test'||!process.env.NAWAA_TEST_DATABASE_URL||
    process.env.DATABASE_URL&&process.env.DATABASE_URL===process.env.NAWAA_TEST_DATABASE_URL)
    throw Error('trusted_journal_disposable_postgres_only');
  const pool=new pg.Pool({connectionString:process.env.NAWAA_TEST_DATABASE_URL,
    ssl:false,max:2});
  const store={
    append:async e=>{await pool.query('INSERT INTO '+T+
      '(receipt_ref,kind,payload_text,signature) VALUES($1,$2,$3,$4)',
      [e.ref,e.kind,e.payload,e.signature])},
    events:async ref=>(await pool.query(
      'SELECT receipt_ref AS ref,kind,payload_text AS payload,signature FROM '+
      T+' WHERE receipt_ref=$1 ORDER BY id ASC',[ref])).rows
  };
  async function initialize(){
    await pool.query('CREATE TABLE IF NOT EXISTS '+T+'('+
      'id bigserial PRIMARY KEY,receipt_ref text NOT NULL,'+
      "kind text NOT NULL CHECK(kind IN ('capture','revoke')),"+
      'payload_text text NOT NULL,signature text NOT NULL,'+
      'inserted_at timestamptz NOT NULL DEFAULT now())');
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
