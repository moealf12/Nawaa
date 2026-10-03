# Current prices and explicit variant identity

Baseline: 2dcbd630e8b501c56caeed56560ef3d708f40eaf. The latest production run completed 261 probes; Jarir passed 6/9 because HP laptop index prices disagree with product pages. Native Union / Spigen / Death Wish fail identity checks because offer SKU and resolver modelNumber are different namespaces. Native Union HTML contains Offer arrays with explicit variant URLs, SKU and prices; the resolver currently chooses cheapest/first without the requested variant.

Accept current Jarir page prices only after independent query and product identity confirmation. Preserve discovery price as evidence, never use it if page lookup fails. Query-negative filtering occurs before page fetch. Bound concurrency, not total results. Missing shipping/tax remain unknown.

For a URL with variant, select only Offer data whose same-host same-path URL carries that exact variant. Unknown variants must fail; cheaper siblings never replace them. Preserve SKU separately from MPN, and prevent non-selected candidates from supplying sibling fields. Nonvariant resolver behavior stays compatible. Keep source attribution and audit criteria strict, including the requested variant URL.

Use existing free infrastructure and no new credentials or services. Three fixed rounds per affected source, two positive queries plus negative control, >=60-second gaps, same deployed revision/environment. Include eXtra/Decathlon/ASOS as regression controls; do not substitute easier queries or claim all 29 sources certified.
