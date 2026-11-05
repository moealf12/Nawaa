#!/usr/bin/env python3
"""One-shot live policy/PDP diagnostics for official AliExpress regional hosts.

No guessed alias equivalence, login, CAPTCHA replay, proxy or bypass.
Every different origin undergoes its own robots.txt evaluation via the
established, fail-closed PDP probe. This reports access, not verified price.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "aliexpress_pdp_host_matrix_probe", ROOT / "aliexpress-pdp-evidence-live.py"
)
pdp = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = pdp
spec.loader.exec_module(pdp)

CASES = (
    ("ar.aliexpress.com", "1005012743543835"),
    ("www.aliexpress.com", "1005012743543835"),
    ("www.aliexpress.us", "3256812557229083"),
    ("www.aliexpress.com", "3256812557229083"),
)
MAX_CASES = 4
WAIT_BETWEEN_CASES_SECONDS = 0.8


def run():
    report = {
        "schema": "nawaa.aliexpress.official-pdp-host-matrix.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat(),
        "caseCount": len(CASES),
        "proxyUsed": False, "captchaSolved": False,
        "loginAttempted": False, "retries": 0,
        "customerPublishable": False,
        "priceVerifiedForOriginalSearchItem": False,
        "observedPdpHtmlCount": 0,
        "sameItemJsonLdPriceCandidates": 0,
        "sameItemDomPriceCandidates": 0,
        "cases": [],
    }
    assert len(CASES) <= MAX_CASES
    for idx, (host, item_id) in enumerate(CASES):
        if idx:
            time.sleep(WAIT_BETWEEN_CASES_SECONDS)
        if host not in pdp.ALLOWED_PDP_HOSTS or not pdp._shared.ID.fullmatch(item_id):
            raise ValueError("INVALID_CASE")
        # The shared probe uses these two constants to construct ONLY the
        # exact-ID first-party URL for this case. Calls are sequential.
        pdp.PDP_HOST = host
        pdp.BASE = "https://" + host
        observation = pdp.probe_item(item_id, trace_alias=False)
        stages = observation.get("stages") or []
        robots = [x for x in stages if x.get("step") == "robots_policy"]
        request = [x for x in stages if x.get("step") == "pdp_html"]
        identity = observation.get("productIdentity") or {}
        jsonld = identity.get("jsonLd") or {}
        dom = identity.get("dom") or {}
        if any(x.get("state") == "PDP_HTML_RECEIVED" for x in request):
            report["observedPdpHtmlCount"] += 1
        if jsonld.get("state") == "SAME_ITEM_JSONLD_PRICE_CANDIDATE":
            report["sameItemJsonLdPriceCandidates"] += 1
        if dom.get("priceCandidate"):
            report["sameItemDomPriceCandidates"] += 1
        # The original item and the alias item are independent. Even when
        # an alias has a valid page, no merger or price promotion follows.
        report["cases"].append({
            "host": host,
            "requestedItemId": item_id,
            "robotsState": robots[-1].get("state") if robots else "NOT_CHECKED",
            "robotsHttpStatus": robots[-1].get("status") if robots else None,
            "httpStatus": request[-1].get("status") if request else None,
            "redirectsFollowed": observation["redirectsFollowed"],
            "conclusion": observation["conclusion"],
            "sameItemJsonLdPriceCandidate": jsonld.get("state") ==
                "SAME_ITEM_JSONLD_PRICE_CANDIDATE",
            "sameItemDomPriceCandidate": bool(dom.get("priceCandidate")),
            "selectedSkuProven": False,
            "originalSearchItemIdentityVerified": False,
            "customerPublishable": False,
        })
    assert len(report["cases"]) == report["caseCount"]
    assert all(not item["customerPublishable"] for item in report["cases"])
    return report


def main():
    summary = run()
    Path("aliexpress-official-pdp-host-matrix.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf8"
    )
    print(
        "NAWAA_ALIEXPRESS_OFFICIAL_PDP_HOST_MATRIX "
        + json.dumps(summary, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()
