# R04 — HP mainboard retail-subject evidence and LIVE audit false negative

**Scope:** narrowly classify a verified independently sold HP replacement board,
not a whole notebook. This documents an actual published first-result defect;
it is not a retailer price or stock certification.

## Production observation
- Exact LIVE backend after PR #245: `4f2fca3602484ddf44eb70bedba3fbe595874ec4`,
  Render `dep-dbj6q8m417fc73akg3jg`.
- [GitHub read-only sample 41249009245](https://github.com/moealf12/Nawaa/actions/runs/41249009245):
  Q15 query `HP laptop 16GB RAM` first group:
  `L34280-601 für HP EliteBook x360 1030 G3 mit Intel Core i7-8650U und 16 GB RAM`.
  Original audit assigned grade 3 incorrectly, and passed 10/10.
- The original seller's listing [eBay 178535835066](https://www.ebay.de/itm/178535835066),
  also reproduced by [Grelly](https://www.grelly.nl/itm/l34280-601-fur-hp-elitebook-x360-1030-g3-mit-intel-core-i7-8650u-und-16-gb-ram-178535835066),
  explicitly identifies `L34280-601` as an **HP EliteBook x360 1030 G3 mainboard**
  with onboard i7-8650U and 16GB RAM. This is a part, not a full laptop.

## Counterfactual controls
- Test-only RED SHA: `25599636f380e263462f55c6b71a5682811854d2`,
  [protected GitHub run 41249209815](https://github.com/moealf12/Nawaa/actions/runs/41249209815):
  **2 real RED tests**, one for the recorded mainboard listing and one for an
  explicit mainboard title. A legitimate full HP EliteBook including a spare
  mainboard remains permitted.
- Production `detectedRetailPeripheral` classifies explicit mainboards/
  motherboards as accessory; additionally recognizes the verified exact part
  ID `L34280-601` before full-laptop inference.
- Independent `provisionalLabel` separately flags the component without
  borrowing NAWAA `exactMatch`, `matchConfidence`, displayed price, or rank.

## Certification limits
- Before the fix is deployed, the new rubric should correctly detect the
  old LIVE rank-one mainboard; that deliberately makes the old-base read-only
  audit RED rather than falsely passing.
- Only a subsequent audit **after** a new exact-SHA LIVE deployment can
  demonstrate the absence of that specific first-result defect.
- Query Q16's 8GB RAM laptop still precedes 16GB RAM candidates; this is a
  separate variant-ordering problem, not solved by mainboard classification.
- R04 remains IN_PROGRESS pending source completeness, independently graded
  broad ranking evaluation, browser DOM parity and storage/RAM correctness.
