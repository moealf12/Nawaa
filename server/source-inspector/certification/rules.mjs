export const SOURCE_STATES = Object.freeze({
  DISCOVERED: "DISCOVERED",
  PROBED: "PROBED",
  CANDIDATE: "CANDIDATE",
  VERIFIED: "VERIFIED",
  CERTIFIED: "CERTIFIED",
  CANARY: "CANARY",
  LIVE: "LIVE",
  DEGRADED: "DEGRADED",
  QUARANTINED: "QUARANTINED",
});

export function evaluateCertification(evidence = {}) {
  const checks = {
    reachable: evidence.reachable === true,
    extractionCandidate: Number(evidence.strategyScore || 0) >= 70,
    criticalFields: Number(evidence.criticalFieldCoverage || 0) >= 0.99,
    priceValidity: Number(evidence.priceValidity || 0) >= 0.99,
    currencyVerified: evidence.currencyVerified === true,
    marketVerified: evidence.marketVerified === true,
    searchPassed: evidence.searchPassed === true,
    paginationPassed: evidence.paginationPassed === true,
    variantAccuracy: Number(evidence.variantAccuracy || 0) >= 0.995,
    semanticCriticalIssues: Number(evidence.semanticCriticalIssues || 0) === 0,
    repeatabilityPassed: evidence.repeatabilityPassed === true,
  };
  const hardPass = Object.values(checks).every(Boolean);
  const probed = checks.reachable && checks.extractionCandidate;
  return {
    passed: hardPass,
    state: hardPass ? SOURCE_STATES.CERTIFIED : probed ? SOURCE_STATES.CANDIDATE : checks.reachable ? SOURCE_STATES.PROBED : SOURCE_STATES.DISCOVERED,
    checks,
  };
}
