// A searchable copy is NOT a new merchant observation. Do not mint fresh
// price/stock timestamps on reindexing, cache warmup, or process restart.
// Customer cache currently uses a 45-second fresh window. Keep the index
// within the same strictly bounded evidence age, never seven-day retention.
export const INDEXED_OFFER_FRESH_MS = 45_000;
const validSourceObservation = (value, now) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp=Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000) return null;
  return new Date(timestamp).toISOString();
};

let client, MeiliCtor;
export const searchIndexConfigured=()=>Boolean(process.env.MEILI_HOST&&process.env.MEILI_MASTER_KEY);
async function index(){if(!searchIndexConfigured())return null;if(!MeiliCtor) MeiliCtor=(await import("meilisearch")).MeiliSearch;client ||= new MeiliCtor({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});return client.index(process.env.MEILI_INDEX||"offers");}
export async function indexOffers(offers=[]){
  const target=await index();
  if(!target||!offers.length)return {configured:Boolean(target),indexed:0};
  const now=Date.now();
  const docs=offers.filter(o=>o?.sourceUrl&&o?.title).flatMap(o=>{
    const observedAt=validSourceObservation(o.observedAt,now);
    if(!observedAt)return []; // Unknown source time must not become "fresh".
    return [{
      id:Buffer.from([o.sourceUrl,o.condition||"new"].join("|")).toString("base64url").slice(0,500),
      title:o.title,brand:o.brand||o.specs?.brand||null,merchant:o.merchant||null,
      merchantCountryCode:o.merchantCountryCode||null,
      productPrice:o.productPrice??null,totalSAR:o.totalSAR??null,
      currency:o.currency||null,sourceUrl:o.sourceUrl,imageUrl:o.imageUrl||o.image||null,
      sku:o.sku||o.sourceMeta?.productId||null,condition:o.condition||null,
      availability:o.availability||null,
      // Stored relevance is historical, and MUST be recalculated on replay.
      matchConfidence:o.matchConfidence??null,exactMatch:o.exactMatch===true,
      sourceMeta:o.sourceMeta?{productId:o.sourceMeta.productId||null,
        parsedFrom:o.sourceMeta.parsedFrom||null}:null,
      specs:o.specs?{brand:o.specs.brand||null,modelNumber:o.specs.modelNumber||null}:null,
      observedAt,
    }];
  });
  if(!docs.length)return {configured:true,indexed:0};
  await target.addDocuments(docs);
  return {configured:true,indexed:docs.length};
}
export async function searchIndexedOffers(query,{limit=80,now=Date.now()}={}){
  const target=await index();
  if(!target||!String(query||"").trim())return {configured:Boolean(target),offers:[]};
  const result=await target.search(String(query),{limit,
    attributesToRetrieve:["title","brand","merchant","merchantCountryCode",
      "productPrice","totalSAR","currency","sourceUrl","imageUrl","sku",
      "condition","availability","matchConfidence","exactMatch","observedAt",
      "sourceMeta","specs"]});
  const offers=(result.hits||[]).filter(hit=>{
    const timestamp=Date.parse(hit.observedAt);
    const age=now-timestamp;
    return Number.isFinite(timestamp)&&age>=-60_000&&age<=INDEXED_OFFER_FRESH_MS;
  }).map(hit=>({
    ...hit,
    // No historical exact=true or confidence from another query/older rules.
    exactMatch:false,matchConfidence:0,
    dataKind:"indexed",
  }));
  return {configured:true,offers};
}
