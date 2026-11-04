"""Live trial of user-supplied Noon extractor architecture, isolated from NAWAA.

Prints machine-readable outcomes for direct curl_cffi and one Chromium page
load of the exact user-provided Saudi Arabic iPhone search. No stored HTML,
cookies, publication, retries after access refusal, paid proxies, or credentials.
"""
from __future__ import annotations

import json
import re
import time
import random
from typing import List, Dict, Optional, Any
from urllib.parse import urljoin, urlsplit
from bs4 import BeautifulSoup, Tag
from curl_cffi import requests
from playwright.sync_api import sync_playwright

TEST_URL = "https://www.noon.com/saudi-ar/search?q=iphone"
CANONICAL_TEST_URL = "https://www.noon.com/saudi-en/search/?q=Laptop"
MAX_HTML = 8_000_000

try:
    from playwright_stealth import Stealth
    STEALTH_VERSION = "v2"
    def apply_stealth_to_page(page):
        instance = Stealth()
        # The supplied apply_to_sync() method is not in v2.0.3; test the
        # compatible method instead to reach actual navigation.
        method = getattr(instance, "apply_to_sync", None)
        if callable(method):
            method(page)
            return "apply_to_sync"
        method = getattr(instance, "apply_stealth_sync", None)
        if callable(method):
            method(page)
            return "apply_stealth_sync"
        return "UNSUPPORTED_STEALTH_API"
except ImportError:
    try:
        from playwright_stealth import stealth_sync
        STEALTH_VERSION = "v1"
        def apply_stealth_to_page(page):
            stealth_sync(page)
            return "stealth_sync"
    except ImportError:
        STEALTH_VERSION = "none"
        def apply_stealth_to_page(page):
            return "NOT_AVAILABLE"


class NoonSkuExtractor:
    NOON_SKU_PATTERN = re.compile(r'/(N\d+[A-Z0-9]*)(?:/p/|\?|$)', re.IGNORECASE)
    NOON_RAW_SKU_PATTERN = re.compile(r'\b(N\d{7,12}[A-Z0-9]*)\b', re.IGNORECASE)
    @classmethod
    def extract(cls, text_or_url: str) -> Optional[str]:
        if not text_or_url:
            return None
        match = cls.NOON_SKU_PATTERN.search(text_or_url)
        if match:
            return match.group(1).upper()
        match = cls.NOON_RAW_SKU_PATTERN.search(text_or_url)
        return match.group(1).upper() if match else None


class RobustPriceExtractor:
    PRICE_PATTERN = re.compile(
        r'(?:(?:SR|SAR|EUR|USD|\$|€|ر\.س|جنيه|درهم)\s*)?'
        r'(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)'
        r'(?:\s*(?:SR|SAR|EUR|USD|\$|€|ر\.س|جنيه|درهم))?',
        re.IGNORECASE
    )
    @classmethod
    def clean_and_parse(cls, raw_text: Any) -> Optional[float]:
        if raw_text is None:
            return None
        text_str = str(raw_text).strip()
        if not text_str or '%' in text_str:
            return None
        match = cls.PRICE_PATTERN.search(text_str)
        if not match:
            return None
        num_str = match.group(1)
        if not num_str:
            return None
        if ',' in num_str and '.' in num_str:
            if num_str.rfind('.') > num_str.rfind(','):
                num_str = num_str.replace(',', '')
            else:
                num_str = num_str.replace('.', '').replace(',', '.')
        elif ',' in num_str:
            parts = num_str.split(',')
            num_str = num_str.replace(',', '.') if len(parts[-1]) == 2 else num_str.replace(',', '')
        try:
            val = float(num_str)
            return val if 0.5 <= val <= 1000000 else None
        except ValueError:
            return None


class GraphJsonLdParser:
    @classmethod
    def parse_payload(cls, payload: Any, base_url: str) -> List[Dict]:
        results = []
        if isinstance(payload, list):
            for node in payload:
                results.extend(cls.parse_payload(node, base_url))
            return results
        if not isinstance(payload, dict):
            return results
        if '@graph' in payload and isinstance(payload['@graph'], list):
            for node in payload['@graph']:
                results.extend(cls.parse_payload(node, base_url))
        item_type = payload.get('@type', '')
        if item_type in ['ItemList', 'SearchResultsPage']:
            for el in payload.get('itemListElement', []):
                sub = el.get('item', el) if isinstance(el, dict) else {}
                parsed = cls._extract_single_product(sub, base_url)
                if parsed and parsed.get('price') is not None:
                    results.append(parsed)
        elif item_type == 'Product':
            parsed = cls._extract_single_product(payload, base_url)
            if parsed and parsed.get('price') is not None:
                results.append(parsed)
        return results
    @classmethod
    def _extract_single_product(cls, item: dict, base_url: str) -> Optional[Dict]:
        if not isinstance(item, dict):
            return None
        title = item.get('name') or item.get('title')
        if not title or len(str(title).strip()) < 2:
            return None
        offers = item.get('offers', {})
        if isinstance(offers, list) and offers:
            offers = offers[0]
        raw_price = offers.get('price') if isinstance(offers, dict) else None
        price = RobustPriceExtractor.clean_and_parse(raw_price)
        url = item.get('url') or item.get('@id')
        full_url = urljoin(base_url, str(url)) if url else base_url
        sku = NoonSkuExtractor.extract(full_url) or item.get('sku') or item.get('productID')
        img = item.get('image')
        if isinstance(img, list) and img:
            img = img[0]
        elif isinstance(img, dict):
            img = img.get('url')
        full_img = urljoin(base_url, str(img)) if img else None
        if not sku:
            return None
        return {'title':str(title).strip(),'sku':str(sku),
                'price':price,'image':full_img,'url':full_url}


class SemanticDomScanner:
    @classmethod
    def scan(cls, soup: BeautifulSoup, base_url: str) -> List[Dict]:
        results = []
        potential_cards = soup.find_all(['article', 'li', 'div'], attrs={
            'data-qa': re.compile(r'product|card', re.I)
        }) or soup.find_all(['article', 'li', 'div'],
              class_=re.compile(r'productContainer|productBox|grid-item', re.I))
        if not potential_cards:
            potential_cards = soup.find_all('a', href=re.compile(r'/p/'))
        for card in potential_cards[:250]:
            if not isinstance(card, Tag):
                continue
            link_node = card if card.name == 'a' else card.find('a', href=True)
            if not link_node:
                continue
            href = link_node.get('href', '')
            full_url = urljoin(base_url, href)
            sku = NoonSkuExtractor.extract(full_url) or card.get('data-sku') or card.get('data-asin')
            if not sku:
                continue
            title_node = card.find(['h1', 'h2', 'h3', 'h4', 'span', 'p'],
                                   class_=re.compile(r'title|name', re.I))
            title = title_node.get_text().strip() if title_node else link_node.get_text().strip()
            if not title or len(title) < 3:
                continue
            price_node = card.find(class_=re.compile(r'amount|priceValue|sellingPrice', re.I)) or card.find(attrs={'data-qa': re.compile(r'price', re.I)})
            price = RobustPriceExtractor.clean_and_parse(
                price_node.get_text() if price_node else card.get_text()
            )
            img_node = card.find('img')
            img_url = None
            if img_node:
                src = img_node.get('src') or img_node.get('data-src')
                if src:
                    img_url = urljoin(base_url, src.split()[0])
            results.append({'title':title,'sku':sku,'price':price,
                            'image':img_url,'url':full_url})
        return results


def parse_user_code(html, base_url):
    if not isinstance(html, str) or len(html) > MAX_HTML:
        return {'status':'INVALID_HTML','products':[]}
    soup = BeautifulSoup(html, 'lxml')
    products = []
    for script in soup.find_all('script', type='application/ld+json'):
        if script.string:
            try:
                payload = json.loads(script.string)
                extracted = GraphJsonLdParser.parse_payload(payload, base_url)
                products.extend([p for p in extracted if p.get('price') is not None])
            except Exception:
                continue
    parser = 'JSON_LD' if products else 'DOM'
    if not products:
        products = SemanticDomScanner.scan(soup, base_url)
    unique_map = {}
    for p in products:
        if p.get('title') and p.get('sku') and p.get('price') is not None:
            key = (p['sku'], p['price'])
            if key not in unique_map:
                unique_map[key] = p
    # These are TENTATIVE results of the user's unvalidated heuristic, not
    # NAWAA approved offers. Count rather than publish sample bad prices.
    return {'status':'PARSED','parser':parser,
            'products':list(unique_map.values())[:100]}


def network_error_category(exc):
    message = str(exc)
    m = re.search(r'net::ERR_[A-Z0-9_]+', message)
    if m:
        return m.group(0)
    if 'Timeout' in message:
        return 'TIMEOUT'
    return type(exc).__name__


def curl_probe(url):
    started=time.monotonic()
    try:
        with requests.Session(impersonate='chrome120',timeout=12.0) as session:
            response = session.get(url,headers={
                'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language':'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7',
                'Upgrade-Insecure-Requests':'1'
            },allow_redirects=False)
        status=response.status_code
        result={'transport':'curl_cffi','http_status':status,
                'elapsed_ms':int((time.monotonic()-started)*1000)}
        if status==200 and len(response.text)>800:
            outcome=parse_user_code(response.text,url)
            result.update({'parse_status':outcome['status'],
                           'parser':outcome.get('parser'),
                           'tentative_results':len(outcome['products']),
                           'first_three':[{'title':p['title'][:90],
                                           'sku':p['sku'],'price':p['price']}
                                           for p in outcome['products'][:3]]})
        else:
            result['tentative_results']=0
        return result
    except Exception as exc:
        return {'transport':'curl_cffi','status':'ERROR',
                'error_class':type(exc).__name__,
                'elapsed_ms':int((time.monotonic()-started)*1000)}


def browser_probe(url):
    started=time.monotonic()
    stage='LAUNCH'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox','--disable-dev-shm-usage',
                '--disable-http2','--ignore-certificate-errors'
            ])
            try:
                stage='CONTEXT'
                context=browser.new_context(viewport={'width':1366,'height':768},
                                            locale='ar-SA')
                try:
                    stage='NEW_PAGE'
                    page=context.new_page()
                    stage='STEALTH'
                    stealth_method=apply_stealth_to_page(page)
                    stage='GOTO'
                    response=page.goto(url,wait_until='domcontentloaded',timeout=25000)
                    http_status=response.status if response else None
                    result={'transport':'playwright_stealth',
                            'stealth_method':stealth_method,
                            'http_status':http_status,
                            'elapsed_ms':int((time.monotonic()-started)*1000)}
                    if http_status==200:
                        stage='RENDER'
                        page.mouse.wheel(0,400)
                        page.wait_for_timeout(800)
                        html=page.content()
                        parsed=parse_user_code(html,url)
                        result.update({'parse_status':parsed['status'],
                                       'parser':parsed.get('parser'),
                                       'tentative_results':len(parsed['products']),
                                       'first_three':[{'title':q['title'][:90],
                                                       'sku':q['sku'],'price':q['price']}
                                                       for q in parsed['products'][:3]]})
                    else:
                        result['tentative_results']=0
                    return result
                finally:
                    context.close()
            finally:
                browser.close()
    except Exception as exc:
        return {'transport':'playwright_stealth','stage':stage,'status':'ERROR',
                'reason':network_error_category(exc),
                'elapsed_ms':int((time.monotonic()-started)*1000),
                'tentative_results':0}


def main():
    print(json.dumps({'stage':'target','url':TEST_URL,
                      'stealth_package_family':STEALTH_VERSION},ensure_ascii=False))
    print(json.dumps(curl_probe(TEST_URL),ensure_ascii=False))
    print(json.dumps(browser_probe(TEST_URL),ensure_ascii=False))


if __name__=='__main__':
    main()
