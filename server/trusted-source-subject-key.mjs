// Selected sellable subject identity for scoped source-head reconciliation.
// A merchant's tracking tags cannot create independent revision histories.
// All nontracking query parameters, including duplicates and their order,
// remain identity-bearing. This is NOT evidence of merchant revision order.
import {createHash} from 'node:crypto';
export const SOURCE_SUBJECT_KEY_POLICY='selected-merchant-offer-v2';
const TRACKING=/^(?:utm_[a-z0-9_]+|gclid|fbclid|msclkid|affiliate|aff)$/i;

export function trustedSourceSubjectKey(sourceId,sku,sourceUrl){
  if(sourceId!=='jarir-sa'||typeof sku!=='string'||!sku.trim()||
     sku.length>256||typeof sourceUrl!=='string'||sourceUrl.length>2048)
    return null;
  let url;
  try{url=new URL(sourceUrl);}catch{return null;}
  const hostname=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||!['jarir.com','www.jarir.com'].includes(hostname)||
     url.username||url.password||url.port)return null;
  url.hostname='www.jarir.com';
  url.hash='';
  const selected=[];
  for(const [key,value] of url.searchParams){
    if(key.length>128||value.length>512)return null;
    if(!TRACKING.test(key))selected.push([key,value]);
  }
  url.search='';
  for(const [key,value] of selected)url.searchParams.append(key,value);
  return createHash('sha256').update(JSON.stringify([sourceId,sku,url.href])).digest('hex');
}
