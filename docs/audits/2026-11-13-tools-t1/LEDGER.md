# Tools one-by-one audit T1 — ledger

Plan: [AREAS.md](AREAS.md). Severity: P1 harms a job, loses work or exposes a secret; P2 is a real defect with limited harm; P3 is wording, tidiness or a test gap.

| # | Tool | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| T01 | Material Test | origin/main @ 8d92bd143 (auditor and refuter); the coordinator re-read 8d92bd143. jsdom Vitest scripts on the real dialog, generator and `prepareOutput` → G-code path; the auditor decoded every cell's F and S across `$30` 255/100/1, a session `$30` override, fractional feeds and ceilings, Line and Fill, all origins, 1×1 to 20×20 and a rotary chuck; the refuter ran an inch-mode unit census of all five calibration dialogs and the layer Speed box | [auditor](T01-material-test.md), [refuter](T01-material-test-refuter.md), [evidence](evidence/T01/) | 8 | 0 | 0 | 0 | 8 | 0 |
| T02 | Interval Test | origin/main @ 8d92bd143 (auditor and refuter); the coordinator re-read 970349413. jsdom Vitest scripts on the real dialog, generator and `prepareOutput` → G-code path; the auditor measured every swatch's scan-line Y step with its own decoder (bidirectional, scan offset, overscan, rotary chuck, inch display); the refuter enumerated all 3,001 intervals the generator can produce from the dialog and decoded 0.06 / 0.0635 / 0.07 mm swatches | [auditor](T02-interval-test.md), [refuter](T02-interval-test-refuter.md), [evidence](evidence/T02/) | 4 | 0 | 0 | 1 | 3 | 5 |

Every Material Test cell burns exactly the F and S its labels state, with no stray burns and no label overlapping a cell. The October repair (fractional feeds such as 0.125 appear exactly in labels and operation names) still holds.

Every Interval Test swatch burns at the line interval its label states (0.116316 mm requested gives a mean decoded step of 0.116316 mm). The October label repair still holds.

## Confirmed P1/P2 (coordinator-verified)

| ID | Tool | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| T02-P2-1 | T02 | **The Interval Test refuses DPI line pitches.** Min and Max interval took only multiples of 0.01 mm from 0.05, so 0.0635, 0.0847 and 0.127 mm (400/300/200 DPI) and 0.125 mm were refused with "use increments of 0.01", though Cut Settings (`step="any"`) and the generator accept them. No decision behind it: the step began as an HTML spinner step (fba24ad64) and #730 made it a hard rule. 0.0635, 0.0508 and 0.1016 cannot be reached by any Min/Max/Steps combination. Users who set density in lines per inch or import LightBurn libraries are the ones blocked; shipped defaults sit on the 0.01 grid. | **READ** on main 970349413: `IntervalTestDialog.tsx:48-49` (`step: 0.01`) and `calibration-draft-validation.ts` (refuses a value off min + k·step). Auditor and refuter **REPRO** (dialog refusal; refuter decoded a 0.0635 mm swatch: mean step 0.063496 mm). | **fix PR #1845** (both boxes take any value ≥ 0.05; DPI-pitch regression tests fail on main) |

## P3 and severity changes

| ID | Tool | Summary | Owner |
|---|---|---|---|
| T01-P2-1 → **P3** | T01 | **Material Test boxes show no unit when Settings → Units is Inches**, so typing 40–120 meaning in/min burns at F40–F120 (25.4× slower). The refuter lowered it to P3 and the coordinator agrees: ADR-629 decision 5 keeps dialogs in mm in its first increment, and the dialog states mm three times before Generate (preview header `Speed (mm/min)`, `Cells: … mm`, `Requested … mm/min`). Only the per-box `mm` label that decision 3 requires is missing. Same level as C8-P3-3 and U8-P3-4. Coordinator READ on 8d92bd143: `CalibrationNumberField.tsx:16-23` renders `props.label` alone, as label, aria-label and title. | P3 sweep |
| T01R-P3-1 | T01 (also T02, T04) | The same missing unit on 20 boxes: Material Test 8, Interval Test 6, Scan Offset Test 6 (its two speed boxes do say mm/min). Tone Calibration and Focus Test already name units. Fix: add the unit to the label strings, as those two do. T02 and T04 count this as known. | P3 sweep |
| T01R-P3-2 | T01 | The boxes refuse typed units and inch-sized values: `0.25in` reads "enter a number"; `6.35` (¼ in) and a `3.175` gap are refused with "use increments of 0.1". Same pattern as the known L2-P3-5 on another surface. | P3 sweep |
| T01-P3-1 | T01 | Burned labels always run at 20 % and 1500 mm/min (F600 on a 600 mm/min profile) and cannot be changed or turned off. LightBurn gives labels their own settings and an on/off switch. | maintainer decision (adds controls) |
| T01-P3-2 | T01 | Generate replaces the whole design without saying so. Undo restores it exactly, but the Material Library experiment created on Generate survives Undo, and two Generates leave two experiments. | P3 sweep (notice wording); dropping the experiment on Undo is a maintainer decision |
| T01-P3-3 | T01 | Power labels show two decimals while the controller's S steps are coarser: 10–12 % over 10 columns at `$30`=100 burns 3 distinct S values under 10 different labels. | maintainer decision (label wording) |
| T01-P3-4 | T01 | With a fractional profile ceiling (1234.9 mm/min) the feed note says "effective 1,000–1,234.9" while the card burns F1234. READ ONLY for the auditor; the refuter reproduced it (T01R-P3-3). | P3 sweep |
| T01R-P3-3 | T01 | In that capped case 8 of 10 rows burn identical settings with no warning; Scan Offset warns in the same situation. | P3 sweep |
| T02-P3-1 | T02 | Max interval has no upper bound (20 and 1e9 are accepted). A swatch spaced wider than itself burns no lines under its label: 3–10 mm on 2 mm swatches burns 0 lines in the "10.00" and "6.50" swatches, with no warning. Material Test and Cut Settings cap the interval at 10 mm. | P3 sweep (cap at 10 mm; warn when the interval is over half the swatch) |
| T02-P3-2 | T02 | The feed note shows an unfloored "effective 1,234.9 mm/min" under a fractional profile ceiling, while the label, layer name and F say 1234. Twin of T01-P3-4. | P3 sweep (fix with T01-P3-4) |
| T02R-P3-1 | T02 | Interval Test captures no Material Library experiment, though `docs/implementation/xtool-workflows-20261007.md:45` (KXS-01) says experiments are captured from Material and Interval Test. Only `MaterialDialog` calls `captureGridExperiment`; `IntervalDialog` (`CalibrationGridDialogs.tsx:15-35`) never has. Refuter **REPRO**: Material Test Generate gives 1 experiment, Interval Test Generate gives 0. | P3 sweep (capture per swatch, or correct the doc) |
