# R04 — Independent JBL product-family evidence for disputed live results

**Scope:** externally sourced manufacturer product-type evidence for four distinct
retailer titles (seven observed first-ten positions across two bilingual queries).
This does **not** establish retailer stock, SKU authenticity, price accuracy, or
human evaluation of all search results.

## Trigger: previously unknown live observations

The read-only real-production run
https://github.com/moealf12/Nawaa/actions/runs/41162761318
reported `10/10` HTTP 200, `98` ranked groups, `7` provisional unknowns.
All seven unknown positions in Q11/Q12 were JBL Tune 125BT and Tune 135BT
retailer titles containing **In-Ear Earphones** and **Bluetooth**.

Original audit deliberately left them UNKNOWN because a lexical rule required
the words `headphones` or `headset`, not because the products were disproven.

## Independent evidence (manufacturer, not model ranking scores)

1. **JBL Tune 125BT** — official JBL product page:
   https://www.jbl.com/TUNE125BT-.html
   Explicit classification *Wireless in-ear headphones*, Bluetooth connectivity.
2. **JBL Tune 135BT** — official JBL product page:
   https://www.jbl.com/TUNE135BT.html
   Explicit classification *Wireless In-Ear headphones*, Bluetooth connectivity.

Rule amendment is constrained to an explicit title stating one of these two
JBL models, sold **earphones**, and Bluetooth/wireless, after JBL brand evidence.
No generic earphone, speaker, or wired product is admitted by this exception.
System `exactMatch`, `matchConfidence`, displayed price, and rank are NEVER
used to compute the provisional label.

## Methodological limits

- Labels are **manufacturer-evidence-backed rules**, not manual grading by
  independent human judges of a captured retailer PDP or an official SKU.
- Different-time production samples are not paired causal A/B comparisons.
- A resolved provisional UNKNOWN does not prove actual merchant identity,
  inventory, shipping, or that all first-ten results are suitable.
- R04 remains `IN_PROGRESS`; require a new pinned production evidence capture
  and separate UI first-screen parity before full round certification.
