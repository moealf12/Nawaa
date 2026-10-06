const STAGES=["profile","adapter","ingestion","normalization","validation","database","productResolution","search","api","frontend"];
export function evaluateEndToEnd(evidence={}){const checks=STAGES.map(stage=>({stage,passed:evidence[stage]===true}));return {passed:checks.every(x=>x.passed),checks,missing:checks.filter(x=>!x.passed).map(x=>x.stage),productionEligible:checks.every(x=>x.passed)};}
