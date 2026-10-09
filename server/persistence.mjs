let pool, initialized=false, initializing=null, PoolCtor=null;
export const persistenceConfigured=()=>Boolean(process.env.DATABASE_URL);
async function db(){
  if(!persistenceConfigured()) return null;
  if(!PoolCtor) PoolCtor=(await import("pg")).default.Pool;
  const ssl=process.env.DATABASE_SSL==="false"
    ? false
    : process.env.DATABASE_SSL_INSECURE==="true"
      ? {rejectUnauthorized:false}
      : {rejectUnauthorized:true};
  return pool ||= new PoolCtor({connectionString:process.env.DATABASE_URL,ssl,max:Number(process.env.DATABASE_POOL_MAX||4)});
}
export async function initPersistence(){
const client=await db();
if(!client||initialized)return {configured:Boolean(client),ready:initialized};
if(initializing)return initializing;
initializing=(async()=>{await client.query(`
create table if not exists nawaa_offers(
id bigserial primary key,offer_key text not null unique,query text,title text not null,brand text,merchant text,merchant_country_code text,
source_url text not null,image_url text,currency text,product_price numeric,total_sar numeric,sku text,condition text,availability text,
match_confidence numeric,exact_match boolean,observed_at timestamptz not null default now(),payload jsonb not null);
create index if not exists nawaa_offers_title_idx on nawaa_offers using gin(to_tsvector('simple',title));
create index if not exists nawaa_offers_brand_idx on nawaa_offers(brand);
create index if not exists nawaa_offers_observed_idx on nawaa_offers(observed_at desc);

create table if not exists offer_observations(
id bigserial primary key,
product_url text not null,
source_name text not null,
price numeric not null,
currency text not null,
validation_timestamp timestamptz not null default now(),
health_status text not null
);
create index if not exists offer_observations_product_url_idx on offer_observations(product_url);
create index if not exists offer_observations_source_time_idx on offer_observations(source_name,validation_timestamp desc);

create or replace function nawaa_reject_offer_observation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'offer_observations is append-only; % is not allowed', TG_OP;
end;
$$;
drop trigger if exists offer_observations_immutable on offer_observations;
create trigger offer_observations_immutable
before update or delete on offer_observations
for each row execute function nawaa_reject_offer_observation_mutation();
`);
// This ledger is only needed by the opt-in durable background worker.
// Keeping its DDL behind the feature flag preserves existing customers.
if(process.env.NAWAA_ENABLE_BACKGROUND_JOBS==="1"){
  await client.query(`create table if not exists nawaa_ingestion_receipts(
    ingestion_id uuid primary key,
    source_name text not null,
    received_at timestamptz not null default now()
  )`);
}
initialized=true;return {configured:true,ready:true};})();
try{return await initializing;}finally{initializing=null;}
}
const canonicalUrl=value=>{try{const u=new URL(value);u.hash="";for(const key of [...u.searchParams.keys()])if(/^utm_|^(gclid|fbclid|ref|aff|affiliate)$/i.test(key))u.searchParams.delete(key);u.hostname=u.hostname.toLowerCase().replace(/^www\./,"");u.pathname=u.pathname.replace(/\/+$/,"")||"/";return u.toString();}catch{return String(value||"").trim();}};
const keyOf=o=>[canonicalUrl(o.sourceUrl),o.condition||"new"].join("|");
const recordUrl=value=>{try{const url=new URL(String(value||"").trim());if(url.protocol!=="https:"||url.username||url.password||!url.hostname)return "";return canonicalUrl(url.href);}catch{return "";}};

export async function recordOffer(offerData={}){
  const sourceUrl=recordUrl(offerData.sourceUrl);
  const title=String(offerData.title||"").trim();
  const price=Number(offerData.productPrice);
  const currency=String(offerData.currency||"").trim().toUpperCase();
  const sourceName=String(offerData.sourceName||offerData.merchant||offerData.provider||"crawler").trim();
  const healthStatus=String(offerData.healthStatus||"healthy").trim().toLowerCase();
  const condition=String(offerData.condition||"new").trim().toLowerCase()||"new";
  if(!sourceUrl||title.length<3||!Number.isFinite(price)||price<=0||!/^[A-Z]{3}$/.test(currency)||!sourceName) throw new Error("invalid_offer_record");
  const client=await db();
  if(!client) throw new Error("persistence_not_configured");
  await initPersistence();
  const normalized={...offerData,sourceUrl,title,productPrice:price,currency,condition};
  const key=keyOf(normalized);
  const observedAt=offerData.observedAt ? new Date(offerData.observedAt) : new Date();
  if(Number.isNaN(observedAt.getTime())) throw new Error("invalid_observed_at");
  // pg-boss retries the same UUID on worker crashes or lost acknowledgements.
  const ingestionId=offerData.ingestionId==null?null:String(offerData.ingestionId);
  if(ingestionId!==null && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ingestionId)
      || process.env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"))throw new Error("invalid_or_disabled_ingestion_id");
  const query=String(offerData.query||sourceName||"crawler");
  const tx=await client.connect();
  try{
    await tx.query("BEGIN");
    if(ingestionId){
      const receipt=await tx.query(
        "insert into nawaa_ingestion_receipts(ingestion_id,source_name) values($1,$2) on conflict do nothing returning ingestion_id",
        [ingestionId,sourceName]
      );
      if(!receipt.rows.length){
        await tx.query("ROLLBACK");
        return {configured:true,recorded:false,duplicate:true,observationId:null};
      }
    }
    const observation=await tx.query(
      `insert into offer_observations(product_url,source_name,price,currency,validation_timestamp,health_status)
       values($1,$2,$3,$4,$5,$6) returning id,validation_timestamp`,
      [sourceUrl,sourceName,price,currency,observedAt,healthStatus]
    );
    const canonical=await tx.query(
      `insert into nawaa_offers(offer_key,query,title,brand,merchant,merchant_country_code,source_url,image_url,currency,product_price,total_sar,sku,condition,availability,match_confidence,exact_match,observed_at,payload)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
       on conflict(offer_key) do update set
         query=excluded.query,title=excluded.title,brand=excluded.brand,merchant=excluded.merchant,
         merchant_country_code=excluded.merchant_country_code,image_url=excluded.image_url,currency=excluded.currency,
         product_price=excluded.product_price,total_sar=excluded.total_sar,sku=excluded.sku,
         availability=excluded.availability,match_confidence=excluded.match_confidence,
         exact_match=excluded.exact_match,observed_at=excluded.observed_at,payload=excluded.payload
       where nawaa_offers.observed_at < excluded.observed_at
       returning id`,
      [key,query,title,offerData.brand||offerData.specs?.brand||null,offerData.merchant||null,offerData.merchantCountryCode||null,sourceUrl,offerData.imageUrl||offerData.image||null,currency,price,offerData.totalSAR??null,offerData.sku||null,condition,offerData.availability||null,offerData.matchConfidence??null,offerData.exactMatch===true,observedAt,JSON.stringify(normalized)]
    );
    await tx.query("COMMIT");
    return {configured:true,recorded:true,canonicalUpdated:canonical.rowCount>0,
      observationId:observation.rows[0]?.id??null,
      observedAt:observation.rows[0]?.validation_timestamp??observedAt};
  }catch(error){
    try{await tx.query("ROLLBACK");}catch{}
    throw error;
  }finally{
    tx.release();
  }
}

export async function persistOffers(query,offers=[]){const client=await db();if(!client||!offers.length)return {configured:Boolean(client),saved:0};await initPersistence();let saved=0;for(const o of offers){if(!o?.sourceUrl||!o?.title)continue;const key=keyOf(o);if(!key)continue;await client.query(`insert into nawaa_offers(offer_key,query,title,brand,merchant,merchant_country_code,source_url,image_url,currency,product_price,total_sar,sku,condition,availability,match_confidence,exact_match,observed_at,payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),$17::jsonb) on conflict(offer_key) do update set query=excluded.query,title=excluded.title,brand=excluded.brand,merchant=excluded.merchant,merchant_country_code=excluded.merchant_country_code,image_url=excluded.image_url,currency=excluded.currency,product_price=excluded.product_price,total_sar=excluded.total_sar,availability=excluded.availability,match_confidence=excluded.match_confidence,exact_match=excluded.exact_match,observed_at=now(),payload=excluded.payload`,[key,query,o.title,o.brand||o.specs?.brand||null,o.merchant||null,o.merchantCountryCode||null,o.sourceUrl,o.imageUrl||null,o.currency||null,o.productPrice??null,o.totalSAR??null,o.sku||null,o.condition||null,o.availability||null,o.matchConfidence??null,o.exactMatch===true,JSON.stringify(o)]);saved++;}return {configured:true,saved};}


export async function searchPersistedOffers(query,{limit=120,maxAgeHours=168}={}){
  const client=await db();
  if(!client||!String(query||"").trim()) return {configured:Boolean(client),offers:[]};
  await initPersistence();
  const q=String(query).trim();
  const result=await client.query(`
    select payload, observed_at
    from nawaa_offers
    where observed_at >= now() - ($2::text || ' hours')::interval
      and (
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(brand,''))
          @@ plainto_tsquery('simple',$1)
        or title ilike '%' || $1 || '%'
        or brand ilike '%' || $1 || '%'
      )
    order by
      ts_rank(
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(brand,'')),
        plainto_tsquery('simple',$1)
      ) desc,
      observed_at desc
    limit $3
  `,[q,String(Math.max(1,Number(maxAgeHours)||168)),Math.max(1,Math.min(500,Number(limit)||120))]);
  return {
    configured:true,
    offers:result.rows.map(row=>({
      ...(row.payload||{}),
      dataKind:"persisted",
      observedAt:row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at
    }))
  };
}

// Internal bounded historical-price read model; deliberately no public route.
// Reuse recordOffer URL normalization and index-supported source filtering.
export async function getOfferPriceHistory(sourceUrl,{sourceName,limit=30}={}){
  const productUrl=recordUrl(sourceUrl);
  const source=String(sourceName||"").trim();
  if(!productUrl||!/^[a-z0-9][a-z0-9-]{1,79}$/.test(source))
    throw new Error("invalid_price_history_identity");
  if(!Number.isSafeInteger(limit)||limit<1||limit>500)
    throw new Error("invalid_price_history_limit");
  const client=await db();
  if(!client)return {configured:false,productUrl,sourceName:source,observations:[]};
  await initPersistence();
  const result=await client.query(
    "select id,price,currency,validation_timestamp,health_status "+
    "from offer_observations where product_url=$1 and source_name=$2 "+
    "order by validation_timestamp desc,id desc limit $3",
    [productUrl,source,limit]
  );
  return {configured:true,productUrl,sourceName:source,
    observations:result.rows.map(row=>({
      id:row.id,price:Number(row.price),currency:row.currency,
      observedAt:row.validation_timestamp instanceof Date
        ?row.validation_timestamp.toISOString():row.validation_timestamp,
      healthStatus:row.health_status
    }))};
}
