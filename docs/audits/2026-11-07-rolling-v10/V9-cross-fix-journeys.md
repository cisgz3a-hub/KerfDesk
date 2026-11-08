# Rolling audit v10 — V9 Cross-fix journeys

- **When:** 2026-11-08, 08:10–13:40 +0800   **Tree:** origin/main @ `5f09e1110` (unchanged during the audit: `git fetch` at the start and at 13:40).
  - Browser runs: my export `scratchpad\zz-v9\mut` (`git archive 5f09e1110`, `node_modules` junction to the main checkout). Its `src` is `diff -rq`-identical to `j10-main`. Its only additions are `vite.zz.config.ts` (the known `fflate` alias to `.pnpm/fflate@0.8.3`, and a private Vite `cacheDir`), `playwright.zz.config.ts`, and my own `e2e/zz-v9-*` specs and `e2e/fixtures/zz-v9-grbl.js`.
  - Own Vite dev server (`--mode desktop`) on 127.0.0.1:4819. Playwright 1.61.1, headless, `--workers=1`, one spec file per process. Browser: the cached `ms-playwright/chromium-1248` Chrome for Testing 156.0.8078.4, via `executablePath`. Nothing was downloaded or installed. The installed KerfDesk was not launched. No hardware and no real port.
  - 1.0.29 comparisons rest on V2's and V5's byte-identity results (emitter, raster, project I/O); I did not recompile on `zz-v2/old29`.
- **Scope:** five user journeys from artwork to a simulated GRBL, across the fixes merged since 1.0.29, plus L12 for the merges that never ran CI on main.
  - **The "ten" untested merges are nine PRs:** #1593, #1594, #1595, #1598, #1599, #1600, #1602, #1603, #1604 (merged 2026-11-05 23:19:36–23:27:19 UTC; `gh pr list --state merged` shows no tenth in that window). AREAS.md and the brief both say ten.
  - Two pairs of them edit the same files minutes apart: #1595 and #1599 (`ConnectionBar.tsx`), #1598 and #1604 (`JobActionControls.tsx`, `OriginRow.tsx`, merged 8 s apart). #1595 and #1604 both edit `LiveMotionBar.tsx`. Both halves of each pair are present on main (`git diff 7961853f2^1 5f09e1110`).
- **Lenses run:** L10 (the fixes, end to end), L4 (Pause, Abort, cable pull, tab close, held keys, `$10=0`), L9 (Save G-code against Start, startup card against File > Recover, toolbar against Job Review), L12 (the e2e suites, see the table).
  - Not run: L5, L2 (no new outside-world claim), the desktop build (see Not verified).
- **Simulator.** `e2e/fixtures/zz-v9-grbl.js`, derived from the V8 refuter's raw-byte door fixture (so it sees `0x84`), adds: a wire log of every admitted line; GRBL 1.1 reset during motion (`ALARM:3`, banner, unlock hint, `error:9` while locked); `$X`, `$H`; `G92` and `G10 L20` work offsets cleared at reset; `$10` (WCO on every report with `$10=1`, on every tenth with `$10=0`, WPos reports); `$G`, `$#`; a reopen that resets the board as an Arduino does; a cable pull (stream error plus `disconnect`); an injected alarm.
- **Counts:** 1 raised → refuter pending → P1 0 / P2 0 / P3 1 (+ 3 KNOWN re-observed in a real browser: V7-P1-1, V7-P2-3, V3-P2-2). L12: all 152 development spec files ran in Chrome. 150 pass, after one rerun of 3 load-timed-out files and one harness fix. 2 fail the same way on the pre-window main `87f0ec583`, so they are local, not from the nine merges (504 tests passed, 3 failed, 12 skipped by design).

## Headline

**The fixes hold together on every journey I ran in Chrome against a simulated GRBL. Pause, Resume and Abort worked every time, every notice I checked was true, and nothing was lost except through findings already ledgered.**

- **New user (J1).** A `$32=0` controller gets the laser-mode question in Machine Setup and stays a Laser after Cancel (#1567). Job Review's **Send $32=1** writes and reads back `$32=1`, then the warning and the unverified-settings acknowledgement both go. The burn is `M4` dynamic with no `M3`/dwell.
  - Pause sent `0x84`; no line executed during the hold. Resume sent `0x7E`. Abort sent `0x18`, and the Abort card's text was true ("It was at X 60, Y 40 mm"). **Restore saved origin** put WCO back at exactly (60, 40) with `$10=1`.
  - The aborted run's 1,729 lines are byte-identical to the start of the full re-run. **Run same job again** streamed 11,865 lines byte-identical to the run before.
- **Logo coasters (J2).** The knock-out toast is true. A cable pull at 45 % opened the interrupted-job Review by itself on reconnect, and that Review said the origin was cleared. Restore matched it, and supervised recovery from line 3453 finished the job. The pre-pull lines plus the recovery lines cover the whole 7,691-line program, with the 13-line overlap the Review disclosed.
- **CNC (J4).** #1603's fallback notice shows in the canvas preview and in Job Review. Save G-code's 51 program lines equal the 51 lines streamed by Start.
- **No-picker browser (J5).** The ADR-688 banner, drag-and-drop import, the "can't save files" error, and the Cancel-first **Unsaved changes** question were all true. Autosave restored the scene unchanged.
- **#1595 × #1599.** "Connected · Alarm" does not move or overflow the connection row at 1920, 1280, 600 or 360 px (V3's open question).
- **L12.** The whole development e2e suite (152 spec files) ran in Chrome.
  - 150 files pass, 3 of them only on a rerun after load timeouts and 1 after a harness port fix.
  - The other 2 (`startup-live-motion`, `gcode-viewer-density`) fail identically on the pre-window main `87f0ec583`, where CI passed them, so the cause is local and not the nine merges.
  - Nothing in the suite points at an interaction between the merges.

One new P3 and three KNOWN findings, now reproduced in the rendered app:

- **V9-P3-1 (new).** #1604 hands focus back to **Frame job** when it re-enables, so a held Enter re-runs the Frame: two traces from one 4 s hold. This is the same key-repeat mechanism as V8-P2-1, but on a beam-off move.
- **V7-P1-1 (KNOWN).** Recover unsaved work lists the two copies of one closed tab as "4 objects, Autosaved … 8:56 AM" and "… 8:57 AM", both "less than a minute ago". Restoring the older one emptied the list, and the next Start burned at 61 % instead of the last edit's 73 %.
- **V7-P2-3 (KNOWN).** A 2 × 2 array of coasters cuts all four rings (`S800`, program lines 9–204) before it engraves any logo (`S400` from line 272), and Job Review gives no cut-last warning.
- **V3-P2-2 (KNOWN).** On `$10=0`, Restore saved origin sends only `$X`, and the card vanishes with no message. V3 wrote that the next Frame refuses. In the journey it instead asked "User Origin needs a custom work origin. OK: set the work origin at the current head position". OK re-ran the job 3.5 mm and 2.05 mm away from the aborted partial burn. The outcome is U4-P2-3's, which U4 rated P2, so the rating stands. The correction is to V3's wording.

## Journey matrix

| # | Journey | Steps run (real UI unless noted) | Result | First wrong step |
|---|---|---|---|---|
| J1 | New user, stock GRBL `$32=0`, `$10=1` | First run → Connect → Machine Setup (laser-mode question, Cancel) → Import a 4032 × 3024 JPEG made in the page → resize to 16 mm (store) → Photo engraving dialog (preview shown, Apply) → user origin at machine (60, 40), Set origin here → Frame → Job Review → Send $32=1 → Start → Pause → Resume → ABORT JOB → Abort card → Restore saved origin → Frame → Start to the end → close Job complete → Run same job again | **Clean.** Wire and notices as in the Headline. The Frame warning "reaches X -5, past the edge" appeared only with the origin at machine zero, where it is true (5 mm overscan) | Nowhere |
| J1b | Same, `$10=0` | As J1 | **KNOWN V3-P2-2.** Restore sent `$X` only, so WCO stayed (0, 0) with no card, toast or alert. The next Frame asked to set the origin at the head (confirm accepted), and the re-run burned at (63.5, 42.05) instead of (60, 40). Run again was byte-identical to that re-run | Restore saved origin |
| J2 | Logo with a white diamond, 2 × 2 coasters | Import SVG (ring red stroke, black disc, white diamond, black square) → ring operation Line 80 %, logo Fill 40 % (store) → Arrange > Array… > Create array (8 objects) → Set origin here at (50, 50) → Frame → Job Review → Start → cable pull at 45 % → reconnect → automatic Review → Restore saved origin → Start supervised recovery (2 confirms) → end | **KNOWN V7-P2-3** (rings cut first, no warning). Recovery clean: tail equals the program from index 3451 to the end; run 1 covered up to 3463 | Job Review (cut last) |
| J3 | Saved project, edits, closed tab | Open `project-basic.lf2` → Ctrl+A → Array 2 × 2 → Save As (fixture picker) → power 61 → 36 s (one autosave) → power 73 → close tab (beforeunload) → new tab → startup card → File > Recover unsaved work → Restore row 0 or row 1 → Frame → Start | Row 0: **clean** (compile hash equal to pre-close, wire `S730`). Row 1: **KNOWN V7-P1-1** (list empties, the 73 % copy is gone, wire `S610`). The saved file holds 30 %, as saved | Recover list (row 1) |
| J4 | CNC adaptive fallback | Benchmark CNC project, 40 × 20 mm adaptive pocket (store, the #1603 test fixture) → Preview → File > Save G-code… → Connect (Machine Setup cancelled) → Frame (two confirms: set origin at the head, set work Z zero) → Job Review → Start → end | **Clean.** Preview banner and Job Review "offset rings (adaptive fell back)" present. Saved file (51 program lines) equals the streamed program. The `$30` mismatch advisories are true for the sim's `$30=1000` | Nowhere |
| J5 | Browser without file pickers | Pickers deleted before load → banner → drop an SVG on the canvas → toolbar Save → Open… on the edited canvas → Cancel → 35 s → close tab → new tab → card → Restore | **Clean.** Save error: "This browser can't save files … Your work stays in this browser's autosave." Open asks **Unsaved changes** with Cancel (focused) and Don't Save only. Scene equal after restore | Nowhere |
| X1 | #1595 × #1599 toolbar | Connect at 1920/1280/600/360 px, inject `ALARM:1` | **Clean.** Row and toolbar boxes identical before and after "Connected · Alarm"; no horizontal overflow | Nowhere |
| X2 | #1604 × key repeat | Mouse Frame once (confirm accepted), focus **Frame again**, hold Enter 1.5 s and 4 s (500 ms delay, 33 ms repeat, CDP) | **V9-P3-1:** 1 extra trace at 1.5 s, 2 at 4 s | Frame job |

## Findings

### V9-P3-1 — A held Enter on Frame job re-runs the Frame: #1604 hands focus back to the button when it re-enables

- **Where (5f09e1110):**
  - `src/ui/common/use-focus-through-disable.ts:31-34`. When the button re-enables, `control.focus()` runs if focus is still on the group.
  - `src/ui/laser/JobActionControls.tsx:164` applies it to Frame job, and `src/ui/laser/OriginRow.tsx:69` applies it to Set origin here.
- **Anchor:**
  - Twin: V8-P2-1's mechanism (`LiveMotionActionButton.tsx:51-56`). A button that keeps or regains focus, plus Chromium's activation on every auto-repeated Enter keypress (the V8 auditor's `html_element.cc` citation).
  - Contract: the hook's own header (`use-focus-through-disable.ts:8-9`) says "The button stays truly disabled, so nothing can press it meanwhile". That holds while it is disabled, but not on the repeats after it re-enables.
  - Before #1604, a Frame that disabled itself dropped focus to the page, so further repeats did nothing. The hook's own header says so (`use-focus-through-disable.ts:3-6`, U7-P3-1), and the V8 refuter measured the same drop for Pause before #1570.
- **Scenario:** a connected laser and a framed job. The operator Tabs to **Frame again** and holds Enter. Keypress 1 starts the Frame. While it runs, focus waits on "Job actions" and the repeats do nothing. When the Frame ends, focus returns to the button, and the next repeat starts another Frame.
- **Evidence: REPRO** (`e2e/zz-v9-held-enter-frame.e2e.ts`, Chrome 156 headless, CDP `Input.dispatchKeyEvent` keyDown, then autoRepeat keyDowns from 500 ms at 33 ms, then keyUp; simulated GRBL at 200 blocks/s). `G4 P0.01` fences, one per Frame, counted from the wire:
  ```
  frame-hold-1500  label "Frame again"  fences 1 -> 2  (frameRuns 1)
  frame-hold-4000  label "Frame again"  fences 1 -> 3  (frameRuns 2)
  focus log: 62 ms "off|Job actions" (focus held on the group while disabled)
  ```
  Each extra run sent the same five `$J=G90 G21 …` moves as the first.
- **User-visible effect:** the head traces the outline again, beam off, without a new key press. A held Enter does the same to Set origin here (READ only). That rewrites the origin at the same head position, so it is harmless.
- **Severity: P3.**
  - The move repeats the Frame the operator just asked for, beam off, over the same outline, and only while the key is still held.
  - A Frame takes seconds, so the hold must outlast it.
  - It is not P1's "move the machine unexpectedly": nothing new or unseen moves, and nothing burns.
  - It matters as a second instance of V8-P2-1's class. A fix for V8-P2-1 that only guards the Pause/Resume button leaves this route open.
- **Novelty:** new. V8 checked that #1604's focus hold works (`V8-fix-help-a11y-wording.md:84`), not what a key repeat does after it. V8-P2-1 is the Pause button (#1570). No open PR touches `use-focus-through-disable.ts` (`gh pr list` file filter: #1609 and #1612 touch `JobActionControls.tsx` for wording and Preview only).
- **Fix direction:** ignore `KeyboardEvent.repeat` activations on the buttons whose focus is held or kept (one guard shared with V8-P2-1's fix), or return focus only when the operator has not pressed a key in the meantime.

## KNOWN, re-observed in the rendered app

These add browser evidence to ledgered findings. They are not re-raised.

- **V7-P1-1** (`UnsavedWorkDialog.tsx:93-97`, `autosave-local-storage.ts:134-147`). V7's UI half was READ; it is now rendered (`zz-v9-journey3.e2e.ts`, `ZZ_ROW=1`).
  - The two rows read "4 objects / Autosaved Nov 8, 2026, 8:57 AM (less than a minute ago)" and the same with 8:56 AM. Nothing says they are one session or which holds the later edit.
  - Restoring the 8:56 row gave power 61. File > Recover unsaved work then said "No unsaved work from earlier sessions.", and the Start burned `S610` where the closed tab's last state was `S730`.
  - Restoring the newer row (`ZZ_ROW=0`, run twice) lost nothing.
- **V7-P2-3** (`cut-before-engraving.ts:62-75`). In J2's 2 × 2 array, the program cuts the four rings (`G1 … S800`, lines 9, 74, 139, 204) before the first fill line (`S400`, line 272). Job Review's 1 warning is only "KerfDesk can't check where this job sits on your bed".
- **V3-P2-2** (`AbortStoppedCard.tsx:42-55`). With `$10=0`:
  - **Restore saved origin** sent `$X` and nothing else. The card closed, and no toast or alert appeared.
  - About 4 s later, Frame asked: "User Origin needs a custom work origin. OK: set the work origin at the current head position — the job runs from here — and then Frame the updated placement before starting." OK (accepted by the test) sent `G54 G92 X0 Y0` at machine (63.5, 42.05), and the re-run burned there, offset (+3.5, +2.05) mm from the aborted partial burn at (60, 40).
  - V3's text says the next Frame "refuses with 'Position is unknown after Unlock…'". That happens only before a `WCO:` report arrives; after one, it asks instead.
  - The asked-for outcome is U4-P2-3's (rated P2), so V3-P2-2's P2 stands. The confirm does not mention that the job's saved origin was lost, which is the case for a coordinator re-read.
- **V8-P2-1** was not re-run: the V8 refuter reproduced it in the same Chrome with the same simulator lineage.

## Refuted (auditor-dropped candidates)

1. **"Run same job again is not offered after a job completes."** In J1's first run the button could not be found. The **Job complete** dialog was open and, by #1570's ADR-207 Amd 2, hides the workspace from the accessibility tree. With the dialog closed, the offer is enabled and replays byte-identically.
2. **"Restore saved origin succeeds silently: no toast."** The success toast lives 4,000 ms (`toast-store.ts:21`), and my read came at 4,000 ms. The same toast family showed in J3 ("Restored unsaved work. Save it to keep it as a file.").
3. **"A restored autosave loses its file name ('untitled')."** By design: ADR-688 Decision 1, "Autosaves hold no file name". No data is lost; Save asks for a file.
4. **"One dropped SVG became two objects."** It splits by colour, one object per operation colour, the same as the toolbar import ("Imported logo.svg — 2 objects, 2 colors"). That is the design.
5. **"The recovery resumed from a different line than the capsule's automatic line (3453 vs 3468)."** My probe called `automaticRestart` without the reconnect banner. The Review knows the board restarted and steps back a whole planner (15 lines), as its text says. The resumed tail matches the program from that line.
6. **"Recovery says 3,467 lines were sent, but the simulator logged 3,465."** My wire log records admitted lines only. Two more sat in the receive queue (simulator `stats.written`). The Review's number is the one KerfDesk wrote.

## Verified clean

- **#1567 Amd 7 on the first Connect (browser).** The question shows. Cancel leaves the profile Laser (`Default 400×400`, homing off). Job Review's Send $32=1 confirms with the ADR's text, writes `$32=1`, reads it back ("Laser mode is on: the controller confirmed $32=1."), and clears both the warning and the settings acknowledgement.
- **Start, Pause, Resume, Abort on a raster job (J1).**
  - Override resets `0x90 0x95 0x99` lead the stream, then `G4 P0.01` and `M4 S0`.
  - Pause sends `0x84`, with 0 lines executed in 1.5 s of hold. Resume sends `0x7E`. Abort sends `0x18`, then `M5`, `M9`, `$G`.
  - The Abort card names the right origin. Restore (`$10=1`) sends `$X` and `G54 G21 G92 X12.100 Y1.950`, which put WCO back at (60.000, 40.000).
- **Burn identity across runs.** The aborted run's 1,729 lines equal the full run's first 1,729 lines. Run same job again equals the previous run (11,865 lines). With `$10=0`, Run again also equals its own previous run.
- **Interrupted-job recovery after a cable pull (J2).**
  - The capsule saved `disconnect`, 3,463 acknowledged of 7,691. The Review opened by itself on reconnect, named the origin then and now, and offered Restore. After Restore it said "The work origin matches".
  - The automatic line and the step-back sentence are true. Supervised recovery streamed the program from index 3451 to the end, byte for byte.
- **Knock-out toast (#1556).** "1 white shape will not burn, as in the file: it was cut out of the shapes under it." True for the file.
- **#1603 on its routes (browser).** The canvas preview banner, Job Review's warning headline, and the operation detail "offset rings (adaptive fell back)". Save G-code then Start stream the same program.
- **ADR-688 in a browser without pickers (J5).** Every message is true, the Cancel-first question works, drag-and-drop imports, and autosave survives a tab close.
- **Startup card and Recover list (J3/J5).** The card's count and age are true. Restoring the newest copy is exact (compile hash equal), and the next Start burns it.
- **Toolbar width with #1595's " · Alarm" (X1).** Unchanged at four widths.
- **L12 cross-PR file pairs.** Both PRs' changes are present in `ConnectionBar.tsx`, `JobActionControls.tsx`, `OriginRow.tsx` and `LiveMotionBar.tsx`. The specs that cover them pass (table below).

## L12 — e2e specs CI would have run

CI on a main push runs the whole development suite in shards ("Chrome UX smoke"), plus the cold-start spec and `production-bundle.spec.ts` ("Browser test checks and production-bundle smoke", `.github/workflows/e2e.yml`). A pull request runs the core list in `scripts/run-pr-browser-smoke.mjs:15-27` plus the specs it changed. Order run here:

1. The specs the nine PRs changed (#1598 `command-search-panel-actions`, #1600 `browser-responsiveness`, `startup-splash`).
2. The PR core list.
3. The specs #1599's body names.
4. The specs V3, V4, V5, V7 and V8 listed as owed.
5. The specs that import #1600's changed fixtures.
6. The rest of the suite, with V6's 50 already-run text and CNC tests last.

**Summary.** 152 of 152 development spec files ran. `production-bundle.spec.ts` needs `dist/web` and is under Not verified. On the first pass, 145 files passed and 7 failed. The 7 resolve as follows:

| Spec | First run | Then | Verdict |
|---|---|---|---|
| `tools-create-audit.e2e.ts` | 22 failed: `ERR_CONNECTION_REFUSED` at :5173 | 22/22 pass with `PLAYWRIGHT_PORT=4819` | **Harness.** The spec reads its own port variable (`:34`). |
| `machine-rail-live-job.spec.ts` | 2 of 4 timed out at 60 s, waiting for the side panel and the Not now button. Other sessions' Vitest, ESLint and Playwright runs were loading the PC; free memory fell to 0.3–1.3 GB that hour | 4/4 on rerun | **Load timeout.** |
| `connected-script-gcode-compile.e2e.ts` | `waitForEvent('worker')` 10 s timeout | 1/1 on rerun | **Load timeout.** |
| `heavy-canvas-workers.e2e.ts` | Heartbeat gaps 1,641 and 1,446 ms against a 1,000 ms ceiling | 2/2 on rerun | **Load timing.** The spec uses #1600's changed fixture, and #1600 is what tells runner stalls from UI blocks. |
| `startup-live-motion.e2e.ts` | 2/2 "The pause panel must not paint over the splash" (pixel compare) | Main: 1/2, then 2/2 again. **Pre-window `87f0ec583`, same Chrome: 2/2 failed twice.** The failure screenshot shows the splash with no visible panel | **Local environment.** CI passed it at `87f0ec583` (run 41996541405: only `controller-recovery-toast` and `startup-splash` failed, both fixed in the window by #1599 and #1600). |
| `gcode-viewer-density.e2e.ts` | 1 of 7: "coplanar traversal cannot repaint a completed cut", 2535 against at least 3048.78 px | Same on rerun. **Same on pre-window `87f0ec583`** (2535) | **Local environment** (headless WebGL). The window changed no file under the G-code viewer (`git diff --stat 87f0ec583 5f09e1110`). |

Skips are opt-in by design, the same as CI: `dense-trace-canvas-navigation` (`KERFDESK_DENSE_CANVAS_AUDIT`), `big-job-run-responsiveness` (`KERFDESK_BIG_JOB_PERF`), and 10 corpus cases in `document-import-acceptance`. V4 and V5 listed `dense-trace-canvas-navigation` as owed; it is opt-in in CI too, and was not forced on.

**Per spec** (reruns after "then"; a passed/failed count per run):

| Spec | Group | Result (passed/failed) |
|---|---|---|
| `startup-splash.e2e.ts` | changed by #1598/#1600 | pass 9/0 |
| `browser-responsiveness.spec.ts` | changed by #1598/#1600 | pass 12/0 |
| `command-search-panel-actions.e2e.ts` | changed by #1598/#1600 | pass 1/0 |
| `controller-recovery-toast.spec.ts` | #1599 fix target | pass 8/0 |
| `foundations.spec.ts` | PR core | pass 3/0 |
| `ux-shell.spec.ts` | PR core | pass 6/0 |
| `shared-chrome-layout.spec.ts` | PR core | pass 4/0 |
| `status-bar-layout.spec.ts` | PR core | pass 3/0 |
| `workbench.e2e.ts` | PR core | pass 11/0 |
| `small-document-scenarios.spec.ts` | PR core | pass 7/0 |
| `composed-svg-roundtrip.e2e.ts` | PR core | pass 7/0 |
| `canvas-text-editing.spec.ts` | PR core | pass 6/0 |
| `project-save-worker.e2e.ts` | PR core | pass 2/0 |
| `first-connect-machine-setup.e2e.ts` | PR core | pass 8/0 |
| `gcode-viewer-preview.e2e.ts` | PR core | pass 1/0 |
| `audit-workflow-repairs.spec.ts` | #1599 body | pass 3/0 |
| `machine-details-focus.e2e.ts` | #1599 body | pass 2/0 |
| `safety-notice-toast.spec.ts` | #1599 body | pass 4/0 |
| `second-pass-workbench.spec.ts` | #1599 body | pass 2/0 |
| `toast-placement.e2e.ts` | #1599 body | pass 2/0 |
| `workspace-responsive.e2e.ts` | #1599 body | pass 17/0 |
| `omission-review-repairs.e2e.ts` | #1599 body | pass 2/0 |
| `production-workflows.spec.ts` | #1599 body | pass 22/0 |
| `machine-tools-dropdowns.e2e.ts` | #1599 body | pass 6/0 |
| `jog-controls-layout.e2e.ts` | #1599 body | pass 3/0 |
| `interface-simplification.spec.ts` | V8 owed / #1595 | pass 2/0 |
| `dialog-opener-focus.spec.ts` | V8 owed / #1595 | pass 4/0 |
| `startup-live-motion.e2e.ts` | V8 owed / #1595 | FAIL 0/2 |
| `controller-incidents-repairs.e2e.ts` | V8 owed / #1595 | pass 1/0 |
| `machine-rail-live-job.spec.ts` | V8 owed / #1595 | FAIL 2/2; then pass (rerun) 4/0 |
| `laser-override-reset.e2e.ts` | V8 owed / #1595 | pass 1/0 |
| `serial-worker-handover.e2e.ts` | V8 owed / #1595 | pass 7/0 |
| `connected-script-gcode-viewer.e2e.ts` | #1600 fixtures | pass 1/0 |
| `connected-script-gcode-compile.e2e.ts` | #1600 fixtures | FAIL 0/1; then pass (rerun) 1/0 |
| `heavy-canvas-workers.e2e.ts` | #1600 fixtures | FAIL 0/2; then pass (rerun) 2/0 |
| `workspace-large-raster.e2e.ts` | #1600 fixtures | pass 1/0 |
| `trace-presets-stress-worker.e2e.ts` | #1600 fixtures | pass 7/0 |
| `depth-map-relief-worker.e2e.ts` | #1600 fixtures | pass 1/0 |
| `cnc-3d-viewer-ab.e2e.ts` | #1600 fixtures | pass 2/0 |
| `tracer-ui.spec.ts` | V3–V7 owed | pass 3/0 |
| `trace-sharp-output.e2e.ts` | V3–V7 owed | pass 1/0 |
| `tracer-preview-upgrades.e2e.ts` | V3–V7 owed | pass 1/0 |
| `trace-part-editing.e2e.ts` | V3–V7 owed | pass 2/0 |
| `dense-trace-canvas-navigation.e2e.ts` | V3–V7 owed | pass 0/0/1 skip |
| `photo-shading.e2e.ts` | V3–V7 owed | pass 2/0 |
| `image-studio-adjust-preview.e2e.ts` | V3–V7 owed | pass 1/0 |
| `photo-engraving.e2e.ts` | V3–V7 owed | pass 1/0 |
| `array-grid-tenths.e2e.ts` | V3–V7 owed | pass 1/0 |
| `tools-vector-audit.e2e.ts` | V3–V7 owed | pass 26/0 |
| `canvas-text-weld.spec.ts` | V3–V7 owed | pass 1/0 |
| `numeric-input-app-audit.spec.ts` | V3–V7 owed | pass 5/0 |
| `autosave-session-ownership.e2e.ts` | V3–V7 owed | pass 1/0 |
| `autosave-version-preservation.e2e.ts` | V3–V7 owed | pass 3/0 |
| `large-heightfield-autosave.e2e.ts` | V3–V7 owed | pass 1/0 |
| `settings-sync-deep-audit.spec.ts` | V3–V7 owed | pass 4/0 |
| `cold-start-variable-text.spec.ts` | V3–V7 owed | pass 1/0 |
| `recovery-deep-audit.spec.ts` | V3–V7 owed | pass 10/0 |
| `recovery-second-pass-stress.spec.ts` | V3–V7 owed | pass 10/0 |
| `second-pass-replay.spec.ts` | V3–V7 owed | pass 1/0 |
| `native-serial-background.e2e.ts` | V3–V7 owed | pass 1/0 |
| `big-job-run-responsiveness.e2e.ts` | V3–V7 owed | pass 0/0/1 skip |
| `advanced-nesting.spec.ts` | rest | pass 5/0 |
| `artwork-field-rows.e2e.ts` | rest | pass 4/0 |
| `artwork-library-acceptance.e2e.ts` | rest | pass 2/0 |
| `artwork-operations-ux.e2e.ts` | rest | pass 7/0 |
| `artwork-panel-refresh.e2e.ts` | rest | pass 1/0 |
| `artwork-power-multiplier.spec.ts` | rest | pass 1/0 |
| `barcode-acceptance.e2e.ts` | rest (V6 also ran) | pass 1/0 |
| `box-generator-worker.e2e.ts` | rest | pass 3/0 |
| `button-audit-regressions.spec.ts` | rest | pass 2/0 |
| `calligraphy-fonts.spec.ts` | rest (V6 also ran) | pass 8/0 |
| `camera-rtsp-liveness.e2e.ts` | rest | pass 1/0 |
| `canvas-text-worker.spec.ts` | rest (V6 also ran) | pass 1/0 |
| `cnc-leaders-build.e2e.ts` | rest (V6 also ran) | pass 3/0 |
| `cnc-spindle-review.spec.ts` | rest (V6 also ran) | pass 1/0 |
| `cnc-stage-recipes.e2e.ts` | rest (V6 also ran) | pass 1/0 |
| `competitor-repairs.e2e.ts` | rest | pass 4/0 |
| `convert-bitmap.spec.ts` | rest | pass 3/0 |
| `cut3d-surface-swap.e2e.ts` | rest | pass 1/0 |
| `design-library-preview.e2e.ts` | rest | pass 1/0 |
| `design-studio-layout.e2e.ts` | rest | pass 1/0 |
| `design-studio-photo-workflow.e2e.ts` | rest | pass 1/0 |
| `design-studio-point-tools.e2e.ts` | rest | pass 2/0 |
| `design-tools-batch-8.e2e.ts` | rest | pass 3/0 |
| `document-import-acceptance.e2e.ts` | rest | pass 11/0/10 skip |
| `extend-shapes.e2e.ts` | rest | pass 1/0 |
| `focus-test-resume.e2e.ts` | rest | pass 1/0 |
| `focus-test.e2e.ts` | rest | pass 4/0 |
| `font-picker.spec.ts` | rest (V6 also ran) | pass 3/0 |
| `frame-after-finished-job.spec.ts` | rest | pass 2/0 |
| `frame-once-process-edits.spec.ts` | rest | pass 5/0 |
| `gcode-large-worker.e2e.ts` | rest | pass 4/0 |
| `gcode-viewer-burn.e2e.ts` | rest | pass 2/0 |
| `gcode-viewer-density.e2e.ts` | rest | FAIL 6/1; then FAIL (rerun) 6/1 |
| `gcode-viewer-detail.e2e.ts` | rest | pass 1/0 |
| `gcode-viewer-gpu-copies.e2e.ts` | rest | pass 1/0 |
| `gcode-viewer-keys.e2e.ts` | rest | pass 1/0 |
| `gcode-viewer-pick.e2e.ts` | rest | pass 3/0 |
| `gcode-viewer-stock.e2e.ts` | rest (V6 also ran) | pass 3/0 |
| `gcode-viewer-top-view.e2e.ts` | rest | pass 1/0 |
| `height-map-import-worker-alpha.e2e.ts` | rest | pass 1/0 |
| `height-map-import-worker-png16.e2e.ts` | rest | pass 1/0 |
| `height-map-import-worker.e2e.ts` | rest | pass 1/0 |
| `image-studio-transform-alpha.e2e.ts` | rest | pass 1/0 |
| `installed-app-file-io.spec.ts` | rest | pass 4/0 |
| `laser-lead-start-reseed.e2e.ts` | rest | pass 4/0 |
| `lightburn-large-worker.e2e.ts` | rest | pass 1/0 |
| `material-library-large-worker.e2e.ts` | rest | pass 1/0 |
| `multi-selection-rotation.spec.ts` | rest | pass 2/0 |
| `multilingual-text-shaping.spec.ts` | rest (V6 also ran) | pass 1/0 |
| `native-project-large-worker.e2e.ts` | rest (V6 also ran) | pass 1/0 |
| `native-smoke-renderer.e2e.ts` | rest | pass 1/0 |
| `nesting-worker-observer.spec.ts` | rest | pass 3/0 |
| `performance.spec.ts` | rest | pass 1/0 |
| `photo-engraving-numbers.e2e.ts` | rest | pass 2/0 |
| `photo-engraving-recipes.e2e.ts` | rest | pass 1/0 |
| `photo-raster-full.e2e.ts` | rest | pass 2/0 |
| `photo-tone-calibration.e2e.ts` | rest | pass 1/0 |
| `place-board-layout.e2e.ts` | rest | pass 4/0 |
| `png-200mb-import.e2e.ts` | rest | pass 1/0 |
| `png-asset-lifecycle.e2e.ts` | rest | pass 2/0 |
| `png-asset-startup-reconciliation.e2e.ts` | rest | pass 2/0 |
| `png-incremental-worker.e2e.ts` | rest | pass 1/0 |
| `positioning-light.e2e.ts` | rest | pass 2/0 |
| `post-release-machine-retention.spec.ts` | rest | pass 1/0 |
| `post-release-numeric-scenarios.spec.ts` | rest | pass 7/0 |
| `preview-entry-parity.spec.ts` | rest | pass 1/0 |
| `preview-layout-stability.e2e.ts` | rest | pass 2/0 |
| `process-recipe-acceptance.e2e.ts` | rest | pass 2/0 |
| `project-production-reuse.spec.ts` | rest | pass 1/0 |
| `project-worker-extensions.e2e.ts` | rest | pass 1/0 |
| `psd-import.e2e.ts` | rest | pass 1/0 |
| `rail-form-css.spec.ts` | rest | pass 3/0 |
| `raster-calibration.spec.ts` | rest | pass 2/0 |
| `registration-tools-audit.e2e.ts` | rest | pass 3/0 |
| `serial-worker-framing.e2e.ts` | rest | pass 1/0 |
| `shape-properties.spec.ts` | rest | pass 1/0 |
| `small-numeric-editing-audit.spec.ts` | rest | pass 6/0 |
| `small-text-focus-audit.spec.ts` | rest (V6 also ran) | pass 7/0 |
| `small-workspace-interactions.spec.ts` | rest | pass 7/0 |
| `start-points.spec.ts` | rest | pass 4/0 |
| `svg-large-worker.e2e.ts` | rest | pass 1/0 |
| `text-render-worker.spec.ts` | rest (V6 also ran) | pass 1/0 |
| `tools-ai-audit.e2e.ts` | rest | pass 1/0 |
| `tools-create-audit.e2e.ts` | rest | FAIL 0/22; then pass (port) 22/0 |
| `tools-file-audit.e2e.ts` | rest | pass 3/0 |
| `tools-image-audit.e2e.ts` | rest | pass 7/0 |
| `topology-repairs.e2e.ts` | rest | pass 2/0 |
| `trim-shapes.e2e.ts` | rest | pass 1/0 |
| `variable-array-acceptance.e2e.ts` | rest (V6 also ran) | pass 2/0 |
| `vcarve-conversion.spec.ts` | rest (V6 also ran) | pass 3/0 |
| `workspace-context-menu.spec.ts` | rest | pass 3/0 |

## Not verified

- **The desktop build** (L12): `pnpm build:web` runs a full `tsc` (about 5 GB) and `vite build` at 6 GB heap. Free memory ranged 0.3–3.7 GB, mostly under 2.6 GB, so neither ran. For the same reason, `production-bundle.spec.ts` (which needs `dist/web`) was not run.
- **The opt-in specs** (`dense-trace-canvas-navigation`, `big-job-run-responsiveness`) skipped themselves, as on CI.
- **The two local-only e2e failures** (`startup-live-motion`, `gcode-viewer-density`) could not be checked on CI's Chrome. They fail identically on the pre-window tree here, so the nine merges are not the cause, but a CI run of main is still owed.
- **Electron 44.9.1 (Chromium 152).** All runs were Chrome for Testing 156. V9-P3-1 rests on the same Blink activation path as V8-P2-1.
- **Journey 3's embedded CJK font and CSV badges.** No `queryLocalFonts` and no CJK font file in headless Chrome. V6 ran `variable-array-acceptance`, `cold-start-variable-text`, `multilingual-text-shaping` and the text specs on this SHA. Rest machining (J4) was not driven in the browser; V6 compiled it.
- **1.0.29 side by side in the browser.** Not run. The G-code identity across the upgrade is V2's and V5's Node result.
- **Timing.** No latency was measured. V1-P1-1's Abort-after-first-line delay needs a large job and a quiet PC.
- **Hardware:** none, by instruction.

Repro specs, fixture and outputs (scratchpad `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v9\`):
- `mut\e2e\zz-v9-journey1.e2e.ts` … `zz-v9-journey5.e2e.ts`, `zz-v9-held-enter-frame.e2e.ts`, `zz-v9-alarm-width.e2e.ts`, `mut\e2e\fixtures\zz-v9-grbl.js`;
- `pre\` is an export of the pre-window main `87f0ec583`, used only for the two attribution runs (`results\slm-pre-*.log`, `results\density-pre.log`; failure screenshots in `evidence\`);
- `results\*.out.json` (step records), `results\*.gcode` / `*.nc` (wire and saved programs), `results\*.log` (Playwright output per spec), `results\A.txt` and `results\Q.txt` (the run log), `scripts\run-queue.sh` (the memory-gated runner).

```json
[
  {"id":"V9-P3-1","severity":"P3","area":"V9","file":"src/ui/common/use-focus-through-disable.ts","line":34,"anchor":"Twin: V8-P2-1 key-repeat activation (LiveMotionActionButton.tsx:51-56); Contract: hook header :8-9","evidence":"REPRO (Chrome 156, CDP key repeat, simulated GRBL: 4 s hold = 2 extra Frames)","verdict":"PENDING","known":false,"summary":"#1604 returns focus to Frame job when it re-enables, so a held Enter re-runs the beam-off Frame (and Set origin here); before #1604 repeats went to body"},
  {"id":"V7-P1-1","severity":"P1","area":"V9 (re-observed)","file":"src/ui/app/UnsavedWorkDialog.tsx","line":93,"anchor":"see V7","evidence":"REPRO (browser): two rows 8:56/8:57, older restore empties list, Start burns S610 not S730","verdict":"KNOWN","known":true,"summary":"Rendered: the two copies of one closed tab are indistinguishable rows; restoring the older loses the newer"},
  {"id":"V7-P2-3","severity":"P2","area":"V9 (re-observed)","file":"src/core/cut-before-engraving.ts","line":62,"anchor":"see V7","evidence":"REPRO (browser): 2x2 coasters, rings S800 lines 9-204 before fill S400 line 272, no warning","verdict":"KNOWN","known":true,"summary":"Array of coasters cuts every ring before engraving with no cut-last warning"},
  {"id":"V3-P2-2","severity":"P2","area":"V9 (re-observed)","file":"src/ui/laser/AbortStoppedCard.tsx","line":42,"anchor":"see V3","evidence":"REPRO (browser, $10=0): $X only, no message; next Frame asks to set origin at head; re-run +3.5/+2.05 mm off","verdict":"KNOWN","known":true,"summary":"Next Frame asks (not refuses) once a WCO report arrives; OK re-runs off the aborted burn"}
]
```

## Refuter (2026-11-08)

- **Tree:** origin/main `5f09e1110` and pre-window main `87f0ec583`, as my own `git archive` exports in scratchpad `zz-v9r\mut` and `zz-v9r\pre`. Each has a `node_modules` junction and the same `fflate` alias and private Vite cache as the auditor's. `zz-v9r\mut\src` is `diff -rq`-identical to `j10-main\src`.
- **Runs:** my own Vite dev server (`--mode desktop`) on 127.0.0.1:4899, warmed before each tree. Playwright 1.61.1, headless, one worker, one spec per process, with the cached Chrome for Testing 156 (`chromium-1248`) via `executablePath`. Each launch was memory-gated at 2 GB free. Free memory ranged from 1.1 to 3.1 GB.
- **Kept to the brief:** nothing was downloaded or installed, no pnpm, no hardware, and the installed KerfDesk was not launched. The simulator is the auditor's `zz-v9-grbl.js`, copied unchanged.
- **Specs and outputs:** scratchpad `zz-v9r\mut\e2e\zz-v9r-*.e2e.ts`, `zz-v9r\results\`.

### V9-P3-1: CONFIRMED, P3 (one count corrected)

- **Pins re-read at `5f09e1110`:**
  - `use-focus-through-disable.ts:31-34`: focus goes back to the control when it re-enables.
  - `JobActionControls.tsx:164`: Frame job uses the hook.
  - `OriginRow.tsx:69`: Set origin here uses it.
  - The hook does not exist at `87f0ec583` (`grep useFocusThroughDisable` finds nothing in `pre\src`), so #1604 introduced it.
- **REPRO:** I ran the auditor's `zz-v9-held-enter-frame` spec unchanged, as `zz-v9r-held-enter-frame.e2e.ts`. Result in `results\hef-a`:
  - 1.5 s hold: fences 1 → 2, 1 Frame run.
  - 4 s hold: fences 1 → 3, 2 Frame runs, each the same five `$J=` moves.
  - Focus stayed on "Job actions" while the button was off, for the first 2.2 s.
- **Correction to the journey matrix (row X2).** It says "1 extra trace at 1.5 s, 2 at 4 s". The first Frame of each hold is the intended key press, so the extra traces are 0 at 1.5 s and 1 at 4 s. The Headline's "two traces from one 4 s hold" is right.
- **No run at `87f0ec583` for comparison.** The memory gate never cleared: free memory stayed at 0.98–1.5 GB for 40 min. The claim that repeats fell to the page before #1604 rests on the hook's absence there and on the V8 refuter's measurement.
- **Severity: P3.**
  - The extra move is a beam-off re-trace of the outline the operator just framed. It needs a key held longer than one whole Frame.
  - I checked whether a Frame can fire the beam. A positioning light with `afterFrame` (`positioning-light.ts:12-13`), including the A1 Pro laser dot, only relights what the first Frame already lit.
  - It is a second route for V8-P2-1's class, which a fix should share.

### V3-P2-2 re-rate: **P1** (I disagree with V3 and with V9's "the rating stands")

**What I checked.** The P2 rests on V3's sentence: "the next Frame refuses or asks before setting an origin, so nothing burns in the wrong place". V9 reaches P2 by analogy with U4-P2-3. I tested both in the rendered app. Spec: `zz-v9r-abort-mask0.e2e.ts`.
- **Setup:** `$10=0`; a 30 × 22.5 mm photo raster; User Origin set at machine (60, 40).
- **Run:** Frame → Job Review → Start → **ABORT JOB** → the card's **Restore saved origin**. Then 8 s of sampling every 0.5 s, then Frame, accept, and Start.
- **Repeats:** twice. Run a aborted at 6 s and framed 14 s after Restore. Run b aborted at 3 s and framed at 8 s.

**What the operator is shown, step by step (both runs):**

1. **The card before Restore.**
   - It says: "The controller reset, so your origin was cleared. It was at X 60, Y 40 mm from machine zero."
   - It also says: "Restore saved origin unlocks the controller and puts the origin back where the job started, without moving the head." That text is `AbortStoppedCard.tsx:198-202`.
   - The button's hover says "…write the job's origin back with one G92. The head does not move." (`:115-119`).
2. **Clicking Restore.**
   - The wire carries `$X` only.
   - The card is gone within 0.5 s, the same way it goes on success.
   - Over 8 s, a MutationObserver installed before load caught **no toast at all**, and there was **no `role=alert`**. `lastWriteError` stayed null. The failure exists only in the unmounted card's state (`AbortStoppedCard.tsx:50-51`).
   - The rail shows "State: Idle" and "Interrupted job saved · laser · 1276 of 8193 lines acknowledged", with nothing about the origin.
   - The success toast that did not come would have said "Origin restored at X 60, Y 40 … Frame the job to check where it lands" (`:204-209`). So the next thing the operator does is Frame, as a success would have told them.
3. **Frame.** It did **not** refuse in either run. The first click went straight to the confirm:
   > User Origin needs a custom work origin.
   >
   > OK: set the work origin at the current head position — the job runs from here — and then Frame the updated placement before starting.
   > Cancel: leave the job blocked.

   - This is `start-blocked-setup-offers.ts:15-21`, the same text a fresh first Frame shows (the held-Enter spec gets it on a clean connect).
   - It held even with `positionEvidenceSuppressed: true` and `wcoCache: null` at the click.
   - Why: the Frame first waits, with a time limit, for an offset report (`frame-blocker-repair.ts:51`, `:96-101`; `frame-status-wait.ts:20-32`). It then offers the set-origin repair for the sole User Origin refusal, whichever way that wait ends (`:52-54`).
   - The withheld-position refusal V3 quotes is applied only in `reportFrameRefusal` (`frame-dispatch-support.ts:138-146`), which this path never reaches. **V3's "the next Frame refuses" does not happen on this path. V9's "only before a `WCO:` report arrives" is not needed either: it offered at 8 s, still suppressed.**
4. **OK.**
   - `G54 G92 X0 Y0` at the head: machine (69.8, 45.75) in run a, (70.3, 44.05) in run b.
   - Rail: "Ready to start — framed placement unchanged".
   - Toast: "Frame complete — press Start to review and run the current settings at this placement."
5. **Job Review.** It is word for word the first run's Review: "ORIGIN User origin, Anchor front left", "Runs from User origin — anchor front left", and the same 2 generic warnings. Nothing names the interrupted job, its recorded origin, or a change.
6. **Start.** The re-run engraves the same 30 × 22.5 mm job offset by **(+9.8, +5.75) mm** in run a and **(+10.3, +4.05) mm** in run b from the aborted partial burn. V9 measured (+3.5, +2.05) / (+5.7, +2.05). That is over the half-engraved piece.

**Verdict: P1** (wrong physical output, position; METHOD §3).

- **Lowering needs a specific warning, and there is none.** §3 lets a refuter lower a P1 only when "a clear warning reaches the operator before the output is produced". G6 adds that the app must tell the operator "about the specific mismatch". Here:
  - The only text on the path is the generic first-origin offer. It names neither the saved origin (X 60, Y 40) nor the head's distance from it.
  - The app holds both numbers at that moment: `originAtStopMm` on the stop request, and the capsule the rail still lists.
  - Frame is not a warning (G6).
  - Job Review repeats the first Review.
- **What makes this different from U4-P2-3** (P2, P1 weighed and rejected). U4's refuter kept P2 because the operator had been told nothing that contradicted the prompt: the card said "Position is lost", and the stated placement was the only claim on screen. Here the app made the opposite claim first.
  - Its main button promised "puts the origin back where the job started, without moving the head".
  - It then failed with no word. To the operator, a card closing with no message is what success looks like: the 4 s success toast is the only difference.
  - The operator therefore reads "set the work origin at the current head position" as a routine Frame step: the same prompt they accepted when they first set up, now over a head that "did not move" from where the job was.
  - With offsets of 2–10 mm, nothing on the bed contradicts that. A reasonable user accepts. The confirm has no information that would make them stop, and Cancel reads "leave the job blocked".
- **Reach.** Stock GRBL with `$10=0` (V3: a supported setting, and KerfDesk's own comment calls it common), plus User Origin, plus ABORT JOB, plus re-running the job. §3 gives P1 no reach clause.
- **Fix direction** (in addition to V3's):
  - Push the card's failure as an error toast (`AbortStoppedCard.tsx:50-51`).
  - While an operator Abort's `originAtStopMm` stands unrestored, replace the generic offer with the mismatch: "Your job's origin (X 60, Y 40) was not restored. The head is 9.8 mm right and 5.8 mm back of it. OK sets the origin here."
  - Or refuse the offer and point at Restore.

### V7-P1-1: agree (spot check)

- I ran the auditor's `zz-v9-journey3` spec unchanged, with `ZZ_ROW=1`. It passed.
- The Start after restoring the older row streamed `S610` only (`results\j3-row1`: 4 × `S610`, no `S730`). That is the 61 % copy.
- My harness overwrote the row-text record with the wire file, so the 8:56/8:57 row texts are the auditor's alone. No disagreement.

### L12: the two local e2e failures

**`startup-live-motion.e2e.ts`: environment (CPU load). The pixel compare is too strict; this is not a product fault.**

- **The messages are the same on both trees.** Every one of the auditor's 4 logs fails at `:41` "The pause panel must not paint over the splash" with `Buffer.equals` false: main twice, `87f0ec583` twice. The spec, `index.html` and `src/ui/app` are identical between the trees. The only difference is `LiveMotionBar.tsx` (#1595).
- **On a warmed server at 2 GB free, main passes.** `results\slm-main-1/2`: 2/2 passed twice.
- **Pre-window rerun on a warmed server:** not done. The `87f0ec583` server was warmed (111 s), but the 2 GB gate skipped the run at 976 MB free. My pass at main, against the auditor's identical failures on both trees, already shows the failure follows the PC's state, not the tree.
- **The diagnostic** (`zz-v9r-slm-diag.e2e.ts`: the same steps, four screenshots of the panel box, shown/hidden/hidden-again/shown-again):
  - Unthrottled: all four are byte-identical. The splash is visible, its art decoded (1672 × 941), and the panel paints under it.
  - With CDP CPU throttling ×6: the screenshots alternate between two encodings (69,320 and 69,323 bytes) **whether or not the panel is hidden**. Hidden-1 equals hidden-2, while shown-2 differs from hidden-2.
  - Decoded, the two differ in 11,521 of 79,200 pixels by **at most 2 levels per channel**, across the splash art (box x 103–719).
  - That is splash re-rasterisation noise under load, not the panel showing through. A panel overlap would differ by up to 255 in the text.
  - The auditor's failure screenshots show no panel, which is consistent.
- **Cause:** a busy PC (free memory 0.3–1.3 GB in the auditor's hour) re-rasterises the splash between two screenshots, and the spec compares exact bytes. CI's runner is quiet. Not memory as such, and not fflate.

**`gcode-viewer-density.e2e.ts` "coplanar traversal cannot repaint a completed cut": caused by the local GPU, and real on that GPU (new finding V9-P3-2 below).**

- **The failures match exactly.** Main, the auditor's two runs and mine, and `87f0ec583`: `Received: 2535`, expected ≥ 3048.78 (before = 3111). The spec is identical on both trees. The number is deterministic, so this is not load.
- **This PC's headless Chrome renders WebGL on the real GPU:** `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics … Direct3D11 vs_5_0 ps_5_0, D3D11)`, 24-bit depth (`zz-gl.mjs`). CI's GPU-less Ubuntu runners (`channel: 'chrome'`) render with SwiftShader.
- **With `--use-angle=swiftshader --enable-unsafe-swiftshader`, the same test on main passes** (`results\density-main-sw.log`: 1 passed). Without them it fails with 2535 (`density-main.log`).
- **In the auditor's `87f0ec583` screenshots:**
  - The cut line's blue pixels fall from 1,667 to 938 when Travel is turned on: 44 % of the line is lost.
  - The line colour shifts from (120, 164, 200) to (135, 168, 203).
  - The other blue regions (legend, and the checkbox, which gains pixels) explain the rest.
- **So the travel stroke repaints the cut on Intel/D3D11.** It is environmental for CI, but it is product behaviour on that hardware.

**"Fails identically at `87f0ec583`" holds for both.** Neither failure is caused by the nine merges.

**`production-bundle.spec.ts` and the desktop build:** still not runnable.
- `build:web` runs `generate:*`, then `typecheck` at `--max-old-space-size=6144`, then `vite build` at 6144 (`package.json:28, 67-68`).
- `build:bundle:desktop` uses the same heap (`:78`).
- Free memory during my session was 1.1–3.1 GB, with other sessions' Vite, Playwright and a 6 GB `activate-block.mjs` running. No `dist/web` exists in the main checkout or `j10-main`. I did not start a build that could push the PC into paging under other sessions' runs.
- A CI run of main is still owed for both.

### New findings

#### V9-P3-2 — The 3D G-code viewer's travel stroke repaints a completed coplanar cut on Intel Iris Xe (ANGLE D3D11): ADR-425's 98 % clause fails on real GPUs, and CI only tests SwiftShader (found by refuter)

- **Where (5f09e1110):**
  - The flat-stroke queue ADR-425 describes ("faint future paths, travel, completed cuts…", `docs/decisions/ADR-425-3d-viewer-fixes-batch-1.md:107-110`).
  - The guarding test: `e2e/gcode-viewer-density.e2e.ts:86-95`.
- **Anchor:**
  - Contract: ADR-425's verification text says "A coplanar return move preserves at least 98% of the cutting stroke's blue pixels" (`ADR-425…md:170-171`).
  - Twin: the same build under SwiftShader passes.
- **Scenario:** a Windows PC with Intel Iris Xe graphics, the most common laptop GPU, opens the G-code viewer on a program whose travel returns over a cut, then ticks Travel. About 44 % of the cut line's pixels take the travel blend. CNC and unknown files show travel by default (ADR-425 :104).
- **Evidence:** REPRO in headless Chrome 156 on this PC's GPU:
  - Fails with 2535 against ≥ 3048.78, on main and on `87f0ec583`, 4 runs in all.
  - Passes under SwiftShader.
  - Pixel analysis as above.
  - Not run in Electron 44 (Chromium 152). The packaged app also renders WebGL through ANGLE D3D11 on Windows, so the same result is likely but UNVERIFIED.
- **Severity: P3.** Display only:
  - The program, the burn and the 2D preview are unchanged.
  - The cut stays visible at 56 % of its pixels.
  - Travel is off by default for laser files.
  - The coordinator may weigh P2 under "a broken contract with a clear failure scenario". I kept P3 because nothing physical or saved is wrong.
- **Novelty:** new. It predates the window (it fails identically at `87f0ec583`). No ledger or audit names it (`grep coplanar docs/` finds only ADR-425 and this report). CI cannot see it.
- **Fix direction:**
  - Give completed cuts a tie-break that does not depend on the depth or blend order the driver picks for equal depths, for example a draw-order-only pass with depth test off for flat strokes, or a small screen-space bias.
  - Add a hardware-GPU leg to the density spec, or a manual check on Windows Intel, before the next release.

### Challenges to "Verified clean"

- **V3-P2-2 bullet.** "The outcome is U4-P2-3's, which U4 rated P2, so the rating stands": challenged, see the re-rate above.
- **V3-P2-2 bullet.** "after one [WCO report] it asks instead": the offer did not wait for one in either of my runs.
- Everything else I re-ran matched the auditor:
  - the Abort card text;
  - `$X`-only restore with no toast;
  - the Frame confirm text;
  - V9-P3-1's mechanism;
  - V7-P1-1's `S610`.

### Not verified (refuter)

- Electron 44 for V9-P3-1, V9-P3-2 and the re-rate. All runs were Chrome for Testing 156.
- The interrupted job's Review recovery after the failed restore. It is still listed in the rail but is not on the path the operator is led down; I did not open it.
- The `$10=1` control. The auditor's J1 covers it; I did not re-run it.

```json
[
  {"id":"V9-P3-1","severity":"P3","verdict":"CONFIRMED","evidence":"REPRO (refuter, auditor's spec unchanged: 1.5 s hold 1 run, 4 s hold 2 runs = 1 extra)","note":"matrix row X2 overcounts by one"},
  {"id":"V3-P2-2","severity":"P1","verdict":"RE-RATED P2->P1 (refuter)","file":"src/ui/laser/AbortStoppedCard.tsx","line":50,"evidence":"REPRO (browser, $10=0, two runs): $X only, no toast or alert; Frame offers the generic set-origin confirm (start-blocked-setup-offers.ts:15-21) at 8 s and 14 s, no refusal; Job Review identical; re-run offset (+9.8,+5.75) and (+10.3,+4.05) mm over the partial burn","summary":"The app claims and silently fails the restore, then leads the operator to a misaligned re-burn with no warning naming the mismatch"},
  {"id":"V9-P3-2","severity":"P3","area":"V9","file":"e2e/gcode-viewer-density.e2e.ts","line":94,"anchor":"Contract ADR-425 98% coplanar clause; Twin SwiftShader passes","evidence":"REPRO (Chrome 156 on Intel Iris Xe D3D11: 2535 vs >=3048.78, main and 87f0ec583; passes with --use-angle=swiftshader)","verdict":"NEW (found by refuter)","known":false,"summary":"Travel repaints 44% of a completed coplanar cut on Intel/D3D11; CI only renders with SwiftShader"}
]
```

Refuter counts: raised 2, refuted 0, P1 0, P2 0, P3 2, known 3. Raised: V9-P3-1 by the auditor, V9-P3-2 by the refuter. Known: V7-P1-1 (agreed), V7-P2-3 (not re-run) and V3-P2-2, which I re-rate to P1 but count under known, not under P1.
