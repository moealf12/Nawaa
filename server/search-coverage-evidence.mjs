// Source evidence for a single bounded acquisition wave. Reports describe
// connector calls, NOT all configured stores, verified availability or global
// search completeness. Preserve raw provider diagnostics separately.
export function summarizeWaveSourceEvidence(providers=[],errors=[]){
  const reports=Array.isArray(providers)?providers:[];
  const issues=Array.isArray(errors)?errors:[];
  let reportedOffers=0,withOffers=0,explicitSuccess=0,explicitNoSuccess=0,unknown=0;
  for(const row of reports){
    const raw=Number(row?.returnedOffers);
    const n=Number.isSafeInteger(raw)&&raw>0?raw:0;
    reportedOffers=Math.min(Number.MAX_SAFE_INTEGER,reportedOffers+n);
    if(n>0)withOffers++;
    if(row?.ok===true)explicitSuccess++;
    else if(row?.ok===false)explicitNoSuccess++;
    else unknown++;
  }
  return {
    providerReports:reports.length,
    reportsWithOffers:withOffers,
    connectorReportedOffers:reportedOffers,
    reportedSuccess:explicitSuccess,
    reportedNoSuccess:explicitNoSuccess,
    outcomeUnknown:unknown,
    errorReports:issues.length,
    // Connector reports can include duplicate offers and empty result sets.
    // Never derive inventory exhaustiveness from these counts.
    exhaustive:false,
  };
}
