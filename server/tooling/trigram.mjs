// Optional PostgreSQL trigram search foundation.
// No query-path changes: never auto-run DDL from a customer request.
export const TRIGRAM_MIGRATION_SQL = [
  "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  "CREATE INDEX IF NOT EXISTS nawaa_offers_title_trgm_idx ON nawaa_offers USING GIN (title gin_trgm_ops)",
  "CREATE INDEX IF NOT EXISTS nawaa_offers_brand_trgm_idx ON nawaa_offers USING GIN (brand gin_trgm_ops)",
];
export function assertTrigramOptIn(env=process.env) {
  if(env.NAWAA_ENABLE_TRIGRAM_MIGRATION!=="1") {
    throw new Error("trigram_migration_requires_explicit_opt_in");
  }
  if(!env.DATABASE_URL) throw new Error("database_url_required");
  return true;
}
export async function applyTrigramMigration(client,{env=process.env}={}) {
  assertTrigramOptIn(env);
  // PostgreSQL extension privileges vary by free-tier provider. Fail explicitly,
  // without changing customer search queries or silently falling back to paid services.
  await client.query("BEGIN");
  try {
    for(const sql of TRIGRAM_MIGRATION_SQL) await client.query(sql);
    await client.query("COMMIT");
    return {installed:true,indexes:2};
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
