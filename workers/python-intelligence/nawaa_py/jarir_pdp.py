"""Official isolated Jarir source module, promoted from the user-supplied JSON-LD -> Hydration -> DOM waterfall.

The extraction order and JSONL output follow the submitted code. Safety-only
live-trial changes: transparent User-Agent, no redirects/proxy, bounded body,
strict https/host allowlist, explicit error codes, JSON-safe Decimal encoding.
No route in the live NAWAA backend invokes this experiment.
"""
import hashlib
import json
import logging
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

logging.basicConfig(stream=sys.stderr,level=logging.INFO,format="[JarirScraper] %(levelname)s: %(message)s")
VERSION="nawaa.jarir.pdp.v1"
USER_AGENT="NAWAA-Research/0.1 (+https://github.com/moealf12/Nawaa)"
MAX_BODY_BYTES=8_000_000
MAX_JSONL_BYTES=4096
REQUESTED_SOURCE="jarir-sa"

class EvidenceTrace(BaseModel):
    source: Literal["JSON-LD","Hydration","DOM","Multiple","Fallback"]
    raw_value: Any

class JarirOfferEvidence(BaseModel):
    price: Optional[Decimal]=Field(default=None,gt=0,allow_inf_nan=False)
    currency: Optional[Literal["SAR"]]=None
    availability: Literal["UNKNOWN","IN_STOCK","OUT_OF_STOCK","PREORDER","BACKORDER"]="UNKNOWN"
    availability_raw: Optional[str]=None
    product_title: Optional[str]=None
    sku: Optional[str]=None
    brand: Optional[str]=None
    seller: Optional[str]=None
    offer_url: Optional[str]=None
    requested_url: Optional[str]=None
    final_url: Optional[str]=None
    fetched_at: Optional[str]=None
    parser_version: str="1.0.0"
    response_sha256: Optional[str]=None
    field_evidence: Dict[str,EvidenceTrace]=Field(default_factory=dict)
    issues: List[str]=Field(default_factory=list)

class JarirScraperEngine:
    @staticmethod
    def _safe_url(url: str) -> str:
        try:parsed=urlsplit(url)
        except (TypeError,ValueError) as exc:raise ValueError("URL_INVALID") from exc
        if not isinstance(url,str) or len(url)>2048 or parsed.scheme!="https" or parsed.hostname!="www.jarir.com" or parsed.username or parsed.password or parsed.port not in (None,443):
            raise ValueError("UNAPPROVED_SOURCE_URL")
        return url

    @staticmethod
    def _download(url: str,timeout: float) -> tuple[str,str,str]:
        """Bounded single public GET; no WAF bypass, redirects, retries or proxy."""
        JarirScraperEngine._safe_url(url)
        if timeout<1 or timeout>20:raise ValueError("TIMEOUT_OUT_OF_RANGE")
        with httpx.Client(
            headers={"User-Agent":USER_AGENT,"Accept-Language":"ar-SA,ar;q=0.9,en;q=0.8",
                     "Accept":"text/html,application/xhtml+xml"},
            timeout=timeout,follow_redirects=False,trust_env=False,
        ) as client:
            # Respect public robots.txt before attempting the product fetch.
            with client.stream("GET","https://www.jarir.com/robots.txt") as robots_response:
                if robots_response.status_code!=200:raise ValueError("ROBOTS_UNAVAILABLE")
                robots_body=bytearray()
                for part in robots_response.iter_bytes():
                    robots_body.extend(part)
                    if len(robots_body)>128_000:raise ValueError("ROBOTS_TOO_LARGE")
            rules=RobotFileParser()
            rules.parse(robots_body.decode("utf-8",errors="replace").splitlines())
            if not rules.can_fetch("NAWAA-Research",url):
                raise ValueError("ROBOTS_DISALLOW")
            with client.stream("GET",url) as response:
                if response.is_redirect:raise ValueError("REDIRECT_BLOCKED")
                response.raise_for_status()
                buffer=bytearray()
                for part in response.iter_bytes():
                    buffer.extend(part)
                    if len(buffer)>MAX_BODY_BYTES:raise ValueError("RESPONSE_TOO_LARGE")
                # Read the precise bytes for response hashing, not a re-encoded string.
                raw=bytes(buffer)
                return (raw.decode(response.encoding or "utf-8",errors="replace"),
                        str(response.url), hashlib.sha256(raw).hexdigest())

    @classmethod
    def extract_jarir_product(cls,url:str,expected_sku:Optional[str]=None,timeout:float=15.0)->JarirOfferEvidence:
        evidence=JarirOfferEvidence(requested_url=url,fetched_at=datetime.now(timezone.utc).isoformat())
        if expected_sku is not None and (not isinstance(expected_sku,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}",expected_sku)):
            evidence.issues.append("EXPECTED_SKU_INVALID")
            return evidence
        try:
            html_content,final_url,raw_sha256=cls._download(url,timeout)
            evidence.final_url=final_url
            evidence.response_sha256=raw_sha256
        except (httpx.HTTPError,ValueError,OSError) as error:
            code=("HTTP_"+str(error.response.status_code)) if isinstance(error,httpx.HTTPStatusError) else type(error).__name__
            if isinstance(error,ValueError):code=str(error)
            evidence.issues.append("FETCH_FAILED:"+code)
            return evidence
        return cls.parse_html(html_content,evidence,expected_sku)

    @staticmethod
    def parse_html(html_content:str,evidence:JarirOfferEvidence,expected_sku:Optional[str]=None)->JarirOfferEvidence:
        """Original waterfall logic, with ambiguous candidate/offer and SKU guards."""
        if len(html_content)>MAX_BODY_BYTES:
            evidence.issues.append("HTML_TOO_LARGE")
            return evidence
        soup=BeautifulSoup(html_content,"lxml")
        candidates=[]
        for script in soup.find_all("script",type="application/ld+json",limit=100):
            raw=script.string or ""
            if len(raw)>1_000_000:continue
            try:
                data=json.loads(raw,parse_float=Decimal)
                if isinstance(data,list):candidates.extend(x for x in data if isinstance(x,dict))
                elif isinstance(data,dict):candidates.append(data)
                if isinstance(data,dict) and isinstance(data.get("@graph"),list):
                    candidates.extend(x for x in data["@graph"] if isinstance(x,dict))
            except (json.JSONDecodeError,TypeError,InvalidOperation):
                continue

        def is_product(candidate):
            typ=candidate.get("@type")
            if isinstance(typ,list):return "Product" in typ
            return typ=="Product" or (isinstance(typ,str) and typ.endswith("/Product"))

        products=[p for p in candidates if is_product(p)]
        if expected_sku:
            products=[p for p in products if str(p.get("sku") or "")==expected_sku]
        # Never pick the first unrelated Product in an ambiguous JSON-LD graph.
        if len(products)>1:
            evidence.issues.append("MULTIPLE_PRODUCT_NODES")
            matched=None
        else:
            matched=products[0] if products else None
        if expected_sku and not matched:
            evidence.issues.append("EXPECTED_SKU_NOT_FOUND")

        if matched:
            title=matched.get("name")
            if isinstance(title,str) and title.strip():
                evidence.product_title=title.strip()
                evidence.field_evidence["product_title"]=EvidenceTrace(source="JSON-LD",raw_value=title[:512])
            sku=matched.get("sku")
            if isinstance(sku,(str,int)):
                evidence.sku=str(sku)
                evidence.field_evidence["sku"]=EvidenceTrace(source="JSON-LD",raw_value=evidence.sku)
            brand=matched.get("brand")
            brand=brand.get("name") if isinstance(brand,dict) else brand
            if isinstance(brand,str) and brand.strip():
                evidence.brand=brand.strip()
                evidence.field_evidence["brand"]=EvidenceTrace(source="JSON-LD",raw_value=evidence.brand[:256])
            offers=matched.get("offers")
            offer_candidates=offers if isinstance(offers,list) else ([offers] if isinstance(offers,dict) else [])
            offer_candidates=[x for x in offer_candidates if isinstance(x,dict)]
            if expected_sku:
                offer_candidates=[x for x in offer_candidates if str(x.get("sku") or expected_sku)==expected_sku]
            # AggregateOffer and multiple variants do not establish one sellable price.
            offer=(offer_candidates[0] if len(offer_candidates)==1 else None)
            if len(offer_candidates)>1:evidence.issues.append("MULTIPLE_OFFERS_AMBIGUOUS")
            if offer and str(offer.get("@type","")).endswith("AggregateOffer"):
                evidence.issues.append("AGGREGATE_PRICE_NOT_SELLABLE")
                offer=None
            if offer and evidence.sku and offer.get("sku") and str(offer["sku"])!=evidence.sku:
                evidence.issues.append("OFFER_SKU_MISMATCH")
                offer=None
            if offer:
                raw_seller=offer.get("seller")
                seller_name=raw_seller.get("name") if isinstance(raw_seller,dict) else raw_seller
                if isinstance(seller_name,str) and seller_name.strip():
                    evidence.seller=seller_name.strip()[:100]
                    evidence.field_evidence["seller"]=EvidenceTrace(source="JSON-LD",raw_value=evidence.seller)
                offer_url=offer.get("url")
                if isinstance(offer_url,str) and offer_url.strip():
                    evidence.offer_url=offer_url.strip()[:2048]
                    evidence.field_evidence["offer_url"]=EvidenceTrace(source="JSON-LD",raw_value=evidence.offer_url)
                # Retailer/URL ownership is required for live promotion, not
                # for structural parsing of older offline fixture samples.
                if evidence.requested_url and (
                    evidence.seller not in ("Jarir Bookstore","Jarir")
                    or evidence.offer_url != evidence.requested_url
                    or (matched.get("url") is not None
                        and matched.get("url") != evidence.requested_url)
                ):
                    evidence.issues.append("OFFER_MERCHANT_URL_UNATTESTED")
                    offer=None
            if offer:
                raw_price=offer.get("price")
                raw_currency=offer.get("priceCurrency")
                # Currency must be independently proven before retaining a price.
                if raw_currency=="SAR" and raw_price is not None:
                    try:
                        price=Decimal(str(raw_price))
                        if price.is_finite() and price>0:
                            evidence.price=price
                            evidence.currency="SAR"
                            evidence.field_evidence["price"]=EvidenceTrace(source="JSON-LD",raw_value=str(raw_price))
                            evidence.field_evidence["currency"]=EvidenceTrace(source="JSON-LD",raw_value="SAR")
                        else:evidence.issues.append("JSONLD_PRICE_INVALID")
                    except (InvalidOperation,ValueError):evidence.issues.append("JSONLD_PRICE_INVALID")
                elif raw_price is not None:evidence.issues.append("JSONLD_CURRENCY_UNVERIFIED")
                availability=str(offer.get("availability",""))
                evidence.availability_raw=availability[:256]
                evidence.field_evidence["availability_raw"]=EvidenceTrace(source="JSON-LD",raw_value=availability[:256])
                if availability.endswith("InStock"):evidence.availability="IN_STOCK"
                elif availability.endswith("OutOfStock"):evidence.availability="OUT_OF_STOCK"
                elif availability.endswith("PreOrder"):evidence.availability="PREORDER"
                elif availability.endswith("BackOrder"):evidence.availability="BACKORDER"

        # Hydration fallback: only same-product evidence. No price without SAR.
        if evidence.price is None or evidence.availability=="UNKNOWN" or evidence.product_title is None:
            tag=soup.find("script",id="__NEXT_DATA__")
            if tag:
                try:
                    hydrated=json.loads(tag.string or "",parse_float=Decimal)
                    product=hydrated.get("props",{}).get("pageProps",{}).get("product",{})
                    if isinstance(product,dict) and product:
                        hydro_sku=product.get("sku")
                        if expected_sku and str(hydro_sku or "")!=expected_sku:
                            evidence.issues.append("HYDRATION_EXPECTED_SKU_MISMATCH")
                        elif evidence.sku and str(hydro_sku or "")!=evidence.sku:
                            evidence.issues.append("HYDRATION_SKU_MISMATCH")
                        else:
                            if evidence.product_title is None:
                                title=product.get("name_ar") or product.get("name")
                                if isinstance(title,str):
                                    evidence.product_title=title
                                    evidence.field_evidence["product_title"]=EvidenceTrace(source="Hydration",raw_value=title[:512])
                            if evidence.sku is None and hydro_sku:
                                evidence.sku=str(hydro_sku)
                                evidence.field_evidence["sku"]=EvidenceTrace(source="Hydration",raw_value=evidence.sku)
                            if evidence.price is None and product.get("price") is not None:
                                currency=product.get("price_currency") or product.get("currency")
                                if currency=="SAR":
                                    try:
                                        p=Decimal(str(product["price"]))
                                        if p>0 and p.is_finite():
                                            evidence.price=p;evidence.currency="SAR"
                                            evidence.field_evidence["price"]=EvidenceTrace(source="Hydration",raw_value=str(product["price"]))
                                            evidence.field_evidence["currency"]=EvidenceTrace(source="Hydration",raw_value="SAR")
                                    except (InvalidOperation,ValueError):pass
                                else:evidence.issues.append("HYDRATION_CURRENCY_UNVERIFIED")
                            if evidence.availability=="UNKNOWN":
                                instock=product.get("is_in_stock")
                                if instock is True:evidence.availability="IN_STOCK"
                                elif instock is False:evidence.availability="OUT_OF_STOCK"
                except (json.JSONDecodeError,TypeError,AttributeError):
                    evidence.issues.append("HYDRATION_PARSE_FAILED")

        # DOM title may be useful, but price is not safe without variant evidence.
        if evidence.product_title is None:
            el=soup.select_one("h1, [data-testid='product-title']")
            if el:
                title=el.get_text(" ",strip=True)
                if title:
                    evidence.product_title=title[:512]
                    evidence.field_evidence["product_title"]=EvidenceTrace(source="DOM",raw_value=title[:512])
        if evidence.price is None and soup.select_one(".price-value, [data-testid='product-price-value']"):
            evidence.issues.append("DOM_PRICE_UNBOUND_TO_SKU")
        return evidence

def run_worker():
    """Bounded JSONL; never leak raw HTTP errors or HTML to stdout."""
    for _ in range(16):
        raw=sys.stdin.buffer.readline(MAX_JSONL_BYTES+1)
        if not raw:return
        rid="unknown"
        if len(raw)>MAX_JSONL_BYTES or not raw.endswith(b"\n"):
            print(json.dumps({"schemaVersion":VERSION,"requestId":rid,"status":"ERROR","errorCode":"JSONL_LIMIT"}),flush=True)
            return
        try:
            request=json.loads(raw)
            if not isinstance(request,dict):raise ValueError("REQUEST_NOT_OBJECT")
            rid=str(request.get("requestId","unknown"))[:128]
            if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}",rid):rid="unknown"
            if request.get("schemaVersion")!=VERSION:raise ValueError("SCHEMA_VERSION_INVALID")
            url=JarirScraperEngine._safe_url(request.get("url"))
            sku=request.get("expected_sku")
            evidence=JarirScraperEngine.extract_jarir_product(url,sku)
            response={"schemaVersion":VERSION,"requestId":rid,"status":"SUCCESS",
                      "evidence":evidence.model_dump(mode="json")}
        except (ValueError,TypeError,json.JSONDecodeError):
            response={"schemaVersion":VERSION,"requestId":rid,"status":"ERROR","errorCode":"REQUEST_INVALID"}
        except Exception:
            response={"schemaVersion":VERSION,"requestId":rid,"status":"ERROR","errorCode":"INTERNAL_FAILURE"}
        print(json.dumps(response,separators=(",",":"),ensure_ascii=False),flush=True)

if __name__=="__main__":
    run_worker()
