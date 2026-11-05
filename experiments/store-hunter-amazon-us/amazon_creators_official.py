"""Optional Amazon Creators API offer adapter (disabled without approval/credentials).

Official endpoint documentation:
https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl
https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2

Never use this adapter without Amazon Associates / Creators API eligibility.
It does not replace or spoof website access and is never enabled by default.
"""
from __future__ import annotations

import asyncio
import os
import re
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

import httpx

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")
TOKEN_ENDPOINTS = {
    "3.1": "https://api.amazon.com/auth/o2/token",
    "3.2": "https://api.amazon.co.uk/auth/o2/token",
    "3.3": "https://api.amazon.co.jp/auth/o2/token",
}
API_URL = "https://creatorsapi.amazon/catalog/v1/getItems"
RESOURCES = [
    "itemInfo.title",
    "images.primary.large",
    "offersV2.listings.price",
    "offersV2.listings.isBuyBoxWinner",
    "offersV2.listings.availability",
    "offersV2.listings.condition",
]


@dataclass(frozen=True)
class Config:
    client_id: str
    client_secret: str
    partner_tag: str
    credential_version: str = "3.1"

    @classmethod
    def from_environment(cls) -> "Config | None":
        client_id = os.getenv("NAWAA_AMAZON_CREATORS_ID", "")
        secret = os.getenv("NAWAA_AMAZON_CREATORS_SECRET", "")
        tag = os.getenv("NAWAA_AMAZON_US_PARTNER_TAG", "")
        if not (client_id and secret and tag):
            return None
        version = os.getenv("NAWAA_AMAZON_CREATORS_VERSION", "3.1")
        if version not in TOKEN_ENDPOINTS:
            raise ValueError("unsupported_Creators_API_credential_version")
        return cls(client_id, secret, tag, version)


def _money(value) -> str | None:
    try:
        amount = Decimal(str(value))
    except (TypeError, InvalidOperation, ValueError):
        return None
    if (not amount.is_finite() or amount <= 0 or amount > Decimal("100000000")
            or amount.as_tuple().exponent < -2):
        return None
    try:
        return format(amount.quantize(Decimal("0.01")), ".2f")
    except InvalidOperation:
        return None


def parse_featured_offers(payload: object, requested_asins: list[str]) -> list[dict]:
    """Only exact-ASIN explicit USD featured offer; never lowest other-seller price."""
    request_set = set(requested_asins)
    result = payload.get("itemsResult") if isinstance(payload, dict) else None
    items = result.get("items") if isinstance(result, dict) else None
    if not isinstance(items, list):
        return []
    accepted = []
    seen = set()
    for item in items[:20]:
        if not isinstance(item, dict):
            continue
        asin = str(item.get("asin") or "").upper()
        if asin not in request_set or not ASIN_RE.fullmatch(asin) or asin in seen:
            continue
        seen.add(asin)
        listings = (item.get("offersV2") or {}).get("listings") if isinstance(item.get("offersV2"), dict) else None
        featured = [x for x in listings if isinstance(x, dict) and x.get("isBuyBoxWinner") is True] if isinstance(listings, list) else []
        if len(featured) != 1:
            continue
        offer = featured[0]
        money = (offer.get("price") or {}).get("money") if isinstance(offer.get("price"), dict) else None
        if not isinstance(money, dict) or money.get("currency") != "USD":
            continue
        price = _money(money.get("amount"))
        if price is None:
            continue
        title = ((item.get("itemInfo") or {}).get("title") or {}).get("displayValue") if isinstance(item.get("itemInfo"), dict) else None
        primary = (item.get("images") or {}).get("primary") if isinstance(item.get("images"), dict) else None
        image = (primary.get("large") or {}).get("url") if isinstance(primary, dict) and isinstance(primary.get("large"), dict) else None
        page = item.get("detailPageURL") or ""
        parsed = urlsplit(page) if isinstance(page, str) else None
        if not parsed or parsed.scheme != "https" or parsed.hostname not in {"www.amazon.com", "amazon.com"}:
            page = "https://www.amazon.com/dp/" + asin
        elif not re.search(r"/(?:dp|gp/product)/" + asin + r"(?:[/?#]|$)", parsed.path, re.I):
            page = "https://www.amazon.com/dp/" + asin
        availability = offer.get("availability") if isinstance(offer.get("availability"), dict) else {}
        condition = offer.get("condition") if isinstance(offer.get("condition"), dict) else {}
        accepted.append({
            "asin": asin, "title": title if isinstance(title, str) else None,
            "url": page, "price": price, "currency": "USD",
            "image": image if isinstance(image, str) and image.startswith("https://") else None,
            "condition": condition.get("value"),
            "availability": availability.get("type"),
            "price_source": "amazon_creators_api_featured_offer",
            "price_evidence": "official_featured_offer",
        })
    return accepted


class CreatorsAPI:
    def __init__(self, config: Config | None, client: httpx.AsyncClient | None = None):
        self.config = config
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=6.0),
            follow_redirects=False, trust_env=False)
        self.owns_client = client is None
        self._access_token: str | None = None
        self._expires_at = 0.0
        self._token_lock = asyncio.Lock()
        self._catalog_lock = asyncio.Lock()
        self._last_catalog_call = 0.0

    async def close(self):
        if self.owns_client:
            await self.client.aclose()

    async def _token(self) -> str | None:
        if self.config is None:
            return None
        async with self._token_lock:
            if self._access_token and time.monotonic() < self._expires_at:
                return self._access_token
            try:
                response = await self.client.post(
                    TOKEN_ENDPOINTS[self.config.credential_version],
                    json={
                        "grant_type": "client_credentials",
                        "client_id": self.config.client_id,
                        "client_secret": self.config.client_secret,
                        "scope": "creatorsapi::default",
                    }, headers={"Content-Type": "application/json"})
                if response.status_code != 200:
                    return None
                data = response.json()
                token = data.get("access_token")
                duration = data.get("expires_in")
                if not isinstance(token, str) or not token or not isinstance(duration, (int, float)):
                    return None
                self._access_token = token
                self._expires_at = time.monotonic() + max(0, float(duration) - 90.0)
                return token
            except (httpx.HTTPError, ValueError, TypeError):
                return None

    async def get_items(self, asins: list[str]) -> dict:
        if self.config is None:
            return {"state": "not_configured", "offers": []}
        normalized = list(dict.fromkeys(x.upper() for x in asins if isinstance(x, str)))
        if not normalized or len(normalized) > 10 or any(not ASIN_RE.fullmatch(x) for x in normalized):
            return {"state": "invalid_asin_batch", "offers": []}
        token = await self._token()
        if token is None:
            return {"state": "not_authorized_or_token_unavailable", "offers": []}
        async with self._catalog_lock:
            elapsed = time.monotonic() - self._last_catalog_call
            if elapsed < 1.0:
                await asyncio.sleep(1.0 - elapsed)
            self._last_catalog_call = time.monotonic()
            try:
                response = await self.client.post(API_URL, headers={
                    "Authorization": "Bearer " + token,
                    "Content-Type": "application/json",
                    "x-marketplace": "www.amazon.com",
                }, json={
                    "itemIds": normalized, "itemIdType": "ASIN",
                    "partnerTag": self.config.partner_tag,
                    "marketplace": "www.amazon.com",
                    "resources": RESOURCES,
                })
                if response.status_code in (401, 403):
                    self._access_token = None
                    return {"state": "not_authorized", "offers": []}
                if response.status_code in (429, 500, 502, 503, 504):
                    return {"state": "temporarily_unavailable", "offers": []}
                if response.status_code != 200:
                    return {"state": "api_error", "offers": []}
                data = response.json()
                offers = parse_featured_offers(data, normalized)
                return {"state": "ok" if offers else "no_proven_featured_offer",
                        "offers": offers}
            except (httpx.HTTPError, ValueError, TypeError):
                # No credentials, API raw bodies, or bearer tokens in output.
                return {"state": "request_or_schema_error", "offers": []}
