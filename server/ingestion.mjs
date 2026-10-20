const HTTPS_URL=/^https:\/\//i;
export const INGEST_BATCH_LIMIT=500;

export function normalizeIngestOffer(input={}){
  const title=String(input.title||"").trim();
  const sourceUrl=String(input.sourceUrl||"").trim();
  const price=Number(input.productPrice);
  const observedTime=typeof input.observedAt==="string"&&input.observedAt.trim()
    ? Date.parse(input.observedAt) : NaN;
  // The time an ingestion request arrives is NOT the time a merchant was observed.
  if(title.length<3||!HTTPS_URL.test(sourceUrl)||!Number.isFinite(price)||price<=0||
     !Number.isFinite(observedTime)||observedTime>Date.now()+60_000)return null;
  return {
    ...input,
    title,
    sourceUrl,
    productPrice:price,
    merchant:input.merchant?String(input.merchant).trim():null,
    currency:input.currency?String(input.currency).trim().toUpperCase():null,
    sku:input.sku?String(input.sku).trim():null,
    condition:input.condition?String(input.condition).trim().toLowerCase():null,
    availability:input.availability?String(input.availability).trim().toLowerCase():null,
    dataKind:"ingested",
    observedAt:new Date(observedTime).toISOString(),
  };
}

export function normalizeIngestBatch(offers=[]){
  if(!Array.isArray(offers))return [];
  return offers.slice(0,INGEST_BATCH_LIMIT).map(normalizeIngestOffer).filter(Boolean);
}
