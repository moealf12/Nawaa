"""Actual live Jarir test of the submitted waterfall, read-only and no ingest."""
import json
from .jarir_user_waterfall import JarirScraperEngine

URL="https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html"
EXPECTED_SKU="666784"

def main():
    evidence=JarirScraperEngine.extract_jarir_product(
        URL,expected_sku=EXPECTED_SKU,timeout=12.0)
    fields={key:trace.source for key,trace in evidence.field_evidence.items()}
    price_bound=(evidence.price is not None and evidence.currency=="SAR"
                 and evidence.sku==EXPECTED_SKU)
    result={
        "test":"USER_SUBMITTED_JARIR_WATERFALL",
        "merchant":"jarir-sa",
        "targetSku":EXPECTED_SKU,
        "responseSha256":evidence.response_sha256,
        "htmlReceived":bool(evidence.response_sha256),
        "finalUrlAllowed":bool(evidence.final_url==URL),
        "fieldSources":fields,
        "skuObserved":evidence.sku,
        "priceObservation":str(evidence.price) if price_bound else None,
        "currency":evidence.currency if price_bound else None,
        "availability":evidence.availability,
        "issues":evidence.issues,
        "hasOwnedPriceEvidence":price_bound,
        "outcome":"EVIDENCE_FOUND" if price_bound else (
            "FETCH_FAILED" if not evidence.response_sha256 else "NO_OWNED_PRICE_EVIDENCE"),
        "readOnly":True,
        "noProxy":True,
        "noRetries":True
    }
    print("NAWAA_JARIR_USER_CODE_LIVE "+json.dumps(result,separators=(",",":"),ensure_ascii=False))

if __name__=="__main__":
    main()
