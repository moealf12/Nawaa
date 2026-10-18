// ASTRA OMEGA v16.1: isolated PostgreSQL canonical revision/outbox/read guard.
// Test-only executable proof. Never runs against production or migrates it.
import {canonicalOfferPayload} from "./canonical-offer-identity.mjs";
let pool,meili,schemaReady;
const T="nawaa_ci_omega_canonical",O="nawaa_ci_omega_outbox";
function onlyTest(){
  if(process.env.NODE_ENV!=="test"||process.env.NAWAA_CANONICAL_INDEX_TEST!=="1"||
     !process.env.NAWAA_TEST_DATABASE_URL||
     process.env.MEILI_HOST!=="http://127.0.0.1:7700"||
     process.env.MEILI_INDEX!=="nawaa_ci_omega"||
     !process.env.MEILI_MASTER_KEY)
    throw Error("canonical_index_disposable_test_only");
}
async function database(){
  onlyTest();
  if(!pool){
    const pg=(await import("pg")).default;
    pool=new pg.Pool({connectionString:process.env.NAWAA_TEST_DATABASE_URL,ssl:false,max:4});
  }
  return pool;
}
async function index(){
  onlyTest();
  if(!meili){
    const {MeiliSearch}=await import("meilisearch");
    meili=new MeiliSearch({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
  }
  return meili.index(process.env.MEILI_INDEX);
}
export async function initializeCanonicalIndex(){
  const pg=await database();
  schemaReady||=pg.query([
    "CREATE TABLE IF NOT EXISTS "+T+"(offer_key text primary key, revision bigint not null check(revision>0), observed_at timestamptz not null, fingerprint text not null, offer jsonb not null)",
    "CREATE TABLE IF NOT EXISTS "+O+"(id bigserial primary key, offer_key text not null, revision bigint not null, publication_status text not null default 'pending', task_uid bigint, updated_at timestamptz not null default now(), UNIQUE(offer_key,revision))",
    "CREATE INDEX IF NOT EXISTS nawaa_ci_omega_outbox_status_idx ON "+O+"(publication_status,id)"
  ].join(";")).catch(e=>{schemaReady=null;throw e;});
  await schemaReady;
}
export async function commitCanonicalObservation(input){
  const normalized=canonicalOfferPayload(input);
  if(!normalized)throw Error("invalid_canonical_observation");
  await initializeCanonicalIndex();
  const tx=await (await database()).connect();
  try{
    await tx.query("BEGIN");
    const sql="INSERT INTO "+T+"(offer_key,revision,observed_at,fingerprint,offer)"+
      " VALUES($1,1,$2,$3,$4::jsonb) ON CONFLICT(offer_key) DO UPDATE SET"+
      " revision="+T+".revision+1,observed_at=excluded.observed_at,"+
      " fingerprint=excluded.fingerprint,offer=excluded.offer"+
      " WHERE "+T+".observed_at<excluded.observed_at"+
      " RETURNING revision,observed_at,fingerprint";
    const result=await tx.query(sql,[normalized.offerKey,normalized.offer.observedAt,
      normalized.fingerprint,JSON.stringify(normalized.offer)]);
    let state,revision;
    if(result.rows.length){
      revision=Number(result.rows[0].revision);
      await tx.query("INSERT INTO "+O+"(offer_key,revision) VALUES($1,$2) ON CONFLICT DO NOTHING",[normalized.offerKey,revision]);
      state="accepted";
    }else{
      const current=(await tx.query("SELECT revision,observed_at,fingerprint FROM "+T+
        " WHERE offer_key=$1",[normalized.offerKey])).rows[0];
      if(!current)throw Error("canonical_state_missing");
      revision=Number(current.revision);
      const equalTime=new Date(current.observed_at).getTime()===Date.parse(normalized.offer.observedAt);
      state=equalTime?(current.fingerprint===normalized.fingerprint?"duplicate":"equal_time_conflict"):"rejected_older";
    }
    await tx.query("COMMIT");
    return {state,revision,offerKey:normalized.offerKey,documentId:normalized.documentId};
  }catch(e){try{await tx.query("ROLLBACK")}catch{}throw e;}finally{tx.release();}
}
export async function currentCanonical(key){
  await initializeCanonicalIndex();
  const row=(await (await database()).query("SELECT revision,observed_at,fingerprint,offer FROM "+T+
    " WHERE offer_key=$1",[key])).rows[0];
  return row?{revision:Number(row.revision),observedAt:new Date(row.observed_at).toISOString(),
    fingerprint:row.fingerprint,offer:row.offer}:null;
}
function indexedDocument(key,state){
  const identity=canonicalOfferPayload(state.offer);
  if(!identity||identity.offerKey!==key)throw Error("canonical_identity_drift");
  return {...state.offer,id:identity.documentId,offerKey:key,
    canonicalRevision:state.revision,canonicalFingerprint:state.fingerprint};
}
async function submit(key,state){
  const target=await index();
  const task=await target.addDocuments([indexedDocument(key,state)]);
  if(!Number.isInteger(task?.taskUid))throw Error("index_task_uid_missing");
  const settled=await target.waitForTask(task.taskUid,{timeOutMs:15000,intervalMs:100});
  if(settled.status!=="succeeded")throw Error("index_task_failed");
  return task.taskUid;
}
export async function publishCanonicalOutbox({limit=40}={}){
  await initializeCanonicalIndex();
  const pg=await database();
  const rows=(await pg.query("SELECT id,offer_key,revision FROM "+O+
    " WHERE publication_status='pending' ORDER BY id LIMIT $1",
    [Math.max(1,Math.min(100,limit))])).rows;
  const outcomes=[];
  for(const event of rows){
    const state=await currentCanonical(event.offer_key);
    if(!state)throw Error("outbox_canonical_missing");
    if(state.revision!==Number(event.revision)){
      await pg.query("UPDATE "+O+
        " SET publication_status='superseded',updated_at=now() WHERE id=$1 AND publication_status='pending'",[event.id]);
      outcomes.push({revision:Number(event.revision),status:"superseded"});continue;
    }
    // Remote tasks may be delayed past this transaction; do not rely on write order.
    const taskUid=await submit(event.offer_key,state);
    await pg.query("UPDATE "+O+
      " SET publication_status='published',task_uid=$2,updated_at=now() WHERE id=$1 AND publication_status='pending'",
      [event.id,taskUid]);
    outcomes.push({revision:state.revision,status:"published",taskUid});
  }
  return outcomes;
}
export async function guardedCanonicalSearch(query,{limit=80,now=Date.now()}={}){
  await initializeCanonicalIndex();
  // The customer normalizer maps "PlayStation 5" to "ps5", while source
  // titles may contain only the expanded spelling. Expand for candidate
  // discovery, then let the existing current-query classifier judge relevance.
  const discoveryQuery=String(query).replace(/\bps5\b/gi,"playstation 5");
  const search=await (await index()).search(discoveryQuery,{
    limit:Math.max(1,Math.min(500,limit)),
    attributesToRetrieve:["offerKey","canonicalRevision","canonicalFingerprint",
      "sourceUrl","observedAt","title","productPrice","availability"]});
  const hits=search.hits||[];
  const keys=[...new Set(hits.map(h=>h.offerKey).filter(x=>typeof x==="string"))];
  if(!keys.length)return {configured:true,offers:[],rejected:hits.length,hydrated:0};
  const rows=(await (await database()).query("SELECT offer_key,revision,observed_at,fingerprint,offer FROM "+T+
    " WHERE offer_key=ANY($1::text[])",[keys])).rows;
  const state=new Map(rows.map(x=>[x.offer_key,x]));
  let rejected=0,hydrated=0;
  const offers=[];
  for(const hit of hits){
    const row=state.get(hit.offerKey);
    if(!row){rejected++;continue;}
    const observation=new Date(row.observed_at).getTime();
    if(!Number.isFinite(observation)||now-observation>45000||observation>now+60000){
      rejected++;continue;
    }
    const lagged=Number(hit.canonicalRevision)!==Number(row.revision)||
      hit.canonicalFingerprint!==row.fingerprint;
    if(lagged)hydrated++;
    // Hydrate authoritative state: raw stale indexed price is never returned.
    offers.push({...row.offer,dataKind:"indexed",exactMatch:false,
      matchConfidence:0,canonicalRevision:Number(row.revision),
      canonicalFingerprint:row.fingerprint,indexLagged:lagged});
  }
  return {configured:true,offers,rejected,hydrated};
}
export async function reconcileCanonicalIndex({limit=50}={}){
  await initializeCanonicalIndex();
  const rows=(await (await database()).query("SELECT offer_key,revision,observed_at,fingerprint,offer FROM "+T+
    " ORDER BY offer_key LIMIT $1",[Math.max(1,Math.min(100,limit))])).rows;
  const target=await index();
  const repaired=[];
  for(const row of rows){
    const state={revision:Number(row.revision),fingerprint:row.fingerprint,offer:row.offer};
    const doc=indexedDocument(row.offer_key,state);
    let current;
    try{current=await target.getDocument(doc.id);}
    catch(e){if(!["document_not_found","index_not_found"].includes(e?.code||e?.cause?.code))throw e;}
    if(current?.canonicalRevision===state.revision&&
       current?.canonicalFingerprint===state.fingerprint)continue;
    const taskUid=await submit(row.offer_key,state);
    repaired.push({offerKey:row.offer_key,revision:state.revision,taskUid});
  }
  return {inspected:rows.length,repaired};
}
export async function isolatedCanonicalIndexOffers(offers=[]){
  onlyTest();
  const accepted=[];
  for(const offer of offers)accepted.push(await commitCanonicalObservation(offer));
  const published=await publishCanonicalOutbox();
  return {configured:true,indexed:published.filter(x=>x.status==="published").length,
    canonicalAccepted:accepted.filter(x=>x.state==="accepted").length,
    conflicts:accepted.filter(x=>x.state==="equal_time_conflict").length};
}

// Linearization point is the batched PostgreSQL SELECT, after live acceptance.
// Cached/indexed candidates only discover identities; they never mint evidence.
export async function canonicalReadBoundary(offers=[],{acceptLive=false,now=Date.now()}={}){
  await initializeCanonicalIndex();
  const candidates=offers.map(offer=>({offer,payload:canonicalOfferPayload(offer)}))
    .filter(x=>x.payload);
  if(acceptLive){
    for(const {offer,payload} of candidates)
      if(offer.dataKind==="live")await commitCanonicalObservation(payload.offer);
  }
  const keys=[...new Set(candidates.map(x=>x.payload.offerKey))];
  if(!keys.length)return [];
  const rows=(await (await database()).query("SELECT offer_key,revision,observed_at,fingerprint,offer FROM "+T+
    " WHERE offer_key=ANY($1::text[])",[keys])).rows;
  return rows.filter(row=>{
    const time=new Date(row.observed_at).getTime();
    return Number.isFinite(time)&&now-time<=45000&&time<=now+60000;
  }).map(row=>({...row.offer,dataKind:"indexed",exactMatch:false,matchConfidence:0,
    canonicalRevision:Number(row.revision),canonicalFingerprint:row.fingerprint}));
}
