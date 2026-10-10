// Read-only, offline operational assessment of approved IKEA pilot observations.
// No network, DB writes, automatic alerts, price claims, or background schedules.
import {PILOT_PRODUCTS} from "../../src/ikea-pilot-products.mjs";
import {priceFreshnessStatus} from "./source-refresh-policy.mjs";
import {summarizePriceHistory} from "./price-history-insights.mjs";
const HOUR=3600000,DAY=24*HOUR;
const MONEY=n=>Math.round((n+Number.EPSILON)*100)/100;
function safeObservedAt(value,now){
 const t=typeof value==="string"?Date.parse(value):NaN;
 return Number.isFinite(t)&&t>=0&&t<=now+30000?t:null;
}
function safeObservation(entry,now){
 const at=safeObservedAt(entry?.observedAt,now);
 const price=entry?.price;
 if(at===null||typeof price!=="number"||!Number.isFinite(price)||
    price<=0||price>250000||entry.currency!=="SAR"||
    (entry.healthStatus!=null&&entry.healthStatus!=="healthy"&&entry.healthStatus!=="ok"))
  return null;
 return {price:MONEY(price),currency:"SAR",observedAt:new Date(at).toISOString(),at};
}
function stableDailySamples(points){
 const days=new Map();
 for(const p of points){
  const day=p.observedAt.slice(0,10);
  if(!days.has(day))days.set(day,p);
 }
 return [...days.values()];
}
export function assessPilotProduct({sku,history,now=Date.now(),minimumDistinctDays=2}={}){
 if(!PILOT_PRODUCTS.some(p=>p.sku===sku))throw new Error("unknown_pilot_sku");
 if(!Number.isSafeInteger(now)||now<0)throw new Error("invalid_monitor_clock");
 if(!Number.isInteger(minimumDistinctDays)||minimumDistinctDays<2||minimumDistinctDays>7)
  throw new Error("invalid_evidence_day_count");
 if(!history||history.configured!==true||!Array.isArray(history.observations))
  return {sku,status:"history_unavailable",displayTrust:"unverified",alerts:["history_unavailable"],
   priceMove:{status:"insufficient_evidence",confirmed:false}};
 if(history.observations.length>500)throw new Error("unbounded_monitor_history");
 const clean=history.observations.map(x=>safeObservation(x,now));
 if(clean.some(x=>x===null))
  return {sku,status:"invalid_observations",displayTrust:"unverified",
   alerts:["invalid_observations"],priceMove:{status:"invalid_evidence",confirmed:false}};
 clean.sort((a,b)=>b.at-a.at);
 const latest=clean[0]||null;
 const freshness=priceFreshnessStatus(latest?.observedAt??null,{now});
 const alerts=[];
 if(freshness.status==="unknown")alerts.push("never_observed");
 else if(freshness.status==="stale")alerts.push("stale_price");
 else if(freshness.status==="aging")alerts.push("refresh_due");
 const insights=summarizePriceHistory(clean);
 const days=stableDailySamples(clean);
 const distinctDays=days.length;
 let priceMove={status:"insufficient_evidence",confirmed:false,distinctDays};
 if(latest&&days.length>=minimumDistinctDays){
  const priorDays=days.slice(1);
  const lowerThanEveryPrior=priorDays.every(p=>latest.price<p.price);
  const higherThanEveryPrior=priorDays.every(p=>latest.price>p.price);
  const baseline=priorDays[0].price;
  const changePct=MONEY((latest.price-baseline)/baseline*100);
  const changed=lowerThanEveryPrior||higherThanEveryPrior;
  priceMove={status:changed?(lowerThanEveryPrior?"confirmed_sample_drop":"confirmed_sample_rise"):"no_confirmed_move",
   confirmed:changed,distinctDays,latestPrice:latest.price,previousDayPrice:baseline,
   percentageVsPreviousDay:changePct,scope:"observed_daily_sample_only"};
  if(changed&&Math.abs(changePct)>=10)alerts.push("significant_sample_move");
 }
 return {sku,status:freshness.status,displayTrust:freshness.displayTrust,
  observedAt:latest?.observedAt??null,price:latest?.price??null,
  currency:latest?"SAR":null,ageMs:freshness.ageMs,
  observationCount:clean.length,distinctDays,
  sampleInsights:insights,priceMove,alerts};
}
export function assessPilotHealth({histories={},now=Date.now()}={}){
 if(!histories||typeof histories!=="object"||Array.isArray(histories))
  throw new Error("invalid_monitor_histories");
 const products=PILOT_PRODUCTS.map(p=>assessPilotProduct({
  sku:p.sku,history:histories[p.sku],now
 }));
 const counters={fresh:0,aging:0,stale:0,unknown:0,history_unavailable:0,invalid_observations:0};
 for(const p of products)counters[p.status]=(counters[p.status]||0)+1;
 return {mode:"offline_read_only_monitor",generatedAt:new Date(now).toISOString(),
  totalProducts:products.length,counters,
  significantMoves:products.filter(p=>p.alerts.includes("significant_sample_move")).length,
  productionAlertsSent:0,scheduled:false,products};
}
