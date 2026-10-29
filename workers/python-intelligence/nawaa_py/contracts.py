"""Strict JSON Lines v1 contract: evidence is not a certified offer."""
from decimal import Decimal
from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VERSION = "nawaa.python.extract.v1"
MAX_HTML_CHARS = 2_000_000

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

class IdentityDecision(StrEnum):
    REJECT = "REJECT"
    INSUFFICIENT = "INSUFFICIENT_EVIDENCE"
    CANDIDATE = "CANDIDATE"

class ProductExpectation(StrictModel):
    brand: str | None = Field(default=None, max_length=128)
    model: str | None = Field(default=None, max_length=256)
    storageGb: int | None = Field(default=None, gt=0, le=65536)
    condition: Literal["NEW", "USED", "REFURBISHED"] | None = None
    bundleId: str | None = Field(default=None, max_length=128)
    sku: str | None = Field(default=None, max_length=128)
    gtin: str | None = Field(default=None, pattern=r"^\d{8}(?:\d{4,6})?$")
    color: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, max_length=512)

    @field_validator("brand", "model", "sku", "bundleId", "color", "title")
    @classmethod
    def nonempty(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("EMPTY_PROPERTY")
        return value

class ExtractionInput(StrictModel):
    expected: ProductExpectation = Field(default_factory=ProductExpectation)
    observed: ProductExpectation | None = None
    html: str | None = Field(default=None, max_length=MAX_HTML_CHARS)
    url: str | None = Field(default=None, max_length=2048)
    price: str | None = Field(default=None, max_length=40)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

class Limits(StrictModel):
    timeoutMs: int = Field(default=5000, ge=1000, le=10000)
    maxResponseBytes: int = Field(default=1_000_000, ge=1024, le=2_000_000)

class ExtractionRequest(StrictModel):
    schema_version: Literal["nawaa.python.extract.v1"] = Field(alias="schemaVersion")
    request_id: str = Field(alias="requestId", min_length=1, max_length=128,
                            pattern=r"^[A-Za-z0-9._:-]+$")
    source_id: str = Field(alias="sourceId", pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    operation: Literal["classify", "extract_html", "fetch_extract"]
    input_data: ExtractionInput = Field(alias="input")
    limits: Limits = Field(default_factory=Limits)

    @model_validator(mode="after")
    def operation_contract(self):
        data = self.input_data
        if self.operation == "classify" and (data.observed is None or data.html is not None or data.url is not None):
            raise ValueError("CLASSIFY_REQUIRES_OBSERVED_ONLY")
        if self.operation == "extract_html" and (data.html is None or data.url is not None):
            raise ValueError("HTML_REQUIRED_WITHOUT_URL")
        if self.operation == "fetch_extract" and (data.url is None or data.html is not None):
            raise ValueError("URL_REQUIRED_WITHOUT_HTML")
        if self.operation != "classify" and (data.price is not None or data.currency is not None):
            raise ValueError("PRICE_ONLY_VALID_IN_CLASSIFY")
        return self

class OfferEvidence(StrictModel):
    price: Decimal = Field(gt=Decimal("0"), allow_inf_nan=False)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    availability: Literal["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"] = "UNKNOWN"

class IdentityResult(StrictModel):
    decision: IdentityDecision
    conflicts: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    similarityScore: float | None = Field(default=None, ge=0.0, le=100.0)

class ExtractionResponse(StrictModel):
    schema_version: Literal["nawaa.python.extract.v1"] = Field(default=VERSION, alias="schemaVersion")
    request_id: str = Field(alias="requestId")
    source_id: str = Field(alias="sourceId")
    status: Literal["CLASSIFIED", "EXTRACTED", "NO_OFFER"]
    product: ProductExpectation | None = None
    offer_evidence: OfferEvidence | None = Field(default=None, alias="offerEvidence")
    identity: IdentityResult
    diagnostics: dict[str, str | int | bool] = Field(default_factory=dict)

class ErrorResponse(StrictModel):
    schema_version: Literal["nawaa.python.extract.v1"] = Field(default=VERSION, alias="schemaVersion")
    request_id: str = Field(default="unknown", alias="requestId")
    source_id: str = Field(default="unknown", alias="sourceId")
    status: Literal["ERROR"] = "ERROR"
    error_code: str = Field(alias="errorCode", pattern=r"^[A-Z0-9_]+$")
