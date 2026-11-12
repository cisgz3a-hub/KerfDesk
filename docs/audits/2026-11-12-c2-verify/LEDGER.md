# C2 fix verification — ledger

Plan: [AREAS.md](AREAS.md). Severity follows C2:
- **P1:** harms a job, loses work or exposes a secret (METHOD §3), or lets such a defect reach `main` unchecked.
- **P2:** a real defect with limited harm. A test gap behind correct code is P2 at most.
- **P3:** structural.

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| E1 | Import and notice fixes (#1750, #1819, #1820, #1822, #1762) | origin/main @ 66a7a008c (auditor and refuter). The coordinator re-read ce6b84357: only #1777 (DXF SPLINE) touched these files, and `arcSweep` is unchanged. The C2 repros were re-run; Node scripts ran on the real modules, with pdf.js for PDF; the refuter used its own methods (path lengths, the `.rd` encoder's motion plan, real `importPostscriptFile`) | [E1-import-and-notice-fixes.md](E1-import-and-notice-fixes.md) | 10 | 0 | 4 | 3 | 3 | 0 |
| E2 | Link-route parity (#1751, #1753, #1763, #1818, #1823) | origin/main @ 52c545886 (auditor and refuter). The coordinator re-read 1065be2af: nothing under `core/controllers/lihuiyu`, `io/egv` or `ui/state/lihuiyu-usb` changed. The same jobs ran through G-code, `.rd`, Ruida UDP, Moshi, `.egv` and K40 USB, decoded byte by byte (the refuter wrote its own `.egv` reader and speed formula); the stores ran on the repo simulators; the registration guard was replayed over mock stores | [E2-link-route-parity.md](E2-link-route-parity.md) | 9 | 0 | 2 | 3 | 4 | 3 |
| E3 | Guards, tests and CI (#1808, #1827, #1828, #1829), plus the fixes merged since E1/E2 (#1831, #1832, #1833, #1836) | origin/main @ 8546953c6 (auditor and refuter). The coordinator re-read 3c713467d: the DXF and Job Review files are unchanged. D3's mutant harness was re-run against the tests #1829 names; the refuter used its own mutants and Vitest command, its own DXF files through the real import, its own `.rd` byte decoder and its own K40 speed formula. CI was measured with read-only `gh` over 2026-11-12 07:48–13:24 UTC (a small window) | [E3-guards-tests-ci.md](E3-guards-tests-ci.md) | 7 | 0 | 2 | 2 | 3 | 2 |
| E4 | E3's fixes (#1839, #1840, #1841) | origin/main @ 8d92bd143 (auditor and refuter). The coordinator re-read `dxf-curve-sampling.ts` there: `WHOLE_TURN_SNAP = 1e-4` turn. DXF text through the real import (both wrote their own); Job Review and the Frame gate on the GRBL simulator; `.rd` bytes decoded with each one's own reader against main before each fix; own mutants on the new tests | [E4-e3-fix-verify.md](E4-e3-fix-verify.md) | 5 | 0 | 1 | 0 | 4 | 2 |
| E5 | The DXF whole-turn fix (#1843) against the maintainer's "leave as written" decision | origin/main @ 0e1a476f5 (auditor and refuter). The coordinator re-read 4bf66022e: `ELLIPSE_WRAP_SNAP = 1.55e-3` turn. The auditor imported 1.80 M generated DXF files per tree through the real worker parse (start angles × fixed decimals 1–12 × significant digits 3–12 × rounding modes), on main and before #1843; the refuter used its own census, a closed-form count of the printing steps and its own mutants | [E5-dxf-whole-turn-verify.md](E5-dxf-whole-turn-verify.md) | 4 | 0 | 1 | 0 | 3 | 5 |
| **Total** | | | | **35** | **0** | **10** | **8** | **17** | **12** |

## C2 items verified

| C2 item | Fix | Status on main |
|---|---|---|
| D1-P2-4 PostScript straight rule | #1750 | Fixed (residual P3: E1-P3-1) |
| D5-P1-1 SECURITY (redacted) | #1819 | Fixed for its payloads; the bound is escaped by other inputs (E1-P1-1) |
| D5-P3-4 SECURITY (redacted) | #1819, #1820 | Fixed |
| D5-P1-2 DXF ARC over one turn | #1820 | Fixed; regression E1-P1-2 |
| D6-P3-3→P2 cross-hatch notice | #1822 | Fixed for Fill hatches (1,120 of 1,120 combinations match); Line strokes on drawn objects are E1-P2-3 |
| D2-P1-2 Ruida `.rd` rotary feed | #1762 | Fixed for dose (97.6–102.3 %); new E1-P2-2 and E1-P3-2 |
| D2-P3-5 Ruida rotary note | #1762 | Fixed (the controller's own behaviour is still unverified on hardware) |
| D1-P1-1/P1-2, D1-P2-2/P2-3/P2-5, D1-P3-1 Moshi raster, Ruida Frame, link guards, Abort | #1751, #1753, #1818 | Fixed (K40 home/jog Abort gap: E2-P3-1) |
| D1-P2-1 warnings only after send | #1753 | Fixed for Moshi and Ruida; the K40 twin is E2-P2-1 |
| D2-P1-1/P1-3, D2-P2-1..3 scope, scan offset, warnings, tabs, variable advance | #1763 | Fixed (K40 tab note: E2-P2-3) |
| D4-P1-1, D4-P2-1..3, D4-P3-1 K40 invisible to guards | #1818 | Fixed: every machine-work guard sees all three link stores |
| D6-P1-1, D6-P1-3, D6-P2-1..3, D6-P3-4 K40 scope, scan offset, warnings, autosave, first job | #1823 | Fixed; K40 USB bytes equal Save `.egv` |
| D6-P1-2 K40 rotary feed | #1823 | Fixed in mechanism (Y strokes get their own speed); the whole-mm/s rounding is E2-P1-1 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| E1-P1-1 | E1 | **SECURITY: the bound added by #1819 can be escaped (CWE-835 / CWE-400).** Redacted until fixed. A small crafted import still holds the window thread for minutes. | **READ** on main `ce6b84357` (location held privately). Auditor and refuter **REPRO**, with details in the coordinator's scratchpad only. | **fixed by #1831** (ADR-700 Amd 3). E3's auditor and refuter re-ran every E1 payload and their own new ones: all end bounded |
| E1-P1-2 | E1 | **A DXF full circle written as ARC `s → s + 360` can import as a near-zero arc** (a regression from #1820). After decimal rounding the difference can be one ulp over 360°, and `% 360` then leaves a dot. 152.2→512.2 burns 0 mm, where it burned 125.6 mm before the fix. This affects 10–12 % of start angles given to 0.1°, 0.01° or 0.001°. There is no note, and a cut-out loses its outline. | **READ** on main: `dxf-entities.ts` `arcSweep` sends any difference over 360° to `sweepDeg % 360` with no tolerance for a whole turn. Auditor and refuter **REPRO** (G-code and path length; pre-fix comparison). | **mostly fixed by #1832**: E1's repros pass (none of about 551,000 cases collapse). The residual for angles printed to 6–12 significant digits is E3-P1-2 |
| E1-P1-3 | E1 | **PostScript and Illustrator 3–8 zero-width (hairline) strokes are dropped.** In PostScript, width 0 means the thinnest line, but the converter writes `stroke-width="0"`, which SVG treats as unpainted. With any other stroked or filled artwork in the file, the import reports success and the hairline outline is gone. A file with only hairlines is refused. This predates the verified fixes. | **READ** on main: `ps-svg.ts` writes `num(path.strokeWidth)` unchanged. Auditor and refuter **REPRO** (real `importPostscriptFile`). | **fixed by #1832** (E3 re-ran the repros) |
| E1-P1-4 (refuter) | E1 | **PDF zero-width strokes are dropped from "Editable paths" without a note** (the PDF twin of E1-P1-3). The dialog thumbnail shows the outline, while the canvas and the job lack it. | **READ** on main: `pdf-vector-page.ts` writes `stroke-width` from `state.width` unchanged. Refuter **REPRO** (real pdf.js operator list). | **fixed by #1832** (E3 re-ran the repros) |
| E1-P2-1 | E1 | **A DXF ELLIPSE with parameters past one turn still clamps to a full ellipse**, unlike the fixed ARC. It is unchanged from before the fix. | Auditor and refuter **REPRO**. | **fixed by #1832** for E1's cases; its whole-turn tolerance caused the regression E3-P1-1 |
| E1-P2-2 | E1 | **The `.rd` speed-class split burns each rotary stroke in many out-of-order pieces.** One 30 mm circle becomes 30 parts with 1.5 m of laser-off travel and 60 rotary reversals, against 2 on a flat bed. The ETA shows 11.0 s where the moves take 43.6 s. Seams on hardware are unverified. | Auditor (decoded bytes) and refuter (encoder motion plan, app clock) **REPRO**. | **partly fixed by #1833** (ADR-127 Amd 7): the ETA now matches the `.rd` route and laser-off travel fell 45–58 %, but rotary reversals rose (E3-P2-2) |
| E1-P2-3 (refuter) | E1 | **The old-project rotary notice still gives the worst case (6.28×) for Line strokes on drawn (non-imported) objects.** A pen-tool horizontal line compiles to 1.00× and a 45° line to 1.40×. This is D6-P3-3's symptom outside #1822's Fill fix. | Refuter **REPRO**; **READ** `old-project-rotary-feed.ts` `outlineAngles` returns "round the part" for any object that is not `imported-svg`. | **fixed by #1833** |
| E2-P1-1 | E2 | **On a Y-port rotary the K40 rounds every burn to whole mm/s and never says what that does to the dose.** Round-the-part strokes burn at 17–127 % of the set dose (32 / 80 / 80 / 106 % at 120 / 300 / 600 / 1,200 mm/min on Ø80 glass). The Moshiboard route announces the same band, and K40 speed codes do not need whole mm/s: they resolve fractional speeds to within 0.2 %. From #1823. | **READ** on main `1065be2af`: `lhy-encoder.ts:180` `matchedMmPerSec` returns `Math.max(1, Math.round(feed / 60))`; `egv-advisories.ts` has no dose note. Auditor and refuter **REPRO** (decoded `.egv`; the refuter used its own reader and speed formula). | **fixed by #1836** (ADR-703 Amd 2). E3 re-ran the E2 repros: rotary dose 101.6–102.2 %, the slow-speed floor named, warnings from the Frame, the row check and the tab note present |
| E2-P1-2 (refuter) | E2 | **A K40 layer slower than 23.49 mm/min burns at 23.49 mm/min, unannounced.** 6 / 12 / 20 mm/min decode as 23.49 mm/min, i.e. 26 / 51 / 85 % of the set dose. The Moshi route names its speed step (ADR-705 Amd 5); the layer Speed input accepts 1 mm/min. | **READ** on main: `lhy-speed-code.ts:90` clamps the code at the board's slowest period with no note; `CutSettingsCommonFields.tsx:43` `min={1}`. Refuter **REPRO** (own `.egv` reader). **Rating:** P1 under METHOD §3 (a silent wrong dose, no reach clause). The Moshi twin O8-P2-1 was rated P2; the narrow reach is noted, not used to lower it. | **fixed by #1836** (ADR-703 Amd 2). E3 re-ran the E2 repros: rotary dose 101.6–102.2 %, the slow-speed floor named, warnings from the Frame, the row check and the tab note present |
| E2-P2-1 | E2 | **The K40 panel shows its job warnings only once Start is sending** (D1-P2-1's K40 twin, which #1753 fixed for Moshi and Ruida). Frame shows 0 warnings; Start shows 2. | **READ** on main: `lihuiyu-usb-store.ts:243` `advisories: frame ? [] : job.advisories`. Auditor and refuter **REPRO** (store and rendered panel). | **fixed by #1836** (ADR-703 Amd 2). E3 re-ran the E2 repros: rotary dose 101.6–102.2 %, the slow-speed floor named, warnings from the Frame, the row check and the tab note present |
| E2-P2-2 | E2 | **K40 Y-rotary Fill and Image rows get no row-grid check.** On Ø80 glass, 100 Image rows burn as 63 machine rows and 100 Fill lines as 34, while the Moshi route warns on the identical grid. | **READ** on main: `moshi-usb-job.ts:53` calls `detectRotaryRowGridWarnings`; nothing under `ui/state/lihuiyu-usb` or `io/egv` does. Auditor and refuter **REPRO**. | **fixed by #1836** (ADR-703 Amd 2). E3 re-ran the E2 repros: rotary dose 101.6–102.2 %, the slow-speed floor named, warnings from the Frame, the row check and the tab note present |
| E2-P2-3 | E2 | **The K40 power note does not name burned tabs** (D2-P2-2's K40 twin). A tabbed cut on a K40 burns through its tabs with no note, where Moshi and `.rd` say so. | **READ** on main: `egv-advisories.ts` has no tab text. Auditor and refuter **REPRO**. | **fixed by #1836** (ADR-703 Amd 2). E3 re-ran the E2 repros: rotary dose 101.6–102.2 %, the slow-speed floor named, warnings from the Frame, the row check and the tab note present |
| E3-P1-1 | E3 | **A full DXF ELLIPSE whose end parameter is 2π rounded up imports as a 0 mm dot, with no note** (a regression from #1832). `0 → 6.28319`, `6.2832` or `6.28318531` gave a closed 138 mm outline before #1832. Radians printed to 4–10 fixed decimals collapse in 31–85 % of cases, including plain `%f` (31 %). | **READ** on main `3c713467d`: `dxf-curve-sampling.ts:77` `TURN_TOLERANCE = 1e-12`, so `counterClockwiseSweep` keeps a remainder of 3.5e-6 rad as the sweep, while `isFullEllipseSweep` (`:73`) uses 1e-9. Auditor and refuter **REPRO** (real UI import; the refuter compared main before #1832). | **partly fixed by #1839** (ADR-700 Amd 4): no ellipse written to 4 or more decimals or 5 or more significant digits collapses. The residual for 1–3 decimals and 3–4 significant digits is E4-P1-1 |
| E3-P1-2 | E3 | **A DXF ARC `s → s + 360` printed to 6–12 significant digits still imports as a dot in 4.4–13.2 % of cases** (the residual of E1-P1-2; #1832 halved it from about 23 %). | **READ** as E3-P1-1 (the same 1e-12 tolerance in degrees). Auditor and refuter **REPRO**. | **fixed by #1843** (ADR-700 Amd 5): no full ARC written to 2+ decimals or 4+ significant digits collapses under nearest, truncated or floored printing (E5 census) |
| E3-P2-1 | E3 | **Job Review's reuse check never sees camera facts.** Turning camera placement on, or confirming a camera position, while the review is open does not force a recompile, so Confirm binds a bundle with 4 warnings where a fresh compile has 5: the camera warning is missing. Every camera fact in the key only produces warnings, so the burned bytes cannot differ. | **READ** on main: `job-review-gate.ts:446-449` carries `previousBundle.preparedMachineInputsKey` forward whenever the compile is reused. Auditor **REPRO**; refuter trace. The phone review already compares the stored key. | **fixed by #1840** (ADR-345 Amd 1): Confirm recompiles on a camera change (5 = 5 warnings) and nowhere else (0 extra compiles); the phone review cannot confirm |
| E3-P2-2 | E3 | **#1833's `.rd` rotary piece order cut laser-off travel but raised rotary reversals**: 60 → 66 per circle and 192 → 374 for 8 rings. Reversals while lit fell in 6 of 8 cases; pieces entered against the rotary's last direction improved for single outlines and rose for clusters such as text (108 → 134; 96 → 175 on a roller). Seams on hardware are unverified. | Auditor (encoder motion plan) and refuter (own `.rd` byte decoder) **REPRO**, before and after #1833. | **fixed by #1841** (ADR-127 Amd 8): rotary turns at or below path order and no wrong-way starts except at a part's Y edge (E4-P3-2); flat-bed and rotary-off `.rd` bytes unchanged. Roller travel rose (E4-P3-3) |
| E4-P1-1 | E4 | **A full DXF ELLIPSE written to 1–3 decimals or 3–4 significant digits still imports as a 0.01–0.13 mm dot, with no note** (the residual of the #1832 regression E3-P1-1). `−3.142 → 3.142` collapses every time; across start angles 83 / 32 / 19 % at 1 / 2 / 3 decimals and 41 / 27 % at 3 / 4 significant digits. None collapsed before #1832. | **READ** on main `8d92bd143`: `dxf-curve-sampling.ts:85` `WHOLE_TURN_SNAP = 1e-4` turn; `−3.142 → 3.142` leaves a remainder of 1.30e-4 turn, so `counterClockwiseSweep` keeps it as the sweep. Auditor and refuter **REPRO** (real import, own DXF text, before-trees). | **fixed by #1843** (ADR-700 Amd 5) for nearest, truncated and floored printing at 2+ decimals or 4+ significant digits; 1-decimal and 3-significant-digit files import as written, by the maintainer's decision. The round-up residual is E5-P1-1 |
| E5-P1-1 | E5 | **A full DXF ELLIPSE written to 4 significant digits and rounded up still imports as a dot, with no note.** `3.717 → 10.01` imports as a 0.19–0.34 mm dot (a closed 138–242 mm outline before #1832), in 0.76 % of starts in [0, 2π). Only directed rounding reaches it: nearest rounding (`%.4g`, `toPrecision`, Python, .NET `G4`) and truncation give 0 %. The printed miss, 0.009815 rad, is inside ADR-700 Amd 5's own "less than 0.01" bound. | **READ** on main `4bf66022e`: `dxf-curve-sampling.ts:93` `ELLIPSE_WRAP_SNAP = 1.55e-3` turn (0.009739 rad); `3.717 → 10.01` misses a turn by 1.5621e-3 turn. Auditor and refuter **REPRO** (real import, worker path, INSERT placements). **Rating:** P1 under METHOD §3 (silent loss, no reach clause), with very narrow reach. | routed to the EPS/AI import session (local_de13cd2d), which wrote #1843. Fix (refuter): `ELLIPSE_WRAP_SNAP` = 1.568e-3 turn. Anything in 1.563e-3–1.575e-3 closes every fine printing in every rounding mode and keeps the pinned `0 → 2π + 0.0099` short; all 171 DXF tests pass at 1.568e-3. Add directed-rounding rows to the sweep test: the ARC ÷3 and ELLIPSE 1.1e-3 mutants survive today |

### P3s (17)

- **E1-P3-1:** a near-straight PostScript rule between 1e-6 and about 1.4e-6 pt tall still imports nothing. The threshold and the rounding disagree.
- **E1-P3-2:** the `.rd` advisory blames a Max-feed hold (up to 367 % dose) on the speed classes. The range is right and shown before output; the cause is misnamed.
- **E1-P3-3:** a legitimate 1.9 M-point EPS uses 61–80 % of the new 5 s limit, so a slower PC refuses it with "may loop forever".
- **E2-P3-1:** Ctrl+. and the link bar's ABORT MOTION do nothing while the K40 homes or jogs.
- **E2-P3-2:** a new link store can still skip the registry, the link job request and the job warnings. The registration guard matches folder names, and the JCZ route (#1725, open) is not in it.
- **E2-P3-3:** a third copy of the preflight adapter, a React duplicate-key warning in the K40 panel, and no K40 air note.
- **E2-P3-4:** header comments still describe a world with two link routes.
- **E3-P3-1:** `main-is-green` gives the right verdict but late: the sync waits for a runner (stale green up to 19.7 min), a fix keeps main "red" until its own main run completes, the text names one commit for both workflows, a 30-run window can return `error`, and any session can set `fixes-main`.
- **E3-P3-2:** the camera guard divides camera samples by all samples, so a camera task that is mostly GC or native work passes.
- **E3-P3-3:** after the part is turned on Z, a Z-rotary's first Start is refused with "Frame the job again"; the second Frame works (reproduced on the GRBL simulator). **Fixed by #1840** (ADR-695 Amd 5): one Frame now suffices, and Z is ignored only on an active Z rotary.
- **E4-P3-1:** by ADR-700 Amd 4's design, an arc within 1e-4 of a turn of closing now closes (`0 → 359.99°`). The gap is R × 6.3e-4, which after a 0.1–0.2 mm kerf only leaves a bridge above a radius of about 160–320 mm, and then one too thin to hold a part.
- **E4-P3-2:** a `.rd` rotary piece that starts at its part's Y edge still starts against the rotary (the approach stays inside the part's Y range by design); the counts equal those before #1841. ADR-127 Amd 8's "no wrong-way starts" is too broad.
- **E4-P3-3:** on a k > 1 roller, multi-piece `.rd` jobs travel up to 42 % more than path order, and their ETA rose 37–58 % against main before #1841 (ADR-127 Amd 8 says up to 2 %). The ETA is accurate; the cost is time only.
- **E4-P3-4:** the new tests do not pin the Frame exemption's narrowness: Z left out for every job, and Y dropped too, both survive 12 Frame test files. Reusing a bundle with no key and a near-full snap three times wider also survive. The Start review's stored key is covered (20 tests kill its mutant).
- **E5-P3-1:** some coarse files still close against the literal "leave as written": 38 % of ELLIPSEs at 3 significant digits and 4 % of ARCs at 3 significant digits. Between 1 and 10 rad a 3-significant-digit printing is the same text as a 2-decimal one, so the decision cannot be met literally; 92–98 % of these closures are such text. No job harm found.
- **E5-P3-2:** a whole turn whose printed end rounds short, written less than a turn apart, stays open: `−3.14 → 3.14` always, and 68 % of ELLIPSEs at 2 decimals. The gap is 0.32 mm at R = 100, a microjoint-sized bridge after the kerf. Unchanged since before #1832 and announced in the ADR. **Maintainer question:** should a symmetric pair such as −π → π close?
- **E5-P3-3 (refuter):** very large angles printed to 4 significant digits still collapse under nearest rounding: ARC starts of 640° or more (`640.5 → 1001`) and ELLIPSE parameters of 100 rad or more. At those sizes 4 significant digits is 0–1 decimals, which the decision leaves as written.

### Verified clean

- **#1750:** the horizontal, vertical, rotated, scaled, fill-only, zero-height-bbox and thick-stroke rules all import.
- **#1820:** negative, equal, huge, NaN and Inf angles; −Z extrusion; the `s → s − 360` noise case, which collapsed before the fix and now does not.
- **#1822:** 1,120 of 1,120 Fill combinations match the compiled strokes.
- **#1762:**
  - flat-bed and rotary-off `.rd` bytes are identical to before the fix;
  - doses are within the announced bands;
  - the 100-part limit retries, then refuses clearly;
  - passes do not multiply parts.
- **Vitest:** the fixes' 7 test files pass (75 tests).

### E2 verified clean

- **Scope and anchor parity** on all six routes; Moshi refuses non-Absolute placement.
- **Byte identity:** Ruida UDP equals Save `.rd`, and the K40 USB stream equals Save `.egv`.
- **Fill and Image parity** with G-code on Moshi and K40: scan offset (layer and table), Dot width and overscan, within 0.15 % on the K40 (1/1000 in rounding), including passes, cross-hatch and 45°.
- **Job warnings, bed and no-go checks** on all six routes; the variable advance on all three link stores, not after a Frame.
- **Every machine-work guard** (Ctrl+., close, Update, drop, keep-awake, crash, autosave, unload) sees Moshi, Ruida and K40.
- **Z and A rotary** are refused on `.egv`, K40 USB and Moshi with a clear reason.

### E3 verified clean

- **#1829:** all 20 targeted D3 mutants are killed by the tests it names, plus 3 auditor variants and 5 refuter mutants. D3-P3-7 stays open: the simulators still model no motion time, arcs or open-port write failure.
- **#1827:** the Abort guard's inherited-name bug is fixed; `generate.mjs` alone selects 12 specs, not 141, and PRs in the window selected 11–15; every job has `timeout-minutes`. Playwright `globalTimeout` is still missing.
- **#1828:** it reports the last completed verdict and marked every open PR red after main went red. It is **not yet in force**: ruleset 19573147 does not require it and the `fixes-main` label does not exist, so 7 merges landed on a red main on 2026-11-12.
- **#1808:** synthetic camera tasks at 60–100 % camera samples fail the guard, and job renders pass; the base64 decode cache is correct.
- **#1831 (security), #1836 (K40):** fixed, as the E1 and E2 rows say. #1836 also fixed E2-P3-1: Abort during a K40 home or jog resets the board in about 85 ms.
- **CI over 5.6 h:** main was red 46 % of the time; CI completed on 8 of 34 main commits and Browser smoke on 3 of 33; no job came near its new time limit.

### E4 verified clean

- **#1839:** genuine arcs within one turn, sweeps over a turn, negative, NaN and Inf angles, partial ellipses and polyline bulges are unchanged; `isFullEllipseSweep` agrees with the sweep rule in 200,000 random cases.
- **#1840:** a camera change at an open review recompiles, with no other extra compile; the phone review reuses the desktop snapshot only while the key matches and cannot confirm or start; the Frame gate still refuses a Z change on a non-rotary, Y- or A-rotary job and an X/Y change on a Z rotary.
- **#1841:** flat-bed and rotary-off `.rd` files are byte-identical to before; lit length, dose per speed and bounds are unchanged; no approach move lights the laser or leaves the bounds; the ETA equals the decoded route; encoding is faster (642 ms against 2,116 ms for 800 rings).

### E5 verified clean

- **#1843 against the decision:** no full ARC or ELLIPSE written to 2+ decimals or 4+ significant digits collapses under nearest, truncated or floored printing, and every such pair at least a turn apart imports closed. ELLIPSE at 1 decimal imports as written in every rounding mode.
- **Genuine arcs:** arcs less than a turn apart are bit-identical to before #1843 (106,387 imports and 594,728 rule pairs across both checks); the test-pinned short cases stay short; `isFullEllipseSweep` agrees with the sweep in 2.3 M random pairs.
- **Every entry point:** INSERT and MINSERT blocks (mirrored, rotated, scaled, −Z, inches), the phone and MCP import and re-import all use the same rule; KerfDesk's own DXF export writes only polylines.
- **The new sweep test** kills 11 of 16 auditor mutants and the E4 refuter's surviving D2.

### Not verified

- **Hardware:** Ruida rotary seams, backlash and real idle speed; K40 speed-code timing, diagonal speed and whether a K40 speed change stops the head.
- **Browser:** no browser run. The window-thread effect of E1-P1-1 is from READ plus Node timings.
- **Real exporters:** their ARC full-circle, ELLIPSE-parameter and zero-width-stroke habits. Nothing in the repo shows them, and nothing was downloaded.


## Round result (2026-11-12)

**Totals:** 35 raised, 0 refuted, P1 10, P2 8, P3 17, 12 KNOWN, across E1–E5.

**What the round found.** All of C2's fixes hold for the cases C2 measured, and every E1 and E2 P1 or P2 was fixed within the day. The new findings sit at the edges of each fix:
- a security bound that other inputs could escape (E1, fixed by #1831);
- the K40 route repeating Moshi's whole-mm/s rounding and its own speed floor without notes (E2, fixed by #1836);
- a whole-turn tolerance too tight for decimal-printed angles, which turned a fix into a regression (E3-P1-1);
- a piece order that traded laser-off travel for rotary reversals (E3-P2-2).

**Fixed on main:** #1831, #1832, #1833 and #1836 (E1 and E2), on top of C2's #1808, #1827, #1828 and #1829.

**Open:**
- E5-P1-1 (one constant: `ELLIPSE_WRAP_SNAP` 1.55e-3 → 1.568e-3 turn), routed to the EPS/AI import session;
- the P3s (17) and D3-P3-7 (simulators without motion time) for a sweep;
- the maintainer question in E5-P3-2.

**E4 (re-check of E3's fixes, added 2026-11-13).** #1840 and #1841 hold, with no collateral change. #1839 fixed the common formats but not 1–3 decimals, so the DXF whole-turn rule has now needed three passes (#1820, #1832, #1839). A fourth pass should come with a test that sweeps start angles and print formats, not single cases.

**E5 (the DXF whole-turn fix, added 2026-11-13).** #1843 meets the maintainer's decision for every printing a normal formatter produces, and genuine arcs are bit-identical to before. The one residual (E5-P1-1) is a constant set 0.6 % below the ADR's own bound; its sweep test now samples start angles and print formats, but not directed rounding.

**Maintainer actions:**
- add `main-is-green` to ruleset 19573147 and create the `fixes-main` label: until then the check only reports;
- D7-P2-3 (runner capacity) is unchanged: only a quarter of main commits got a CI verdict in this window.

**Structural direction.** One shared numeric rule per geometric question (a whole turn, a full ellipse), with tolerances sized for printed decimals rather than for floating-point noise; and order-sensitive output (piece order, rotary direction) measured by a test that counts reversals, not only travel.