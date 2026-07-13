## S14 · Material test & calibration

Products rated: KerfDesk, LightBurn, LaserGRBL, XCS (xTool Studio), Easel, Carbide Create.
N/R: MillMage — CNC-only (0.8.02, no laser); power×speed / interval / focus tests are laser features, N/R in this laser-only sector per the binding Phase-0 coverage note.
Pinned evidence: KerfDesk @ current `main` (this session's worktree); competitor versions per methodology.md — LightBurn 2.1.03 (Core $99 / Pro $199), MillMage 0.8.02, LaserGRBL 7.14.1 (dormant ~16 mo), xTool Studio (XCS successor) V1.7.x free, Easel web SaaS (Free/Starter/Pro), Carbide Create free (Pro paid).

| # | Category | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel | Carbide Create |
|---|----------|----------|-----------|----------|-----------|-----|-------|----------------|
| 14.1 | Power×speed test grids | 6 [CODE]¹ | 10 [OFF]² | N/R [OFF]³ | 2 [OFF]⁴ | 7 [OFF]⁵ | 0 [INF]⁶ | 0 [COMM]⁷ |
| 14.2 | Interval & focus tests | 5 [CODE]⁸ | 10 [OFF]⁹ | N/R [OFF]³ | 2 [OFF]¹⁰ | 2 [OFF]¹¹ | 0 [INF]¹² | 0 [INF]¹³ |
| 14.3 | Test customization | 5 [CODE]¹⁴ | 10 [OFF]² | N/R [OFF]³ | 0 [OFF]⁴ | 6 [OFF]⁵ | 0 [INF]⁶ | 0 [COMM]⁷ |
| 14.4 | Calibration round-trip | 5 [CODE]¹⁵ | 10 [OFF]¹⁶ | N/R [OFF]³ | 2 [OFF]¹⁷ | 6 [OFF]¹⁸ | 2 [OFF]¹⁹ | 2 [OFF]²⁰ |

¹ `src/core/job/material-test-grid.ts:71-133` (generateMaterialTestGrid; speeds→rows 89,93-100, powers→columns via powerScale 90,108-115, labels 129,159-182, counts clamped 1-20 17-18,72-73); `MaterialTestGridOptions` exposes only rows/cols/speed·power ranges/cell/gap/origin — no passes/interval axis (26-40); default 10×10 `src/ui/calibration/MaterialTestDialog.tsx:28-55`.
² https://docs.lightburnsoftware.com/2.1/Reference/MaterialTest/ · https://www.rabbitlaserusa.com/transform-your-projects-must-know-material-testing-in-lightburn
³ https://lightburnsoftware.com/products/millmage-core · https://docs.millmagesoftware.com/latest/Reference/OperationSettingsEditor/ (CNC-only op set; no material-test tool)
⁴ https://lasergrbl.com/test-file-and-samples/ (import-only fixed files; no in-app generator)
⁵ https://support.xtool.com/article/872 (Material Test Array: power×speed, min/max, count, spacing, editable header labels, vector+bitmap)
⁶ https://support.easel.com/hc/en-us/articles/360012848433 (feeds/speeds calculator; no power×speed grid — absence inferred, CNC scope)
⁷ https://community.carbide3d.com/t/carbide-create-feature-request-test-grid-generation/71552 (open request for a LightBurn-style N×M grid; users script external Python)
⁸ `src/core/job/interval-test-grid.ts:57-112` (interval sweep 1-20 steps, floor 0.05mm, burned labels); Focus Test permanently disabled `src/ui/commands/command-families.ts:308-317`; bonus scan-offset generator `src/core/job/scan-offset-calibration-pattern.ts:59-138`.
⁹ https://docs.lightburnsoftware.com/latest/Reference/IntervalTest/ · https://docs.lightburnsoftware.com/FocusTest.html (Interval Test + Z-ramp Focus Test)
¹⁰ https://lasergrbl.com/test-file-and-samples/depth-of-focus-test/ (fixed downloadable focus/accuracy files; no generator)
¹¹ https://support.xtool.com/article/1336 · https://support.xtool.com/article/37 (autofocus/manual measure; no interval-test or focus-ramp generator)
¹² https://support.easel.com/hc/en-us/articles/5360405175187-Using-the-Z-Probe (Z-probe zeroing, not a focus ramp; interval/focus laser-specific — inferred absent)
¹³ https://carbide3d.com/hub/courses/create/toolpaths/ (contour/pocket/drill/V-carve set; no interval/focus ramp — inferred absent)
¹⁴ `src/core/job/calibration-labels.ts:19-40,106-112` (7-seg digits/`.`/`-` only, no text/titles); safety clamps power 0-100 `material-test-grid.ts:72-73,252-254`, axes fixed (speed=rows, power=cols), no per-axis param choice.
¹⁵ `src/ui/laser/MeasuredScanOffsetApply.tsx:60-67` (Apply measured offsets → updateDeviceProfile scanningOffsets); material/interval→preset create path removed `DECISIONS.md:3508-3512` (ADR-047, wizard is sole authoring route).
¹⁶ https://docs.lightburnsoftware.com/latest/GetStarted/FirstMaterialTest/ · https://github.com/LightBurnSoftware/Documentation/blob/master/MaterialLibrary.md (apply best cell → Create new from layer → Material Library)
¹⁷ https://lasergrbl.com/usage/raster-image-import/import-parameters/ (no material library; manual re-entry of speed/power)
¹⁸ https://support.xtool.com/article/1865 · https://support.xtool.com/article/872 (winning array cell's power/speed saved as a user-defined material; no one-click)
¹⁹ https://inventableshardwaresupport.zendesk.com/hc/en-us/articles/34390465589268 (tested default cut settings + calculator; no test→setting round-trip)
²⁰ https://carbide3d.com/hub/courses/create/tool-library/ (tool library feeds/speeds per tool+material; not fed by a test)

### State of play

Material test and calibration is a **laser-native sector**, and the roster splits cleanly along that line. The three CNC tools contribute almost nothing: MillMage is scored N/R (CNC-only, no laser mode, so a power×speed grid or focus ramp has no meaning), while Easel and Carbide Create — which the audit design explicitly enrolls in S14 for the P2/P3 personas — are scored on the sector's laser-specific categories and, having no test-grid generator at all, land at 0 on 14.1–14.3. Both do offer a partial endpoint for 14.4 (Inventables-tested default cut settings / a tool-material feeds library), which is why they earn a token 2 there rather than 0. The real contest is a three-way race among KerfDesk, LightBurn, and XCS.

**LightBurn is the sector leader and the reference by a wide margin.** Its Material Test generator varies any of six parameters (Power/Speed/Interval/Passes/Frequency/Q-Pulse) on either axis, with separate material/text/border cut settings and preset export/import; it ships a second pair of Laser Tools generators (Interval Test and a true Z-ramp Focus Test); and it documents a manual round-trip that turns a winning cell into a named Material Library entry. It holds a 10 in all four categories. XCS is the credible middle: a mature, shipping two-axis Material Test Array with editable header labels, adjustable min/max/count/spacing, vector+bitmap cells, and a manual "save winning cell as a custom material" round-trip — solid, but two axes only and with no interval or focus generator.

**KerfDesk lands as a genuine but narrower material-test suite — ahead of the free/CNC field, behind LightBurn, and roughly level with (marginally behind) XCS.** Its power×speed grid (ADR-044) is well-built and tested: configurable rows/cols (1–20 clamp), cell size, gap and origin, burned numeric axis labels, and — usefully — it emits an ordinary Scene that flows through the normal preview/save/frame/start pipeline. But it is a **two-axis grid only** (no interval or passes axis, where LightBurn has six), its labels are **auto numeric-only** via a seven-segment renderer (no titles or text, where LightBurn and XCS allow custom labels), and every claim here is **CODE/TEST-level — no cell has ever been rendered-compared or burned** to confirm the labels are legible at small cell sizes or the chosen cells usable. Under the no-benefit-of-the-doubt rule that caps it at 6 on 14.1.

On 14.2 KerfDesk is genuinely split: the **Interval Test is functional** (interval swept over 1–20 steps with burned labels), and there is even a third, less-common calibration generator (a bidirectional scan-offset pattern) that neither the LightBurn nor XCS evidence shows — but the **Focus Test is a permanently-disabled stub**: the menu item exists and is hard-coded to `disabled('tools.focus-test', … 'needs a dedicated, hardware-verified Z-motion generator')`, and it never runs even when the profile advertises verified Z. Half the category is solid, half is entirely absent, netting a 5.

14.4 is the most nuanced cell. KerfDesk has a **fully-closed round-trip for scan-offset calibration** — burn the swatch, read each speed's best offset, type the pairs into Measured Scan Offset Apply, and the values are written into the active DeviceProfile (`scanningOffsets`, merged by speed) and applied deterministically at compile. That is a real, coupled loop. But for the **headline power×speed material test there is no round-trip at all**: the test-swatch→preset create path was deliberately removed (ADR-047, maintainer decision), leaving the Material Library wizard as the sole manual-entry route — the operator reads burned labels by eye and re-types. Because 14.4's core is *material test → saved material setting*, KerfDesk trails LightBurn (−5) and XCS (−1) on exactly the path a buyer expects, even though its niche scan-offset loop is arguably a differentiator. The removal is ADR-recorded, so per §5.6 it is a deliberate divergence, not an un-ADR'd bug — no severity bump.

Net: KerfDesk's S14 mean (~5.25) sits it firmly above the free-laser baseline (LaserGRBL, no in-app generators) and the CNC tools, but a clear tier below LightBurn and a shade behind XCS on the two-axis grid and the material-test round-trip.

### Where we win / where we lose

- WIN 14.1 (+6 vs Carbide Create) — KerfDesk generates a configurable power×speed material-test grid in-app; Carbide Create has none (open forum feature request; users script external Python). [verified: Carbide Create 14.1 = COMM]
- WIN 14.1 (+4 vs LaserGRBL) — KerfDesk generates grids in-app; LaserGRBL can only import and run fixed downloadable test files, generating nothing itself. [verified: LaserGRBL 14.1 = OFF]
- WIN 14.2 (+3 vs LaserGRBL) — KerfDesk ships a working interval-test generator; LaserGRBL only runs downloadable focus/accuracy files. [verified: LaserGRBL 14.2 = OFF]
- LOSE 14.2 (−5 vs LightBurn) — KerfDesk's Focus Test is a permanently-disabled stub (no Z-motion generator); LightBurn ships a working Z-ramp Focus Test → G-S14-1
- LOSE 14.4 (−5 vs LightBurn) — No automated path from a power×speed test cell to a saved material preset (removed per ADR-047); LightBurn and XCS both save a winning cell's settings → G-S14-2
- LOSE 14.1 (−4 vs LightBurn) — KerfDesk's grid varies only power×speed; LightBurn varies six parameters including interval and passes → G-S14-3
- LOSE 14.3 (−5 vs LightBurn) — KerfDesk labels are auto numeric-only (7-segment, no titles/text); LightBurn and XCS support editable text labels → G-S14-4

### Gaps feeding the register

- **G-S14-1 · 14.2 Focus test** — vs LightBurn (−5). Focus Test is a disabled stub with no Z-motion/focus-ramp generator; nothing to run even with verified Z. Documented-disable (not un-ADR'd). Severity **P2**, effort **M** (needs a hardware-verified Z-motion generator).
- **G-S14-2 · 14.4 Material-test → preset round-trip** — vs LightBurn (−5), XCS (−1). No path from a winning power×speed/interval cell to a saved material preset; removed by ADR-047 (deliberate). Severity **P2**, effort **M** (reintroduce create-from-swatch).
- **G-S14-3 · 14.1 Param-axis breadth** — vs LightBurn (−4). Grid varies only power×speed; no interval or passes axis (ADR-044, deliberate two-axis scope). Severity **P2**, effort **M**.
- **G-S14-4 · 14.3 Custom text labels** — vs LightBurn (−5), XCS (−1). Labels are auto numeric-only (7-segment); no titles, units, or text annotation. Severity **P3**, effort **S**.

### Not verified

- **No PERC / render / burn proof for any KerfDesk generator (14.1–14.3).** Grids, interval swatches, and labels have never been rendered-compared or burned; label legibility at small cell sizes and cell usability are unproven. Repo hardware ledger = CLAIMED. (14.1 is not a fidelity category, so 6 does not require PERC — but the perceptual gap is real and stated.)
- **Focus Test (14.2) is a disabled stub** — no Z-ramp output can be produced, so there is nothing to verify beyond "disabled."
- **14.4 round-trip unproven on hardware.** The scan-offset loop has never been closed on a machine (HW-CLAIMED); for material/interval tests the hand-off is manual transcription (read labels by eye, re-type), whose correctness is unmeasured.
- **Competitor cells anchored on [INF] cannot support win/lose bullets** — Easel 14.1/14.2/14.3/14.4 (absence inferred) and Carbide Create 14.2 (absence inferred). Wins above are anchored only on OFF (LaserGRBL) / COMM (Carbide Create 14.1) cells.
- **MillMage N/R** is taken from the binding Phase-0 coverage note plus official docs; not independently re-verified beyond those docs.
- **Scoping judgment:** Easel and Carbide Create are scored 0 (not N/R) on the laser-specific categories 14.1–14.3 — a rater call following the design's explicit S14 enrolment of Carbide Create and the P2 persona weighting, not a hands-on determination.
- **Whole-scene-replace** (KerfDesk replaces the scene with the generated grid) vs LightBurn's insert-at-job-origin behavior is not perceptually assessed.
