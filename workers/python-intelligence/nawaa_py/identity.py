"""Conservative variant isolation: missing evidence never becomes verified."""
from typing import Any

FIELDS = ("brand", "model", "storageGb", "condition", "bundleId")


def classify(expected: dict[str, Any], observed: dict[str, Any]) -> dict[str, Any]:
    conflicts = []
    missing = []
    for field in FIELDS:
        target = expected.get(field)
        if target is None:
            continue
        value = observed.get(field)
        if value is None:
            missing.append(field)
        elif type(value) is not type(target) or value != target:
            conflicts.append(field)
    decision = ("REJECT" if conflicts else
                "INSUFFICIENT_EVIDENCE" if missing else "CANDIDATE")
    return {"decision": decision, "conflicts": conflicts, "missing": missing}
