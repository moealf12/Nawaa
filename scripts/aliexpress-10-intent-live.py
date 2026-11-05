#!/usr/bin/env python3
"""Bounded 10-intent LIVE AliExpress search acceptance; source cards never publish.

Sequential requests, one official robots policy per host, zero proxy/retry,
no raw HTML or product data retained. The aim is measured category coverage,
not to force a fragile all-queries-green claim against a live merchant.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.robotparser import RobotFileParser

from curl_cffi import requests


path = Path(__file__).resolve().with_name("aliexpress-public-html-live.py")
spec = importlib.util.spec_from_file_location("aliexpress_public_matrix", path)
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)

# Acceptance probes only. The extraction engine accepts arbitrary user query.
QUERIES = (
    ("smartphone", "iPhone 17"),
    ("android", "Samsung Galaxy"),
    ("console", "PlayStation 5"),
    ("controller", "PS5 controller"),
    ("headphones", "Bluetooth headphones"),
    ("arabic-audio", "سماعات بلوتوث"),
    ("laptop", "laptop"),
    ("appliance", "coffee machine"),
    ("watch", "smart watch"),
    ("jewellery", "silver necklace"),
)
HOST = "www.aliexpress.com"
MAX_ATTEMPTS = len(QUERIES)
DELAY_S = 1.0


def build_search_url(query):
    if not 2 <= len(query) <= 100 or any(ord(char) < 32 for char in query):
        raise ValueError("INVALID_SEARCH_QUERY")
    return (
        "https://" + HOST + "/w/wholesale-"
        + quote("-".join(query.split()), safe="-") + ".html"
    )


def prepare_policy(session):
    url = "https://" + HOST + "/robots.txt"
    report = {"state": "UNAVAILABLE", "host": HOST}
    try:
        response = session.get(
            url, timeout=12, allow_redirects=False,
            headers={"user-agent": probe.USER_AGENT, "accept": "text/plain"}
        )
        if (response.status_code != 200 or not 0 < len(response.content) <= 150_000
                or str(response.url) != url):
            report["state"] = "POLICY_NOT_VERIFIED"
            return None, report
        robot = RobotFileParser()
        robot.parse(response.text.splitlines())
        report["state"] = "PARSED"
        return robot, report
    except Exception as exc:
        report["state"] = "TRANSPORT_UNAVAILABLE"
        report["exceptionType"] = type(exc).__name__[:60]
        return None, report


def run_matrix():
    report = {
        "schema": "nawaa.aliexpress.10-intent-live-matrix.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat(),
        "headSha": os.getenv("HEAD_SHA", ""),
        "queryCount": MAX_ATTEMPTS,
        "requestsAttempted": 0,
        "proxyUsed": False,
        "retries": 0,
        "customerPublishable": False,
        "pdpPriceVerified": False,
        "productsAccepted": 0,
        "queriesWithTrustedSearchCards": 0,
        "queries": [],
    }
    with requests.Session(impersonate="chrome") as session:
        robot, policy = prepare_policy(session)
        report["requestsAttempted"] += 1
        report["policy"] = policy
        for index, (query_id, query) in enumerate(QUERIES):
            if index > 0:
                time.sleep(DELAY_S)
            url = build_search_url(query)
            item = {
                "queryId": query_id,
                "query": query,
                "state": "POLICY_UNAVAILABLE",
                "sourceItems": 0,
                "accepted": 0,
                "customerPublishable": False,
            }
            if robot is not None and robot.can_fetch(
                probe.USER_AGENT.split("/", 1)[0], url
            ):
                acquisition = {
                    "requestsAttempted": 0,
                    "stages": [],
                }
                page = probe.fetch_html(session, url, "search_html_live", acquisition)
                report["requestsAttempted"] += acquisition["requestsAttempted"]
                step = acquisition["stages"][-1] if acquisition["stages"] else {}
                item["state"] = step.get("state", "UNVERIFIED")
                item["httpStatus"] = step.get("status")
                item["responseBytes"] = step.get("responseBytes", 0)
                if page is not None:
                    metrics, offers = probe.parsed_search_cards(page, query)
                    item["sourceItems"] = metrics["sourceItems"]
                    item["accepted"] = len(offers)
                    item["rejectedReasons"] = metrics["rejected"]
                    item["state"] = (
                        "SEARCH_CARDS_UNVERIFIED_PDP" if offers
                        else "SEARCH_NO_ADMISSIBLE_CARDS"
                    )
                    report["productsAccepted"] += len(offers)
                    if offers:
                        report["queriesWithTrustedSearchCards"] += 1
            elif robot is not None:
                item["state"] = "ROBOTS_DISALLOWED"
            report["queries"].append(item)
    assert len(report["queries"]) == MAX_ATTEMPTS
    assert all(item["customerPublishable"] is False for item in report["queries"])
    assert report["productsAccepted"] == sum(item["accepted"] for item in report["queries"])
    return report


def main():
    report = run_matrix()
    filename = Path("aliexpress-10-intent-live-matrix.json")
    filename.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("NAWAA_ALIEXPRESS_TEN_INTENT_LIVE " + json.dumps(report, ensure_ascii=False))
    if len(report["queries"]) != MAX_ATTEMPTS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
