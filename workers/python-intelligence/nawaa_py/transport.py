"""Constrained HTTPX source transport: explicit opt-in, no bypasses or redirects.

The preflight DNS check is defense-in-depth; a protected production deployment
must also enforce network-layer egress restrictions to close DNS rebinding.
"""
import asyncio
import ipaddress
import os
import socket
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
import httpx

# Bound to approved public storefronts, not user-supplied host lists.
SOURCES = {
    "jarir-sa": frozenset({"www.jarir.com"}),
    "noon-sa": frozenset({"www.noon.com"}),
}
USER_AGENT = "NAWAA-Research/0.1 (+https://github.com/moealf12/Nawaa)"
MAX_ROBOTS_BYTES = 128_000

class FetchFailure(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)

def validate_url(raw: str, source_id: str) -> str:
    if not isinstance(raw, str) or len(raw) > 2048:
        raise FetchFailure("URL_INVALID")
    try:
        url = urlsplit(raw)
    except ValueError as exc:
        raise FetchFailure("URL_INVALID") from exc
    if (url.scheme != "https" or not url.hostname or url.username or url.password or
        url.port not in (None, 443) or url.fragment):
        raise FetchFailure("URL_POLICY_REJECTED")
    host = url.hostname.lower().rstrip(".")
    if source_id not in SOURCES or host not in SOURCES[source_id]:
        raise FetchFailure("SOURCE_HOST_NOT_APPROVED")
    if "%" in host or "\\" in host:
        raise FetchFailure("URL_POLICY_REJECTED")
    return raw

async def _validate_dns(host: str) -> None:
    try:
        addresses = await asyncio.wait_for(
            asyncio.to_thread(socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM),
            timeout=2.0,
        )
    except (OSError, asyncio.TimeoutError) as exc:
        raise FetchFailure("PUBLIC_DNS_UNAVAILABLE") from exc
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise FetchFailure("NONPUBLIC_ADDRESS_REJECTED")

async def _bounded_get(client: httpx.AsyncClient, url: str, limit: int) -> tuple[bytes, int, str]:
    try:
        async with client.stream("GET", url) as response:
            status = response.status_code
            if 300 <= status <= 399:
                raise FetchFailure("REDIRECT_NOT_FOLLOWED")
            if status == 403:
                raise FetchFailure("HTTP_403_ACCESS_DENIED")
            if status == 429:
                raise FetchFailure("HTTP_429_RATE_LIMITED")
            if status >= 500:
                raise FetchFailure("HTTP_5XX_SOURCE_FAILURE")
            if status not in (200, 404):
                raise FetchFailure("HTTP_OTHER_RESPONSE")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > limit:
                    raise FetchFailure("RESPONSE_TOO_LARGE")
            return bytes(body), status, response.headers.get("content-type", "").lower()
    except httpx.TimeoutException as exc:
        raise FetchFailure("HTTP_TIMEOUT") from exc
    except httpx.TransportError as exc:
        raise FetchFailure("SOURCE_TRANSPORT_FAILURE") from exc

async def fetch_public_html(url: str, source_id: str, timeout_ms: int, max_bytes: int) -> str:
    if os.getenv("NAWAA_PY_LIVE_ENABLED") != "1":
        raise FetchFailure("NETWORK_DISABLED")
    validate_url(url, source_id)
    host = urlsplit(url).hostname
    await _validate_dns(host)
    client_timeout = httpx.Timeout(timeout_ms / 1000, connect=min(3, timeout_ms / 1000))
    async with httpx.AsyncClient(
        timeout=client_timeout, follow_redirects=False, trust_env=False,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        limits=httpx.Limits(max_connections=1, max_keepalive_connections=0)
    ) as client:
        # Fail closed on inaccessible robots policy; no attempt to bypass it.
        robots_url = f"https://{host}/robots.txt"
        try:
            robots, robots_status, _ = await _bounded_get(client, robots_url, MAX_ROBOTS_BYTES)
        except FetchFailure as exc:
            if exc.code == "RESPONSE_TOO_LARGE":
                raise FetchFailure("ROBOTS_RESPONSE_TOO_LARGE") from exc
            raise
        if robots_status != 200:
            raise FetchFailure("ROBOTS_UNAVAILABLE")
        rules = RobotFileParser()
        rules.parse(robots.decode("utf-8", errors="replace").splitlines())
        if not rules.can_fetch(USER_AGENT.split("/", 1)[0], url):
            raise FetchFailure("ROBOTS_DISALLOW")
        try:
            content, status, content_type = await _bounded_get(client, url, max_bytes)
        except FetchFailure as exc:
            if exc.code == "RESPONSE_TOO_LARGE":
                raise FetchFailure("PRODUCT_PAGE_RESPONSE_TOO_LARGE") from exc
            raise
        if status != 200:
            raise FetchFailure("SOURCE_RESOURCE_NOT_FOUND")
        if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
            raise FetchFailure("NON_HTML_RESPONSE")
        return content.decode("utf-8", errors="replace")
