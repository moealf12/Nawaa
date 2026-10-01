# Product cards and comparison

Search results present one card per comparable product identity, with available
product price, variant specifications, condition, offer/merchant counts and
merchant country flags. The selected card expands its own comparison. Clicking
it again or closing the comparison collapses it. Source URLs remain internal to
the procurement/detail flow.

Manufacturer identifiers are corroborating evidence. Matching named phone models,
capacity and color can bridge an offer without an identifier only when exactly
one compatible group exists. Conflicting explicit identifiers stay separate.
Shared identifiers can join different merchant wording, but cannot override
conflicting variant specifications. Each candidate must match every existing
member; unidentified offers cannot transitively bridge conflicting groups.
Generic laptop/family names, insufficient phone variants, clothing sizes, regions,
conditions, capacities and bundle contents are handled conservatively. Missing
secondary specifications remain unconfirmed and visible in comparison warnings.
Group keys remain distinct even when insufficient identities share the same title.

Card headline prices compare product prices in SAR. Confirmed arrival totals are
shown separately. Unknown delivery, estimated costs and product-only prices do
not establish a confirmed arrival total; numerical price differences require the
same comparison basis. Unavailable offers do not set the headline available price.

HP category priorities and PS5 device-before-game ordering are preserved. Coffee
and clothing use merchant product-type metadata, with Arabic coffee/clothing
query aliases. No category displays irrelevant phone-specific controls.
