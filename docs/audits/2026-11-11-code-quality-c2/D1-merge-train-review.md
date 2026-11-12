# D1 — merge-train review (code quality audit C2)

**Question.** Is the code merged since C1 (`f61a0757a`) correct?
**Tree.** `origin/main` @ `6ce535a26` (git archive `j26-main`). Read-only git on the main checkout for each PR's diff.
**Method.** Line-by-line review, machine code first. Every defect below was reproduced with Node scripts that load the real modules (`zz-d1/register.mjs` loader) and, where the repo has one, the repo's own simulator. Camera and rotary PRs were skipped (v13/v14), except where they meet the PRs below.

## Headline

One P1: **a Moshiboard burns every image row's overscan runway.** Each row of an Image layer burns from the start of its laser-off run-up, so a default layer (5 mm overscan) burns a 5 mm streak at one end of every row. The new Moshi and Ruida network routes also skip rules that live in the line-based laser store: the job warnings appear only after the job is sent, and the app's "a job is running" guards (window close, Update, Machine Setup save, project drop) do not see their jobs. A Ruida Frame that ends before the first status poll is never counted, so Start stays locked with no time limit. A PostScript file whose only artwork is one straight horizontal or vertical line imports nothing.

| PR | Verdict | Findings | Test adequacy |
|---|---|---|---|
| #1723 Moshiboard (ADR-705) | **Defects** | D1-P1-1, D1-P2-1, D1-P2-3, D1-P3-1 | Weak where it matters. The only raster test uses `overscanMm: 0`, so it cannot see P1-1. The store tests use a hand-written advisory and never check that it is visible before Start. |
| #1744 Moshi rotary feed (ADR-705 Amd 1) | Covered by Z3; nothing new | — | Z3 verified. |
| #1707 Ruida over UDP (ADR-697) | **Defects** | D1-P2-1 (READ), D1-P2-2, D1-P2-3 (READ) | The simulator stays busy for 3 status reads by default, which hides P2-2. One test (`does not count a frame the controller never reported running`) pins the stuck state as intended. |
| #1726 WebUSB + CH341 (ADR-702) | Clean on the paths reviewed; byte meanings against MeerK40t not verified | D1-P3-1 (part) | EPP framing and the fake device are tested. No test covers clean-up after an open or claim failure. |
| #1694 stranded jog / ordered `$G` (ADR-696) | Clean (READ) | — | The ordering proof is tested on the GRBL simulator. Lines are stored without `\n`, so the `$G` match works. |
| #1711 Marlin hold containment (ADR-676 Amd 4) | Clean (READ) | — | Adequate. |
| #1715 lit-stop advice (ADR-676 Amd 5) | Clean (READ); advisory text and order only | — | A good order test. |
| #1732 Abort auto-restore (ADR-341 Amd 14) | Clean (READ) | — | Exclusions are listed one per rule. Not mutation-checked (that is D3). |
| #1735 Unlock keeps position (ADR-367 Amd 3) | Clean (READ) | — | Firmware sources cited per code. |
| #1736 Run again skips Job Review (ADR-237 Amd 3) | Clean (READ) | — | Strong. A changed program, a new or gone warning, another controller session, a reload and a remote presenter each reopen the dialog, with a test for each. |
| #1733 clean jog keeps the Frame (ADR-565 Amd 1) | Clean (READ) | — | Strong. The simulator covers Current Position, origin changes, alarms, resets and edits during a jog. |
| #1714 CNC `$30`/`$31` warning (ADR-567 Amd 3) | Clean (READ) | — | Adequate. |
| #1716 surface probe circuit line | Clean (UI only) | — | — |
| #1717 feed-ceiling Raise undo (ADR-361 Amd 1) | Clean (READ) | — | Adequate. |
| #1705 EPS/AI import (ADR-700) | **One defect** | D1-P2-4 | Good operator coverage. No test has artwork with zero width or height. |
| #1719 3D Sliced + Fill Ramp (ADR-699) | Clean (REPRO spot check of the ramp; READ of slicing) | — | Adequate. |
| #1708 guided first job / Simple view (ADR-698) | Clean (READ) | — | Good: a test fails when a new operation key is not classified. |
| #1731 splash / Don't Save (ADR-688 Amd 3) | Clean (READ); the autosave copy is kept | — | Adequate. |
| #1734 shortcuts / Preview / unlock one | Clean (READ) | — | Adequate. |
| #1706, #1709, #1710, #1713 Design Studio precision | No defect found (READ of typed entry and trim crossings only) | — | Not run here. |
| #1718 G-code viewer chrome (ADR-701) | Clean (READ of `timeline-bands.ts`) | — | — |
| #1692 trace apexes | Not reviewed in depth | — | — |

The existing tests on main pass. `ruida-network-store.test.ts`, `moshi-job-encoder.test.ts` and `moshi-usb-store.test.ts` give 33 passed, 3 files. That is the point: they pass with each defect below in place.

## Findings

### D1-P1-1 — A Moshiboard burns the overscan run-up of every image row (5 mm per row by default)

- **Where:** `src/core/controllers/moshi/moshi-raster-plan.ts:116-124` (`planRow`). It writes a laser-off move to `entryX`, then each run's end as the next step. For the first run that step is a cut, so the cut starts at `entryX`, not at the first dark pixel (`startX`). Reverse rows have the same flaw through `reversedRuns` (L130-141): the head cuts from `entryX`, past the last dark pixel's right edge. `startX` is used only as the reversed rows' far end.
- **Anchor:** ADR-705 decision 3: "horizontal cuts across dark pixels, horizontal moves across light ones". The laser-off runway is there to bring the head to speed before the burn. The Fill twin does it right: `moshi-vector-plan.ts` `planPolyline` travels to the entry, then to `start`, then burns.
- **Evidence: REPRO.**
  - `zz-d1/r1-moshi-raster-runway.mts`, real `encodeMoshiJob` + `decodeMoshiProgram`. The test's own raster with `overscanMm: 2` burns x 8.00→11.99 (art 10–12) and 15.01→11.00 (art 11–13). With overscan 0 the burns match the art.
  - `zz-d1/r1b-moshi-image-e2e.mts`, real `prepareOutput` → `emitPreparedMoshiJob` on the catalog `GENERIC_MOSHI_PROFILE`. A default Image layer (no overscan set, so 5 mm) on a black 20 mm image at X 30–50 burns X 24.99–54.99 across 100 strokes. Forward rows burn 24.99→50.01 and reverse rows 54.99→30.00.
  - Output: `zz-d1/out/r1.txt`, `out/r1b.txt`.
- **Scenario:** any photo, logo or engraving on an Image layer sent to a Moshiboard. Every row gets an extra burned line as long as the overscan, on the side the head enters from. With two-way scanning that is the left edge on one row and the right edge on the next, so both sides of the image get a 5 mm band of solid burn at full dial power.
- **Severity: P1.** It harms the job: burn lands outside the artwork on every row, at the machine's full power (a Moshiboard has no power control). The default settings reach it, and nothing warns.
- **Announced?** No. ADR-705 says rows burn only the dark pixels.
- **Novelty:** new. v14 Z3 covered Moshi rotary feed, not rasters.
- **Fix direction:** in `planRow`, after the move to `entryX`, add a laser-off `push(edge, y, false)` to the first dark pixel's edge: `startX` going forward, the last dark pixel's right edge going back. Then the runs follow. Add a decoded test with overscan > 0 that checks no cut step starts outside the dark pixels.

### D1-P2-1 — The Moshi and Ruida network routes show job warnings only after the job is sent

- **Where:**
  - `src/ui/state/moshi-usb/moshi-usb-store.ts:191-197`: `advisories` is set in the same `set()` that starts sending. A Frame sets it to `[]`, and a finished job clears it (L233-234).
  - `src/ui/state/ruida-network/ruida-network-store.ts:188-194`: the same pattern.
  - The panels list advisories only from the store (`MoshiUsbDetails.tsx:67-73`, `RuidaNetworkDetails`).
- **Anchor:** PROJECT.md non-negotiable 21: "Each Start reviews and claims the current exact executable program once … Job Review remains the single warning surface." The ADRs say advisories are "shown as warnings and never refuse" (ADR-697 decision 5), and the Moshi job warnings come from the same `runPreflight` (ADR-705 decision 5). Neither route shows them before the beam fires.
- **Evidence:**
  - Moshi, **REPRO** `zz-d1/r4-moshi-warnings-timing.mts`. Real `emitPreparedMoshiJob` for a square hanging off the bed gives the advisory `X out of bed: 419.989 (bed position)`. The real store drives the repo's `MoshiSimulator`. After Frame, the panel's advisories are `[]`. They first appear when the first job byte is written. After the job they are `[]` again (`out/r4.txt`).
  - Ruida, **READ**, plus the repo test `ruida-network-store.test.ts:~139`. It asserts `advisories` only after `start()`.
- **Scenario:** a job that overhangs the bed or crosses a no-go zone, or a Moshi rotary layer outside 95–105 % of its dose (Z3's fix added that warning). The operator presses Start and the beam fires. The warning shows while the job runs, and on a short job it is gone by the time they look.
- **Severity: P2.** A real defect with limited harm: the Frame has already traced the footprint, and the warnings never refuse. It is not P1 because no wrong command is sent.
- **Announced?** Partly. ADR-705 Amd 1 and Z3 note "the Moshi route has no Job Review". Neither says that its warnings appear only after Start.
- **Novelty:** new as a finding. It is the C2 shape: a new route skips the rule kept by `job-review-gate.ts`.
- **Fix direction:** show the compiled advisories at Frame and while idle, before Start. Better, route both Starts through a Job Review confirmation (the warning list and one confirm). D2 should trace this rule.

### D1-P2-2 — A Ruida Frame that ends before the first status poll never counts, and Start waits for it with no time limit

- **Where:** `src/ui/state/ruida-network/ruida-network-monitor.ts:18, 55-65, 69`. The first status read comes 400 ms after the last ACK. A run is "finished" only after the controller has been seen busy once (`busySeen`) and then idle twice. There is no bound or fallback. `ruida-network-store.ts:244-286` stays in `framing`, and `run()` refuses Start until `framed` is set (L180-183).
- **Anchor:** ADR-697 decision 5 ("A Frame counts as completed only after the controller reported busy at least once and then idle twice in a row"). C2's own note in AREAS.md: "simulators and fakes whose timing hides real behaviour".
- **Evidence: REPRO** `zz-d1/r5-ruida-fast-frame.mts`, with the real store, exchange and timers against the repo's `RuidaUdpSimulator`.
  - `runReads: 1` (busy for one poll): the Frame completes in 1.3 s and Start runs.
  - `runReads: 0` (the controller is already idle at the first poll, as when the frame took under ~0.4 s): after 8.1 s and 59 status reads, the phase is still `framing` with "Frame sent; waiting for the controller to finish tracing it." Start is then ignored (`out/r5.txt`).
  - The repo test at `ruida-network-store.test.ts:156` pins this state as intended.
- **Scenario:** a small job (a 10 mm tag) whose head is already near it. The travel-only Frame is done within the first poll, so the panel waits forever. The only way out is Abort, which also never counts the Frame. The operator cannot Start that job from KerfDesk.
- **Severity: P2.** It blocks the job but harms nothing: nothing is sent while it waits. It is a real, unbounded wait.
- **Announced?** The rule is announced. The stuck outcome and its missing bound are not.
- **Novelty:** new.
- **Fix direction:** read the status straight after the last ACK and poll faster at first. Or count a Frame as completed when the controller reports idle after having received the whole frame, if no busy read came within a bound. Say so in the panel either way. Give the simulator a fast-frame script.

### D1-P2-3 — The app's "a job is running" guards do not see a Moshi or Ruida network job

- **Where:**
  - `src/ui/app/desktop-close-runtime.ts:31-54`: the close snapshot's `active`, `updateBlocked` and stop read only `useLaserStore`.
  - `desktop-close-controller.ts:88-96` (`wasActive`) and `:117-131` (`prepareForUpdate`).
  - The same single-store check in `recent-projects/dropped-project-open.ts:24` and `device-setup/use-machine-setup-save.ts:47-55`.
  - The only Abort for these jobs is in `MoshiUsbPanel.tsx:20` / `RuidaNetworkPanel.tsx:17`, which unmount once `project.device.controllerKind` is no longer Moshi/Ruida.
- **Anchor:** the close and update rules for a running job (controller audit electron-native-3; `updateBlocked`: "Update-only close waits for … observed external machine work"). The Machine Setup and project-open locks (`SETUP_SAVE_LOCKED_DURING_JOB`). This is the C2 shape: two new stores skip rules that live with the line-based store.
- **Evidence:**
  - **REPRO** `zz-d1/r9-moshi-close-mid-job.mts`. A two-layer job (two Moshi programs) runs on the real store against `MoshiSimulator`, with program 1 still on the board. `desktopCloseController.prepareForUpdate()` and `prepare()` both answer `{"status":"ready","dirty":false}` at once. There is no notice and no estop, and the Moshi phase is still `running` (`out/r9.txt`).
  - **READ** for the Ruida close (main sends Stop Process on quit, ADR-697 decision 7, without asking), for project drop and Machine Setup save, and for the panel unmount.
- **Scenario:**
  - The operator closes the window or presses Update during a Moshi job. KerfDesk closes without asking. The board finishes the program it holds, the rest of the job is never sent, and no software stop remains.
  - Saving a Machine Setup change of controller during the job hides the panel, and with it the only Abort, until the profile is switched back.
- **Severity: P2.** The job is truncated or left without a software stop, but only after an operator action that the GRBL route would refuse or confirm. The board stops at the end of its program.
- **Announced?** No.
- **Novelty:** new.
- **Fix direction:** one "machine work active" query that `useLaserStore`, `useMoshiUsbStore` and `useRuidaNetworkStore` all answer. Use it in the close snapshot (`active`, `updateBlocked`, a stop that sends the Moshi estop or Ruida Stop), the project open and Machine Setup locks, and keep the Moshi or Ruida panel (or a global Abort) mounted while its store is not idle.

### D1-P2-4 — A PostScript file with no bounding box whose artwork is one horizontal or vertical line imports nothing

- **Where:** `src/io/postscript/ps-svg.ts:166-186`. With no `%%BoundingBox` the page box is the drawn extent, which has zero height (or width) for straight horizontal (or vertical) art. The SVG becomes `height="0mm" viewBox="0 0 80 0"`, and `parseSvg` returns `object: null` with the note "SVG has no drawable geometry".
- **Anchor:** ADR-700: EPS/PS artwork "goes through the ordinary SVG import". A valid program that strokes one line must import that line.
- **Evidence: REPRO** `zz-d1/r6-eps-line-import.mts`: real `convertPostscript` + real `parseSvg` under jsdom.
  - `newpath 10 10 moveto 90 10 lineto stroke` with no bbox gives 0 points. The vertical case also gives 0.
  - Controls: the diagonal line gives 2 points over 28.2 mm, and the same horizontal line with a `%%BoundingBox` imports correctly (`out/r6.txt`, `out/r6b.txt`).
- **Scenario:** a plain `.ps` (no EPS bbox, which is common for `.ps` files) holding a single cut line, or only horizontal rules. Import says there is nothing to draw.
- **Severity: P2.** A real defect with limited harm: the import fails loudly and moves nothing. EPS files normally carry a bbox, so the reach is narrow.
- **Announced?** No.
- **Novelty:** new.
- **Fix direction:** in `paintedSvg`, give a zero-size axis a minimum extent (for example the stroke width or 1 pt) before writing `width`/`height`/`viewBox`. Add a zero-extent test.

### D1-P3-1 — A Moshi Connect whose first status read fails leaves the USB device open and claimed

- **Where:** `src/ui/state/moshi-usb/moshi-usb-store.ts:121-128`: the `catch` after `open()` + `readStatus()` never closes `link`. The status-0 branch does (L129-130). Likewise `src/platform/web/web-usb-link.ts:103-109`: a failed `selectConfiguration` does not close the opened device.
- **Anchor:** ADR-702 (the link releases the device it opens).
- **Evidence: REPRO** `zz-d1/r10-moshi-connect-leak.mts`. A link whose status read throws gives `link.close() calls=0`. The control with status 0 gives `1` (`out/r10.txt`).
- **Scenario:** the cable is pulled or the board stalls during Connect. KerfDesk keeps the CH341 claimed until the page closes, so MeerK40t or MoshiDraw cannot take it meanwhile. A KerfDesk reconnect still works: WebUSB `open()`/`claimInterface()` resolve on an already-open device.
- **Severity: P3.** It is a resource tidiness gap with no lost job or wrong output.
- **Announced?** No. **Novelty:** new.
- **Fix direction:** close the link in that `catch`, and close the device when `selectConfiguration` fails.

## Refuted (candidates dropped)

- **Moshi coordinates on a rear-left home.** It was suspected that `machineSpaceJob` gives negative or flipped Y on the catalog Moshi profile, which would refuse every job. `zz-d1/r7-moshi-profile-coords.mts` shows positive mils from the top-left that match the canvas (`out/r7.txt`).
- **PostScript string escapes.** `(a\)b)` looked mis-tokenized. That was a test-harness quoting error. `r8b-ps-string.mts` shows `\)`, `\(`, `\\`, octal and nested parentheses all read correctly (`out/r8b.txt`).
- **PostScript number syntax and operators.** Radix, exponent, leading and trailing dot, hex strings, `aload`/`roll`, `ifelse`, `bind`/`load`, `arc`/`arcn`/`arcto`, `rectstroke`, transforms, `atend` bbox, the AI 8 compound path, and the AI `v`/`y` curves all give the expected geometry (`r2-eps-cases.mts`, `r8-ps-numbers.mts`; `out/r2.txt`, `out/r8.txt`).
- **3D Sliced with Cross-hatch.** The suspicion was that `groupsPerPass` gave the wrong slice to the second angle. `imageScanPassRuns` alternates angles per pass, so pass k's two groups share slice k (READ, `scan-pass-angles.ts:72-80`).
- **Fill Ramp grid.** Edge cells are half a cell from the edge, holes always ramp, and the outer edge ramps only with Ramp outer edge on. `r3-fill-ramp.mts` (10 mm square, 4 mm hole, 1 mm ramp, S 200–1000) gives 240 at the cell beside an edge and 1000 beyond 1 mm. The outer edge is flat (1000) when off and 240 when on (`out/r3.txt`).
- **Ruida double Start during the pre-start status read.** A second `run()` finds the phase no longer `idle` after its read and returns quietly (READ, `ruida-network-store.ts:204-206`).
- **Run again carrying a review onto a changed job.** The carry requires the same `retentionKey` (project, scope, placement) and G-code fingerprint, the same warning set from a freshly built model, and the same controller session. The repo tests cover each case (READ; `run-again-review-carry*.test.ts`).
- **The ordered-`$G` proof never matching.** Reservations store lines split on `\n` (`laser-write-reservation.ts:34-38`), so `'$G'` matches (READ).

## Verified clean

#1694, #1711, #1715, #1732, #1735, #1736, #1733, #1714, #1716, #1717, #1708, #1731 and #1734 are clean by line review; see the table. Test files ran on main: `ruida-network-store.test.ts`, `moshi-job-encoder.test.ts` and `moshi-usb-store.test.ts`, 33 passed.

## Not verified

- **Byte meanings against MeerK40t.** The Moshi swizzle, program bytes and EPP status, the CH341 init, version and status requests, and the Ruida `DA 00` addresses and status bits were not checked: the MeerK40t source is not on this PC, and downloads are not allowed here. The repo's goldens are hand-derived from it.
- **Hardware timing.** When a real Ruida reports busy or idle (D1-P2-2), and what a Moshiboard reports right after the epilogue.
- **Browser runs.** Memory stayed between 0.97 and 1.63 GB free, so no browser run was made.
- **Design Studio** (#1706/#1709/#1710/#1713): READ only, with no repro and no test run. **#1692**: not reviewed in depth.
- **Ruida halves of D1-P2-1 and D1-P2-3:** READ (and existing tests), not run end to end.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d1\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file>` from that folder. Output is in `out\`.

- `r1-moshi-raster-runway.mts`, `r1b-moshi-image-e2e.mts`: D1-P1-1
- `r4-moshi-warnings-timing.mts`: D1-P2-1
- `r5-ruida-fast-frame.mts`: D1-P2-2
- `r9-moshi-close-mid-job.mts`: D1-P2-3
- `r6-eps-line-import.mts`: D1-P2-4
- `r10-moshi-connect-leak.mts`: D1-P3-1
- `r2-eps-cases.mts`, `r3-fill-ramp.mts`, `r7-moshi-profile-coords.mts`, `r8-ps-numbers.mts`, `r8b-ps-string.mts`: refutations
- `lib.mts`, `register.mjs`, `ts-resolve.mjs`: the harness (copied from Z3 and pointed at `j26-main`)

No security findings; `SECURITY-DETAILS.md` was not needed.

```json
[
  {"id":"D1-P1-1","severity":"P1","area":"merge-train-review","pr":1723,"file":"src/core/controllers/moshi/moshi-raster-plan.ts","line":116,"anchor":"ADR-705 decision 3 (cuts across dark pixels only); Fill twin planPolyline","evidence":"REPRO","known":false,"summary":"Moshi raster rows cut from the overscan entry point, not the first dark pixel: a default Image layer burns a 5 mm streak at one end of every row (art X 30-50 burns 24.99-54.99)"},
  {"id":"D1-P2-1","severity":"P2","area":"merge-train-review","pr":[1723,1707],"file":"src/ui/state/moshi-usb/moshi-usb-store.ts","line":191,"anchor":"PROJECT.md non-negotiable 21 (each Start reviews; Job Review the single warning surface)","evidence":"REPRO (Moshi), READ (Ruida)","known":"partly (Z3 notes no Job Review on Moshi)","summary":"Moshi and Ruida network Starts show job warnings (bed overhang, no-go, rotary dose) only once the job is being sent; Frame shows none"},
  {"id":"D1-P2-2","severity":"P2","area":"merge-train-review","pr":1707,"file":"src/ui/state/ruida-network/ruida-network-monitor.ts","line":55,"anchor":"ADR-697 decision 5; C2 simulator-timing note","evidence":"REPRO","known":false,"summary":"A Ruida Frame finished before the first 400 ms status poll is never counted; the store waits in framing forever and Start is refused"},
  {"id":"D1-P2-3","severity":"P2","area":"merge-train-review","pr":[1723,1707],"file":"src/ui/app/desktop-close-runtime.ts","line":31,"anchor":"close/update job-running rules (electron-native-3, updateBlocked), Machine Setup and project-open locks","evidence":"REPRO (Moshi close/update), READ (rest)","known":false,"summary":"Close, Update, project drop and Machine Setup save read only the line-based laser store: a running Moshi job closes without asking or estop (2-program job truncated); the Moshi/Ruida Abort unmounts when the profile changes"},
  {"id":"D1-P2-4","severity":"P2","area":"merge-train-review","pr":1705,"file":"src/io/postscript/ps-svg.ts","line":166,"anchor":"ADR-700 (PostScript artwork imports through the SVG import)","evidence":"REPRO","known":false,"summary":"PS without a bounding box whose art is one horizontal or vertical line yields a zero-height SVG; parseSvg imports nothing"},
  {"id":"D1-P3-1","severity":"P3","area":"merge-train-review","pr":[1723,1726],"file":"src/ui/state/moshi-usb/moshi-usb-store.ts","line":124,"anchor":"ADR-702 (the link releases what it opens)","evidence":"REPRO","known":false,"summary":"A Moshi Connect whose first status read throws never closes the opened link; web-usb-link leaves the device open when selectConfiguration fails"}
]
```

Auditor counts: raised 6, P1 1, P2 4, P3 1, known 0

## Refuter (2026-11-11)

**Tree.** `j26-main` (git archive of `origin/main` @ `6ce535a26`), read-only. Line numbers below are on that tree.
**Harness.** Own scripts in `scratchpad\zz-d1r\` (`q1`…`q6`), run with `node --no-experimental-webstorage --import ./register.mjs <file>`. Only `register.mjs` and `ts-resolve.mjs` were copied from `zz-d1`. The auditor's scripts were read for API shape only, never run. My method differs on purpose:
- Moshi strokes are read by patching `MoshiProgram.prototype` (each `moveAbs`, `moveHorizontal`, `cutHorizontal` call as the encoder issues it), not through the repo decoder.
- The Ruida timing uses a simulator subclass whose busy bit follows wall-clock time after the file's last byte, not a count of status reads.
- PostScript goes through the app's own `importPostscriptFile` action (toasts and objects recorded), not through `parseSvg` alone.
- USB clean-up runs the real `createWebUsbLink` + `moshiUsbOpener` + store over a fake `navigator.usb` device.
No Vitest and no browser run: both were unnecessary for the verdicts, and memory was about 3 GB.

### Verdicts

| Finding | Verdict | Severity |
|---|---|---|
| D1-P1-1 Moshi raster burns the overscan runway | **CONFIRMED** | P1 kept |
| D1-P2-1 Moshi/Ruida warnings only after Start | **CONFIRMED**, with corrections | P2 kept |
| D1-P2-2 Ruida fast Frame never counts | **CONFIRMED**, and Retry cannot escape it | P2 kept |
| D1-P2-3 job-running guards ignore Moshi/Ruida | **CONFIRMED**, with one nuance on the Ruida close | P2 kept |
| D1-P2-4 PS line with no bbox imports nothing | **CONFIRMED**; location corrected; wider than stated | P2 kept |
| D1-P3-1 Moshi connect leaks the USB claim | **CONFIRMED** end to end | P3 kept |

**D1-P1-1: CONFIRMED, P1.**
- **REPRO** `q1-moshi-raster-trace.mts` (`out/q1.txt`). The art is dark at X 42–44 and 46–48 mm.
  - Overscan 0: the laser-on strokes are 42.01→43.99 and 46.00→48.01.
  - Overscan 5: forward rows cut **37.01→43.99**, and reverse rows cut **53.01→46.00**.
  - The runway is measured from the first or last *dark* pixel, so a white border on the image does not absorb it.
  - One-way scanning burns 37.01→43.99 on every row.
  - An image at X 1 has its entry clamped to 0, so it burns **0.00→5.00**.
- **REPRO** `q1b-moshi-prepare-e2e.mts` (`out/q1b.txt`). This is the real path: `createProject(GENERIC_MOSHI_PROFILE)` + `createLayer` defaults + `prepareOutput` + `emitPreparedMoshiJob`.
  - The layer default `imageOverscanMm` is `undefined`, so the prepared group has `overscanMm` 5 (`operation-cut-extras.ts:55-58`, `compile-job-defaults.ts:7`).
  - Dark art at X 110–130 burns X 105.00–135.00 over 100 strokes, each 24.99 mm long against 20 mm of art.
  - That is 499.9 mm of burn outside the art: exactly 5.00 mm per row.
  - `advisories` is `[]`.
- **Does the board fire during that segment?** Yes (READ). `writeRasterProgram` (`moshi-programs.ts:46-48`) writes a step with `cut: true` as `cutHorizontal`, which is the `MOSHI_CUT_HORIZ` command (`moshi-program.ts:93-95`). The first run after the move to `entryX` has `on: true` (`moshi-raster-plan.ts:89-95, 116-124`).
- **Is this expected MeerK40t/MoshiDraw behaviour?** Nothing in the repo says so.
  - The file's own MeerK40t citations (driver.py `_goto_absolute`, device.py raster orders) are about axis-only moves and horizontal scans, not overscan.
  - ADR-705 decision 3 (`ADR-705…md:71-74`) says Fill lines "burn between laser-off runways" and Image rows are "horizontal cuts across dark pixels, horizontal moves across light ones".
  - The repo's Fill golden (`moshi-job-encoder.test.ts:91-130`) has the runways as `cut: false`.
  - The only raster golden uses `overscanMm: 0`, with the comment "No overscan, so each row starts at its first dark pixel" (L135, L148).
- **Is the default really 5 mm?** Yes, as above. With `autoOverscan` on, the value is computed and is still above 0.
- **Is there any path where it is right?** Only when overscan is 0, or when the first dark pixel sits at X = 0, where the clamped entry equals the start. A **warning before output?** None: the Frame traces the widened footprint, but Frame is not a warning (METHOD §3, G6 clarification).

**D1-P2-1: CONFIRMED, P2.** Three corrections:
1. **Pre-Start surfaces the auditor missed (partial).**
   - The design canvas draws red dashed outlines around objects past the bed (`draw-scene.ts:195` → `draw-out-of-bounds-outlines.ts`).
   - Preview shows a danger banner for the same case (`preview-overlays.tsx:60-64`).
   - No-go zones are drawn on the canvas (`draw-no-go-zones.ts`).
   - On a Moshi profile, the layer panel says the board has no power control (`CutPowerModeField.tsx:17-23`).

   These cover an *object* past the bed. They do not cover the post-compile checks: a runway past the bed, grey pixels burning as black (`moshi-job-encoder.ts:102-105`), the vector speed clamp, the rotary dose, or any Ruida `.rd` advisory. Those still appear only from the Start `set()` (`moshi-usb-store.ts:191-197`, `ruida-network-store.ts:188-194`).
2. **The auditor understated the timing.** Even after Start, the warning list renders inside a collapsed `<details>` (`MoshiUsbDetails.tsx:26-74`, `RuidaNetworkDetails.tsx:27-55`). That section sits in the "Machine details" `AnchoredPopover`, which mounts only while it is open (`CompactConnectionControls.tsx:71-91`) and closes on any outside pointer-down or Escape (`AnchoredPopover.tsx:59,72,134`). Once the operator clicks the canvas, the warnings are out of view until they reopen the popover and expand the section again.
3. **The grey-level sub-case** meets the letter of P1 (wrong power, with the note only after the first byte). It stays P2 because ADR-705 decision 4 announces it, the layer panel's pre-Start power note covers it, and the default dither (`floyd-steinberg`, `layer.ts:170`) is binary.

**D1-P2-2: CONFIRMED, P2.**
- **REPRO** `q2-ruida-timed-frame.mts` (`out/q2.txt`): real store and exchange, real timers, a 30 × 20 mm tag (100 mm Frame perimeter).

  | Trace time | First status reads | Result |
  |---|---|---|
  | 250 ms | 407 ms idle, 813 ms idle … | still `framing` after 4 s; Start refused with `RUIDA_FRAME_FIRST` |
  | 380 ms | 412 ms idle … | still `framing` after 4 s; Start refused |
  | 450 ms | 415 ms busy | Frame counts in 1.25 s; Start sends the job |
  | 900 ms | busy, then idle | Frame counts in 1.70 s; Start sends the job |

- **Timing assumptions.**
  - The Frame is travel only, and "a Ruida travels at its own panel-set idle speed" (`rd-frame-job.ts:43-45`), not at the framing feed.
  - The first poll comes `RUIDA_STATUS_POLL_MS` = 400 ms after the last ACK (`ruida-network-monitor.ts:18,69`).
  - So any Frame that finishes within about 400 ms is lost: a short perimeter at an ordinary CO2 idle speed, once the head is near the job. That speed is not verified on hardware.
  - There is no timeout anywhere in `watchRuidaRun` or `watchToEnd` (`ruida-network-store.ts:244-286`).
- **Abort/Retry is not a real exit.**
  - Abort leaves `framed: null` (L310-330).
  - The physical Frame ended at the start corner, so the retried Frame has no approach travel and is no longer than the first. The REPRO's re-Frame stays `framing` too.
  - The operator's only workaround is to move the head away at the controller panel first.
- **Extension (READ):** the same monitor watches a *job*. A job that ends before the first poll leaves the phase `running` with no bound, until Abort.

**D1-P2-3: CONFIRMED, P2.**
- **REPRO** `q3-moshi-running-guards.mts` (`out/q3.txt`): a Moshi job held `running` on the repo `MoshiSimulator`. `appProjectOpenDeps(...).jobActive()` returns `false`.
- **READ** confirms each guard reads only `useLaserStore`:
  - `desktop-close-runtime.ts:31-44`;
  - `desktop-close-controller.ts:117-130` (`prepareForUpdate`);
  - `use-machine-setup-save.ts:47-55`;
  - the browser `beforeunload` guards (`use-unload-stop.ts`, `use-unsaved-changes-guard.ts:42`).
- **Nuance for the Ruida close.** Electron main does send Stop Process to every Ruida session on `will-quit` (`ruida-network-routes.ts:19-26,33-36` → `ruida-network-bridge.ts:93-107`). So closing *stops* a Ruida job, which is the same outcome as a GRBL close (`prepare` → `stopForAttempt`); what is missing there is the in-app close notice.
- **The sharper Ruida case is Update.** A GRBL job makes `prepareForUpdate` answer `cancelled`. A Ruida job lets Update quit, and main's Stop Process then aborts the job.
- **The Moshi case** gets no stop at all. The board runs the program it holds, and the rest is dropped.

**D1-P2-4: CONFIRMED, P2; location corrected.**
- `ps-svg.ts` has 104 lines. The defect is in `paintedSvg` at **`ps-svg.ts:14-35`** (with `paintedExtent` at L67-89), not at L166-186.
- **REPRO** `q4-ps-zero-extent.mts` (`out/q4.txt`), through `importPostscriptFile`. Each of these toasts "has no drawable content" and adds 0 objects:
  - a vertical `rlineto` rule with no bbox;
  - two collinear horizontal rules;
  - a 10 pt-wide horizontal stroke: the stroke width is not part of the extent;
  - and, new, **a file whose declared `%%BoundingBox` is itself zero-height**: the union stays zero.
- Control: the same line plus a 1 pt tick imports 1 object.

**D1-P3-1: CONFIRMED, P3.**
- **REPRO** `q5-usb-open-leak.mts` (`out/q5.txt`).
  - (a) `createWebUsbLink`, with `selectConfiguration` throwing: device calls `open, selectConfiguration`, and the device is still open (`web-usb-link.ts:103-109`).
  - (b) The real `moshiUsbOpener` + store, with the vendor status read stalling: device calls `open, selectConfiguration, claim, ctlOut, ctlIn 5f, ctlIn 52`, with no `release` and no `close`. The store reports `disconnected` (`moshi-usb-store.ts:121-128`).
- WebUSB `open()` and `claimInterface()` succeed again on a device the same page already holds (from WebUSB behaviour; not run), so a KerfDesk retry recovers. P3 stands.

### Challenges to the "Clean" verdicts (no break found)

- **#1732 Abort auto-restore.**
  - Tried: a project or profile switch between the Abort and the restore. `readProfile` is read at verdict time and again in `runAutoRestore` (`abort-auto-restore.ts:72-80, 147-152`), so a newly opened homing or rotary profile excludes the restore: safe.
  - Tried: a second Abort for the same request, which `decided` blocks. And a firmware `$22=1` that the profile does not list, where the restore is `$X` + G92 and moves nothing.
  - Clean holds (READ).
- **#1736 Run again skips Job Review.**
  - Tried: Current Position with the head moved. The program fingerprint is identical, but any new bounds warning changes the warning set, and warning strings carry their numbers, so the set comparison is exact. Run again also needs a framed-run permit.
  - Tried: a controller reconnect (`controllerSessionEpoch`) and a remote presenter (`isOrdinaryDesktopReview`). Both reopen the dialog (`run-again-review-carry.ts:92-140`).
  - Clean holds (READ).
- **#1733 Clean jog keeps the Frame.**
  - Tried: a Current Position job, a Z or rotary jog, a roller rotary, a cancelled jog, and the pendant. Each is excluded (`jog-held-frame.ts:57-75, 98-124, 168-185`).
  - Clean holds (READ).
- **#1694 ordered `$G`.**
  - Tried: whether `ok` to `$G` only means "accepted", as with a jog that is planned but still running. The probe fires only after a sustained Idle window (1 s on identified firmware, 15 s otherwise; ADR-696 decision 1), so motion has ended.
  - Clean holds (READ).
- **#1711 Marlin handback.**
  - Tried: a worker that never answers the release, so `handbacksPending` would stay set and the freeze would never run. `releaseHostedRefill` → `worker-refill-handover.ts` `begin()` arms `deps.fail` on a timer, and the stop lines are written before the wait.
  - Clean holds (READ).

### New findings

#### D1-P1-2: the Moshi raster ignores the layer's Dot width correction and every bidirectional scan offset
- **Where:** `src/core/controllers/moshi/moshi-raster-plan.ts:23-55` (`planRasterGroupSteps`). It never reads `group.dotWidthCorrectionMm` or `group.bidirectionalScanOffsetMm`, nor the device's `scanningOffsets` table.
- **Anchor:**
  - The G-code route applies both: `grbl-strategy.ts:333-335` passes `dotWidthCorrectionMm` and `scanOffsetMm: group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, feed)`.
  - The compiler builds them into every Image group (`compile-job-raster.ts:172, 230-233`).
  - ADR-705 says each Image group "is one raster program" from the same `prepareOutput` (preview = output, ADR-040).
- **Evidence: REPRO** `q6-moshi-raster-settings.mts` (`out/q6.txt`).
  - The Moshi program bytes are **byte-identical** with Dot width correction 0 or 0.2 mm, and with scan offset 0 or 0.3 mm. The strokes are 42.01→46.00 and 46.00→42.01 in every case.
  - Control: `emitRasterGroup` output changes for each setting (`true`, `true`).
- **Scenario:** an operator who has calibrated a bidirectional scan offset (in the layer or in Machine Setup's scanning offsets), or who sets Dot width correction, sends an image to a Moshiboard.
  - Reverse rows land uncorrected, so edges ghost by the calibrated offset.
  - Every dark run burns longer by the correction.
  - No warning is shown.
- **Severity: P1** by the letter of METHOD §3: it silently produces wrong position or scale, and the P1 test has no reach clause. The precedent is Z3-P1-2 (Moshi missed the rotary feed match, which is also an opt-in setting). The error is sub-millimetre and the settings are off by default, so the coordinator may weigh this when re-checking.
- **Announced?** No. ADR-705 decision 4 lists power as the only thing a Moshi drops.
- **Novelty:** new. Related, outside the window: the Ruida `.rd` writer reads neither field either (`src/core/controllers/ruida`, `src/io/rd`: no reference). That predates C1 and belongs to D2 (single choke points).
- **Fix direction:**
  - Shift each reverse row's run edges by the scan offset (resolved as on G-code: the layer's value, else `offsetForSpeed(device.scanningOffsets, feed)`).
  - Shorten each dark run by the dot width correction, as `emit-raster-sweep.ts` does.
  - Or refuse or warn before Start when either is set.
  - Add decoded tests with both settings set.

#### D1-P2-5: on a Moshi or Ruida network job, Abort is not reachable from every window state (non-negotiable 9)
- **Where:**
  - `src/ui/laser/use-job-shortcuts.ts:40-46, 92-117`: `Ctrl+.` resolves its action from `useLaserStore` only.
  - `src/ui/laser/LiveMotionBar.tsx:67-75`: the bar is built from `useLaserStore` only.
  - The only Abort for these jobs is in `MoshiUsbDetails.tsx:124-131` and `RuidaNetworkDetails.tsx:157-163`. Both sit inside a `<details>` that is collapsed by default, inside the "Machine details" `AnchoredPopover`. That popover mounts only while open (`CompactConnectionControls.tsx:71-91`) and closes on any outside pointer-down or Escape (`AnchoredPopover.tsx:59,72,134`).
- **Anchor:** PROJECT.md:486, non-negotiable 9: "the software Abort / Controller Reset control is reachable from any window state during a job. No modal can block it". `use-job-shortcuts.ts:6-17` states that `Ctrl+.` exists to keep this rule.
- **Evidence:**
  - **REPRO** `q3-moshi-running-guards.mts` (`out/q3.txt`). With a Moshi job `running` on `MoshiSimulator`, the app's real capture-phase `Ctrl+.` handler (`installAbortShortcut`) leaves the event unhandled. No estop is written, and the phase stays `running`.
  - Control: the panel's `abort()` writes the estop and returns to `idle`.
  - **READ** for the popover and `<details>` mounting, and for the Ruida half.
- **Scenario:** the operator starts a Moshi or Ruida job from Machine details, then clicks the canvas, which closes the popover. To stop it from KerfDesk they must reopen Machine details, expand the collapsed connection section, and press Abort. `Ctrl+.` does nothing, and an open modal blocks the popover entirely.
- **Severity: P2.** It is a broken non-negotiable with a clear failure scenario, but nothing wrong is sent, and the machine's own stop remains. Note the precedent: the 2026-07-13 handoff rated an unmounted Stop mid-job (T2) P1. The coordinator may prefer that rating.
- **Announced?** No. **Novelty:** new. D1-P2-3 covers only the profile-change unmount.
- **Fix direction:** a global "machine work active" source, as D1-P2-3 proposes. Have `stopShortcutAction` and the Live Motion bar offer the Moshi estop or the Ruida Stop Process while either store is `framing`, `running`, `homing` or `paused`, and add a test for each.

### Not verified
- Real hardware timing:
  - the Ruida idle (travel) speed and when the controller first reports busy after a UDP file (D1-P2-2);
  - whether the Ruida `partEnd` bit, which counts as busy (`ruida-live-commands.ts:47-49`), stays latched after a job.
- MeerK40t sources: not on this PC. The only MeerK40t evidence available is the repo's comments and goldens.
- The popover/`<details>` unmount was read, not exercised in a browser.
- WebUSB re-open semantics on an already-claimed device (D1-P3-1): from the WebUSB spec, not run.
- Design Studio (#1706/#1709/#1710/#1713) and #1692 were not re-checked.

### Repro files
All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d1r\`. Output is in `out\`.
- `q1-moshi-raster-trace.mts`, `q1b-moshi-prepare-e2e.mts`: D1-P1-1
- `q2-ruida-timed-frame.mts`: D1-P2-2
- `q3-moshi-running-guards.mts`: D1-P2-3, D1-P2-5
- `q4-ps-zero-extent.mts`: D1-P2-4
- `q5-usb-open-leak.mts`: D1-P3-1
- `q6-moshi-raster-settings.mts`: D1-P1-2
- `register.mjs`, `ts-resolve.mjs`: the loader (copied from `zz-d1`)

No security findings; `SECURITY-DETAILS.md` was not needed.

```json
[
  {"id":"D1-P1-1","verdict":"CONFIRMED","severity":"P1","evidence":"REPRO q1/q1b (own MoshiProgram trace): default Image layer, dark X 110-130 burns 105.00-135.00, 5.00 mm per row, no advisory; ADR-705 d3 and Fill golden have runways laser-off; no repo evidence MeerK40t burns the runway"},
  {"id":"D1-P2-1","verdict":"CONFIRMED","severity":"P2","evidence":"READ; partial pre-Start surfaces exist (canvas out-of-bed outlines, Preview banner, no-go drawing, Moshi power note) but not for post-compile checks; after Start the list sits in a collapsed <details> inside a dismissable popover"},
  {"id":"D1-P2-2","verdict":"CONFIRMED","severity":"P2","evidence":"REPRO q2 (wall-clock busy): traces of 250/380 ms stay framing >4 s, Start refused; 450/900 ms count; Abort + re-Frame from the start corner stays stuck; a job under 400 ms stays running (READ)"},
  {"id":"D1-P2-3","verdict":"CONFIRMED","severity":"P2","evidence":"REPRO q3 (drop guard false during Moshi job) + READ; nuance: Electron will-quit sends Ruida Stop Process, so a Ruida close stops the job like GRBL, but Update is not refused and aborts it; Moshi gets no stop"},
  {"id":"D1-P2-4","verdict":"CONFIRMED","severity":"P2","file":"src/io/postscript/ps-svg.ts","line":14,"evidence":"REPRO q4 via importPostscriptFile; location corrected from L166-186 to L14-35; also fails for a zero-height declared %%BoundingBox and thick strokes"},
  {"id":"D1-P3-1","verdict":"CONFIRMED","severity":"P3","evidence":"REPRO q5: real createWebUsbLink + moshiUsbOpener + store over a fake device; selectConfiguration failure and stalled status read both leave the device open and claimed"},
  {"id":"D1-P1-2","verdict":"NEW","severity":"P1","area":"merge-train-review","pr":1723,"file":"src/core/controllers/moshi/moshi-raster-plan.ts","line":23,"anchor":"grbl-strategy.ts:333-335 applies dotWidthCorrectionMm and scanOffsetMm; ADR-040 preview = output; METHOD §3 no reach clause (precedent Z3-P1-2)","evidence":"REPRO q6: Moshi program bytes identical with dot width 0/0.2 mm and scan offset 0/0.3 mm; emitRasterGroup changes for both","known":false,"summary":"Moshi raster drops the layer's Dot width correction and every bidirectional scan offset (layer and device scanningOffsets) silently"},
  {"id":"D1-P2-5","verdict":"NEW","severity":"P2","area":"merge-train-review","pr":[1723,1707],"file":"src/ui/laser/use-job-shortcuts.ts","line":92,"anchor":"PROJECT.md:486 non-negotiable 9 (Abort reachable from any window state)","evidence":"REPRO q3: Ctrl+. during a running Moshi job is unhandled, no estop; READ: LiveMotionBar reads useLaserStore only; the only Abort lives in a collapsed <details> inside a popover that unmounts when closed","known":false,"summary":"Moshi and Ruida network jobs have no always-reachable Abort: Ctrl+. and the Live Motion bar ignore them, and the panel Abort is inside a dismissable popover"}
]
```

Refuter counts: raised 8, refuted 0, P1 2, P2 5, P3 1, known 0
