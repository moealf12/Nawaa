import {z} from "zod";
// Validation boundary for background ingestion; never rewrites live customer-search behavior.
// Cross-field and merchant-original verification remain additional mandatory steps.
export const candidateOfferSchema=z.object({
 title:z.string().trim().min(3).max(350),
 sourceUrl:z.url({protocol:/^https$/}),
 productPrice:z.number().finite().positive(),
 currency:z.string().regex(/^[A-Z]{3}$/),
 image:z.url({protocol:/^https$/}).optional(),
 imageUrl:z.url({protocol:/^https$/}).optional(),
 merchant:z.string().trim().min(2).max(120).optional(),
 sku:z.string().max(120).optional(),
}).passthrough();
export function validateCandidateOffer(value){
 const result=candidateOfferSchema.safeParse(value);
 if(!result.success)return {valid:false,issues:result.error.issues.map(i=>({field:i.path.join("."),code:i.code}))};
 const offer=result.data;
 try{
  const url=new URL(offer.sourceUrl);
  if(url.username||url.password||!url.hostname.includes("."))return {valid:false,issues:[{field:"sourceUrl",code:"invalid_target"}]};
  for(const candidate of [offer.image,offer.imageUrl].filter(Boolean)){
   const img=new URL(candidate);
   if(img.username||img.password||!img.hostname.includes("."))return {valid:false,issues:[{field:"image",code:"invalid_target"}]};
  }
 }catch{return {valid:false,issues:[{field:"sourceUrl",code:"invalid_target"}]};}
 return {valid:true,offer};
}
