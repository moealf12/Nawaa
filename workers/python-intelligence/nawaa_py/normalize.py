"""Conservative text normalization; fuzzy scores are diagnostics only."""
import re
import unicodedata
from rapidfuzz import fuzz

_STORAGE = re.compile(r"\b(\d{1,4})\s*(TB|GB)\b", re.IGNORECASE)
_MODEL_PATTERNS = (
    re.compile(r"\b(iPhone\s*\d{1,2}\s*(?:Pro Max|Pro|Plus|Air|Mini)?)\b", re.I),
    re.compile(r"\b(Galaxy\s*S\d{2}\s*(?:Ultra|Plus|FE)?)\b", re.I),
    re.compile(r"\b(Edge\s*\d{3}\s*(?:Solar)?)\b", re.I),
    re.compile(r"\b(PS5\s*(?:Pro|Slim|Digital|Disc)?)\b", re.I),
)

def norm(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(re.findall(r"[\w]+", normalized, re.UNICODE))

def storage_from_title(value: str) -> int | None:
    tokens = _STORAGE.findall(value)
    values = {int(n) * (1024 if unit.upper() == "TB" else 1) for n, unit in tokens}
    return next(iter(values)) if len(values) == 1 else None

def model_from_title(value: str) -> str | None:
    for pattern in _MODEL_PATTERNS:
        found = pattern.search(value)
        if found:
            return found.group(1).strip()
    return None

def similarity(expected: str | None, observed: str | None) -> float | None:
    if expected is None or observed is None:
        return None
    return round(fuzz.ratio(norm(expected), norm(observed)), 2)
