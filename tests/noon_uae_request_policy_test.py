"""Regression tests for source-rate and error classification, no network calls."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_request_policy import (  # noqa: E402
    classify_source_response, retry_after_seconds
)


class RequestPolicyTests(unittest.TestCase):
    def test_403_stops_without_rotating_header(self):
        v = classify_source_response(status=403)
        self.assertEqual(v["action"], "HALT_SESSION")
        self.assertFalse(v["retry"])

    def test_429_never_rotates_and_honors_retry_after(self):
        v = classify_source_response(status=429, retry_after="120")
        self.assertEqual(v["action"], "SOURCE_COOLDOWN")
        self.assertEqual(v["delaySeconds"], 120)
        self.assertFalse(v["retry"])

    def test_429_retry_after_http_date(self):
        now = datetime(2026, 11, 5, 0, 0, tzinfo=timezone.utc)
        self.assertEqual(retry_after_seconds(
            "Thu, 05 Nov 2026 00:02:00 GMT", now
        ), 120)

    def test_retry_after_bounds_and_malformed(self):
        self.assertEqual(retry_after_seconds("999999999"), 86400)
        self.assertIsNone(retry_after_seconds("-3"))
        self.assertIsNone(retry_after_seconds("invalid"))
        self.assertIsNone(retry_after_seconds(None))

    def test_200_preserves_session(self):
        self.assertEqual(
            classify_source_response(status=200)["action"], "KEEP_SESSION"
        )

    def test_http2_protocol_requires_explicit_differential(self):
        v = classify_source_response(
            error=RuntimeError("HTTP/2 stream 0 ErrCode: 92")
        )
        self.assertEqual(v["action"], "MANUAL_PROTOCOL_DIFFERENTIAL")
        self.assertFalse(v["retry"])

    def test_network_timeout_no_blind_header_loop(self):
        v = classify_source_response(error=TimeoutError("timeout"))
        self.assertEqual(v["code"], "NETWORK_TIMEOUT")
        self.assertFalse(v["retry"])

    def test_client_code_error_no_header_retry(self):
        v = classify_source_response(error=AttributeError("invalid Response"))
        self.assertEqual(v["code"], "CLIENT_CODE_ERROR")
        self.assertFalse(v["retry"])


if __name__ == "__main__":
    unittest.main()
