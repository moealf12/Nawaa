// Amazon multi-page source evidence, shared by JSON, SSE, and cursor expansion.
// Failure of one page must never erase independently validated sibling offers.
// Only bounded source-level classifications are returned (no query/URL/price).
export function assessAmazonPageEvidence(expectedPages, result) {
  const expected=Number(expectedPages);
  const deny=(reason,pagesRequested=null,pagesFetched=null)=>({
    complete:false,reason,expectedPages:expectedPages,pagesRequested,pagesFetched,
  });
  if(!Number.isSafeInteger(expected)||expected<0||expected>8)return deny("expected_pages_invalid");
  if(expected===0)return {complete:true,reason:"not_requested",expectedPages:0,pagesRequested:0,pagesFetched:0};

  if(!result||typeof result!=="object"||Array.isArray(result))
    return deny("result_missing");
  if(result.error)return deny("source_error");
  if(result.errors!==undefined && (!Array.isArray(result.errors)||result.errors.length))
    return deny("source_errors");
  if(result.failures!==undefined && (!Number.isSafeInteger(result.failures)||result.failures>0||result.failures<0))
    return deny("source_failures");

  const diagnostic=result.diagnostics;
  if(!diagnostic||typeof diagnostic!=="object"||Array.isArray(diagnostic))
    return deny("diagnostics_missing");
  if(diagnostic.primarySearchError||diagnostic.sourceAccessFailure||
     diagnostic.searchPage?.blockedReason)
    return deny("source_access_failure");

  const page=diagnostic.searchPage;
  if(!page||typeof page!=="object"||Array.isArray(page))
    return deny("page_counts_missing");
  const pagesRequested=page.pagesRequested,pagesFetched=page.pagesFetched;
  if(!Number.isSafeInteger(pagesRequested)||!Number.isSafeInteger(pagesFetched)||
     pagesRequested<0||pagesFetched<0)
    return deny("page_counts_invalid",pagesRequested??null,pagesFetched??null);
  if(pagesRequested!==expected)
    return deny("page_count_mismatch",pagesRequested,pagesFetched);
  if(pagesFetched!==pagesRequested)
    return deny("page_fetch_incomplete",pagesRequested,pagesFetched);
  return {complete:true,reason:"pages_verified",expectedPages:expected,
    pagesRequested,pagesFetched};
}

export function amazonPartialEvidenceError(expectedPages,result,pass) {
  const evidence=assessAmazonPageEvidence(expectedPages,result);
  if(evidence.complete)return null;
  return {provider:"free-storefronts",sourceId:"free-storefronts:amazon-sa",
    pass, error:"amazon_incomplete_source_evidence"};
}
