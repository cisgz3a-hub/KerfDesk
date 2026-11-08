# Rolling audit v10 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| V1 | Fix: job pipeline (#1575, #1574, #1572, #1576, #1562, #1565, #1585) | origin/main @ 5f09e1110 (refuter 5f09e1110; Node only, browser gate never met) | [V1-fix-job-pipeline.md](V1-fix-job-pipeline.md) | 4 | 0 | 1 (found by refuter) | 0 | 3 | 2 |
| V2 | Returning user: 1.0.29, 1.0.28 and older projects on main | origin/main @ 5f09e1110 (refuter 5f09e1110; Node only, browser gate never met) | [V2-returning-user.md](V2-returning-user.md) | 3 | 0 | 2 (refuter) | 0 | 1 | 0 |
| V3 | Fix: controller (#1558, #1559, #1567, #1568, #1569, #1595, #1599) | origin/main @ 5f09e1110 (refuter 5f09e1110; simulated GRBL in Vitest, browser gate never met) | [V3-fix-controller.md](V3-fix-controller.md) | 5 | 0 | 1 (V3-P2-2, re-rated by the V9 refuter) | 1 | 3 | 1 |
| V4 | Fix: canvas and geometry (#1551, #1552, #1593, #1582, #1583) | origin/main @ 5f09e1110 (refuter 5f09e1110; Node only, Vitest and browser gates rarely met) | [V4-fix-canvas-geometry.md](V4-fix-canvas-geometry.md) | 2 | 0 | 0 | 0 | 2 | 1 |
| V5 | Fix: photo, Image Studio and Trace (#1555, #1557, #1578, #1586, #1587, #1594) | origin/main @ 5f09e1110 (refuter 5f09e1110; Node only, browser gate never met) | [V5-fix-photo-image-trace.md](V5-fix-photo-image-trace.md) | 3 | 0 | 0 | 0 | 3 | 0 |
| V6 | Fix: text and CNC (#1589, #1590, #1591, #1602, #1603) | origin/main @ 5f09e1110 (refuter 5f09e1110; 50 e2e in Chrome by the auditor) | [V6-fix-text-cnc.md](V6-fix-text-cnc.md) | 3 | 0 | 0 | 0 | 3 | 1 |
| V7 | Fix: design and burn safety (#1556, #1561, #1566, #1564) | origin/main @ 5f09e1110 (refuter 5f09e1110; Vitest with real modules, browser gate never met) | [V7-fix-design-burn-safety.md](V7-fix-design-burn-safety.md) | 7 | 0 | 1 | 3 | 3 | 2 |
| V8 | Fix: help, accessibility and wording (#1554, #1570, #1580, #1581, #1588, #1598, #1604) | origin/main @ 5f09e1110 (refuter 5f09e1110; Chromium 156 headless with a simulated GRBL) | [V8-fix-help-a11y-wording.md](V8-fix-help-a11y-wording.md) | 6 | 0 | 1 (refuter) | 0 | 5 | 0 |
| V9 | Cross-fix journeys and the L12 e2e for the nine PRs merged without CI | origin/main @ 5f09e1110 (refuter 5f09e1110; Chromium 156 headless, simulated GRBL) | [V9-cross-fix-journeys.md](V9-cross-fix-journeys.md) | 2 | 0 | 0 | 0 | 2 | 3 |
| **Total (V1–V9)** | | | | **35** | **0** | **6** | **4** | **25** | **10** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| V1-P1-1 | V1 | **Abort waits behind a whole-program re-check right after the first line**: activating the archived run re-validates the archive just built by #1574's slices (fingerprint of the whole program text, manifest, sendable-line count) in one task, so Abort, Pause and status wait 53–59 ms at 375k lines, 110–132 ms on a real 100 mm grayscale photo (838k lines) and 139–156 ms at 1.0M lines (Node, real modules). Over the 50 ms budget #1574 set itself, so S4-P2-3 is only partly fixed; not larger than 1.0.29, where the same check ran inside a 260–620 ms block. Found by the refuter; P1 by the S4-P2-3 precedent, Chrome timing owed (P2 if ordinary jobs stay under 100 ms there) | **READ** (main): `recovery-snapshot.ts:102-131` (`knownArtifactCanHydrate` → `isValidatedExecutionArtifact` → `isExecutionArtifact`, memo only after the first call), `execution-artifact.ts:305-325` (`runWorkSteps` drains the fingerprint and line count at once). Refuter REPRO `zz-v1r/activate-out.txt` (stack ends in `RecoverySnapshotCoordinator.refresh`) | fixed by #1616 (merged 2026-11-08) |
| V2-P2-1 (P1, refuter) | V2 | **A logo imported on 1.0.29 still burns its white shapes on main, with no notice.** ADR-686 (#1556) knocks white fills out only on import or Re-import, so projects saved before it keep the white areas as ink: U3's logo burns its white diamond twice (+960 mm lit travel, +19.9 % dose), a white-letter plate +1,140 mm, the refuter's `style=` and CSS-class logos +65.6 % and +83.2 % lit length against the same SVG imported on main. Main's G-code is byte-identical to 1.0.29's; Open says only "Opened", the canvas paints the white shape as ink, and Job Review and preflight have no white-fill check. U3-P2-2 was P1 for the same output and R7-P1-1 set the precedent for field files. The fix is a notice with a one-step offer (not a silent change at open), skipping white shapes whose operation already has output off | **READ** (main): the knock-out is called only from `object-insert-actions.ts` (`applyImportWhiteKnockout`, `withWhiteKnockout`); no project-open caller; ADR-686 is silent on saved projects. Auditor and refuter REPRO (Node, 1.0.29 save → main open → compile) | fixed by #1617 (merged 2026-11-08) |
| V2-P2-2 (P1, refuter) | V2 | **A laser that 1.0.29 turned into a CNC stays a CNC on main, and Start lights the beam.** 1.0.29's first Connect to stock GRBL with `$32=0` saved the generic laser as a CNC (U8-P2-1); main restores it at startup and a first square job compiles to `M3 S12000`, `G4 P3.000`, then rapids with no `S0`. The repo's simulated GRBL in laser-mode-off holds the spindle output on through the 3 s dwell and 40 mm of rapids (GRBL clamps S to `$30`, so a diode runs at its maximum). The only Job Review line is a `$30` mismatch advisory that does not stop Start and advises `$30=12000`. ADR-637 Amendment 7 (#1567) fixes the Connect path only; its claim that the CNC output path "cannot be reached from `$32` alone" is false for every profile 1.0.29 saved this way. U8-P2-1 was P1 on the same output | **READ** (main): the Amendment 7 paths are `DeviceSetupLaserModeOff.tsx`, `DeviceSetupReviewStep.tsx` and the laser Job Review row `SendLaserModeButton.tsx`; no profile migration or CNC-profile check of laser signals. Refuter REPRO (simulated GRBL, compile + stream). The `$30` clamp citation is from a local GRBL source copy, version not re-fetched | fixed by #1619 (merged 2026-11-08) |
| V3-P2-1 | V3 | **The toolbar's "Reconnect now" ends a running job.** Offered when Machine Setup's Save could not switch the driver (#1558, U2-P2-1), it stays an enabled primary button during a job and its hover says "Nothing moves"; pressing it disconnects (a soft reset), so the burn stops mid-piece. Machine Setup's Save refuses the same state with "a job is running", and Ctrl+K Disconnect is guarded, but this route and Machine Setup step 1's "Reconnect using selected profile" are not. Not P1: the beam goes off, the run is kept as an interrupted job whose recovery Review opens on reconnect, nothing moves | **READ** (main): `ControllerConnectionControls.tsx:85-88` (`reconnectWithProfile` calls `disconnectController()` with no job check). Auditor and refuter REPRO (simulated GRBL: reset sent, stream dropped, 36 of 47 lines acknowledged) | fixed by #1620 (merged 2026-11-08) |
| V3-P2-2 (P1, V9 refuter) | V3 | **On `$10=0` the Abort card's origin restore fails with no message, and the next Frame leads to a misaligned re-burn.** "Restore saved origin" (#1568, U4-P2-3) sends `$X`, then needs a work-offset report that GRBL with `$10=0` sends only in some reports; it fails, the alarm is already cleared so the card is gone, and the error goes nowhere, leaving the origin cleared: the original U4-P2-3 situation. "Home, then restore origin" fails the same way about 9 times in 10. The error, if shown, says to wait for a report, which never helps on `$10=0`. Re-rated P1 by the V9 refuter: the next Frame does not refuse; it offers the generic "set the work origin at the current head position" (`frame-blocker-repair.ts:51-54`), which never mentions the unrestored saved origin (still held as `originAtStopMm`, read only by `AbortStoppedCard`), and accepting re-runs the job (+9.8, +5.75) mm and (+10.3, +4.05) mm off the partly burned piece (Chrome, simulated GRBL, twice). The card had promised Restore puts the origin back | **READ** (main): `AbortStoppedCard.tsx:42-55`; `frame-blocker-repair.ts:51-55` (the setup offer has no access to the saved origin) (success pushes a toast because "this card is gone"; failure only sets the gone card's state). Auditor and refuter REPRO (simulated GRBL, `$10=0` with the offset in every tenth report; `$10=1` control works) | fixed by #1620 (merged 2026-11-08) |
| V7-P1-1 | V7 | **Restoring the older of two unsaved-work rows deletes the newer one for good.** A closed tab leaves two copies under one storage key: the 30-second IndexedDB autosave and a newer copy written to localStorage as the tab closes. File > Recover unsaved work (#1564, ADR-688) lists them as two rows (different times and counts, nothing saying they are one session); restoring the older row clears the key in both stores, so every edit after the last 30-second save is lost, and autosave pauses while a job streams, so that can be everything edited during a burn. Restoring the newer row loses nothing. New with #1564: 1.0.29 offered only the newest copy | **READ** (main): `UnsavedWorkDialog.tsx:93-97` (rows keyed `storageKey@savedAt`), `autosave-durable.ts:169-172, 314` (`clearSnapshotNow` → `clearAutosave`), `autosave-local-storage.ts:134-147` (`localStorage.removeItem(storageKey)` with no `savedAt` check). Auditor and refuter REPRO (Vitest, real autosave service, fake IndexedDB, shared Web Locks) | fixed by #1618 (merged 2026-11-08) |
| V7-P2-1 | V7 | **The white knock-out treats any `#ffffff` paint as paper**: translucent white (`fill-opacity`, group `opacity`, `rgba`, CSS) leaves a hole where the file shows grey, a gradient emblem whose first stop is white vanishes from the burn (whole job 5,373 → 2,240 mm lit), and masked white removes the area the mask hides. The import toast says the shape "will not burn, as in the file", which misstates the cause; one Undo restores it. P2 (a warning reaches the operator before output); the vanishing emblem is the case for P1 | **READ** (main): `white-fill-knockout.ts:128-130` (`isWhite` compares the colour string only), `svg-paint.ts:82`, `parse-svg.ts:256`. Auditor and refuter REPRO | fixed by #1617 (merged 2026-11-08) |
| V7-P2-2 | V7 | **Re-importing an unchanged logo whose white shapes were knocked out resets its operation to defaults** (77 %, 3 passes became 30 %, 1 pass), breaking ADR-358 Decision 6; the same logo with a green shape keeps its settings. The toast says "new layer settings" in success styling; Undo restores | Auditor and refuter REPRO (Vitest, real import path); `import-toasts.ts:106` | fixed by #1617 (merged 2026-11-08) |
| V7-P2-3 | V7 | **"Cut last" (#1561, ADR-687) warns only when one cut holds the whole engraving operation**: one coaster is warned, but two coasters, a 2 × 2 grid, or a coaster plus a label elsewhere on the same Fill operation get no warning while the G-code still cuts every part free before engraving it: the original U3-P2-4 harm. P2, as U3-P2-4 | **READ** (main): `cut-before-engraving.ts:62-75` (`cutsHolding` needs one ring to hold `computeJobBounds` of the whole group). Auditor and refuter REPRO | fixed by #1614 (merged 2026-11-08) |
| V8-P2-1 (P1, refuter) | V8 | **Holding Enter on Pause resumes the burn.** #1570 (ADR-207 Amendment 2) keeps Pause → Pausing… → Resume in one focused button; Chromium clicks a focused button on every Enter repeat, so the first auto-repeat after the pause confirms clicks Resume and sends `0x7E` (about 508 ms into a held Enter at Windows' default repeat delay). A 1 s hold leaves the job running; a 2 s hold toggles Pause and Resume every ~250 ms; holding Enter on Job Review's Start job does the same once focus moves to Pause; a 600 ms hold hit a one-render Resume twice and the second resume made KerfDesk send its fail-dark reset `0x18`, ending the job. An 80 ms tap or a 300 ms hold pauses and stays paused. Before #1570 focus fell to the page and repeats did nothing. Also found: the shared paced-GRBL e2e fixture decodes writes as UTF-8, turning the `0x84` pause byte into U+FFFD, so the existing e2e could not see a Pause | **READ** (main): `LiveMotionActionButton.tsx:51-56` (`aria-disabled` keeps focus; `onClick` has no repeat guard), `LiveMotionBar.tsx:161-192` (the same button becomes Resume → `resumeJob`). Refuter REPRO (Chromium 156.0.8078.4 headless, CDP key repeat, simulated GRBL with safety-door states: `zz-v8r/out-run5.json`); Electron 44.9.1 pinned (Chrome 152) not run, same Blink activation path | fixed by #1615 (merged 2026-11-08) |

## Round result (2026-11-08)

All nine areas ran through the same three steps: an auditor, a fresh refuter, and a check by the coordinator in main's code (`5f09e1110`). The round raised **35 findings and refuted none: P1 6 / P2 4 / P3 25**. A further 10 KNOWN findings were seen again.

**What holds.** Across 1,100+ job pairs the burn matches 1.0.29 byte for byte: G-code, traced paths and text outlines are all identical, apart from changes an ADR names. The pairs cover:
- golden projects from 1.0.27–1.0.29, and projects saved with 1.0.29's own code;
- text, CNC, photo, fill and tabs;
- 7,359 traces.

Every speed fix keeps its burn. Weld, nesting and the Fill pool caches agree with 1.0.29 and with the canvas.

**What CI never saw.** Nine PRs merged on 2026-11-05 while Actions could not run (#1593–#1595, #1598–#1600, #1602–#1604). AREAS said ten; the correct count is nine. Results run locally for them:
- 38,920 unit tests passed, with no real failures.
- 150 of the 152 related e2e spec files passed, run one at a time in headless Chrome 156.
- The two that fail (`startup-live-motion`, one `gcode-viewer-density` test) fail the same way before the merges. The cause is this PC: its CPU load, and its Intel GPU through ANGLE D3D11. With software rendering, `gcode-viewer-density` passes.
- The desktop build and `production-bundle.spec.ts` need a 6 GB heap and could not run here. A CI run of main is still owed.

### P1 and P2, each with a fix PR (all merged 2026-11-08 once CI was back)

| ID | What | Fix |
|---|---|---|
| V1-P1-1 | Abort waits behind a whole-program re-check after the first line (53–156 ms) | fixed by #1616 (merged 2026-11-08; Chrome timing still owed) |
| V2-P2-1 (P1) | Logos imported on 1.0.29 still burn their white shapes on main, with no notice | #1617 |
| V2-P2-2 (P1) | A laser that 1.0.29 saved as a CNC stays one; Start sends `M3 S12000` with a 3 s dwell | #1619 |
| V3-P2-2 (P1) | On `$10=0` the origin restore fails silently; Frame then offers "set origin here" and re-burns 10 mm off | #1620 (scope widened 2026-11-08) |
| V7-P1-1 | Restoring the older of two unsaved-work rows deletes the newer copy | fixed by #1618 (merged 2026-11-08) |
| V8-P2-1 (P1) | Holding Enter on Pause resumes the burn (key repeat) | #1615 (also covers V9-P3-1) |
| V3-P2-1 | The toolbar's Reconnect now ends a running job | fixed by #1620 (merged 2026-11-08) |
| V7-P2-1 | The white knock-out treats translucent, gradient and masked white as paper | fixed by #1617 (merged 2026-11-08) |
| V7-P2-2 | Re-import after a knock-out resets the operation's settings | fixed by #1617 (merged 2026-11-08) |
| V7-P2-3 | Cut last misses jobs with more than one part | fixed by #1614 (merged 2026-11-08) |

**The pattern.** Five of the six P1s came from fixes that work for new work but not for existing work. Two examples:
- **Old files and machines.** V2's projects and profiles saved before the fix still behave the old way.
- **Second steps.** V3's restore and V7's recovery work at first, but the step after them fails.

V8's P1 is a regression created by an accessibility fix. The fixes' own tests stopped one step too early every time.

### The 1.0.30 update notes need a line each for

- the white knock-out, both on import and the offer for older logos;
- the stale-CNC laser check;
- Cut last;
- the Before you start block;
- Recover unsaved work;
- the CNC adaptive-fallback notice;
- the GRBL laser-mode ETA change;
- the origin restore after Abort;
- the new missing-font notice.

`docs/releases/desktop-update-notes.json` still holds 1.0.29's notes.

### P3s (25)

Proposed routing: one sweep session per group, run after the fix PRs above merge, because several touch the same files.

| Group | Findings |
|---|---|
| Job pipeline | V1-P3-1..3 |
| Returning user | V2-P3-1 |
| Controller | V3-P3-1..3 |
| Canvas / pools | V4-P3-1/2 |
| Image | V5-P3-1..3 |
| Text / CNC | V6-P3-1..3 |
| Design / safety wording | V7-P3-1..3 |
| Help and accessibility | V8-P3-1..5 |
| Viewer | V9-P3-2: the GPU travel overdraw, which breaks ADR-425 on Intel graphics; CI cannot see it |

V9-P3-1 is fixed in #1615.

### Gaps in the test tools found this round

- **The shared simulated GRBL can't see Pause.** It decodes writes as UTF-8, so the `0x84` pause byte becomes U+FFFD and no existing e2e test can observe a Pause. #1615 fixes the fixture.
- **CI renders without a GPU.** Real-GPU canvas paths, such as V9-P3-2, are never tested.

### Not verified (memory)

The PC had 0.8–3.1 GB free throughout, so:
- Most browser timings were not taken, including Chrome's for V1-P1-1 and V1-P3-1.
- The Electron app, real screen readers and the desktop build were not run.
- Most measurements are Node runs of the real modules; each area's report lists what that covers.
