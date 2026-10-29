"""Read-only offline inspector for genuine merchant HTML saved by the owner.

No network calls, cookies, dynamic code, proxies or persistence. Never print raw
HTML; diagnostic output is JSON. Source files are not sent to GitHub by this CLI.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from noon_sa_html_next_probe import html_shape, parse_html
from noon_sa_known_urls_probe import SKU, exact_sku_pdp_jsonld

MAX_BYTES = 8_000_000

def inspect_snapshot(file_path, kind):
    if kind not in ("search", "pdp", "home"):
        raise ValueError("unsupported snapshot kind")
    file = Path(file_path)
    size = file.stat().st_size
    if size <= 0 or size > MAX_BYTES:
        return {"kind":kind,"status":"SNAPSHOT_SIZE_INVALID",
                "bytes":size,"customer_publishable":False}
    html = file.read_bytes().decode("utf-8", errors="replace")
    shape = html_shape(html)
    out = {"kind":kind,"status":"SNAPSHOT_INSPECTED",
           "html_shape":shape,"customer_publishable":False}
    if kind == "search":
        parsed = parse_html(html)
        offers = parsed["items"]
        out.update({"parser_status":parsed["status"],
                    "raw_hits":parsed["raw_hits"],
                    "items":len(offers),
                    "advertised_priced_items":sum(x["price_sar"] is not None for x in offers)})
    elif kind == "pdp":
        out.update(exact_sku_pdp_jsonld(html))
        out["expected_sku"] = SKU
    return out

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--file",required=True,help="Path to saved Noon HTML")
    parser.add_argument("--kind",choices=["home","search","pdp"],required=True)
    args=parser.parse_args()
    print(json.dumps(inspect_snapshot(args.file,args.kind),ensure_ascii=False))
