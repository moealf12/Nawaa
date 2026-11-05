"""Verify signed partner delivery quotes before allowing a positive source claim.

Only operator-pinned Ed25519 public keys are trusted; the source payload must
NOT specify its own trusted key material. An unsigned dict or a Global badge
cannot authenticate origin. This is an optional, fail-closed integration:
NO production Noon partner public key is configured here.
"""
from __future__ import annotations

import base64
import json
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

MAX_PAYLOAD_BYTES = 8192
MAX_ENCODED_BYTES = 12000
KEY_ID = re.compile(r"[a-z][a-z0-9._-]{2,63}")
BASE64 = re.compile(r"[A-Za-z0-9_-]+")


def _pairs_no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("DUPLICATE_JSON_KEY")
        out[key] = value
    return out


def _no_nonfinite(value):
    raise ValueError("NONFINITE_JSON")


def _decode_b64url(value, max_chars):
    if not isinstance(value, str) or not 1 <= len(value) <= max_chars:
        return None
    if not BASE64.fullmatch(value):
        return None
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        # Disallow alternate or noncanonical encodings.
        if base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != value:
            return None
        return decoded
    except (ValueError, base64.binascii.Error):
        return None


def verify_partner_delivery_envelope(envelope, *, trusted_public_keys=None):
    """Return verified signed payload or None, no exceptions for bad input.

    trusted_public_keys must be independent operator configuration, not
    merchant HTML nor the untrusted envelope. A key signed by *us* alone does
    not establish merchant authority without the relevant partner binding.
    """
    if not isinstance(envelope, dict) or not isinstance(trusted_public_keys, dict):
        return None
    if set(envelope) != {"keyId", "payloadB64", "signatureB64"}:
        return None
    key_id = envelope.get("keyId")
    if not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id):
        return None
    raw_public_key = trusted_public_keys.get(key_id)
    if not isinstance(raw_public_key, bytes) or len(raw_public_key) != 32:
        return None
    payload = _decode_b64url(envelope.get("payloadB64"), MAX_ENCODED_BYTES)
    signature = _decode_b64url(envelope.get("signatureB64"), 100)
    if (payload is None or not 1 <= len(payload) <= MAX_PAYLOAD_BYTES
            or signature is None or len(signature) != 64):
        return None
    try:
        # Signature over original exact bytes, before any JSON interpretation.
        Ed25519PublicKey.from_public_bytes(raw_public_key).verify(
            signature, payload
        )
        quote = json.loads(
            payload.decode("utf-8"), object_pairs_hook=_pairs_no_duplicates,
            parse_constant=_no_nonfinite,
        )
    except (InvalidSignature, ValueError, TypeError, UnicodeDecodeError):
        return None
    if not isinstance(quote, dict):
        return None
    if quote.get("schema") != "nawaa.noon.partner-delivery-quote.v1":
        return None
    if quote.get("sourcePartner") != "noon":
        return None
    if quote.get("sourceKind") != "authorized_offer_delivery_feed":
        return None
    return quote
