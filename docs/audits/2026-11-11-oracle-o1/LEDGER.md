# Oracle audit O1 — ledger

Plan and method: [AREAS.md](AREAS.md). Severity: AREAS §Severity (a mark that silently carries the wrong content or cannot be read is P1; an UNSOURCED oracle caps a finding at P2). "Contradicted" counts outside facts that the research verifier found wrong; in O3, O5, O6 and O8 those were claims in the oracle plan, corrected before they could become findings.

Every area read `origin/main` at `5c9441ba8` (batches 1–2) or a later main (batches 3–4; the date and commit are in each report). The coordinator re-read every P1 in main's code (see below).

**Final status (2026-11-12):** every P1 and P2 fix below has merged to `main`, except O1-P2-1 (#1780, closed unmerged; with the maintainer).

| # | Area | Report | Raised | Refuted | Contradicted | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|
| O1 | Barcode truth | [O1-barcode-truth.md](O1-barcode-truth.md) | 11 | 2 | 1 | 0 | 1 | 7 |
| O2 | File format truth | [O2-file-format-truth.md](O2-file-format-truth.md) | 14 | 0 (2 KNOWN) | 0 | 2 | 2 | 9 |
| O3 | Licensing and update trust | [O3-licensing-and-update-trust.md](O3-licensing-and-update-trust.md) | 8 | 1 | 4 | 0 | 0 | 7 |
| O4 | Nesting, box and parts geometry | [O4-nesting-box-geometry.md](O4-nesting-box-geometry.md) | 5 | 0 | 0 | 0 | 1 | 4 |
| O5 | Variables and batch production | [O5-variables-and-batch-production.md](O5-variables-and-batch-production.md) | 11 | 1 | 3 | 1 | 2 | 7 |
| O6 | Image maths truth | [O6-image-maths-truth.md](O6-image-maths-truth.md) | 6 | 1 | 1 | 0 | 1 | 3 |
| O7 | Text and font truth | [O7-text-and-font-truth.md](O7-text-and-font-truth.md) | 10 | 0 | 0 | 0 | 2 | 6 |
| O8 | Units, locale and numbers | [O8-units-locale-numbers.md](O8-units-locale-numbers.md) | 19 | 0 | 2 | 0 | 2 | 17 |
| O9 | Material library truth | [O9-material-library-truth.md](O9-material-library-truth.md) | 8 | 3 | 0 | 0 | 1 | 3 |
| O10 | Sketch constraints and design carve | [O10-sketch-and-design-carve.md](O10-sketch-and-design-carve.md) | 9 | 3 | 2 | 0 | 0 | 6 |
| O11 | Supply chain and licences | [O11-supply-chain-truth.md](O11-supply-chain-truth.md) | 18 (2 merged) | 1 | 0 | 0 | 0 | 15 |
| O12 | Research re-verify of C2, A2, CNC v2, v14 (39 outside claims: 33 verified, 2 contradicted, 4 unsourced) | [O12-research-reverify.md](O12-research-reverify.md) | 4 | 0 | 2 | 1 | 0 | 3 |
| **Total (O1–O12)** | | | **123** | **12** | **15** | **4** | **12** | **87** |

## Confirmed P1/P2

| ID | Summary | Coordinator check | Fix |
|---|---|---|---|
| O2-P1-1 | **Unclamped and periodic DXF SPLINEs import in the wrong shape** (2.4 mm on a 10 mm closed spline, 27 mm on a 100 mm open uniform cubic), with no note. AutoCAD's default closed spline is periodic, so ordinary files reach it. | **Agree.** Main's `flatten-spline-to-tolerance.ts` `bezierPieces` raises only knots strictly inside the domain, then reads every span's controls as Bézier controls, which holds only for clamped ends. | #1777 (merged) |
| O2-P1-2 | **GeoJSON export fills a hole** when the 0.001 mm grid snap moves one hole vertex across a slanted parent edge. | **Agree.** Main's `fill-region-rings.ts` `ringInside` returns on the first probe that is not on the boundary. | #1779 (merged) |
| O5-P1-1 | **A job finished through laser recovery repeats its serial number**: "After completed job" never advances after a clean recovery, so the next Start burns the same serial. | **Agree.** On main `armVariableStreamAdvancement` is called only from `start-job-transmission.ts`; the recovery flow rebuilds variable-text jobs (ADR-443 Amd 2) but arms no advance. | #1790 (merged; ADR-279 Amd 1) |
| O12-P1-1 | **On grblHAL with `$13=1`, the rotary A turn is read in inches as degrees** when A is not flagged rotary in `$376` (the Falcon A1 Pro ships `$376=0`). Start from line and the turn-back after Abort then aim 25.4× short of the turn the job started from, with no warning. A "not verified" item in v14 Z2 hid it. | **Agree.** On main `abort-rotary-turn.ts` `currentMachineTurn` and `laser-job-stop.ts` `rotaryStartTurnAtStop` scale Z by 25.4 under `reportInches` but return A raw, and `parse-settings.ts` never reads `$376`. **Research:** grblHAL `report.c` `get_axis_values_imperial()` multiplies every axis by `INCH_PER_MM` except an axis above Z whose bit is in `settings.steppers.is_rotary.mask` (fetched 2026-11-12). | #1810 (merged) |
| O1-P2-1 | A barcode whose module is narrower than its Fill line interval leaves whole module rows unburned and cannot scan; nothing warned. | Agree: main's only barcode warnings are the Data Matrix 144 × 144 scan check and a 0.2 mm dialog note. | #1780 was **closed unmerged** on 2026-11-11 18:53 UTC; open with the maintainer |
| O2-P2-1 | A SPLINE defined only by fit points was dropped with a misleading note. | — | #1784 (merged) |
| O2-P2-2 | An HP-GL file that sets speed, force or pen width was refused completely. | — | #1783 (merged; ADR-357 Amd 5) |
| O4-P2-1 | On a laser layer without a kerf offset, the Box Fit Test could not find a press fit. | — | #1793 (merged) |
| O5-P2-1 | Start from line burned the next serial and said only "a date or time" could differ. | — | #1790 (merged) |
| O5-P2-2 | Job Review could never confirm a job with a seconds field. | — | #1791 (merged) |
| O6-P2-1 | Image Gamma runs opposite to LightBurn, and two of three fields did not say so. | — | #1785 (merged) |
| O7-P2-1 | Basic-Latin text kerned against OpenType's rules (wrong script, first lookup only). | — | #1798 (merged; ADR-591 Amd 4) |
| O7-P2-2 | Bend and path text mapped only the ends of straight strokes, leaving chords. | — | #1800 (merged) |
| O8-P2-1 | Moshi flat-bed speeds ran at a different whole step with no note. | — | #1797 (merged) |
| O8-P2-2 | A decimal comma in DXF and ASCII STL numbers was silently truncated. | — | #1799 (merged; ADR-357 Amd 6) |
| O9-P2-1 | Applying a material preset kept the operation's cross-hatch, scan angle, angle step and fill ramp; saving a preset dropped them. | — | #1795 (merged) |

P3s and the items listed for the maintainer are in each area's report.

## What the oracles caught that self-checks could not

- **O2-P1-1:** the existing "periodic spline" test used a clamped knot vector, so test and code shared the wrong assumption. The closed-form uniform B-spline caught it.
- **O1:** every encoder was right; a decoder written from the ISO standards (and a second, third-party QR reader) agreed on more than 5,000 symbols. The defect was one step later, in how a Fill samples the modules.
- **O12:** re-fetching the primary sources behind four earlier audits confirmed every P1/P2 premise, but one item those audits had left "not verified" hid a P1 (O12-P1-1). An audit's "not verified" list is where its next defects are.
- **O3:** the research verifier corrected four facts in the oracle plan itself (Paddle's retry window, the meaning of `transaction.completed`, a missing adjustment action, NSIS install behaviour) before any finding rested on them.
