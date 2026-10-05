let pool, initialized=false, PoolCtor=null;
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
export async function initPersistence(){const client=await db();if(!client||initialized)return {configured:Boolean(client),ready:initialized};await client.query(`
create table if not exists nawaa_offers(
id bigserial primary key,offer_key text not null unique,query text,title text not null,brand text,merchant text,merchant_country_code text,
source_url text not null,image_url text,currency text,product_price numeric,total_sar numeric,sku text,condition text,availability text,
match_confidence numeric,exact_match boolean,observed_at timestamptz not null default now(),payload jsonb not null);
create index if not exists nawaa_offers_title_idx on nawaa_offers using gin(to_tsvector('simple',title));
create index if not exists nawaa_offers_brand_idx on nawaa_offers(brand);
create index if not exists nawaa_offers_observed_idx on nawaa_offers(observed_at desc);

-- Append-only price history. Each validation creates a new observation; rows are never updated in place.
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

-- Enforce immutability at the database boundary so application bugs cannot rewrite historical prices.
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

-- Future zero-cost search strategy: keep PostgreSQL as the only search datastore (no Meilisearch).
-- Build a weighted tsvector from normalized product title, brand, merchant, category and identifiers,
-- persist/index it with GIN, then rank candidates with websearch_to_tsquery/ts_rank before live verification.
-- This keeps the fast path as a DB read while asynchronous ingestion refreshes durable offer data.
`);initialized=true;return {configured:true,ready:true};}
const canonicalUrl=value=>{try{const u=new URL(value);u.hash="";for(const key of [...u.searchParams.keys()])if(/^utm_|^(gclid|fbclid|ref|aff|affiliate)$/i.test(key))u.searchParams.delete(key);u.hostname=u.hostname.toLowerCase().replace(/^www\./,"");u.pathname=u.pathname.replace(/\/+$/,"")||"/";return u.toString();}catch{return String(value||"").trim();}};
const keyOf=o=>[canonicalUrl(o.sourceUrl),o.condition||"new"].join("|");
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
