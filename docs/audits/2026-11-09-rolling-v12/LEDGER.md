# Rolling audit v12 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| X1 | Fix: job safety (#1615, #1616, #1620, #1628, #1612) | origin/main @ 743d37bc4 (refuter 743d37bc4; Vitest with the simulated GRBL, Node with the real main-process modules, Chrome 156 for V1-P1-1) | [X1-fix-job-safety.md](X1-fix-job-safety.md) | 3 | 0 | 1 | 1 | 1 | 1 |
| X2 | Returning user (1.0.29 saves on main: #1617, #1618, #1619, #1622, #1635 + byte identity) | origin/main @ af1573c77 (refuter af1573c77; coordinator re-read be671b158; Node with 1.0.29's own store and main's loader, Vitest for the recovery flows) | [X2-returning-user.md](X2-returning-user.md) | 6 | 0 | 2 | 1 | 3 | 1 |
| X3 | Fix: design, text and import (#1614, #1617, #1601, #1602, #1592, #1635, #1636) | origin/main @ be671b158 (refuter be671b158; coordinator re-read a468f7bea; Node with main's real modules, Vitest 653 tests for the seven PRs; refuter ran HarfBuzz-shaped text) | [X3-fix-design-text-import.md](X3-fix-design-text-import.md) | 2 | 0 | 0 | 1 | 1 | 2 |
| X4 | Fix: performance sweep (#1593, #1594, #1597, #1606, #1607, #1608, #1611) | origin/main @ a468f7bea (refuter a468f7bea; Node with main's real modules against each PR's parent: 1,308 traces and 45 CNC outputs byte-identical, Fill-pool and pan caches against uncached runs; Vitest 61 tests) | [X4-fix-perf-sweep.md](X4-fix-perf-sweep.md) | 1 | 0 | 0 | 0 | 1 | 1 |
| X5 | Fix: UX sweep (#1595, #1598, #1599, #1604, #1605, #1609) | origin/main @ 7c3c00971 (refuter 7c3c00971; coordinator re-read 8c6b04869; Vitest with the real store and bar on a scripted GRBL, Node for the speed entry, Chrome 156 for the wheel check) | [X5-fix-ux-sweep.md](X5-fix-ux-sweep.md) | 7 | 0 | 1 | 1 | 5 | 3 |
| X6 | Fix: CNC and relief (#1603, #1622, #1643, #1646) | origin/main @ 8c6b04869 (refuter 8c6b04869; coordinator re-read 43d75cabb; Node with main's real modules, emitted G-code run through two independent stock simulations; Vitest 104/108, 4 local timeouts) | [X6-fix-cnc-relief.md](X6-fix-cnc-relief.md) | 6 | 0 | 1 | 3 | 2 | 3 |
| X7 | Cross-fix journeys and main CI over the merge train | origin/main @ 43d75cabb (refuter 43d75cabb; coordinator re-read ffd9fe66b; whole jobs through the real store, Job Review, Start and simulated GRBL; headless Chrome for the 500,000-line Run Abort) | [X7-cross-fix-journeys.md](X7-cross-fix-journeys.md) | 4 | 0 | 0 | 1 | 3 | 2 |
| X8 | Rotary complete (requested by the maintainer: a perfect burn on round glass) | origin/main @ ffd9fe66b (refuter ffd9fe66b; coordinator re-read bd9e17bff; Node with main's real modules on simulated GRBL, grblHAL, Falcon A1 Pro, FluidNC, Marlin and Smoothieware, two independent rotary kinematics models; LightBurn docs and forum read) | [X8-rotary-complete.md](X8-rotary-complete.md) | 8 | 0 | 2 | 1 | 5 | 2 |
| **Total** | | | | **37** | **0** | **7** | **9** | **21** | **15** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| X1-P1-1 | X1 | **After a controller hard-reset, Frame still offers to restore the aborted job's origin, and the re-run burns off-position with no warning.** #1620's offer matches the stop request on the job counter only, so it survives a power cycle or a USB auto-reset that re-zeroes machine position on a machine without homing. In the refuter's repro the controller session went 4 → 7 and machine position jumped from (35, 15) to (0, 0) with no motion sent; no notice appeared; Frame said "The job you stopped ran from X 35, Y 15", OK wrote `G54 G21 G92 X-35.000 Y-15.000`, and the toasts "Origin restored" and "Frame complete" confirmed it; the re-run landed (+35, +15) mm off (auditor: (+20, +68) mm after a reconnect). The interrupted job's own Review already warns "home the machine if it was reset". Same class as V3-P2-2 (P1) | **READ** (main): `unrestored-abort-origin.ts:29-35` (`currentJobStopRequest` only), `job-stop-request.ts:32-38` (matches `streamerEpoch` only; `positionMayBeLost` not consulted; nothing clears the request on a reset). Auditor and refuter REPRO (Vitest, simulated GRBL: `zz-x1r/vt-powercycle.txt`) | fixed by #1647 |
| X1-P2-1 | X1 | **If the renderer dies while KerfDesk is closing, main's network stop waits behind the close guard's blocking box until the operator answers.** #1628 meant the stop to go first; during a close the "App controls unavailable" box runs first and the reset waits (3,002 ms in the auditor's run against 13 ms without a close). The wait has no time limit, but the box opens within 1 ms, says Software Abort cannot be confirmed and names the E-stop (conditionally: "if the machine may be unsafe"), and one Enter ends it. P2 | Auditor and refuter REPRO (Node, real close guard and crash recovery in `main.ts` order: `zz-x1r/order-out.txt`) | fixed by #1645 (also X1-P3-1) |
| X2-P1-1 | X2 | **Copies of a 1.0.29 logo keep burning their white after Leave white unburned, while the toast says the white is unburned and the Job Review row goes.** Duplicate, Paste, Array and production nesting drop `svgImport`; #1617's count and knock-out read only `svgImport` groups. Four duplicated logos are counted as 1 white shape; after the button 3 copies still burn their white over the black (+1,920 mm lit per logo in the auditor's repro; +4,920.6 mm per copy, +39.7 %, on the refuter's own logo). The canvas shows the copies solid, which is display, not a warning | **READ** (main `be671b158`): `burning-imported-white.ts:23-33` keys groups on `svgImport.id` only and `:46-57` counts only those; `scene-object-copy-dependencies.ts:31` drops `svgImport` unless the caller passes `preserveSvgImport` (only array first placement, board tiles, jig and retained arrays do). Auditor and refuter REPRO (Node, 1.0.29's store saves, main compiles: `zz-x2/dup.mjs`, `arr.mjs`, `zz-x2r`) | fixed by #1651 (also X2-P3-1, X2-P3-2) |
| X2-P1-2 | X2 | **#1619 does not ask about a 1.0.29-converted laser whose owner set the spindle max RPM to 1000, as 1.0.29's own `$30` advisory told them; Start sends `M3 S1000`, a 3 s lit dwell and lit rapids with no question and no advisory.** The question needs the starter's `profileId` and KerfDesk's default spindle RPM, spin-up and coolant, and drops once `$30 > 1000`. P2 alone: `$30` written to 12000 (the startup card warns before Connect, nothing after), `.lbdev` lasers 1.0.29 converted, and profiles with no id (both keep the laser-worded advisory) | **READ** (main `be671b158`): `converted-laser-profile.ts:59-64,71-84` (`madeFromLaserStarter`, `spindleUntouched`, the `$30` ceiling). Auditor and refuter REPRO (Node, 1.0.29's real setup fill and store, main's question, readiness and emitter: `zz-x2/prof.mjs`, `prof2.mjs`) | fixed by #1650 |
| X2-P2-1 | X2 | **CNC pass recovery and supervised recovery start a 1.0.29 interrupted CNC job without the converted-laser question** that ADR-637 Amd 8 says gates every job; the banner's Not now says "Job Review asks again before Start". The recovery's Controller warning still shows the laser-worded `$30` advisory, so P2 (P1 on an X2-P1-2 machine, carried there) | **READ** (main `be671b158`): no `convertedLaser` reference in `cnc-pass-recovery-flow.ts`, `cnc-supervised-recovery-flow.ts` or `cnc-recovery-open-project.ts`; the question gates only `runJobReviewGate`. Refuter REPRO (Vitest: both flows stream `M3 S12000`, a lit dwell and about 510 mm of lit rapids) | fixed by #1650 |
| X3-P2-1 | X3 | **A cut with a lead-in or lead-out never gets the "Cut runs before the engraving inside it" warning in Job Review, Save G-code or Start.** Those routes read the prepared job, where a cut contour with leads becomes an open burn carrying `leadContour`; the check counts only closed outlines. One coaster, two coasters and a round disc with leads all burn cut-then-engrave with no warning; the same jobs without leads, or with overcut or kerf, are warned. Predates #1614 (leads 2026-10-18, the warning #1561 on 2026-11-03); the repo's tests check `compileJob` only, so they never meet a lead. Leads are off by default. P2, as V7-P2-3 and U3-P2-4: the burn follows the order the operator set, and the advisory is what is missing. #1638's "Cut last for each part" overclaims until fixed | **READ** (main `a468f7bea`): `cut-before-engraving.ts:122-124` (`closedOutlines` keeps only `segment.closed`), `apply-laser-leads.ts:441` (a led contour becomes `closed: false` with `leadContour`). Auditor and refuter REPRO (Node, real prepare + review on all three routes, incl. a per-object lead with the operation's leads off: `zz-x3/cut1.mjs`, `zz-x3r/cut-r.mjs`) | fixed by #1653 |
| X5-P3-4 (P1, refuter) | X5 | **The Speed and Feed boxes convert mm/s only for the number next to the unit, so an expression commits a wildly wrong speed with no warning.** "1/2 mm/s" commits 1 mm/min instead of 30, "60/2 mm/s" 1 instead of 1,800, "1/2 in/s" 1 instead of 762, and "50+50 mm/s" 3,050 instead of 6,000. The G-code follows (`F1`): the first-burn lesson's 90 mm circle runs lit for 283 minutes instead of 9.4. The box is not marked invalid and nothing in Job Review flags it; the box showing "1" and a "0 mm/s" readout are visible results, not warnings. The length boxes read "1/2 in" correctly as 12.7 mm, so the same box treats expressions differently by unit | **READ** (main `8c6b04869`): `dimension-entry.ts:6` (`PER_SECOND` captures one number) and `:19` (`replace(PER_SECOND, '($1 $2 * 60)')` rewrites only the last term); `LayerSpeedInput.tsx:96,102` clamp to ≥1 mm/min. Auditor REPRO (Node, main's `dimension-entry.ts`: `zz-x5/mms.mjs`); refuter REPRO (real Speed box to emitted `F1`: `zz-x5r/refute.jsonl`) | fixed by #1657 |
| X5-P2-1 | X5 | **A door opened once every line is sent shows "press Pause and then Resume here", but the bar offers only ABORT JOB, so the job sits in Door with no way forward at the PC.** Pause is offered for a sent-out job only while the controller reports Run. The Console refuses `~` during a job, and neither a shortcut nor Ctrl+K pauses. A 100 mm square cut is 6 moves, all buffered at once, so the whole 80 s cut is in this state. Beam off throughout; Abort keeps an interrupted-job record that restarts 15 moves back, so P2 | **READ** (main `8c6b04869`): `LiveMotionBar.tsx:165` (`canPause` needs `streaming`, or `done` with `statusReport.state === 'Run'`), `:363-375` (the door text and `DOOR_RELEASE`). Auditor and refuter REPRO (Vitest, real store, `LiveMotionBar` and `LaserWindow` on a scripted 15-block GRBL: `zz-x5/door-alarm.jsonl`, `zz-x5r/refute.jsonl`; still stuck after 120 s) | fixed by #1657 |
| X6-P1-1 | X6 | **A projected loop's tabs are only as thick as the relief floor left under them, while Job Review states the set tab height.** Job Review says "6 × 2 mm above the stock bottom" (or 3 mm); the bridges left are 1.00, 0.50, 0.20 and 0.05 mm, and a floor at the stock bottom frees the part. The "cut free" check never fires once a tab window exists, and the spoilboard note does not mention tabs. The refuter argues P2: the G-code keeps all the material there is, so only the description is wrong. Coordinator keeps P1 on the W6-P2-1 precedent: a part that comes free under the bit while Job Review lists holding tabs harms the job, and METHOD §3 has no reach clause (floors within about 0.2 mm of the stock bottom). The 2D profile shares the root and predates #1643 | **READ** (main `43d75cabb`): `compile-cnc-relief-projection.ts:141-149` (`tabTopZ` from the stock bottom plus the set height, whatever the relief floor), `relief-projection-plan.ts:203-212` (a window lifts a point only if below the tab top), `job-review-projection-detail.ts:76-88` (the set height). Auditor and refuter REPRO (Node, emitted G-code against independent stock simulations: `zz-x6/`, `zz-x6r/tabs.mts`) | fixed by #1661 |
| X6-P2-1 | X6 | **A projection steps down from the relief's target surface, not from the stock that is there.** On the shipped relief layer, which has no finishing bit, a 0.5 mm-per-pass projection's first pass takes 2.58 mm (3.80 mm with 3 mm roughing passes), while Job Review says "passes of up to 0.5 mm". The order warning fires only when finishing runs later, so the roughing-only case, the worse one, gets only the general "projection does not verify remaining stock" note | **READ** (main `43d75cabb`): `relief-projection-plan.ts:207-209` (levels lifted from the target), `job-review-projection-detail.ts:58-65`, `cnc-relief-projection-order-warnings.ts:34`. Auditor and refuter REPRO (`zz-x6r/load.mts`) | fixed by #1661 |
| X6-P2-2 | X6 | **Rest finishing never steps down.** Where the finishing ball cannot enter a 2.4 mm groove, the 1/16" rest ball cuts it full width 4.72 mm deep for 18.3 mm at F1000 (3 × the bit diameter), with no note; Depth per pass changes nothing, and the reach check never flags a groove that narrow | **READ** (main `43d75cabb`): `compile-cnc-relief-rest.ts:43-92` (no `finishingStepDown`; only finishing calls it), `relief-roughing-reach.ts:71-78`. Auditor and refuter REPRO (`zz-x6r/rest.mts`) | fixed by #1661 |
| X6-P2-3 (refuter) | X6 | **With a small finishing ball, the first finishing row along a relief edge that its floor meets slots the unroughed edge band at full depth.** With the starter 1/16" ball, a 3 mm floor running to the edge gets a 28.3 mm row at Z−3, F1000, over 2.96 mm of uncut stock, with no step-down level and no note. This contradicts ADR-421 Amd 2's "usually gets levels along that edge"; the 1/8" ball holds | **READ** (main `43d75cabb`): `relief-roughing-reach.ts:202-223` (`allowanceEnvelope`: past-the-edge cells stand at the stock top), `:79`, `compile-cnc-relief.ts:304`. Refuter REPRO (`zz-x6r/k2diag.mts`) | fixed by #1661 |
| X7-P3-3 (P2, refuter) | X7 | **The Run dialog streams external G-code on a 1.0.29-converted CNC without the converted-laser question, although the 1.0.30 notes and the canvas card's Not now tooltip promise KerfDesk asks "before any job or recovery starts".** On a CNC-typed machine the Run dialog drops the laser-only lit-rapid warning and the `$30`/`$32` acknowledgement, and a converted machine is at `$32=0` by construction. On a LightBurn-shaped file the repo's GRBL power model shows 130.7 mm of lit travel at S800 (the D5-P2-2 burn). On the machine as 1.0.29 left it, a clear `$30` warning still shows. On machines changed per 1.0.29's advice (spindle max RPM 1000, or `$30` written to 12000), the only hint is "The program never moves Z, as a laser program does". ADR-637 Amd 10 excludes the Inspector Run, but the notes and tooltip do not | **READ** (main `ffd9fe66b`): no `convertedLaser` reference anywhere in `src/ui/gcode-inspector/`; `MachineSetupBanner.tsx:126` ("asks again before any job or recovery starts"); `desktop-update-notes.json` (same promise). Refuter REPRO (Node, Run dialog review plus the GRBL power model: `zz-x7r/`) | fixed by #1664 |
| X8-P1-1 | X8 | **On a Y-port rotary, KerfDesk scales only the Y distances. The layer speed goes out unchanged, so the glass surface moves at the set speed divided by the rotary's Y scale.** Strokes around the part therefore burn too light when the scale is below 1 and too dark when it is above 1. Line is the default layer mode, so this hits text and outlines. Results from the refuter's own kinematics model, energy against the set speed: on the Creality chuck, an Ø80 glass gets 15.9 % (6.3× too fast) and an Ø150 bowl 8.5 %; a Ø10 pen gets 127 %; a geared roller 184 %; a never-edited roller 458 %. A cross-hatch's 90° pass gets 15.9 %. Job Review's Rotary row shows only "Y ×0.16", warning-coloured, and never mentions speed. ADR-501 D1 itself says a machine Y millimetre is not a surface millimetre | **READ** (main `bd9e17bff`): `rotary-transform.ts:20-26,44-56,71-74` (`applyRotaryYScale` maps Y only; no feed or speed term anywhere in the file). Auditor and refuter REPRO (Node, emitted G-code through two independent kinematics models: `zz-x8/`, `zz-x8r/h.mts`, `r1`–`r6`) | fixed by #1672 (taper feed and the CI break after #1670 still owed) |
| X8-P2-1 (P1, refuter) | X8 | **KerfDesk drives a rotary only through the Y port, with no A or Z axis choice, yet it offers the Falcon A1 Pro the Creality "Y port" preset.** A published A1 Pro `$I` reports `[AXS:4:XYZA]` with the A axis configured (`$103`/`$113`/`$133`), and the same rows are in the repo's own A1 Pro fixture. A rotary job on the A1 Pro profile emits only X and Y: the head moves 7.96 mm in Y with the beam on, the glass does not turn, and there are no preflight issues or warnings. Firmware routing on the maintainer's own machine is still unconfirmed; their `$$`/`$I` with the rotary fitted would settle it | **READ** (main `bd9e17bff`): `rotary-presets.ts:23` (`machineFamilies: ['creality-falcon']`, so the A1 Pro gets the preset); no A-axis emission in `src/core/job/rotary-*.ts` or `src/core/devices/rotary*.ts`. Refuter REPRO (`zz-x8r/`) | fixed by #1671 |
| X8-P2-3 (refuter) | X8 | **Image rows on a chuck land on the controller's Y step grid, not on the line interval.** At 80 steps/mm and the default 10 lines/mm, an Ø80 glass gets a 0.157 mm gap about every fourth row instead of 0.0785 mm, which shows as banding. On an Ø150 bowl, 31 of 100 rows burn on top of another row at double dose. It also happens at 100 and 160 steps/mm. The app already reads `$101` but never checks this | Refuter REPRO (`zz-x8r/`, rows quantised to `$101` steps) | fixed by #1673 and #1674 |

## Round result (2026-11-10)

Each of the eight areas went through an auditor, a fresh refuter, and a coordinator check against main's code. The trees used were `743d37bc4`, `af1573c77`, `be671b158`, `a468f7bea`, `7c3c00971`, `8c6b04869`, `43d75cabb` and `ffd9fe66b`. X8 was added on 2026-11-09, when the maintainer asked for rotary engraving to be "fully built".

**Totals.**
- Raised 37, refuted 0: P1 7, P2 9, P3 21. 15 earlier findings were rechecked and are still open (KNOWN).
- Refuters raised five findings to P1 or P2: X5-P3-4, X7-P3-3, X8-P2-1, X6-P2-3 and X8-P2-3.
- They lowered two: X8-P2-2 to P3, and the coordinator kept X6-P1-1 at P1 against the refuter's case for P2.

**Fix status.**
- X1–X6: every P1 and P2 is fixed on main, by #1645, #1647, #1650, #1651, #1653, #1657 and #1661.
- X7-P3-3: fixed by #1664.
- X8 (status 2026-11-10): X8-P1-1 fixed by #1672, X8-P2-1 by #1671, X8-P2-3 by #1673 and #1674, X8-P2-2 (P3) by #1670. Main went red when #1670 and #1672 met; the fix and the taper factor in the feed are owed.
- X8: P1 ×2 and P2 ×1 are being built in the rotary sessions (speed, axis). Taper warp (X8-P2-2, now P3) is being built in its own session at the maintainer's request.

**The pattern.** As in v10 and v11, most findings are a guard or a promise that one route has and its twin route lacks:
- copies vs imports (X2-P1-1);
- the canvas vs the Inspector Run (X7-P3-3);
- the PC vs the phone Pause (X7-P3-1);
- Job Review's Start vs the other starts (X7-P3-2);
- the profile vs the rotary-projection tabs (X6-P1-1).

Two P1s came from new input routes that worked for the common case and failed silently for the rest: mm/s expressions (X5-P3-4) and a rotary port on another axis (X8-P2-1).

### Rotary status (maintainer's question: "put in a round glass … and burn perfect burn while it rotates")

**Not yet.**

What is right today:
- The wrap geometry is exact on every controller, on a chuck and on rollers: exactly one turn, aspect kept, centred, and it rescales with the diameter.
- Rotary projects saved by 1.0.29 compile byte-identically.

Three things stop a perfect burn:
1. **X8-P1-1: the feed is not corrected for the surface.** Line work around the glass burns 0.16× to 4.6× the set dose, depending on the rotary.
2. **X8-P2-1 (P1): there is no A/Z rotary axis.** On the Falcon A1 Pro, whose rotary port is the A axis, the head burns a squashed copy and the glass does not turn.
3. **X8-P2-3: image rows on a chuck snap to the Y step grid**, which shows as banding.

The only setup that comes out right today is a Y-port roller with its Y steps per mm calibrated to the surface.

All three are being built, along with taper warp for tumblers and more rotary presets. The maintainer's `$$`/`$I` with the rotary fitted to their A1 Pro would confirm the axis wiring.

### Release 1.0.30

1.0.30 would have newly shipped two findings:
- X1-P1-1, fixed by #1647;
- X5-P3-4, fixed by #1657.

X7-P3-3's notes line becomes true once #1664 merges.

X8's rotary findings are not regressions, since 1.0.29 behaves the same. The notes should not claim rotary improvements until the rotary PRs merge.

### Maintainer decisions open

- **BQ-20:** whether to follow the Illustrator SVG unit rule (14-P2-1).
- **W9-P2-1:** the power-state check (`power-state.ps1` in the coordinator's scratchpad).
- **S9-P3-1, S8-P2-1, S8-P3-3.**
- **The Worker redeploy.** Phone-side text changes in #1644 and others reach phones only after it.
- **X6-P1-1:** P1, the coordinator's call, or P2, the refuter's case.

### P3s (21) and sweeps

The P3s are listed in each area report. Proposed sweeps:
- **Returning user and imports:** X2-P3-3 and X3-P3-1.
- **Docs and ADR text:** X4-P3-1.
- **Controller messages and Console:** X5-P3-1, -2 and -3.
- **Speed entry:** X5-P3-4's sibling X7-P3-4.
- **Phone and browser parity:** X5-P3-6, X7-P3-1 and X7-P3-2.
- **Relief:** X6-P3-1 and X6-P3-2.
- **Rotary:** X8-P3-1 to -4, most of which are in the rotary sessions.
- **The cable card's wording:** X5-P3-5.

### Not verified (memory)

The PC had 0.95–4 GB free. Most checks were Node runs of the real modules. Browsers ran where the memory gate allowed: X1, X5 and X7.

No area ran:
- hardware or a real serial port;
- the packaged Electron app;
- the live Worker, licensing server, update feed, AI provider or cameras (by rule);
- Firefox or Safari.
