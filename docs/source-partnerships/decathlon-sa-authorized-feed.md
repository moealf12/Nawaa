# NAWAA v22.06 — Decathlon Saudi authorized-source onboarding (research only)

**State:** ACCESS PENDING. **Do NOT turn on ingestion, product offer promotion, quote, checkout or shipping claims.** The existence of public Shopify APIs and a UK affiliate program is not evidence of Decathlon Saudi approval.

## Verified public facts and their boundaries

- Saudi Decathlon's official contact page: https://decathlon.com.sa/pages/contact-us ; published customer-service email: Supportksa@decathlon.com. This is a contact / referral channel, **not a confirmed technology partnership desk**.
- Decathlon UK (https://www.decathlon.co.uk/c/lp/affiliate-program-decathlon_5af91ef3-3375-44f9-9c12-dfaf92c62c8d) describes an Awin affiliate programme open to comparison and shopping directories and mentions product feeds. **UK programme terms do not apply automatically to the Saudi franchise.**
- Shopify's official Storefront API documentation (https://shopify.dev/docs/api/storefront/latest) describes product/collection GraphQL operations, some tokenless. It is intended for merchant storefront experiences, is subject to usage terms and bot limits, and is **not** permission to bulk-copy another merchant's catalog.
- The prior controlled Decathlon Saudi product .js probe returned **non-JSON** on a source-owned endpoint (PR #145, exact-head one-shot run 40609342613). Its live run is now OFF; do not retry with alternative URLs, secret store domains, proxies, bot avoidance, or guessed credentials.
- Decathlon Sports API documentation describes **sport taxonomy**, not Saudi SKU, local inventory or price: https://github.com/Decathlon/sports-docs .
- Published Saudi delivery FAQ may describe thresholds/times at the policy level; it cannot certify a specific SKU's destination-based price, stock, fees or checkout.

## Source partner request route — no email has been sent

1. Ask the official Saudi contact to forward to the e-commerce / partnerships / data feed owner. Request confirmation of the legal data provider, shop/franchise region, data reuse rights and a free/read-only feed option.
2. Ask explicitly whether NAWAA may: show product title/photo; display variant-level SAR prices and timestamp; cache/revalidate data; compare against other merchants; use merchant links; and refresh the feed on an agreed cadence. Clarify attribution, expiry, images/brand rights, rate limits, referral/affiliate terms and deletion/revocation requirements.
3. Ask for product **SKU, selected variant ID, GTIN where present, SAR inclusive/exclusive tax, price observation time, product status, availability semantics, image rights, link and last update time**. Request Saudi delivery eligibility, destination-specific shipping fee and estimated time **only if they can provide independently supportable fields**.
4. Confirm allowed transfer mechanism and authentication (e.g. partner-provided CSV/JSON file over agreed channel, official merchant API credentials or approved programme), scope and permission expiry. Never paste secret credentials into GitHub or ChatGPT.
5. Have an authorized source operator independently verify the agreement **outside the feed** before installing any trusted grant. Keep an approval record reference and scope. A self-declared approval field inside the merchant data is not authorization.

## Engineering contract (isolated, not production)

- Current \`PARTNER_SOURCE_ACCESS["decathlon-sa"]\` is **UNVERIFIED / OFF**. No trusted grants, feed URLs, partner tokens or data requests have been configured.
- \`server/merchant-feed-authorization-gate.mjs\` is a **pure no-network verifier** for a single *locally supplied* JSON payload and a separate privileged authorization receipt. The prototype checks a file SHA-256, source ID/country, rights, expiry, chosen variant ID/SKU, SAR minor-unit price, freshness, exact merchant HTTPS product path, and duplicates.
- A digest match proves only that the payload bytes agree with the independently approved receipt; **it does NOT establish merchant origin or legal permission by itself**. Approval must be established and supplied through a privileged process, not a user-provided JSON field.
- No incoming feed has been used, installed or approved. Fixture values in tests are synthetic. Even for a matching fixture, the module **never emits a product offer, inventory availability, shipping, checkout or customer quote**.
- All customer-visible source promotion remains subject to independent source freshness, merchant identity reconciliation, offer verification, buyability/delivery constraints and release gates in the existing NAWAA codebase.

## Source status and GO / NO-GO

| Candidate | Product data channel | Current evidence | Engineering decision |
|---|---|---|---|
| Decathlon Saudi PDP | Public source-owned HTML | Selected variant SKU and price attribution in v22.01, but insufficient local inventory/delivery proof | Research only |
| Saudi product .js | Public Shopify Ajax pattern | One robots-allowed probe returned non-JSON; not viable as tested | Stop; no retries |
| Shopify GraphQL Storefront | Documented platform capability | No Saudi merchant permission/endpoint capability established for NAWAA | No calls |
| UK Decathlon Awin feed | Documented UK partner programme | Saudi eligibility, rights and feed delivery not established | Ask Saudi owner |
| Merchant-supplied Saudi file/API | Prospective explicit agreement | No permission/data yet | Build isolated offline acceptance tests only |

**Next trigger:** official Saudi partner confirmation with written rights, scope, and actual feed schema. Only then map received data into a source-specific adapter behind exact-head tests. Do not infer merchant shipping or real-time availability from a generic \`available:true\` field.

## Draft contact message (not sent)

Subject: Request for authorized Decathlon Saudi product data partnership — NAWAA

Hello Decathlon Saudi e-commerce / partnerships team,

We are building NAWAA, a Saudi product discovery and price-comparison service. We would like to ask whether Decathlon Saudi offers an officially approved product catalogue/affiliate feed or partner API for independent comparison platforms.

Could you advise who manages these partnerships and whether there is a no-cost pilot feed with written permission to show item titles, product images, SKU/variant identifiers, SAR prices, product links, update timestamps and explicitly supported availability signals? We would also appreciate documentation on permitted cache/refresh intervals, image and content reuse, referral terms and any applicable shipping-information limits.

We will not collect private customer data or perform checkout transactions, and we will not present inventory or delivery estimates without source-backed evidence. Please let us know the appropriate process or contact.

Thank you,
NAWAA project team

## v22.07 — signed grant authenticity and operator-owned key (research only)

The v22.06 gate checked a caller-provided INDEPENDENTLY_VERIFIED string; that assertion can be forged. v22.07 now requires an Ed25519 signature over a canonical grant receipt, verified against a public key installed via the trusted server environment. The signing key must be held outside ChatGPT, the source repository, CI fixtures and customer inputs.

- Trusted configuration: NAWAA_PARTNER_AUTHORITY_PUBLIC_KEY_SPKI_B64 (Ed25519 DER SPKI, Base64) and NAWAA_PARTNER_AUTHORITY_KEY_ID. No production authority key is currently installed; the default result is DENY.
- Signed fields: key ID, approval ID, merchant source ID/host/region, verification claim, transport, evidence reference, permitted purposes, start and expiry, and approved feed SHA-256. Unexpected fields, modified scopes or dates, unpinned keys, and unsigned claims fail.
- Test-generated signing keys are ephemeral and stored only in isolated test process memory; their successful signatures are NOT actual Decathlon Saudi approvals.
- A verified signature establishes approval by the pinned key holder, NOT legality of a contract, authenticity of the source, present-day pricing, inventory, shipping or checkout. The independent operator must verify the actual Saudi agreement before issuing any receipt.
- Production release additionally needs revocation/key-rotation lifecycle and secure issuance, a source-owned data transport and signed payloads, SKU and variant reconciliation, validated pricing and independently supported shipping/checkout. No source feed or user-visible offer is enabled in this PR.

NO-GO for live source activation, any pricing badge, quote, merge or Render deployment. No partner message sent.
