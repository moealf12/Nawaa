function stable(value){ return JSON.stringify(value, Object.keys(value || {}).sort()); }

export function diffExtractionProfiles(previous, current) {
  const fields=["platform","market","currency","mechanisms","requirements","endpoints","strategies","fieldMapping","knownQuirks","knownLimitations"];
  const changes=[];
  for (const field of fields) {
    if (stable(previous?.[field])!==stable(current?.[field])) changes.push({field,before:previous?.[field] ?? null,after:current?.[field] ?? null});
  }
  return {changed:changes.length>0,changes};
}
