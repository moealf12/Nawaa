// One-time manual database migration. Never called by npm start.
import pg from "pg";
import {applyTrigramMigration,assertTrigramOptIn} from "../server/tooling/trigram.mjs";
assertTrigramOptIn();
const pool=new pg.Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:true},
  max:1,
});
try {
  const client=await pool.connect();
  try {
    const result=await applyTrigramMigration(client);
    console.log(JSON.stringify({ok:true,feature:"pg_trgm",...result}));
  } finally {client.release();}
} finally {await pool.end();}
