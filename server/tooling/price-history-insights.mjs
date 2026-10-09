// Pure, read-only analysis over a bounded merchant price-history sample.
// Every min/max is sample-only; it is NOT an all-time low/high claim.
function money(value){return Math.round((value+Number.EPSILON)*100)/100;}
export function summarizePriceHistory(observations=[]){
 if(!Array.isArray(observations))throw new TypeError("price_history_array_required");
 if(!observations.length)return {status:"no_observations",sampleSize:0,hasChange:false};
 const points=[];
 for(const item of observations){
  const price=Number(item?.price);
  const timestamp=Date.parse(item?.observedAt||"");
  const currency=item?.currency;
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(timestamp)||
    !/^[A-Z]{3}$/.test(String(currency||"")))
    return {status:"invalid_history",sampleSize:observations.length,hasChange:false};
  points.push({price,currency,timestamp});
 }
 const distinctCurrencies=[...new Set(points.map(x=>x.currency))];
 if(distinctCurrencies.length!==1)
  return {status:"mixed_currency",sampleSize:points.length,hasChange:false};
 // The persisted read uses observed timestamp DESC; sort defensively for
 // callers using synthetic fixtures. Stable equal-time ordering is preserved.
 points.sort((a,b)=>b.timestamp-a.timestamp);
 const current=points[0],oldest=points.at(-1);
 const firstDifferentIndex=points.findIndex((p,i)=>i>0&&p.price!==current.price);
 const priorSeries=firstDifferentIndex<0?[]:points.slice(firstDifferentIndex);
 const prior=priorSeries[0];
 const prices=points.map(p=>p.price);
 const min=money(Math.min(...prices)),max=money(Math.max(...prices));
 const delta=prior?money(current.price-prior.price):null;
 const percent=prior?money((current.price-prior.price)/prior.price*100):null;
 const direction=delta===null?"not_enough_change_evidence":
   delta<0?"decrease":delta>0?"increase":"stable";
 return {
  status:"ok",sampleSize:points.length,currency:current.currency,
  latestObservedPrice:money(current.price),latestObservedAt:new Date(current.timestamp).toISOString(),
  oldestObservedAt:new Date(oldest.timestamp).toISOString(),
  sampleMinPrice:min,sampleMaxPrice:max,
  hasChange:Boolean(prior),lastDifferentPrice:prior?money(prior.price):null,
  absoluteChange:delta,percentageChange:percent,direction,
  sampleAtLow:current.price===min,
  sampleNewLow:Boolean(prior)&&current.price<Math.min(...priorSeries.map(p=>p.price)),
  sampleAtHigh:current.price===max,
  sampleNewHigh:Boolean(prior)&&current.price>Math.max(...priorSeries.map(p=>p.price)),
  significantMove:Boolean(prior)&&Math.abs(percent)>=10
 };
}
