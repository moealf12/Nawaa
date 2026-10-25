// Fail closed when public Render /health serves a different GitHub main revision.
// This is deployment identity only, NOT a merchant/product authenticity claim.
export function requireLiveRevision(actual,expected){
  const pattern=/^[a-f0-9]{40}$/i;
  if(typeof actual!=='string'||!pattern.test(actual))
    throw new Error('live_revision_missing_or_invalid');
  if(typeof expected!=='string'||!pattern.test(expected))
    throw new Error('expected_main_revision_missing_or_invalid');
  if(actual.toLowerCase()!==expected.toLowerCase())
    throw new Error('post_release_exact_head_mismatch');
  return true;
}
