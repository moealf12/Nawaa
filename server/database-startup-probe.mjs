import { randomUUID } from "node:crypto";

// One-shot, opt-in deployment diagnostic. Never blocks HTTP startup, logs credentials,
// or commits a synthetic merchant offer. Disabled unless NAWAA_DATABASE_PROBE=1.
export async function probeDatabaseOnStartup({
  env=process.env,
  Client=null,
  log=(line)=>console.info(line),
  clock=()=>performance.now(),
  id=randomUUID,
}={}) {
  if (env.NAWAA_DATABASE_PROBE !== "1") return {skipped:true};
  const started=clock();
  const report=(outcome)=>{
    const result={...outcome,elapsedMs:Math.round(Math.max(0,clock()-started))};
    log("NAWAA_DATABASE_STARTUP_PROBE "+JSON.stringify(result));
    return result;
  };
  if (!env.DATABASE_URL) return report({configured:false,ready:false,reason:"not_configured"});

  let client=null;
  let transactionOpen=false;
  let stage="connect";
  try {
    const PgClient=Client || (await import("pg")).default.Client;
    const ssl=env.DATABASE_SSL==="false" ? false
      : env.DATABASE_SSL_INSECURE==="true" ? {rejectUnauthorized:false}
      : {rejectUnauthorized:true};
    client=new PgClient({
      connectionString:env.DATABASE_URL,
      ssl,
      connectionTimeoutMillis:4000,
      query_timeout:4000,
    });
    await client.connect();

    stage="read";
    const check=await client.query("SELECT 1::integer AS ok");
    if (check.rows?.[0]?.ok!==1) throw new Error("read_mismatch");

    // INSERT lives inside an explicit transaction that is ALWAYS rolled back.
    // This tests the exact customer-offer storage table and the Render role's
    // actual write privileges, without leaving invented offers in production.
    const probeKey="__nawaa_storage_probe__:"+id();
    stage="write";
    await client.query("BEGIN");
    transactionOpen=true;
    await client.query(
      "INSERT INTO nawaa_offers(offer_key,title,source_url,observed_at,payload) VALUES($1,$2,$3,now(),$4::jsonb)",
      [probeKey,"NAWAA storage probe","https://example.invalid/nawaa-storage-probe",'{"probe":true}'],
    );

    stage="rollback";
    await client.query("ROLLBACK");
    transactionOpen=false;

    stage="verify";
    const residual=await client.query(
      "SELECT COUNT(*)::integer AS remaining FROM nawaa_offers WHERE offer_key=$1",
      [probeKey],
    );
    if (residual.rows?.[0]?.remaining!==0) throw new Error("rollback_residual");

    return report({configured:true,ready:true,read:true,writeRollback:true});
  } catch {
    if (client && transactionOpen) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    // Do not print raw database exceptions: some drivers include URI/password
    // fragments in their errors. The stable stage is sufficient for triage.
    return report({configured:true,ready:false,reason:stage+"_failed"});
  } finally {
    if (client) {
      try { await client.end(); } catch {}
    }
  }
}
