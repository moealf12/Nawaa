"""Synthetic boundary tests only; LIVE evidence comes from GitHub run artifacts."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_long_window import _sample, summarize, wilson_lower_95  # noqa: E402

BASE = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)


def source_sample(hours=0, *, ok=True, sha="a" * 40):
    stamp = (BASE + timedelta(hours=hours)).isoformat()
    return {
        "schema": "nawaa.noon-ae.stability-snapshot.v1",
        "source": "NOON_AE_PUBLIC_HTML",
        "headSha": sha,
        "observedUtc": stamp,
        "useProxies": False,
        "headerRotation": False,
        "retries": 0,
        "customerPublishable": False,
        "sessionCountPlanned": 3,
        "maxRequests": 6,
        "requestsAttempted": 6 if ok else 1,
        "sessions": (
            [{"state": "LIVE_SOURCE_CATALOG_OBSERVED"} for _ in range(3)]
            if ok else [{"state": "WARMUP_NOT_AVAILABLE"}]
        ),
        "classification": (
            "THREE_LIVE_SESSIONS_WITH_VALID_SEARCH_HTML"
            if ok else "SOURCE_UNSTABLE_OR_INCOMPLETE"
        ),
    }


class LongWindowPolicyTests(unittest.TestCase):
    def test_verified_success_source_record(self):
        v = _sample(source_sample(), expected_sha="a" * 40)
        self.assertTrue(v["successful"])

    def test_source_failure_counts_as_failure_not_omitted(self):
        v = _sample(source_sample(ok=False))
        self.assertIsNotNone(v)
        self.assertFalse(v["successful"])

    def test_wrong_sha_or_market_rejected(self):
        self.assertIsNone(_sample(source_sample(), expected_sha="b" * 40))
        raw = source_sample()
        raw["source"] = "NOON_SA"
        self.assertIsNone(_sample(raw))

    def test_header_rotation_and_retry_disqualify_evidence(self):
        raw = source_sample()
        raw["retries"] = 2
        self.assertIsNone(_sample(raw))
        raw = source_sample()
        raw["headerRotation"] = True
        self.assertIsNone(_sample(raw))

    def test_repeated_samples_same_minute_not_long_window(self):
        rows = [_sample(source_sample(0)) for _ in range(50)]
        result = summarize(rows)
        self.assertEqual(result["independentFourHourWindows"], 1)
        self.assertFalse(result["operationalWindowCriteriaMet"])

    def test_utc_clock_bucket_rollover_is_not_independence(self):
        before = _sample(source_sample(2.95))
        after = _sample(source_sample(3.05))
        result = summarize([before, after])
        self.assertEqual(result["independentFourHourWindows"], 1)

    def test_twelve_real_time_windows_over_three_days(self):
        rows = [_sample(source_sample(i * 5)) for i in range(12)]
        result = summarize(rows)
        self.assertEqual(result["independentFourHourWindows"], 12)
        self.assertEqual(result["successfulWindows"], 12)
        self.assertTrue(result["operationalWindowCriteriaMet"])
        self.assertFalse(result["productionAvailabilitySlaProven"])
        self.assertFalse(result["customerPublishable"])

    def test_one_failure_overrides_window_and_blocks_criteria(self):
        rows = [_sample(source_sample(i * 5)) for i in range(12)]
        rows.append(_sample(source_sample(10.01, ok=False)))
        result = summarize(rows)
        self.assertEqual(result["independentFourHourWindows"], 12)
        self.assertEqual(result["failedWindows"], 1)
        self.assertFalse(result["operationalWindowCriteriaMet"])

    def test_short_hours_span_even_if_many_distinct_days(self):
        rows = [_sample(source_sample(i * 4.01)) for i in range(12)]
        result = summarize(rows)
        self.assertLess(result["spanHours"], 48)
        self.assertFalse(result["operationalWindowCriteriaMet"])

    def test_wilson_small_sample_never_claims_certain_uptime(self):
        self.assertLess(wilson_lower_95(3, 3), 0.5)
        self.assertLess(wilson_lower_95(12, 12), 0.8)
        self.assertIsNone(wilson_lower_95(0, 0))


if __name__ == "__main__":
    unittest.main()
