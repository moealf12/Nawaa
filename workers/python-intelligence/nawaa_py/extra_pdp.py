"""NAWAA eXtra Saudi public product extraction, based on user-provided Python code.

Strict, evidence-first, source-specific. A network denial is an observed
failure, not permission to impersonate a browser or invent product prices.
This experiment never publishes or persists offers.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
import sys
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
import httpx
from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "nawaa.extra.pdp.v1"
SOURCE_ID = "extra-sa"
PRODUCT_URL_PATTERN = re.compile(r"^/en-sa/(?:[a-z0-9-]+/)+p/([0-9]{5,12})/?$")
SKU_PATTERN = re.compile(r"^[0-9]{5,12}$")
PRICE_PATTERN = re.compile(r"^(?:[0-9]{1,9}|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$")
DOM_PRICE_PATTERN = re.compile(r"(?<![0-9])(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,9})(?:\.[0-9]{1,2})?(?![0-9.])")
ISO_SAR = re.compile(r"\bSAR\b|ر\.?\s*س\.?|ريال(?:\s+سعودي)?", re.IGNORECASE)
MAX_HTML_BYTES = 2_000_000
MAX_JSONLD_BYTES = 300_000
MAX_SCRIPTS = 96
MAX_ROBOTS_BYTES = 128_000
MAX_INPUT_BYTES = 4096
MAX_REQUESTS = 8
USER_AGENT = "NAWAA-PriceResearch/1.0 (+https://github.com/moealf12/Nawaa)"

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_assignment=True)

class EvidenceTrace(StrictModel):
    source: Literal["JSON-LD", "DOM"]
    raw_value: str = Field(max_length=512)

class ExtraOfferEvidence(StrictModel):
    price: Decimal | None = Field(default=None, gt=0, allow_inf_nan=False)
    currency: Literal["SAR"] | None = None
    availability: Literal["UNKNOWN", "IN_STOCK", "OUT_OF_STOCK", "PREORDER"] = "UNKNOWN"
    product_title: str | None = None
    sku: str | None = None
    brand: str | None = None
    requested_url: str | None = None
    final_url: str | None = None
    parser_version: str = "1.1.0"
    response_sha256: str | None = None
    field_evidence: dict[str, EvidenceTrace] = Field(default_factory=dict)
    issues: list[str] = Field(default_factory=list)

class ExtraRequest(StrictModel):
    schemaVersion: Literal["nawaa.extra.pdp.v1"]
    requestId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    sourceId: Literal["extra-sa"] = SOURCE_ID
    url: str = Field(max_length=2048)
    expected_sku: str = Field(pattern=r"^[0-9]{5,12}$")
    timeoutMs: int = Field(default=8000, ge=1000, le=12000)
    maxResponseBytes: int = Field(default=1_500_000, ge=1024, le=MAX_HTML_BYTES)

class ExtraFetchError(Exception):
    def __init__(self, code: str, http_status: int | None = None):
        super().__init__(code)
        self.code = code
        self.http_status = http_status

def approved_url(raw_url: str, expected_sku: str) -> bool:
    """Deny private or unowned URLs and bind source SKU to the product page."""
    if not isinstance(raw_url, str) or not isinstance(expected_sku, str):
        return False
    if not SKU_PATTERN.fullmatch(expected_sku) or len(raw_url) > 2048:
        return False
    try:
        parts = urlsplit(raw_url)
        match = PRODUCT_URL_PATTERN.fullmatch(parts.path)
        return bool(
            parts.scheme == "https"
            and parts.netloc == "www.extra.com"
            and parts.hostname == "www.extra.com"
            and parts.port is None
            and not parts.username and not parts.password
            and not parts.query and not parts.fragment
            and match is not None and match.group(1) == expected_sku
        )
    except (ValueError, AttributeError):
        return False

def _types(node: dict[str, Any]) -> set[str]:
    value = node.get("@type")
    values = value if isinstance(value, list) else [value]
    return {x.rsplit("/", 1)[-1].casefold() for x in values if isinstance(x, str)}

def _walk(value: Any, depth: int = 0):
    if depth > 5:
        return
    if isinstance(value, list):
        for node in value[:64]:
            yield from _walk(node, depth + 1)
    elif isinstance(value, dict):
        yield value
        for key in ("@graph", "mainEntity"):
            if key in value:
                yield from _walk(value[key], depth + 1)

def _price(raw: Any) -> Decimal | None:
    if isinstance(raw, bool) or not isinstance(raw, (str, int, Decimal)):
        return None
    value = str(raw).strip()
    if not PRICE_PATTERN.fullmatch(value):
        return None
    try:
        amount = Decimal(value.replace(",", ""))
    except InvalidOperation:
        return None
    return amount if amount.is_finite() and 0 < amount <= Decimal("999999999") else None

def _availability(value: Any) -> str:
    if not isinstance(value, str):
        return "UNKNOWN"
    status = value.rsplit("/", 1)[-1].casefold()
    if status == "instock":
        return "IN_STOCK"
    if status == "outofstock":
        return "OUT_OF_STOCK"
    if status in {"preorder", "presale"}:
        return "PREORDER"
    return "UNKNOWN"

def _bounded_text(value: Any, size: int = 256) -> str | None:
    return value.strip()[:size] if isinstance(value, str) and value.strip() else None

class ExtraScraperEngine:
    """Extract public eXtra product evidence without merchant-identity shortcuts."""

    @classmethod
    def parse_html(
        cls, html: str, expected_sku: str, *,
        requested_url: str | None = None,
        response_sha256: str | None = None
    ) -> ExtraOfferEvidence:
        result = ExtraOfferEvidence(
            requested_url=requested_url,
            final_url=requested_url,
            response_sha256=response_sha256
        )
        if not SKU_PATTERN.fullmatch(expected_sku):
            result.issues.append("EXPECTED_SKU_INVALID")
            return result
        if len(html.encode("utf-8")) > MAX_HTML_BYTES:
            result.issues.append("HTML_TOO_LARGE")
            return result
        soup = BeautifulSoup(html, "lxml")

        # JSON-LD can contain @graph and several Product variant records.
        products: list[dict[str, Any]] = []
        for script in soup.find_all("script", type="application/ld+json", limit=MAX_SCRIPTS):
            text = script.string or script.get_text()
            if not text or len(text.encode("utf-8")) > MAX_JSONLD_BYTES:
                continue
            try:
                parsed = json.loads(text, parse_float=Decimal, parse_int=Decimal)
            except (ValueError, TypeError, RecursionError):
                continue
            for node in _walk(parsed):
                if "product" in _types(node):
                    products.append(node)

        chosen = None
        matched = [
            node for node in products
            if str(node.get("sku") or node.get("productID") or "").strip() == expected_sku
        ]
        if len(matched) == 1:
            chosen = matched[0]
        elif len(matched) > 1:
            result.issues.append("MULTIPLE_SAME_SKU_PRODUCTS")
            return result
        elif len(products) == 1:
            chosen = products[0]
        elif products:
            result.issues.append("MULTIPLE_UNMATCHED_PRODUCT_VARIANTS")
            return result
        else:
            result.issues.append("PRODUCT_JSONLD_NOT_FOUND")

        if chosen is not None:
            name = _bounded_text(chosen.get("name"), 512)
            if name:
                result.product_title = name
                result.field_evidence["product_title"] = EvidenceTrace(source="JSON-LD", raw_value=name)
            actual_sku = _bounded_text(chosen.get("sku") or chosen.get("productID"), 128)
            if actual_sku:
                result.sku = actual_sku
                result.field_evidence["sku"] = EvidenceTrace(source="JSON-LD", raw_value=actual_sku)
            brand = chosen.get("brand")
            brand_name = _bounded_text(brand.get("name") if isinstance(brand, dict) else brand)
            if brand_name:
                result.brand = brand_name
                result.field_evidence["brand"] = EvidenceTrace(source="JSON-LD", raw_value=brand_name)

            # Price must belong to this Product/expected SKU; no AggregateOffer
            # lowPrice and no arbitrary first offer from a list of variants.
            if actual_sku and actual_sku != expected_sku:
                result.issues.append("PRODUCT_SKU_MISMATCH")
            elif not actual_sku:
                result.issues.append("SKU_EVIDENCE_MISSING")
            else:
                raw_offers = chosen.get("offers")
                offers = raw_offers if isinstance(raw_offers, list) else [raw_offers]
                offers = [o for o in offers if isinstance(o, dict)]
                if len(offers) > 1:
                    exact = [
                        o for o in offers
                        if str(o.get("sku") or "").strip() == expected_sku
                    ]
                    if len(exact) == 1:
                        offers = exact
                    else:
                        result.issues.append("MULTIPLE_OFFERS_AMBIGUOUS")
                        offers = []
                if len(offers) == 1:
                    offer = offers[0]
                    offer_sku = str(offer.get("sku") or "").strip()
                    if "aggregateoffer" in _types(offer):
                        result.issues.append("AGGREGATE_OFFER_NOT_SELLABLE")
                    elif offer_sku and offer_sku != expected_sku:
                        result.issues.append("OFFER_SKU_MISMATCH")
                    else:
                        amount = _price(offer.get("price"))
                        currency = offer.get("priceCurrency")
                        if amount is None:
                            result.issues.append("JSONLD_PRICE_MISSING_OR_INVALID")
                        elif currency != "SAR":
                            result.issues.append("JSONLD_CURRENCY_MISSING_OR_NOT_SAR")
                        else:
                            result.price = amount
                            result.currency = "SAR"
                            result.field_evidence["price"] = EvidenceTrace(
                                source="JSON-LD", raw_value=str(offer.get("price"))[:512]
                            )
                            result.field_evidence["currency"] = EvidenceTrace(
                                source="JSON-LD", raw_value="SAR"
                            )
                        result.availability = _availability(offer.get("availability"))
                        if result.availability != "UNKNOWN":
                            result.field_evidence["availability"] = EvidenceTrace(
                                source="JSON-LD",
                                raw_value=str(offer.get("availability"))[:512]
                            )

        # DOM fallback is supplementary. Never bypass explicit SKU conflicts.
        conflict = any(x in result.issues for x in (
            "PRODUCT_SKU_MISMATCH", "SKU_EVIDENCE_MISSING",
            "MULTIPLE_SAME_SKU_PRODUCTS", "MULTIPLE_UNMATCHED_PRODUCT_VARIANTS",
            "MULTIPLE_OFFERS_AMBIGUOUS", "OFFER_SKU_MISMATCH",
            "AGGREGATE_OFFER_NOT_SELLABLE"
        ))
        if result.product_title is None:
            h1 = soup.select_one("h1.product-title, [data-test='product-title'], h1")
            if h1:
                title = _bounded_text(h1.get_text(" ", strip=True), 512)
                if title:
                    result.product_title = title
                    result.field_evidence["product_title"] = EvidenceTrace(source="DOM", raw_value=title)
        if result.price is None and not conflict and result.sku == expected_sku:
            # A DOM price is usable only when an explicit SAR currency appears
            # with that same price. Never infer SAR from storefront geography.
            selectors = ".price-container .price, [data-test='product-price'], .current-price"
            nodes = soup.select(selectors)[:12]
            candidates: dict[str, tuple[Decimal, str]] = {}
            for node in nodes:
                raw = node.get_text(" ", strip=True)[:512]
                if not ISO_SAR.search(raw):
                    continue
                prices = {p for x in DOM_PRICE_PATTERN.findall(raw) if (p := _price(x)) is not None}
                if len(prices) == 1:
                    amount = next(iter(prices))
                    candidates[str(amount)] = (amount, raw)
            if len(candidates) == 1:
                amount, raw = next(iter(candidates.values()))
                result.price = amount
                result.currency = "SAR"
                result.field_evidence["price"] = EvidenceTrace(source="DOM", raw_value=raw)
                result.field_evidence["currency"] = EvidenceTrace(source="DOM", raw_value="SAR in price text")
            elif len(candidates) > 1:
                result.issues.append("DOM_PRICE_AMBIGUOUS")

        if result.price is None:
            result.issues.append("NO_ACCEPTABLE_PRICE_EVIDENCE")
        return result

    @staticmethod
    def _public_dns():
        """Preflight only; production egress policy still needed against rebinding."""
        try:
            addresses = socket.getaddrinfo("www.extra.com", 443, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise ExtraFetchError("DNS_UNAVAILABLE") from exc
        if not addresses:
            raise ExtraFetchError("DNS_UNAVAILABLE")
        for record in addresses:
            try:
                if not ipaddress.ip_address(record[4][0]).is_global:
                    raise ExtraFetchError("NONPUBLIC_ADDRESS_REJECTED")
            except ValueError as exc:
                raise ExtraFetchError("DNS_ADDRESS_INVALID") from exc

    @staticmethod
    def _limited_get(client: httpx.Client, url: str, max_bytes: int) -> tuple[bytes, int, str]:
        try:
            with client.stream("GET", url) as resp:
                status = resp.status_code
                if status in (403, 429):
                    raise ExtraFetchError(f"HTTP_{status}", status)
                if 300 <= status <= 399:
                    raise ExtraFetchError("REDIRECT_NOT_FOLLOWED", status)
                if status != 200:
                    raise ExtraFetchError("HTTP_NON_200", status)
                buffer = bytearray()
                for part in resp.iter_bytes():
                    buffer.extend(part)
                    if len(buffer) > max_bytes:
                        raise ExtraFetchError("RESPONSE_TOO_LARGE", status)
                return bytes(buffer), status, resp.headers.get("content-type", "").lower()
        except httpx.TimeoutException as exc:
            raise ExtraFetchError("HTTP_TIMEOUT") from exc
        except httpx.TransportError as exc:
            raise ExtraFetchError("TRANSPORT_FAILURE") from exc

    @classmethod
    def extract_product(cls, url: str, expected_sku: str, *, timeout_ms: int = 8000,
                        max_response_bytes: int = 1_500_000) -> ExtraOfferEvidence:
        if not approved_url(url, expected_sku):
            raise ExtraFetchError("UNAPPROVED_PRODUCT_URL")
        cls._public_dns()
        with httpx.Client(
            timeout=httpx.Timeout(timeout_ms / 1000, connect=min(3, timeout_ms / 1000)),
            follow_redirects=False,
            trust_env=False,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml",
                     "Accept-Language": "ar-SA,ar;q=0.8,en-US;q=0.6"},
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=0)
        ) as client:
            # Do not crawl a page disallowed by the public robots policy.
            robots_url = "https://www.extra.com/robots.txt"
            robots, _, _ = cls._limited_get(client, robots_url, MAX_ROBOTS_BYTES)
            parser = RobotFileParser()
            parser.parse(robots.decode("utf-8", errors="replace").splitlines())
            if not parser.can_fetch(USER_AGENT.split("/", 1)[0], url):
                raise ExtraFetchError("ROBOTS_DISALLOW")
            body, _, content_type = cls._limited_get(client, url, max_response_bytes)
            if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
                raise ExtraFetchError("NON_HTML_RESPONSE")
            sha = hashlib.sha256(body).hexdigest()
            html = body.decode("utf-8", errors="replace")
            return cls.parse_html(html, expected_sku, requested_url=url, response_sha256=sha)

def process(request: dict[str, Any]) -> dict[str, Any]:
    req = ExtraRequest.model_validate(request)
    evidence = ExtraScraperEngine.extract_product(
        req.url, req.expected_sku,
        timeout_ms=req.timeoutMs, max_response_bytes=req.maxResponseBytes
    )
    has_evidence = (
        evidence.price is not None and evidence.currency == "SAR"
        and evidence.sku == req.expected_sku and not evidence.issues
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "requestId": req.requestId, "sourceId": SOURCE_ID,
        "status": "EVIDENCE_FOUND" if has_evidence else "INSUFFICIENT_EVIDENCE",
        "evidence": evidence.model_dump(mode="json")
    }

def run_worker() -> int:
    # JSONL has fixed framing and bounded input; stderr is generic diagnostics.
    for _ in range(MAX_REQUESTS):
        line = sys.stdin.buffer.readline(MAX_INPUT_BYTES + 1)
        if not line:
            return 0
        if len(line) > MAX_INPUT_BYTES or not line.endswith(b"\n"):
            sys.stdout.write(json.dumps({
                "schemaVersion": SCHEMA_VERSION, "requestId": "unknown",
                "sourceId": SOURCE_ID, "status": "ERROR",
                "errorCode": "INPUT_FRAMING_OR_SIZE_INVALID"
            }) + "\n")
            sys.stdout.flush()
            return 2
        parsed = None
        try:
            parsed = json.loads(line)
            out = process(parsed)
        except ExtraFetchError as exc:
            out = {
                "schemaVersion": SCHEMA_VERSION, "requestId": "unknown",
                "sourceId": SOURCE_ID, "status": "ERROR",
                "errorCode": exc.code, "httpStatus": exc.http_status
            }
        except Exception:
            # No raw merchant URL, HTML or exception details in stdout/stderr.
            out = {
                "schemaVersion": SCHEMA_VERSION, "requestId": "unknown",
                "sourceId": SOURCE_ID, "status": "ERROR",
                "errorCode": "REQUEST_OR_EXTRACTION_INVALID"
            }
        if isinstance(parsed, dict):
            rid = parsed.get("requestId")
            if isinstance(rid, str) and re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", rid):
                out["requestId"] = rid
        sys.stdout.write(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0

if __name__ == "__main__":
    raise SystemExit(run_worker())
