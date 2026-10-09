// Background ingestion validation only. Production search is unchanged.
export function inspectOffer(offer) {
 const failures=[];
 if(!offer||typeof offer!=='object'||Array.isArray(offer))return {ok:false,failures:['not_object']};
 const title=String(offer.title||'').trim();
 if(title.length<3||title.length>500)failures.push('title');
 if(typeof offer.price!=='number'||!Number.isFinite(offer.price)||offer.price<=0)failures.push('price');
 if(!/^[A-Z]{3}$/.test(String(offer.currency||'')))failures.push('currency');
 for(const key of ['productUrl','imageUrl']){
  const value=offer[key];
  if(key==='imageUrl'&&(value===null||value===undefined||value===''))continue;
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)failures.push(key)}catch{failures.push(key)}
 }
 return {ok:failures.length===0,failures};
}
