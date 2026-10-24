// A/B smoke measurements are diagnostics, not production P95 certification.
// This module is pure: no server, network or paid dependency. Reuse this
// exact contract from tests to forbid silent promotion of a tiny, biased sample.
const quantile=(values,p)=>values.length?
  [...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]:null;

export function summarizeDiagnosticLatencyGroup(rows,{sha,q,phase}={}){
  if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'))
    throw new TypeError('latency_observation_rows_required');
  const times=rows.map(r=>r.firstValidOfferMs)
    .filter(t=>Number.isFinite(t)&&t>=0);
  const exactTimes=rows.map(r=>r.firstExactOfferMs)
    .filter(t=>Number.isFinite(t)&&t>=0);
  // Never issue a production P95 claim from isolated CI benchmark runs:
  // even n>=20 would not ensure representative query/population sampling,
  // production topology, adequate failure inclusion or confidence bounds.
  return Object.freeze({sha,q,phase,n:rows.length,successes:times.length,
    medianMs:quantile(times,.5),maxMs:quantile(times,1),
    firstExactSuccesses:exactTimes.length,
    firstExactMedianMs:quantile(exactTimes,.5),
    firstExactMaxMs:quantile(exactTimes,1),
    sampleP95Ms:null,sloCertified:false,
    certificationStatus:'DIAGNOSTIC_ONLY',
    certificationBlocker:'nonrepresentative_ci_samples_and_uncertified_slo_method',
    missingValidOffers:rows.length-times.length});
}
