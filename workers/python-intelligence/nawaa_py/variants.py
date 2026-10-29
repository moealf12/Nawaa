"""Strict predicates override all approximate matching scores."""
from .contracts import IdentityDecision, IdentityResult, ProductExpectation
from .normalize import norm, similarity

_FIELDS = ("brand", "model", "storageGb", "condition", "bundleId", "sku", "gtin", "color")
_TEXT_FIELDS = frozenset({"brand", "model", "condition", "bundleId", "color"})

class VariantClassifier:
    @staticmethod
    def classify(expected: ProductExpectation, observed: ProductExpectation) -> IdentityResult:
        conflicts: list[str] = []
        missing: list[str] = []
        for field in _FIELDS:
            want, got = getattr(expected, field), getattr(observed, field)
            if want is None:
                continue
            if got is None:
                missing.append(field)
            elif field in _TEXT_FIELDS:
                if norm(want) != norm(got):
                    conflicts.append(field)
            elif got != want:
                conflicts.append(field)

        decision = (
            IdentityDecision.REJECT if conflicts else
            IdentityDecision.INSUFFICIENT if missing else
            IdentityDecision.CANDIDATE
        )
        return IdentityResult(
            decision=decision,
            conflicts=conflicts, missing=missing,
            similarityScore=similarity(expected.model, observed.model)
        )
