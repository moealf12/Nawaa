let client, MeiliCtor;
export const searchIndexConfigured=()=>Boolean(process.env.MEILI_HOST&&process.env.MEILI_MASTER_KEY);
async function index(){if(!searchIndexConfigured())return null;if(!MeiliCtor) MeiliCtor=(await import("meilisearch")).MeiliSearch;client ||= new MeiliCtor({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});return client.index(process.env.MEILI_INDEX||"offers");}
export async function indexOffers(offers=[]){const target=await index();if(!target||!offers.length)return {configured:Boolean(target),indexed:0};const docs=offers.filter(o=>o?.sourceUrl&&o?.title).map(o=>({id:Buffer.from([o.sourceUrl,o.sku,o.condition].filter(Boolean).join("|")).toString("base64url").slice(0,500),title:o.title,brand:o.brand||o.specs?.brand||null,merchant:o.merchant||null,merchantCountryCode:o.merchantCountryCode||null,productPrice:o.productPrice??null,totalSAR:o.totalSAR??null,currency:o.currency||null,sourceUrl:o.sourceUrl,imageUrl:o.imageUrl||null,sku:o.sku||null,condition:o.condition||null,availability:o.availability||null,matchConfidence:o.matchConfidence??null,exactMatch:o.exactMatch===true,observedAt:new Date().toISOString()}));await target.addDocuments(docs);return {configured:true,indexed:docs.length};}

export async function searchIndexedOffers(query,{limit=80}={}){
  const target=await index();
  if(!target||!String(query||"").trim()) return {configured:Boolean(target),offers:[]};
  const result=await target.search(String(query),{limit,attributesToRetrieve:["title","brand","merchant","merchantCountryCode","productPrice","totalSAR","currency","sourceUrl","imageUrl","sku","condition","availability","matchConfidence","exactMatch","observedAt"]});
  return {configured:true,offers:(result.hits||[]).map(hit=>({...hit,dataKind:"indexed"}))};
}
