import unittest
from nawaa_py.cli import process, VERSION
from nawaa_py.identity import classify
from nawaa_py.prices import normalize_price


class ClassificationTests(unittest.TestCase):
    def test_variant_isolation(self):
        want = {"brand": "Apple", "model": "iPhone 17", "storageGb": 256}
        self.assertEqual(classify(want, dict(want))["decision"], "CANDIDATE")
        self.assertEqual(classify(want, {**want, "storageGb": 128})["decision"], "REJECT")
        self.assertEqual(classify(want, {"brand": "Apple", "model": "iPhone 17"})["decision"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(classify(want, {**want, "model": "iPhone 17 Pro"})["decision"], "REJECT")
        self.assertEqual(classify(want, {**want, "storageGb": "256"})["decision"], "REJECT")

    def test_price(self):
        self.assertEqual(normalize_price("3299.5", "SAR")["price"], "3299.50")
        for value in ("0", "-1", "NaN", "1e5", "1,000"):
            with self.assertRaises(ValueError):
                normalize_price(value, "SAR")

    def test_contract(self):
        request = {"schemaVersion": VERSION, "requestId": "case1", "operation": "classify",
                   "expected": {"model": "PS5 Digital"}, "observed": {"model": "PS5 Disc"},
                   "price": "1999", "currency": "SAR"}
        result = process(request)
        self.assertEqual(result["identity"]["decision"], "REJECT")
        self.assertNotIn("verified", result)
        self.assertNotIn("availability", result)
        with self.assertRaises(ValueError):
            process({**request, "schemaVersion": "wrong"})


if __name__ == "__main__":
    unittest.main()
