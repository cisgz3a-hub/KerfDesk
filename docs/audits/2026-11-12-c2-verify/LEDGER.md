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
| **Total** | | | | **26** | **0** | **8** | **8** | **10** | **5** |

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
| E3-P1-1 | E3 | **A full DXF ELLIPSE whose end parameter is 2π rounded up imports as a 0 mm dot, with no note** (a regression from #1832). `0 → 6.28319`, `6.2832` or `6.28318531` gave a closed 138 mm outline before #1832. Radians printed to 4–10 fixed decimals collapse in 31–85 % of cases, including plain `%f` (31 %). | **READ** on main `3c713467d`: `dxf-curve-sampling.ts:77` `TURN_TOLERANCE = 1e-12`, so `counterClockwiseSweep` keeps a remainder of 3.5e-6 rad as the sweep, while `isFullEllipseSweep` (`:73`) uses 1e-9. Auditor and refuter **REPRO** (real UI import; the refuter compared main before #1832). | routed to the EPS/AI import session (local_de13cd2d), which wrote #1832. Fix (refuter's correction): when the angles are more than a whole turn apart, snap a remainder within 1e-4 to 1e-3 of a turn to a full turn; a genuine tiny arc within one turn stays as it is. One rule for ARC and ELLIPSE |
| E3-P1-2 | E3 | **A DXF ARC `s → s + 360` printed to 6–12 significant digits still imports as a dot in 4.4–13.2 % of cases** (the residual of E1-P1-2; #1832 halved it from about 23 %). | **READ** as E3-P1-1 (the same 1e-12 tolerance in degrees). Auditor and refuter **REPRO**. | routed with E3-P1-1 (one fix) |
| E3-P2-1 | E3 | **Job Review's reuse check never sees camera facts.** Turning camera placement on, or confirming a camera position, while the review is open does not force a recompile, so Confirm binds a bundle with 4 warnings where a fresh compile has 5: the camera warning is missing. Every camera fact in the key only produces warnings, so the burned bytes cannot differ. | **READ** on main: `job-review-gate.ts:446-449` carries `previousBundle.preparedMachineInputsKey` forward whenever the compile is reused. Auditor **REPRO**; refuter trace. The phone review already compares the stored key. | routed to the D3 tests session (local_b6d551c4), which found it. Fix (refuter's correction): compare the stored `preparedMachineInputsKey` with the live key before reusing; keeping the old camera object would still miss "camera may have moved" |
| E3-P2-2 | E3 | **#1833's `.rd` rotary piece order cut laser-off travel but raised rotary reversals**: 60 → 66 per circle and 192 → 374 for 8 rings. Reversals while lit fell in 6 of 8 cases; pieces entered against the rotary's last direction improved for single outlines and rose for clusters such as text (108 → 134; 96 → 175 on a roller). Seams on hardware are unverified. | Auditor (encoder motion plan) and refuter (own `.rd` byte decoder) **REPRO**, before and after #1833. | routed to the rotary-speed session (local_203c64d8), which wrote #1833. Fix: order pieces to keep the rotary's direction (sweep in one direction per class, or penalise reversals in the nearest-first cost) |

### P3s (10)

- **E1-P3-1:** a near-straight PostScript rule between 1e-6 and about 1.4e-6 pt tall still imports nothing. The threshold and the rounding disagree.
- **E1-P3-2:** the `.rd` advisory blames a Max-feed hold (up to 367 % dose) on the speed classes. The range is right and shown before output; the cause is misnamed.
- **E1-P3-3:** a legitimate 1.9 M-point EPS uses 61–80 % of the new 5 s limit, so a slower PC refuses it with "may loop forever".
- **E2-P3-1:** Ctrl+. and the link bar's ABORT MOTION do nothing while the K40 homes or jogs.
- **E2-P3-2:** a new link store can still skip the registry, the link job request and the job warnings. The registration guard matches folder names, and the JCZ route (#1725, open) is not in it.
- **E2-P3-3:** a third copy of the preflight adapter, a React duplicate-key warning in the K40 panel, and no K40 air note.
- **E2-P3-4:** header comments still describe a world with two link routes.
- **E3-P3-1:** `main-is-green` gives the right verdict but late: the sync waits for a runner (stale green up to 19.7 min), a fix keeps main "red" until its own main run completes, the text names one commit for both workflows, a 30-run window can return `error`, and any session can set `fixes-main`.
- **E3-P3-2:** the camera guard divides camera samples by all samples, so a camera task that is mostly GC or native work passes.
- **E3-P3-3:** after the part is turned on Z, a Z-rotary's first Start is refused with "Frame the job again"; the second Frame works (reproduced on the GRBL simulator).

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

### Not verified

- **Hardware:** Ruida rotary seams, backlash and real idle speed; K40 speed-code timing, diagonal speed and whether a K40 speed change stops the head.
- **Browser:** no browser run. The window-thread effect of E1-P1-1 is from READ plus Node timings.
- **Real exporters:** their ARC full-circle, ELLIPSE-parameter and zero-width-stroke habits. Nothing in the repo shows them, and nothing was downloaded.


## Round result (2026-11-12)

**Totals:** 26 raised, 0 refuted, P1 8, P2 8, P3 10, 5 KNOWN, across E1–E3.

**What the round found.** All of C2's fixes hold for the cases C2 measured, and every E1 and E2 P1 or P2 was fixed within the day. The new findings sit at the edges of each fix:
- a security bound that other inputs could escape (E1, fixed by #1831);
- the K40 route repeating Moshi's whole-mm/s rounding and its own speed floor without notes (E2, fixed by #1836);
- a whole-turn tolerance too tight for decimal-printed angles, which turned a fix into a regression (E3-P1-1);
- a piece order that traded laser-off travel for rotary reversals (E3-P2-2).

**Fixed on main:** #1831, #1832, #1833 and #1836 (E1 and E2), on top of C2's #1808, #1827, #1828 and #1829.

**Open:**
- E3-P1-1 and E3-P1-2 (one DXF tolerance fix), routed to the EPS/AI import session;
- E3-P2-1 (Job Review camera key), routed to the D3 tests session;
- E3-P2-2 (`.rd` rotary reversals), routed to the rotary-speed session;
- the P3s (10) and D3-P3-7 (simulators without motion time) for a sweep.

**Maintainer actions:**
- add `main-is-green` to ruleset 19573147 and create the `fixes-main` label: until then the check only reports;
- D7-P2-3 (runner capacity) is unchanged: only a quarter of main commits got a CI verdict in this window.

**Structural direction.** One shared numeric rule per geometric question (a whole turn, a full ellipse), with tolerances sized for printed decimals rather than for floating-point noise; and order-sensitive output (piece order, rotary direction) measured by a test that counts reversals, not only travel.