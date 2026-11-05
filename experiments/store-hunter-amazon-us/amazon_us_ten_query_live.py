#!/usr/bin/env python3
"""10 independent LIVE Amazon US search intents (no synthetic product outcomes).

Only publicly available Amazon search pages and PDPs; no stealth, proxy,
login, CAPTCHA handling, status-code masking or production wiring.
"""
import asyncio
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from nawaa_store_hunter import Scraper

QUERIES = (
    "wireless headphones",
    "iPhone 17",
    "Samsung Galaxy S25",
    "PlayStation 5 console",
    "PS5 disc drive",
    "JBL bluetooth speaker",
    "laptop 16GB RAM",
    "4K monitor",
    "robot vacuum",
    "سماعات بلوتوث",
)
MAX_PER_QUERY = 5
ASIN = re.compile(r"^[A-Z0-9]{10}$")
STOP_STATUSES = {"BLOCKED_OR_RATE_LIMITED", "CHALLENGE_PAGE", "ROBOTS_DENIED_OR_UNSAFE"}
def now_utc():
    return datetime.now(timezone.utc).isoformat()

def summary_for(query, result, elapsed_ms):
    products = result.get("products", [])
    complete = [p for p in products if p.get("title") and p.get("url")
                and p.get("price") and p.get("currency") == "USD"
                and p.get("image") and ASIN.fullmatch(str(p.get("sku") or ""))]
    correlated = [p for p in complete if p.get("price_status") == "evidence_correlated"]
    single_source = [p for p in complete if p.get("price_status") == "single_source_unverified"]
    exact = [p for p in complete if p.get("intent_match") == "exact"]
    exact_parity = [p for p in exact if p.get("price_evidence") == "listing_pdp_agree"]
    related = [p for p in complete if p.get("intent_match") == "related"]
    mismatches = [p for p in complete if p.get("intent_match") == "mismatch"]
    unclassified = [p for p in complete if p.get("intent_match") == "unclassified"]
    diagnostics = result.get("diagnostics", [])
    http_search = [d for d in diagnostics if d.get("method") == "search-html"]
    access_stop = [d for d in diagnostics if d.get("status") in STOP_STATUSES]
    if exact_parity:
        acceptance = "PASS_EXACT_WITH_PDP_PARITY"
    elif exact:
        acceptance = "PARTIAL_EXACT_SINGLE_SOURCE_ONLY"
    elif complete:
        acceptance = "FAIL_NO_EXACT_MATCH_WITH_PRICE"
    else:
        acceptance = "FAIL_NO_COMPLETE_PRODUCT"
    return {
        "query": query, "observed_utc": now_utc(),
        "status": result.get("status"), "acceptance": acceptance,
        "elapsed_ms": round(elapsed_ms),
        "product_count": len(products),
        "complete_usd_image_asin": len(complete),
        "pdp_correlated": len(correlated),
        "exact_intent_complete": len(exact),
        "exact_intent_pdp_parity": len(exact_parity),
        "related_intent_complete": len(related),
        "mismatched_intent_complete": len(mismatches),
        "unclassified_intent_complete": len(unclassified),
        "single_source_unverified": len(single_source),
        "price_conflicts": sum(p.get("price_status") == "conflict" for p in products),
        "access_denied_or_challenged": bool(access_stop),
        "search_attempts": len([d for d in http_search if d.get("status") in ("OK","HTTP_ERROR","BLOCKED_OR_RATE_LIMITED","CHALLENGE_PAGE")]),
        "header_fallback": any(d.get("status") == "TRANSIENT_HTTP_HEADER_FALLBACK_ONCE" for d in diagnostics),
        "header_restored": any(d.get("status") == "HEADER_PROFILE_RESTORED" for d in diagnostics),
        "search_diagnostics": [
            {"status": d.get("status"), "detail": str(d.get("detail") or "")[:100], "elapsed_ms": d.get("elapsed_ms",0)}
            for d in http_search
        ],
        "products": [
            {"asin": p.get("sku"), "title": p.get("title"), "price": p.get("price"),
             "currency": p.get("currency"), "image": p.get("image"), "url": p.get("url"),
             "price_status": p.get("price_status"), "price_evidence": p.get("price_evidence"),
             "intent_match": p.get("intent_match"), "intent_reasons": p.get("intent_reasons"),
             "condition": p.get("condition"), "issues": p.get("issues")}
            for p in products
        ],
    }

async def probe_one(query):
    scraper = Scraper("https://www.amazon.com", query, maximum=MAX_PER_QUERY,
                      pages=1, browser="never", pdp="all",
                      search_url="https://www.amazon.com/s?k={query}")
    scraper.search_targets = lambda _: [("https://www.amazon.com/s", {"k": query})]
    start = time.monotonic()
    try:
        result = await scraper.search()
    except Exception as exc:
        result = {"status": "probe_exception", "products": [],
                  "diagnostics": [{"method": "probe", "status": type(exc).__name__,
                                   "detail": str(exc)[:100]}]}
    finally:
        await scraper.close()
    return summary_for(query, result, (time.monotonic()-start)*1000)

async def main():
    run_start = time.monotonic()
    data=[]
    stopped_reason=None
    for i,query in enumerate(QUERIES, 1):
        if stopped_reason:
            data.append({"query":query,"status":"NOT_RUN","acceptance":"SKIPPED_SAFETY_STOP",
                         "reason":stopped_reason})
            continue
        record=await probe_one(query)
        record["index"]=i
        data.append(record)
        concise={k:v for k,v in record.items() if k not in ("products","search_diagnostics")}
        print("INTENT "+json.dumps(concise, ensure_ascii=False, sort_keys=True),flush=True)
        if record["access_denied_or_challenged"]:
            stopped_reason="Explicit 403/429, challenge or robots denial; stopped further probing"
        # Moderate load and keep the exact search count observable.
        if i < len(QUERIES) and not stopped_reason:
            await asyncio.sleep(1.5)
    ran=[r for r in data if r.get("status")!="NOT_RUN"]
    report={
        "experiment":"NAWAA Amazon US Store Hunter — 10 real intents",
        "tested_utc":now_utc(),
        "target":"https://www.amazon.com",
        "runner":"GitHub Actions macos-15",
        "total_queries":len(QUERIES), "queries_attempted":len(ran),
        "queries_with_complete_product":sum(r["complete_usd_image_asin"]>0 for r in ran),
        "queries_with_pdp_parity":sum(r["pdp_correlated"]>0 for r in ran),
        "queries_with_exact_intent_complete":sum(r["exact_intent_complete"]>0 for r in ran),
        "queries_with_exact_intent_pdp":sum(r["exact_intent_pdp_parity"]>0 for r in ran),
        "total_exact_intent_complete":sum(r["exact_intent_complete"] for r in ran),
        "total_exact_intent_pdp":sum(r["exact_intent_pdp_parity"] for r in ran),
        "total_intent_mismatch_complete":sum(r["mismatched_intent_complete"] for r in ran),
        "total_complete_products":sum(r["complete_usd_image_asin"] for r in ran),
        "total_pdp_correlated":sum(r["pdp_correlated"] for r in ran),
        "header_fallback_queries":sum(r["header_fallback"] for r in ran),
        "header_restored_queries":sum(r["header_restored"] for r in ran),
        "elapsed_seconds":round(time.monotonic()-run_start,2),
        "safety_stop":stopped_reason,
        "results":data,
        "field_gate":"PASS_ALL_TEN_FIELDS" if len(ran)==10 and all(r["complete_usd_image_asin"]>=1 for r in ran) else
                     "FAIL_FIELD_COVERAGE",
        "gate":"PASS_ALL_TEN_EXACT_INTENTS" if len(ran)==10 and all(r["exact_intent_complete"]>=1 for r in ran) else
               "FAIL_EXACT_INTENT_COVERAGE",
    }
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/amazon-us-ten-live-intents.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    table=["| # | Search | Products | Complete fields | Exact+complete | Exact+PDP | Mismatch+price | Header fallback | ms | Status |",
           "|---:|---|---:|---:|---:|---:|---:|---|---:|---|"]
    for i,r in enumerate(data,1):
        table.append(f"| {i} | {r['query']} | {r.get('product_count','—')} | {r.get('complete_usd_image_asin','—')} | {r.get('exact_intent_complete','—')} | {r.get('exact_intent_pdp_parity','—')} | {r.get('mismatched_intent_complete','—')} | {r.get('header_fallback','—')} | {r.get('elapsed_ms','—')} | {r.get('acceptance')} |")
    print("\n".join(["TEN_QUERY_SUMMARY",*table,"GATE "+report["gate"]]),flush=True)
    import os
    path=os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path,"a",encoding="utf-8") as f:
            f.write("## Amazon US 10-intent live evidence\n\n"+"\n".join(table)+"\n\nGate: "+report["gate"]+"\n")
    # Fail the strict intent gate even if all cards have price and image.
    raise SystemExit(0 if report["gate"]=="PASS_ALL_TEN_EXACT_INTENTS" else 1)

if __name__ == "__main__":
    asyncio.run(main())
