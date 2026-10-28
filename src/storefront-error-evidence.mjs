// Stable, source-owned diagnostic envelopes, NOT customer trust attestations.
// A failed extraction never implies an out-of-stock SKU or a false price.
import {classifySourceError} from "./source-access-intelligence.mjs";

const FAILURE_CLASSES=new Set([
  "HTTP_403_ACCESS_DENIED","HTTP_404_RESOURCE_NOT_FOUND",
  "HTTP_410_RESOURCE_GONE","HTTP_429_RATE_LIMITED",
  "HTTP_5XX_SOURCE_FAILURE","HTTP_TIMEOUT","HTTP_ABORTED",
  "HTTP_200_BLOCK_PAGE","HTTP_200_JS_SHELL","HTTP_200_EMPTY_CATALOG",
  "HTTP_REDIRECT_CHANGED","PRODUCT_IDENTITY_MISMATCH",
  "EXTRACTION_FAILURE","CATALOG_RESULT_NOT_FOUND",
  "SOURCE_TRANSPORT_FAILURE","PRICE_EVIDENCE_INCOMPLETE",
  "NO_VERIFIED_STRUCTURED_PRICE_PDP"
]);
export function storefrontSourceFailure(storeId,error,{observedFailureClass=null}={}){
  // A source id must come from our static storefront registry, not a URL.
  if(typeof storeId!=="string"||!/^[a-z0-9][a-z0-9-]{1,79}$/.test(storeId))
    throw Error("INVALID_STOREFRONT_ID");
  const message=error instanceof Error?error.message:String(error??"");
  const inferred=classifySourceError(error instanceof Error?error:{message}).failureClass;
  // classifySourceError's generic fallback is SOURCE_TRANSPORT_FAILURE.
  // That fallback is not evidence of a transport error: unknown parsing/logic
  // exceptions must remain UNKNOWN unless the error mentions a network cause.
  const transportObserved=/\b(?:fetch failed|network error|econnreset|enotfound|eai_again|dns|socket hang up|econnrefused)\b/i.test(message);
  const safeInference=inferred==="SOURCE_TRANSPORT_FAILURE" && !transportObserved
    ? "UNKNOWN" : inferred;
  const failureClass=FAILURE_CLASSES.has(observedFailureClass)?observedFailureClass:
    FAILURE_CLASSES.has(safeInference)?safeInference:"UNKNOWN";
  return {
    market:storeId,
    sourceId:storeId,
    failureClass,
    // Existing downstream diagnostics contract: retain source-provided text,
    // but never copy it to customer-visible or archived attribution reports.
    error:message,
  };
}
