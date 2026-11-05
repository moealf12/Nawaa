"""Read-only deterministic source failure policy.

A profile is sticky per session. No rotating headers to retry 403/429,
no proxy rotation, no challenge solving, no credential changes.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


def retry_after_seconds(value, now=None):
    if not isinstance(value, str) or len(value) > 100:
        return None
    raw = value.strip()
    if re.fullmatch(r"\d{1,10}", raw):
        return min(86400, int(raw))
    try:
        date = parsedate_to_datetime(raw)
        if date.tzinfo is None:
            return None
        base = now if now is not None else datetime.now(timezone.utc)
        return min(86400, max(0, int((date - base).total_seconds())))
    except (ValueError, TypeError, OverflowError):
        return None


def classify_source_response(*, status=None, error=None, retry_after=None):
    if status is not None:
        if status == 403:
            return {"code": "SOURCE_ACCESS_DENIED", "action": "HALT_SESSION",
                    "retry": False, "delaySeconds": None}
        if status == 429:
            delay = retry_after_seconds(retry_after)
            return {"code": "SOURCE_RATE_LIMITED", "action": "SOURCE_COOLDOWN",
                    "retry": False, "delaySeconds": delay}
        if 200 <= status < 300:
            return {"code": "SOURCE_HTTP_OK", "action": "KEEP_SESSION",
                    "retry": False, "delaySeconds": None}
        if status in (500, 502, 503, 504):
            delay = retry_after_seconds(retry_after)
            return {"code": "SOURCE_TEMPORARY_ERROR", "action": "BOUNDED_BACKOFF",
                    "retry": False, "delaySeconds": delay}
        return {"code": "SOURCE_HTTP_OTHER", "action": "HALT_SESSION",
                "retry": False, "delaySeconds": None}
    name = type(error).__name__.lower() if error is not None else ""
    msg = str(error).lower() if error is not None else ""
    if name in ("typeerror", "attributeerror", "nameerror", "importerror"):
        kind = "CLIENT_CODE_ERROR"
    elif "timeout" in name or "timeout" in msg or "timed out" in msg:
        kind = "NETWORK_TIMEOUT"
    elif "http2" in msg or "http/2" in msg or "errcode: 92" in msg:
        kind = "HTTP2_PROTOCOL_ERROR"
    else:
        kind = "NETWORK_OR_UNKNOWN_ERROR"
    return {"code": kind,
            "action": "MANUAL_PROTOCOL_DIFFERENTIAL" if kind == "HTTP2_PROTOCOL_ERROR"
            else "NO_BLIND_HEADER_RETRY",
            "retry": False, "delaySeconds": None}
