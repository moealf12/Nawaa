import { createExtractionProfile, PROFILE_STATUS } from "./profile-schema.mjs";

function unique(values=[]) { return [...new Set(values.filter(Boolean))]; }

export function applyInspectorEvidence(profile, inspection) {
  const next=structuredClone(profile || createExtractionProfile({sourceUrl:inspection?.source?.url}));
  const now=inspection?.observedAt || new Date().toISOString();
  next.platform=inspection?.capabilities?.platform || next.platform;
  next.requirements.javascript=inspection?.capabilities?.embeddedJson ? "possible" : next.requirements.javascript;
  next.mechanisms.product=inspection?.capabilities?.jsonLd ? "json-ld" : inspection?.capabilities?.productHint ? "html" : next.mechanisms.product;
  next.mechanisms.search=inspection?.capabilities?.searchHint ? "discovered" : next.mechanisms.search;
  next.mechanisms.pagination=inspection?.probes?.pagination?.model || next.mechanisms.pagination;
  next.strategies.candidates=(inspection?.strategies || []).map(({id,score})=>({id,score}));
  next.strategies.primary=inspection?.selectedStrategy || next.strategies.primary;
  const xhrCandidates=inspection?.probes?.jsonXhr?.candidates || [];
  next.endpoints.observed=unique([...(next.endpoints.observed || []),...xhrCandidates.map(candidate=>candidate.url)]);
  next.endpoints.search=unique([...(next.endpoints.search || []),...xhrCandidates.filter(candidate=>candidate.type==="search").map(candidate=>candidate.url)]);
  next.endpoints.product=unique([...(next.endpoints.product || []),...xhrCandidates.filter(candidate=>candidate.type==="product").map(candidate=>candidate.url)]);
  next.evidence=[...next.evidence,{
    kind:"fast-probe",
    observedAt:now,
    phase:inspection?.phase || "FAST_PROBE",
    capabilities:inspection?.capabilities || {},
    probes:inspection?.probes || {},
  }].slice(-20);
  next.endpoints.observed=unique(next.endpoints.observed);
  next.updatedAt=now;
  return next;
}

export function finalizeExtractionProfile(profile, patch={}) {
  const next=structuredClone(profile);
  Object.assign(next, patch);
  next.status=PROFILE_STATUS.COMPLETE;
  next.updatedAt=new Date().toISOString();
  return next;
}
