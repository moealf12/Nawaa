import { diffExtractionProfiles } from "./profile-diff.mjs";

export function versionExtractionProfile(previous, candidate, {reason="re-probe", now=new Date().toISOString()}={}) {
  const diff=diffExtractionProfiles(previous,candidate);
  if (!diff.changed) return {...candidate,profileVersion:previous?.profileVersion || candidate.profileVersion || 1,updatedAt:now,changeReason:null};
  return {...candidate,profileVersion:(previous?.profileVersion || 0)+1,updatedAt:now,changeReason:reason};
}
