// Optional PIM bridge. NAWAA owns offers/prices; an external PIM owns canonical products/variants.
export const pimConfigured=()=>Boolean(process.env.PIM_API_URL&&process.env.PIM_API_TOKEN);
export async function upsertPimProduct(product){
  if(!pimConfigured()||!product?.identity?.title)return {configured:pimConfigured(),synced:false};
  const base=process.env.PIM_API_URL.replace(/\/$/,"");
  const res=await fetch(base+"/nawaa/products/upsert",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+process.env.PIM_API_TOKEN},body:JSON.stringify({schemaVersion:product.schemaVersion,identity:product.identity,media:product.media,source:product.source,quality:product.quality})});
  if(!res.ok)throw new Error("pim_sync_failed:"+res.status);
  return {configured:true,synced:true};
}
