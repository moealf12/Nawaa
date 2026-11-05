"""Evidence-only multi-run Noon UAE availability analysis from GitHub artifacts.

No source networking: consumes archived LIVE reports. Never auto-publishes or
treats three adjacent sessions as long-window uptime. Requires independent
UTC windows and exposes Wilson 95% confidence lower bound.
"""
from __future__ import annotations

import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

REPO = "moealf12/Nawaa"
BRANCH = "experiment/noon-ae-sa-catalog-proof-20261105"
ARTIFACT = "noon-uae-session-stability"
SOURCE_SCHEMA = "nawaa.noon-ae.stability-snapshot.v1"
OUTPUT = "noon-uae-long-window-evidence.json"
MAX_HISTORY_ARTIFACTS = 50
MAX_ARCHIVE_BYTES = 1000000
MIN_SAMPLES = 12
MIN_SPAN_HOURS = 48
MIN_DAYS = 3
MIN_WINDOW_GAP_HOURS = 4


def _date(value):
    if not isinstance(value, str):
        return None
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return t.astimezone(timezone.utc) if t.tzinfo else None
    except (ValueError, OverflowError):
        return None


def _sample(value, *, expected_sha=None):
    if not isinstance(value, dict) or value.get("schema") != SOURCE_SCHEMA:
        return None
    if value.get("source") != "NOON_AE_PUBLIC_HTML":
        return None
    if expected_sha is not None and value.get("headSha") != expected_sha:
        return None
    time = _date(value.get("observedUtc"))
    if time is None or value.get("useProxies") is not False:
        return None
    if value.get("headerRotation") is not False or value.get("retries") != 0:
        return None
    if value.get("customerPublishable") is not False:
        return None
    if value.get("sessionCountPlanned") != 3 or value.get("maxRequests") != 6:
        return None
    attempt = value.get("requestsAttempted")
    sessions = value.get("sessions")
    if type(attempt) is not int or not 1 <= attempt <= 6 or not isinstance(sessions, list):
        return None
    if not 1 <= len(sessions) <= 3:
        return None
    complete = sum(x.get("state") == "LIVE_SOURCE_CATALOG_OBSERVED"
                   for x in sessions if isinstance(x, dict))
    accepted = (
        complete == 3 and len(sessions) == 3 and attempt == 6
        and value.get("classification") == "THREE_LIVE_SESSIONS_WITH_VALID_SEARCH_HTML"
    )
    return {
        "utc": time.isoformat(),
        "successful": accepted,
        "successfulSessions": complete,
        "requests": attempt,
        "observedFailureClasses": [
            str(x.get("state"))[:64] for x in sessions
            if isinstance(x, dict) and x.get("state") != "LIVE_SOURCE_CATALOG_OBSERVED"
        ][:3],
        "headShaPrefix": str(value.get("headSha") or "")[:12],
    }


def wilson_lower_95(successes, total):
    if not total:
        return None
    z = 1.959963984540054
    p = successes / total
    z2 = z * z
    return max(0.0, (
        p + z2 / (2 * total)
        - z * math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
    ) / (1 + z2 / total))


def summarize(samples):
    # At most one observation per 4h bucket so back-to-back retries cannot
    # fabricate independent time windows. Failed windows count as failures.
    buckets = {}
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        time = _date(sample.get("utc"))
        if time is None:
            continue
        hour_index = int(time.timestamp() // (MIN_WINDOW_GAP_HOURS * 3600))
        previous = buckets.get(hour_index)
        # Fail closed if any observed artifact in a window reports failure.
        if previous is None or (previous["successful"] and not sample["successful"]):
            buckets[hour_index] = sample
    entries = sorted(buckets.values(), key=lambda s: s["utc"])
    successes = sum(item["successful"] for item in entries)
    total = len(entries)
    days = len({item["utc"][:10] for item in entries})
    span_h = (
        (_date(entries[-1]["utc"]) - _date(entries[0]["utc"])).total_seconds() / 3600
        if total >= 2 else 0.0
    )
    lower = wilson_lower_95(successes, total)
    ready = (
        total >= MIN_SAMPLES and span_h >= MIN_SPAN_HOURS
        and days >= MIN_DAYS and successes == total
        # 12/12 successes yields only ~0.76 95% lower bound;
        # ensure the report communicates uncertainty explicitly.
    )
    return {
        "schema": "nawaa.noon-ae.long-window-evidence.v1",
        "source": "GitHub Actions live source snapshots only",
        "independentFourHourWindows": total,
        "successfulWindows": successes,
        "failedWindows": total - successes,
        "distinctUtcDays": days,
        "spanHours": round(span_h, 2),
        "observedWindowSuccessRate": round(successes / total, 4) if total else None,
        "wilson95LowerBound": round(lower, 4) if lower is not None else None,
        "requiredIndependentWindows": MIN_SAMPLES,
        "requiredSpanHours": MIN_SPAN_HOURS,
        "requiredUtcDays": MIN_DAYS,
        "operationalWindowCriteriaMet": ready,
        "productionAvailabilitySlaProven": False,
        "customerPublishable": False,
        "releaseDecision": (
            "LONG_WINDOW_OBSERVATIONS_COMPLETE_REVIEW_REQUIRED"
            if ready else "LONG_WINDOW_EVIDENCE_INSUFFICIENT_OR_FAILED"
        ),
        "observations": entries[-40:],
    }


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        if url.scheme != "https":
            raise ValueError("INSECURE_ARTIFACT_REDIRECT")
        next_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if next_req is None:
            return None
        old = urllib.parse.urlsplit(req.full_url)
        if old.hostname != url.hostname:
            next_req.remove_header("Authorization")
        return next_req


def github_get(url, token, *, max_bytes=MAX_ARCHIVE_BYTES):
    if not url.startswith("https://api.github.com/"):
        raise ValueError("UNPINNED_GITHUB_API")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "User-Agent": "NAWAA-PublicSourceEvidence/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    opener = urllib.request.build_opener(SafeRedirect())
    with opener.open(req, timeout=14) as response:
        content = response.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise ValueError("ARCHIVE_TOO_LARGE")
        return content


def fetch_historical_samples(token):
    url = (
        "https://api.github.com/repos/" + REPO + "/actions/artifacts"
        "?name=" + ARTIFACT + "&per_page=100"
    )
    obj = json.loads(github_get(url, token).decode("utf8"))
    artifacts = obj.get("artifacts", [])
    samples = []
    for item in artifacts[:MAX_HISTORY_ARTIFACTS]:
        run = item.get("workflow_run") or {}
        if item.get("expired") or run.get("head_branch") != BRANCH:
            continue
        if item.get("name") != ARTIFACT or not isinstance(item.get("id"), int):
            continue
        archive_url = (
            "https://api.github.com/repos/" + REPO
            + "/actions/artifacts/" + str(item["id"]) + "/zip"
        )
        try:
            binary = github_get(archive_url, token)
            with zipfile.ZipFile(io.BytesIO(binary)) as archive:
                path = "noon-uae-stability-live.json"
                if path not in archive.namelist():
                    continue
                if archive.getinfo(path).file_size > MAX_ARCHIVE_BYTES:
                    continue
                data = json.loads(archive.read(path).decode("utf8"))
                sample = _sample(data, expected_sha=run.get("head_sha"))
                if sample is not None:
                    sample["sourceRunId"] = run.get("id")
                    samples.append(sample)
        except (OSError, ValueError, zipfile.BadZipFile, KeyError):
            continue
    return samples


def main():
    samples = []
    local = Path("noon-uae-stability-live.json")
    if local.is_file():
        sample = _sample(json.loads(local.read_text(encoding="utf8")))
        if sample:
            sample["sourceRunId"] = os.environ.get("GITHUB_RUN_ID", "local")
            samples.append(sample)
    token = os.environ.get("GITHUB_TOKEN", "")
    if token:
        try:
            samples.extend(fetch_historical_samples(token))
        except (ValueError, OSError) as exc:
            # No claimed acceptance if artifact API is unavailable.
            report = summarize([])
            report["historyAccess"] = "UNAVAILABLE"
            report["errorType"] = type(exc).__name__
            Path(OUTPUT).write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report, indent=2))
            return 1
    report = summarize(samples)
    report["historyAccess"] = "AVAILABLE" if token else "NO_TOKEN_LOCAL_ONLY"
    Path(OUTPUT).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
