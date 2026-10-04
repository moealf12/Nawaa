import pg from "pg";
const { Pool } = pg;
let pool, initialized=false;
export const persistenceConfigured=()=>Boolean(process.env.DATABASE_URL);
const db=()=>{ if(!persistenceConfigured()) return null; return pool ||= new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false},max:Number(process.env.DATABASE_POOL_MAX||4)}); };
export async function initPersistence(){const client=db();if(!client||initialized)return {configured:Boolean(client),ready:initialized};await client.query(`
create table if not exists nawaa_offers(
id bigserial primary key,offer_key text not null unique,query text,title text not null,brand text,merchant text,merchant_country_code text,
source_url text not null,image_url text,currency text,product_price numeric,total_sar numeric,sku text,condition text,availability text,
match_confidence numeric,exact_match boolean,observed_at timestamptz not null default now(),payload jsonb not null);
create index if not exists nawaa_offers_title_idx on nawaa_offers using gin(to_tsvector('simple',title));
create index if not exists nawaa_offers_brand_idx on nawaa_offers(brand);
create index if not exists nawaa_offers_observed_idx on nawaa_offers(observed_at desc);`);initialized=true;return {configured:true,ready:true};}
const keyOf=o=>[o.sourceUrl,o.sku,o.condition].filter(Boolean).join("|");
export async function persistOffers(query,offers=[]){const client=db();if(!client||!offers.length)return {configured:Boolean(client),saved:0};await initPersistence();let saved=0;for(const o of offers){if(!o?.sourceUrl||!o?.title)continue;const key=keyOf(o);if(!key)continue;await client.query(`insert into nawaa_offers(offer_key,query,title,brand,merchant,merchant_country_code,source_url,image_url,currency,product_price,total_sar,sku,condition,availability,match_confidence,exact_match,observed_at,payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),$17::jsonb) on conflict(offer_key) do update set query=excluded.query,title=excluded.title,brand=excluded.brand,merchant=excluded.merchant,merchant_country_code=excluded.merchant_country_code,image_url=excluded.image_url,currency=excluded.currency,product_price=excluded.product_price,total_sar=excluded.total_sar,availability=excluded.availability,match_confidence=excluded.match_confidence,exact_match=excluded.exact_match,observed_at=now(),payload=excluded.payload`,[key,query,o.title,o.brand||o.specs?.brand||null,o.merchant||null,o.merchantCountryCode||null,o.sourceUrl,o.imageUrl||null,o.currency||null,o.productPrice??null,o.totalSAR??null,o.sku||null,o.condition||null,o.availability||null,o.matchConfidence??null,o.exactMatch===true,JSON.stringify(o)]);saved++;}return {configured:true,saved};}
