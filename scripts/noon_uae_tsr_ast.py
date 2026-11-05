"""Bounded static ESTree decoder for TanStack streaming SSR $R alias payloads.

No evaluation, no JavaScript execution, no dynamic code loading. Requires
esprima==4.0.1 in the *experimental CI only*. A parsed offer needs an exact
offer-code, SKU, currency and price in the same explicit record to be promoted
to "attested"; textual adjacency in the script is never sufficient.
"""
from __future__ import annotations

import re

import esprima

from noon_uae_embedded_offer import candidate_objects

MAX_SCRIPT_CHARS = 260_000
MAX_SCRIPTS = 10
MAX_AST_NODES = 60000
MAX_ALIASES = 20000
MAX_EVIDENCE = 12
UNKNOWN = object()


def _children(value):
    if isinstance(value, list):
        return [x for x in value if hasattr(x, "type")]
    if not hasattr(value, "type"):
        return []
    out = []
    for v in vars(value).values():
        if isinstance(v, list):
            out.extend(x for x in v if hasattr(x, "type"))
        elif hasattr(v, "type"):
            out.append(v)
    return out


def _alias_key(node):
    if getattr(node, "type", None) != "MemberExpression":
        return None
    obj = getattr(node, "object", None)
    if getattr(obj, "type", None) != "Identifier" or obj.name != "$R":
        return None
    key = getattr(node, "property", None)
    if getattr(key, "type", None) == "Literal" and type(key.value) is int:
        if 0 <= key.value <= 999999:
            return key.value
    return None


def _property_key(prop):
    key = getattr(prop, "key", None)
    typ = getattr(key, "type", None)
    if typ == "Identifier":
        return str(key.name)
    if typ == "Literal" and isinstance(key.value, str):
        return key.value
    return None


def _unpack(node, aliases, level=0, visiting=None):
    if level > 14 or node is None:
        return UNKNOWN
    if visiting is None:
        visiting = set()
    typ = getattr(node, "type", None)
    if typ == "Literal":
        v = getattr(node, "value", UNKNOWN)
        return v if isinstance(v, (str, int, float, bool, type(None))) else UNKNOWN
    if typ == "AssignmentExpression":
        return _unpack(node.right, aliases, level + 1, visiting)
    if typ == "MemberExpression":
        alias = _alias_key(node)
        if alias is None or alias in visiting or alias not in aliases:
            return UNKNOWN
        return _unpack(aliases[alias], aliases, level + 1, visiting | {alias})
    if typ == "UnaryExpression" and node.operator in ("+", "-"):
        v = _unpack(node.argument, aliases, level + 1, visiting)
        return node.operator == "-" and -v or v if type(v) in (int, float) else UNKNOWN
    if typ == "ObjectExpression":
        data = {}
        for prop in node.properties[:150]:
            if getattr(prop, "type", None) != "Property" or prop.computed:
                continue
            key = _property_key(prop)
            if key is None or len(key) > 80 or key in data:
                continue
            value = _unpack(prop.value, aliases, level + 1, visiting)
            if value is not UNKNOWN:
                data[key] = value
        return data
    if typ == "ArrayExpression":
        return [
            value for entry in node.elements[:60]
            if (value := _unpack(entry, aliases, level + 1, visiting)) is not UNKNOWN
        ]
    return UNKNOWN


def inspect_tsr_ast(soup, *, sku, offer_code, plp_price):
    report = {
        "tsrScriptCount": 0,
        "parsedScriptCount": 0,
        "parseFailureCount": 0,
        "astNodesInspected": 0,
        "resolvedAliasCount": 0,
        "objectExpressionsInspected": 0,
        "offerCodePresentInTsrScript": False,
        "candidateRecords": [],
        "exactOfferWithExplicitSkuCurrencyPrice": False,
        "samePriceOfferAttested": False,
        "customerPublishable": False,
    }
    if not re.fullmatch(r"[A-Za-z0-9-]{1,100}", str(offer_code)):
        return report
    for tag in soup.find_all("script", limit=140):
        body = tag.string or tag.get_text()
        if not isinstance(body, str) or not body or len(body) > MAX_SCRIPT_CHARS:
            continue
        if "self.$R" not in body and "$_TSR" not in body:
            continue
        if report["tsrScriptCount"] >= MAX_SCRIPTS:
            break
        report["tsrScriptCount"] += 1
        if offer_code not in body:
            continue
        report["offerCodePresentInTsrScript"] = True
        try:
            ast = esprima.parseScript(body, tolerant=True)
        except Exception:
            report["parseFailureCount"] += 1
            continue
        report["parsedScriptCount"] += 1
        nodes = []
        stack = [ast]
        while stack and len(nodes) < MAX_AST_NODES:
            node = stack.pop()
            if not hasattr(node, "type"):
                continue
            nodes.append(node)
            stack.extend(_children(node))
        report["astNodesInspected"] += len(nodes)
        aliases = {}
        for node in nodes:
            if getattr(node, "type", None) != "AssignmentExpression":
                continue
            idx = _alias_key(getattr(node, "left", None))
            if idx is not None and len(aliases) < MAX_ALIASES:
                aliases[idx] = node.right
        report["resolvedAliasCount"] += len(aliases)
        for node in nodes:
            if getattr(node, "type", None) != "ObjectExpression":
                continue
            report["objectExpressionsInspected"] += 1
            record = _unpack(node, aliases)
            if not isinstance(record, dict):
                continue
            # A first-level object whose offer_code is exact is decisive;
            # parent/child or sibling matching never grants offer parity.
            evidence, _ = candidate_objects(
                record, sku=sku, offer_code=offer_code, plp_price=plp_price
            )
            for e in evidence:
                if e.get("skuExplicitInOfferRecord") and e.get("currency") == "AED" and (
                    e.get("priceCents") is not None
                ):
                    report["exactOfferWithExplicitSkuCurrencyPrice"] = True
                    if e.get("amountMatchesPlp"):
                        report["samePriceOfferAttested"] = True
                if len(report["candidateRecords"]) < MAX_EVIDENCE:
                    if e not in report["candidateRecords"]:
                        report["candidateRecords"].append(e)
    return report
