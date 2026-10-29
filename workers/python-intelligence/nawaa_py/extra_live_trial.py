"""One-shot public eXtra product HTTPX trial; diagnostic evidence only."""
import json
import time
from .extra_pdp import ExtraScraperEngine, ExtraFetchError, SOURCE_ID

# Source page was already referenced in NAWAA's existing HTML-inspection script.
PUBLIC_URL = (
    "https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/"
    "apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492"
)
SKU = "100462492"

def main():
    started = time.perf_counter()
    result = {
        "experiment": "EXTRA_PYTHON_HTTPX_REAL_PDP",
        "sourceId": SOURCE_ID, "sku": SKU, "attempted": True,
        "live": True, "published": False, "persisted": False,
        "noProxy": True, "noImpersonation": True, "noRetries": True,
        "noRedirects": True, "outcome": "NOT_OBSERVED",
        "priceObserved": False, "skuMatches": False
    }
    try:
        evidence = ExtraScraperEngine.extract_product(
            PUBLIC_URL, SKU, timeout_ms=8000, max_response_bytes=1_500_000
        )
        eligible = (
            evidence.price is not None and evidence.currency == "SAR"
            and evidence.sku == SKU and not evidence.issues
        )
        result.update({
            "outcome": "EXTRACTED_PRICE_EVIDENCE" if eligible
                       else "INSUFFICIENT_SOURCE_EVIDENCE",
            "skuMatches": evidence.sku == SKU,
            "hasResponseHash": bool(evidence.response_sha256),
            "priceObserved": bool(eligible),
            "price": str(evidence.price) if eligible else None,
            "currency": evidence.currency if eligible else None,
            "availability": evidence.availability if eligible else "UNKNOWN",
            "priceSource": evidence.field_evidence.get("price").source if eligible else None,
            "issues": evidence.issues[:8]
        })
    except ExtraFetchError as exc:
        result.update({"outcome": "SOURCE_ACCESS_OR_TRANSPORT_FAILURE",
                       "failureClass": exc.code, "httpStatus": exc.http_status})
    except Exception:
        result.update({"outcome": "EXPERIMENT_INTERNAL_FAILURE",
                       "failureClass": "EXTRA_PYTHON_INTERNAL_ERROR"})
    result["elapsedMs"] = round((time.perf_counter() - started) * 1000)
    print("NAWAA_EXTRA_PYTHON_LIVE " + json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    # Workflow completion means a real experiment ran; denied source is not
    # reported as a successful price observation.
if __name__ == "__main__":
    main()
