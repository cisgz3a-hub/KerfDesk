# Rolling audit v12 — X5 Fix verification: the UX P3 sweep

- **When:** 2026-11-09, 17:50–18:40 +0800   **Tree:** origin/main @ `7c3c00971`. Repros ran on the scratchpad export `j17-main` (`7c3c00971`, `node_modules` a junction) and on a mutable copy of it, `zz-x5\mut`, which adds only the repro test file.
- **Scope:** the six merged PRs of the UX P3 sweep.
  - #1595 `147f0cefa` controller messages a beginner can act on (U5-P3-1..7, U5-P3-13; U4-P3-2, U4-P3-4).
  - #1598 `5f09e1110` wider Ctrl+K, ranked Learn, Keyboard Shortcuts (U6-P2-1→P3, U6-P3-1..6; ADR-604 Amd 1).
  - #1599 `bfe4d2b92` the toolbar says "No answer".
  - #1604 `7961853f2` keyboard, screen reader and small-screen fixes (U7-P3-1, 2, 5, 7, 8, 9, 10).
  - #1605 `42c23e777` the LightBurn beginner path: first-burn lesson, cut test guidance, origin check, mm/s speeds (U8-P3-1..4).
  - #1609 `0e5c2c896` first-burn wording for Pause, Frame, the origin offer, the cable card, Job Review and Job complete (U4 P3s).
  - Rolling v10 already audited #1595 and #1599 (V3) and #1598 and #1604 (V8, V9). Their findings are KNOWN and their verified items were not redone; this report adds what they did not reach (the door-hold wording, the homing-off and grblHAL alarm routes) and audits #1605 and #1609, which were still open then.
- **Lenses run:**
  - **L10:** each fix on the case it was filed for, on every entry point that shows it (rail, Live Motion bar, toolbar pill, canvas badge, Console, Ctrl+K, lessons).
  - **L9 (truthful wording):** every sentence the six PRs added or reworded, checked against the code path that shows it and against the labels it names.
  - **L12:** main's CI history for each merge.
  - Not run: the phone/remote view (remote text reaches phones only after the owed Worker redeploy; noted, not raised). No hardware.
- **Counts:** 7 raised → refuter pending → P1 0 / P2 1 / P3 6 (+ 3 KNOWN re-observed: V8-P3-2, V8-P3-4, V8-P3-5).

## Headline

**The wording is mostly true, and the controller messages hold on the simulated GRBL. One new sentence promises a button that is not there.**

- **#1595's door-hold sentence** ("press Pause and then Resume here") is true while the job is still streaming: in the simulator, Pause then Resume finished the job. In the **finishing tail**, though, every line has been sent and the planner is still running. Open the lid there and the bar shows the same sentence with **only ABORT JOB**. Fifteen seconds later the controller is still in Door and the job never finishes (X5-P2-1). With Sort cuts last, the tail is usually the slow final cut-out.
- **#1609's U4-P3-3 fix misses the alarm case it was filed for.** After ALARM:1 mid-job, the rail keeps counting down ("~30s remaining", then "~20s", then "~17s" after Reset), and the run overlay stays `running` / `Run` (X5-P3-1).
- **Smaller truth slips:**
  - With Home off, the ALARM:8/9 card tells the beginner to turn Home off and to Home again (X5-P3-2).
  - Console still decodes a banner-less grblHAL E-stop as "Homing fail — dual-axis switch" (X5-P3-3).
  - The mm/s conversion wraps only the number next to the unit, so "1/2 mm/s" commits 1 mm/min (X5-P3-4).
  - The cable-pulled card says the machine may keep moving "for a few seconds"; a 100 mm square cut at 5 mm/s is four buffered lines, about 80 s lit (X5-P3-5).
  - Ctrl+K lists Pro lessons with no Pro mark (X5-P3-6).
- **What holds:**
  - Every label the new lessons name exists under that name, and each instruction does what it says.
  - mm/s typed in the Speed box and LightBurn's mm/s both reach the G-code F word ×60.
  - The Pause text is true on every driver that shows it.
  - The origin offer names the corner that lands at the head.
  - The PRs' own 14 test files pass on main (124 tests).
- **L12:** the four 2026-11-05 merges never ran CI on their own merge commits (billing lock), but their combined result `5f09e1110` passed CI, Browser smoke and Desktop package on re-runs dated 2026-11-08. #1605 and #1609 had CI and Browser smoke cancelled on their merges; later main commits passed both.

## Matrix

"Holds" means the fix's behaviour was reproduced or read true on that route.

| PR | Route / entry point | Result |
|---|---|---|
| #1595 | Door opened while **streaming**: bar text, then Pause → Resume (simulated GRBL, door input) | holds: Pause shown, `paused` at `Door:0`, Resume ran the job to `Idle` and `M5` |
| #1595 | Door opened in the **finishing tail** (`streamer: done`, planner running) | **X5-P2-1**: same text, only ABORT JOB; stuck in `Door` 15 s later |
| #1595 | ALARM:8 / ALARM:9, Home on: card text and button order | holds: `$X — Unlock`, `Machine Setup`, `Home ($H)` |
| #1595 | ALARM:8 / ALARM:9, **Home off** | **X5-P3-2** |
| #1595 | ALARM:1 before / after Reset, Home on and off; ALARM:2 before / after Reset | holds: "Then Unlock ($X)" or "Then Home ($H)…"; "The position is kept, so Unlock ($X) is safe" (true for GRBL soft limits: feed hold, then reset) |
| #1595 | Toolbar pill on each alarm | holds: "Connected · Alarm" |
| #1595 | grblHAL with no banner (`$$` lists `$14`–`$18`), ALARM:10: card | holds: "E-stop asserted (grblHAL)" |
| #1595 | same, **Console** decode | **X5-P3-3**: "Homing fail — dual-axis switch" |
| #1595 | Halted rail state, Use detected baud, second idle refusal | KNOWN verified by V3; PR tests pass on main |
| #1598 | Lesson relabels (Cut Planner, Apply Mask to Image, Shared by, Show on canvas / Include in output, Apply to operation, Link to operation, Font size, Weld overlaps, Photo engraving, Material recipe, Auto tones, Open design library, Design Studio) | holds (V8 also verified) |
| #1598 | Pro marks: Learn list and reader | holds, except the camera and trace lessons (KNOWN V8-P3-5) |
| #1598 | Pro marks: **Ctrl+K lesson rows** | **X5-P3-6** |
| #1598 | New shortcuts vs existing keys and Electron accelerators | none added; Help → Keyboard Shortcuts... has no key; F12 was already bound (`view-shortcuts.ts:79`); Windows and Linux have no native menu, and macOS's omits View (`electron/application-menu-policy.ts:8-19`) |
| #1599 | "No answer" in the toolbar | KNOWN verified by V3 / V9 |
| #1604 | Status-bar hover "mouse wheel" | KNOWN V8-P3-2, re-confirmed in Chrome 156 (vertical wheel 0 px, Shift+wheel 300 px) |
| #1604 | Draw-tool keyboard route, focus hold, dark disabled contrast (3.59:1 on `--lf-bg-1`, as the comment says) | holds |
| #1605 | First-burn lesson: every named control and every claimed effect | holds (see Verified clean) |
| #1605 | Material Test guidance and Use cut starting ranges | holds: all fields are mm/min; the title matches `CUT_START_RANGES` |
| #1605 | Origin hint: jog-arrow check, upside-down / mirrored advice | holds: the jog signs follow the origin (`jog-direction.ts:17-29`, `JogPad.tsx:66`) |
| #1605 | mm/s in the Speed box → stored speed → G-code F; LightBurn mm/s import | holds for plain values (100 → F6000, 5 → F300, 2.5 → F150, both routes) |
| #1605 | mm/s inside an expression | **X5-P3-4** |
| #1609 | Pause hover "stops the head and switches the laser off" | holds: only GRBL-family drivers have `realtimePause`, all send `0x84`; CNC has its own text |
| #1609 | Origin offer names the anchor corner | holds: anchors are physical corners mapped per origin (`job-origin.ts`) |
| #1609 | Job complete "laser is off", "Not now, then Run same job again from start" | holds: the program ends `M5` / `S0`; both labels exist |
| #1609 | Canvas badge after Abort | holds ("Time remaining unavailable · job stopped") |
| #1609 | Rail countdown and run label after **ALARM:1** | **X5-P3-1** |
| #1609 | Cable-pulled card | **X5-P3-5** |

## Findings

### X5-P2-1 — A door opened in the job's finishing tail shows "press Pause and then Resume here", but the bar offers only ABORT JOB, and the job never finishes

- **Where (7c3c00971):**
  - `src/ui/laser/LiveMotionBar.tsx:355-375`: `controllerHoldDescription` and `DOOR_RELEASE` ("press Pause and then Resume here, or the machine's cycle-start button if it has one"), added by #1595.
  - `:304-326` (`describeActiveJob`) shows that text for every `isActiveJobStatus` state. That set includes `done` (`src/ui/state/laser-store-helpers.ts:76-80`).
  - `:165`: Pause is offered only when `status === 'streaming' || (status === 'done' && isControllerRunning)`, and `isControllerRunning` is `statusReport.state === 'Run'`. In `Door`, a `done` stream gets no Pause.
  - `src/ui/laser/JobRunControls.tsx` renders no Pause (ADR-207: the bar owns it).
- **Anchor:**
  - **Original finding:** U4-P3-2 ("Most hobby lasers have no cycle-start button. The working path, Pause then Resume, is not suggested") and #1595's commit message ("A door hold during a job names the route that works without a cycle-start button").
  - **Contract:** ADR-207 (DECISIONS.md): the bar "owns Pause, Resume, tool-change Continue, and software Abort while a job or machine operation is active".
  - **Lens:** L9 truthful wording.
- **Scenario:** a beginner runs the first-burn lesson. Sort cuts last puts the slow outline cut last, so near the end every line has been sent and GRBL's planner holds the rest of the cut. They lift the lid to look and the controller parks in Door, beam off.
  - The bar says "The lid or door was opened, so the controller stopped the job. Press Pause and then Resume here…". The only button is **ABORT JOB**.
  - Closing the lid changes nothing. The job sits at 99 % until they abort, and so loses the end of the cut, or until they find a cycle-start button the machine may not have.
- **Evidence:** REPRO, `zz-x5\mut\src\ui\laser\zz-x5-door-alarm.simulator.test.tsx` → `zz-x5\door-alarm.jsonl`. Real laser-store, real `LiveMotionBar` and `LaserWindow`, scripted GRBL simulator (15-block planner).

  | Step | Stream | Controller | Bar buttons | Bar text |
  |---|---|---|---|---|
  | A1 door opened while streaming | `streaming` | `Door:1` | Pause, ABORT JOB | "…Press Pause and then Resume here…" |
  | A3 after Pause | `paused` | `Door:0` | Resume, ABORT JOB | "JOB PAUSED" |
  | A4 after Resume | finished | `Idle` (last lines `M5`, `G0 X0 Y0 S0`) | — | — |
  | B1 door opened in the tail (caught at `done`, sim `Run`, 15 blocks queued) | `done` | `Door:1` | **ABORT JOB only** | "…Press Pause and then Resume here… · 47 / 47 lines · 99%" |
  | B2 door closed | `done` | `Door:0` | **ABORT JOB only** | same |
  | B3 15 s later | `done` | `Door:0` | **ABORT JOB only** | same |
  | B4 the store's `pauseJob()` called directly | `paused` | `Door:0` | Resume, ABORT JOB | "JOB PAUSED" |

  B4 shows that the route works in the tail. Only the button is missing.
- **Severity:** P2.
  - **For P2:**
    - A false instruction to a beginner on the job's last step.
    - The only exit offered is the red ABORT JOB, which leaves the cut unfinished.
    - The precedent for the missing route itself is U4-P3-2 (P3), but here the app now names a control that does not exist.
  - **For P3:**
    - The beam is dark throughout (Door).
    - The window is the planner tail, and the interrupted-job card can recover the rest after an Abort.
    - A machine with a cycle-start button can release it.
  - **Against P1:** no wrong burn, no lit beam.
- **Announced?** No. The code comment at `:351-354` says "Pause makes the hold the app's own, and its Resume then releases it" without the `done` case.
- **Novelty:** new with #1595's wording. The missing Pause in `done` + `Door` is older (before #1595 the text said "press cycle start on the machine"). No audit under `docs/audits` (incl. v10 V3/V8/V9, v11, pro-loop v1–v3) covers a door hold in the finishing tail. No open PR touches `LiveMotionBar.tsx`.
- **Fix direction:** offer Pause when `status === 'done'` and the controller reports `Door` or `Hold` (B4 shows `pauseJob` handles it). Or drop the Pause/Resume clause from the text while Pause is not offered. Add the tail case to `controller-messages-u5.test.tsx`.
- **Refuter:** PENDING.

### X5-P3-1 — After ALARM:1 mid-job the rail keeps counting down and the run stays "Run", through Reset: #1609's U4-P3-3 fix misses the alarm case

- **Where (7c3c00971):**
  - `src/ui/workspace/canvas-motion-badge.tsx:268-276` (`runStateLabel`, #1609) trusts `run.lifecycle` and `run.controllerState`.
  - `src/ui/laser/LiveJobTimeBadge.tsx:20-29` shows `run.timing` while `liveCanvasRun` exists.
  - After a hard-limit alarm, `liveCanvasRun.lifecycle` stays `running` and `controllerState` stays `Run`, although the streamer is `cancelled` (`src/ui/state/live-canvas-run-timing.ts:202-208` lists the terminal lifecycles).
- **Anchor:** the original finding, U4-P3-3: "After Abort and ALARM:1 the head label still says 'Run', and after ALARM:1 the rail still says '~3m 58s remaining'". Its fix direction: "Clear the head label and time left when the run ends for any reason." P3-SWEEP-U1-U4 records it as "Fixed by this sweep (#1609)".
- **Scenario:** a beginner's head hits a limit mid-job (ALARM:1). The rail's Alarm card says to clear the head and Reset, while the job box beside it keeps counting down "~30s remaining · 32 / 47 lines" as if the job were running. After Reset it is still counting ("~17s remaining").
- **Evidence:** REPRO, same test file, `stale run state` cases → `door-alarm.jsonl` lines `E-*`.

  | Case | Streamer | Rail text | `liveCanvasRun` lifecycle / controllerState |
  |---|---|---|---|
  | ALARM:1 at 300 ms into the stream, +1.5 s | `cancelled` | "~30s remaining · 32 / 47 lines" | `running` / `Run` |
  | +10 s | `cancelled` | "~20s remaining" | `running` / `Run` |
  | after Reset (+3 s), controller `Alarm` | `cancelled` | "~17s remaining · 32 / 47 lines" | `running` / `Run` |
  | Abort (control) | `cancelled` | "Time remaining unavailable · job s[topped]" | — |

  `runStateLabel` therefore returns `controllerState`, "Run", for the canvas badge too (READ: not terminal, not `Door`).
- **Severity:** P3, as U4-P3-3. A stale display beside a correct Alarm card; nothing moves.
- **Announced?** No. The sweep table says fixed.
- **Novelty:** new. #1609's test (`canvas-motion-badge.run-state.test.ts`) feeds terminal lifecycles directly; it never drives an alarm. Not in v10/v11/v12 reports.
- **Fix direction:** end the canvas run (lifecycle `errored` or `stopped`) when the streamer leaves the active set on an alarm, as Abort already does. Or have `runStateLabel` and `LiveJobTimeBadge` also check `isActiveJob(streamer)`. Add an ALARM:1-mid-job case.
- **Refuter:** PENDING.

### X5-P3-2 — With Home off, the ALARM:8/9 card says "turn Home off in Machine Setup" and "Home again", beside "Turn on homing in Machine Setup"

- **Where (7c3c00971):**
  - `src/core/controllers/grbl/alarm-codes.ts:118` (ALARM:8) and `:129` (ALARM:9), rewritten by #1595.
  - `src/ui/laser/alarm-card-advice.ts:36-50`: `alarmCardAction` adapts codes 1 and 2 to `homingEnabled`, but returns the table text unchanged for 8 and 9.
  - `src/ui/laser/AlarmRecoveryActions.tsx:63-68` adds "Set up homing — Turn on homing in Machine Setup if this machine has homing switches" when Home is off.
- **Anchor:** the original U5-P3-3 asked the card to "ask about switches first"; #1595's commit message says "If this machine has no homing switches, turn Home off in Machine Setup, then Unlock". Lens L9.
- **Scenario:** Home is off in the profile, but the firmware has `$22=1`, and the user runs `$H` from the Console (or another app left homing on). Homing fails. The card says to turn Home off (it is off) and, "if it has switches", to Home again; there is no Home button, and the row below says to turn homing on.
- **Evidence:** REPRO (`C-9-false-*` in `door-alarm.jsonl`). The card reads "…If this machine has no homing switches, turn Home off in Machine Setup, then Unlock ($X). If it has switches, check that their cables are plugged in, then Home again… **Set up homing** Turn on homing in Machine Setup if this machine has homing switches. **$X — Unlock**".
- **Severity:** P3. Contradictory wording on a rare route; Unlock is offered and is right.
- **Announced?** No. **Novelty:** new; V3 checked 8/9 with Home on only.
- **Fix direction:** give `alarmCardAction` a Home-off branch for 8 and 9: "Homing is off here, but the controller ran it. If the machine has no switches, set $22=0 or Unlock ($X)…". Or leave out the Home-off clause when `homingEnabled` is false.
- **Refuter:** PENDING.

### X5-P3-3 — A banner-less grblHAL E-stop is fixed on the Alarm card only; Console still decodes ALARM:10 as "Homing fail — dual-axis switch"

- **Where (7c3c00971):**
  - `src/ui/laser/LaserWindow.tsx` (via `alarmControllerKind`, `alarm-card-advice.ts:21-27`): the card only.
  - The Console transcript decodes with the live driver's kind: `src/ui/state/laser-transcript.ts:151-160` (`presentAlarm(controllerKind, …)`). So does the refusal text: `src/ui/state/controller-rejection-text.ts:58-69` via `controller-error-notice.ts:27`.
- **Anchor:** U5-P3-4 ("decode with the firmware the controller reported"). Lens L9 entry-point parity.
- **Scenario:** an Ortur-style grblHAL board that sends no banner runs on the stock GRBL driver. The E-stop is pressed. The rail card says "E-stop asserted (grblHAL)", while the Console line the beginner copies into a forum post says "Homing fail — dual-axis switch".
- **Evidence:** REPRO (`D-alarm10` in `door-alarm.jsonl`). The simulator's `$$` lists `$14`–`$18`, so `listsGrblHalSignalSettings: true` and `activeControllerKind: grbl-v1.1`.
  - Card: "Alarm 10: E-stop asserted (grblHAL)…".
  - Console `decoded`: "Homing fail — dual-axis switch: The second limit switch on a dual-motor axis did not trigger in time after the first. (grblHAL firmware uses alarm 10 for E-stop instead.)".
- **Severity:** P3. Console is an expert surface, and the stock text keeps its grblHAL hint.
- **Announced?** No. **Novelty:** new; the PR test checks the card only.
- **Fix direction:** pass `alarmControllerKind(state)` to the transcript and rejection decoders.
- **Refuter:** PENDING.

### X5-P3-4 — The Speed box converts mm/s only for the number next to the unit: "1/2 mm/s" commits 1 mm/min, "50+50 mm/s" 3,050 mm/min

- **Where (7c3c00971):** `src/ui/layers/dimension-entry.ts:6` (`PER_SECOND` captures one number) and `:19` (`replace(PER_SECOND, '($1 $2 * 60)')`).
  - `src/ui/layers/LayerSpeedInput.tsx` `parse` / `commit` clamp the result to at least 1 mm/min.
  - The same entry serves the CNC feed box (`CncLayerPrimitives.tsx:85,129`).
- **Anchor:** U8-P3-4's fix ("accept mm/s… and convert ×60 at the input boundary"); the box already advertises expressions for lengths. Lens L9.
- **Scenario:** a vendor guide says "half a millimetre per second" for a deep cut, and the user types `1/2 mm/s`. The regex rewrites only `2 mm/s`, giving `1/(2 mm * 60)` = 0.0083. The box clamps that to 1 mm/min and commits it: a lit beam crawling 30× slower than meant.
- **Evidence:** REPRO, `zz-x5\mms.mjs` → `mms.out.txt` (main's real `dimension-entry.ts`):
  - plain values are right: `100 mm/s` → 6000, `.5 mm/s` → 30, `4 in/sec` → 6096, `10 cm/s` → 6000;
  - `1/2 mm/s` → 0.00833 (committed as 1);
  - `50+50 mm/s` → 3050;
  - `(50+50) mm/s` → invalid ("s isn't a unit…").
- **Severity:** P3.
  - **For P2:** a silent misread becomes a much slower lit burn.
  - **Against:** typing a fraction with a unit is rare, the box shows the committed value, and the speed slider's mm/s readout shows "0 mm/s".
- **Announced?** No. **Novelty:** new (#1605).
- **Fix direction:** parse a trailing `/s` as a unit of the whole expression: evaluate the text with `/s` stripped, then ×60. Or refuse an expression that mixes an operator with a per-second unit. Add the two cases to `lightburn-path-u8.test.tsx`.
- **Refuter:** PENDING.

### X5-P3-5 — The cable-pulled card says the machine may keep moving "for a few seconds"; a buffered cut can run lit for over a minute

- **Where (7c3c00971):** `src/ui/state/laser-safety-notice.ts:207-215` (`disconnectDuringJobMessage`, #1609): "The machine may keep moving for a few seconds on commands it already has, with the laser or spindle still on. If it does not stop, use the physical E-stop…".
- **Anchor:** U4-P3-5 (whose fix direction proposed "for a few seconds"). Lens L9: "doesn't promise safety the code doesn't give". GRBL holds up to 15 planner blocks plus a 128-byte receive buffer after the host is gone.
- **Scenario:** a 100 mm square cut-out at 5 mm/s (a typical diode cut speed). The cable is knocked out at the start of the cut. All four sides are already in the controller, so the beam keeps cutting for about 80 s with no host, while the card has told the beginner it lasts "a few seconds".
- **Evidence:**
  - REPRO, `zz-x5\seg.mjs` → `seg.out.txt`. Main's LightBurn import, compile and GRBL emit give **4 G1 lines** (`G1 X110 Y10 F300 S1000` … ), each 100 mm at 300 mm/min.
  - READ: the simulator's own drain in U4-P3-5 ran 16 moves at S300.
- **Severity:** P3.
  - **For P2:** it understates a lit beam with nobody at the controls.
  - **Against:** the same card says the laser is still on and to E-stop if it does not stop, and the burn follows the job's own path.
- **Announced?** No. **Novelty:** new; the sweep took the fix direction's wording without checking it.
- **Fix direction:** drop the duration ("may keep moving and burning until it finishes the commands it already has, which can be a minute or more"). Or compute it from the unacknowledged program lines.
- **Refuter:** PENDING.

### X5-P3-6 — Ctrl+K lists Pro lessons with no Pro mark, while the same window marks Pro commands "(Pro)"

- **Where (7c3c00971):** `src/ui/commands/search-entries.ts:171-185` (`lessonEntries`: `label: tutorial.title`, family "Learn", `tutorial.pro` ignored). `src/ui/commands/CommandSearchDialog.tsx:174-176` renders label and family only. Command rows get "(Pro)" from `edition-command-gate.ts:41`.
- **Anchor:** U6-P3-4's fix ("Show the same Pro pill on Pro lessons"), applied by #1598 to the Learn list and reader. The same PR made Ctrl+K a lesson entry point (ADR-604 Amd 1 Decision 1). Lens L10 (every entry point).
- **Scenario:** in KerfDesk Free, Ctrl+K → "box" shows "Box Generator... (Pro)" and, under Learn, "Generate a finger-jointed box" with no mark. "studio" lists Design Studio lessons the same way.
- **Evidence:** READ.
- **Severity:** P3 (labelling, as V8-P3-5). The Pro prompt still gates the tool.
- **Announced?** No. **Novelty:** new entry point. A sibling of KNOWN V8-P3-5 (camera and trace lessons, Learn list), and it could join that fix card.
- **Fix direction:** append " (Pro)" with `proChoiceLabel` when `tutorial.pro !== undefined` and Pro is locked.
- **Refuter:** PENDING.

### KNOWN (re-observed, not re-raised)

- **V8-P3-2:** the status-bar hover says "scroll it sideways with the mouse wheel". Re-confirmed on Chrome for Testing 156 (`zz-x5\wheel.mjs` → `wheel.out.txt`: a vertical wheel 0 px, Shift+wheel 300 px, ArrowRight 340 px).
- **V8-P3-5:** camera lesson (Set up camera is `requestPro('camera-alignment')`) and trace lesson without Pro marks.
- **V8-P3-4** sibling: #1605's origin hint "Most diode lasers: Front left…" also shows in a CNC's Machine Setup (`DeviceSetupConfirmStep.tsx:36`). Same class (laser words on a CNC); not raised separately.

## Refuted

Candidates the auditor dropped:

- **"Pause 'switches the laser off' is false on drivers without the door byte."** Only the GRBL driver has `realtimePause: true` (`grbl/driver.ts:46`), and its `safetyDoor` is `0x84` (`:69`). Marlin, Smoothieware and Ruida have `realtimePause: false` and get the stream-side texts (`job-control-copy.ts:30-33`). CNC jobs get `cncPauseMessage`. GRBL's Door state de-energises the spindle (ADR-212; `laser-job-pause-resume.ts:114-121`).
- **"'The position is kept, so Unlock ($X) is safe' is wrong after ALARM:2."** GRBL's soft-limit check feed-holds a cycle before it resets, so machine position is retained. The alarm table and gnea's own wording say the alarm "may be safely unlocked".
- **"The origin offer's corner words are mirrored on a rear-origin machine."** The nine anchors are physical corners mapped per origin (`job-origin.ts` comment above `anchorPointForOrigin`). "front-left corner" is what lands at the head.
- **"The first-burn lesson's Set origin step leaves Start from on Absolute."** `placementAfterSetOrigin` switches Absolute to User Origin (`set-origin-placement.ts:16-24`), and the lesson also says to choose it.
- **"Use cut starting ranges sets 60–600 in the display unit."** Material Test speeds are always mm/min (`MaterialTestDialog.tsx:209-211`); the title says mm/min.
- **"The Frame hover's 'stays unlocked while the job and its placement are unchanged' hides other expiries."** True: a jog, alarm or autofocus also voids the permit (`framed-run-invalidation.ts:73-85`). But the old text made the same claim, and the error is in the safe direction: Start is greyed with its reason. Not raised.

## Verified clean

- **#1595** (simulated GRBL, rendered `LaserWindow`):
  - ALARM:8 and 9 with Home on: Unlock, Machine Setup, Home in that order, with the new text.
  - ALARM:1 before Reset: physical step, then Reset. After Reset: "Then Unlock ($X)" with Home off, "Then Home ($H) to find the position again" with Home on, and Home first.
  - ALARM:2 after Reset: "The position is kept…".
  - The pill reads "Connected · Alarm" on all six.
  - The door route while streaming: Pause, Resume, job completes (table in X5-P2-1).
  - grblHAL without a banner: the card decodes ALARM:10 as the E-stop.
  - "Machine Setup" opens the Confirm step, whose Homing row is "Enable Home ($H)" (`DeviceSetupConfirmStep.tsx:38-53`), so "turn Home off in Machine Setup" names a real control.
- **#1598:**
  - Every lesson relabel names a real control (V8 agrees).
  - `help.keyboard-shortcuts` has no key, so nothing collides.
  - ADR-604 Amd 1's labels match `search-entries.ts` (Settings headings, "Materials"/"Recipes", "Phone & MCP" desktop-only).
  - Machine Setup's Confirm row and Window → machine panel toggle exist (`window-panel-commands.ts:53-58`).
- **#1604:**
  - The draw-tool route names real things: Import is Ctrl+I (`file-command-family.ts:39`, `shortcuts.ts:116`); **Objects** is in the Artwork panel header (`CutsLayersPanel.tsx:45-52`).
  - The dark disabled colour `#7f786e` on `--lf-bg-1` `#252320` is 3.59:1, matching the "3.6:1" comment.
  - The dialog inset leaves the bar on top.
- **#1605, first-burn lesson:** every named control exists under that name:
  - Draw ellipse + Shift;
  - W/H;
  - Text;
  - Arrange → Align (Align Center X/Y, Align Centers);
  - Operation list tools (•••) → **Sort cuts last** (`OperationListTools.tsx:81-102`);
  - Tools → **Material Test...**;
  - Set origin here;
  - Start from → **User Origin** (`JobPlacementControls.tsx:10,63`);
  - Frame job;
  - Start → Job Review → **Start job** (`JobReviewDialog.tsx:270`);
  - ABORT JOB.

  Sort cuts last puts engraving-only artwork first and cut-only artwork last (`sort-cuts-last.ts:69-74`), so "Preview runs the engraving first and the cut last" is true for the lesson's coaster. None of the steps is a Pro tool.
- **#1605, the other fixes:**
  - **Material Test:** the reading and safety lines show on both modes; the offer appears only on Cut with default speed and power.
  - **Origin hint:** the jog arrows follow the origin.
  - **Speed entry:** mm/s, sec, second, in/s and cm/s convert; the error says "Enter a speed in mm/min (or type mm/s)".
- **mm/s round trip** (`zz-x5\rt.mjs` → `rt.out.txt`, main's real import, compile and GRBL emit):

  | Speed (mm/s) | LightBurn import: layer speed → F | Typed in the Speed box → F |
  |---|---|---|
  | 100 | 6000 → F6000 | F6000 |
  | 5 | 300 → F300 | F300 |
  | 2.5 | 150 → F150 | F150 |

- **#1609:**
  - **Pause and Resume hovers:** true per driver (Refuted).
  - **The rail's "Running the framed job":** replaces "Frame expired" during a run (READ, `JobActionControls.tsx:232`).
  - **The origin offer and the stale "needs a custom work origin" banner:** both cleared once `workOriginActive` turns true (`start-blocker-invalidation.ts:55-71`).
  - **Job Review:** the size range now reads "G-code X…", and the out-of-bed lines read "(bed position)".
  - **Job complete:** "The job finished and the laser is off.", plus Not now → Run same job again from start (both labels exist; the program ends `M5`, `G0 … S0` in the simulator).
  - **Canvas "Paused, laser off" for Door:** true.
  - **Door gloss substates:** they match GRBL 1.1's report.c meanings.
- **The PRs' own tests on main** (`zz-x5\vt-focused.txt`): 14 files and 124 tests passed on `7c3c00971`, one worker, `--no-experimental-webstorage`, launched at 3.3 GB free.
  - Files: `controller-messages-u5`, `search-entries`, `CommandSearchDialog`, `accessibility-u7`, `lightburn-path-u8`, `tutorial-fidelity`, `controller-state-gloss`, `start-blocked-setup-offers`, `start-blocker-invalidation`, `canvas-motion-badge.run-state`, `job-review-stat-tiles`, `laser-safety-notice`, `ConnectionBar.compact` and `Toolbar`.

### CI on the merged results (L12)

Main's push runs per merge commit (`gh api repos/cisgz3a-hub/KerfDesk/actions/runs?head_sha=`). Every PR head shows its required checks green (`gh pr view --json statusCheckRollup`: 15–17 success, the rest skipped or neutral).

| PR | Merge commit | CI / Browser smoke / Desktop package on the merge | First main commit where each passed |
|---|---|---|---|
| #1599 | `bfe4d2b92` (11-05 23:19 UTC) | failure ×3: no job started ("account is locked due to a billing issue") | `5f09e1110`, all three (re-runs, CI attempt 3, Browser attempt 3, Desktop attempt 11, finished 2026-11-08 09:36–09:46 UTC) |
| #1595 | `147f0cefa` (23:26) | failure ×3, same cause | `5f09e1110`, all three |
| #1604 | `7961853f2` (23:27:10) | failure ×3, same cause | `5f09e1110`, all three |
| #1598 | `5f09e1110` (23:27:18) | **success ×3** (the re-runs above) | itself; it is the combined result of all four 11-05 merges |
| #1605 | `42c23e777` (11-08 12:01) | cancelled / cancelled / success | CI `2826e2932` (#1621); Browser `c70612b58` (#1615) |
| #1609 | `0e5c2c896` (11-08 13:45) | cancelled / cancelled / success | Browser `9d446e01f` (#1611); CI `a3965a77d` (#1619) |

So every one of the six has a completed unit-test, browser-smoke and packaging run on a main commit that contains it. Local Vitest above re-ran their own suites on today's main.

## Not verified

- **Phone / remote view:** not opened. Remote-facing text reaches phones only after the owed Worker redeploy (KNOWN, U7-P3-8 follow-up).
- **Browser UI:** only the wheel check ran in Chrome 156. The Live Motion bar, alarm card and rail were rendered in jsdom by the real components, not in a browser.
- **A door input reporting `Pn:D`:** the simulator does not report the pin, so the "Close it, then…" variant was read, not rendered. It names the same Pause.
- **Interrupted-job recovery after aborting a door-held tail (X5-P2-1):** not run; the severity case assumes the card offers it.
- **A cable pull's real drain time:** sized from the emitted program and GRBL's buffers, not timed on hardware.
- **Hardware:** none, by instruction.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x5\`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `mut\` | Copy of `j17-main` (`7c3c00971`) with `node_modules` junctioned; only the test below added |
| `mut\src\ui\laser\zz-x5-door-alarm.simulator.test.tsx` | X5-P2-1 (door while streaming / in the tail), X5-P3-1 (ALARM:1 mid-job countdown), X5-P3-2 (ALARM:8/9 Home on and off, ALARM:1/2 before and after Reset, pill), X5-P3-3 (grblHAL ALARM:10 card vs Console); output `door-alarm.jsonl` |
| `vt-door-alarm.txt`, `vt-alarm10.txt`, `vt-stale.txt`, `vt-stale2.txt` | Vitest runs of that file (8, 1, 3 and 1 tests passed) |
| `vt-focused.txt` | The six PRs' own 14 test files on main |
| `mms.mjs` → `mms.out.txt` | X5-P3-4: main's `dimension-entry.ts` on 37 inputs |
| `rt.mjs` → `rt.out.txt` | mm/s round trip: LightBurn import and typed entry → G-code F |
| `seg.mjs` → `seg.out.txt` | X5-P3-5: G1 lines for a 100 mm square at 5 mm/s |
| `wheel.mjs` → `wheel.out.txt` | KNOWN V8-P3-2 re-check on Chrome for Testing 156 |
| `register.mjs`, `ts-resolve.mjs` | Node TS loader (from W4) |

```json
{
  "area": "X5",
  "id": "fix-ux-sweep",
  "tree": "7c3c00971",
  "raised": 7,
  "findings": [
    {"id": "X5-P2-1", "severity": "P2", "area": "X5", "file": "src/ui/laser/LiveMotionBar.tsx", "line": 165, "anchor": "Original U4-P3-2 + #1595 message; ADR-207 bar owns Pause; L9", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Door opened in the finishing tail (streamer done, planner running): the bar says 'press Pause and then Resume here' but shows only ABORT JOB (canPause needs streaming or Run); the job stays in Door; store pauseJob works there"},
    {"id": "X5-P3-1", "severity": "P3", "area": "X5", "file": "src/ui/workspace/canvas-motion-badge.tsx", "line": 268, "anchor": "Original U4-P3-3 (ALARM:1 case) claimed fixed by #1609", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "After ALARM:1 mid-job liveCanvasRun stays running/Run; the rail counts '~30s remaining' down through Reset and the canvas badge label stays Run"},
    {"id": "X5-P3-2", "severity": "P3", "area": "X5", "file": "src/ui/laser/alarm-card-advice.ts", "line": 50, "anchor": "U5-P3-3 fix wording; L9", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "With Home off, ALARM:8/9 card says turn Home off and Home again, beside 'Turn on homing in Machine Setup' and no Home button"},
    {"id": "X5-P3-3", "severity": "P3", "area": "X5", "file": "src/ui/state/laser-transcript.ts", "line": 157, "anchor": "U5-P3-4; L9 entry-point parity", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Banner-less grblHAL ALARM:10 is the E-stop on the card but Console (and refusal text) still decode 'Homing fail — dual-axis switch'"},
    {"id": "X5-P3-4", "severity": "P3", "area": "X5", "file": "src/ui/layers/dimension-entry.ts", "line": 19, "anchor": "U8-P3-4 fix; L9", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "mm/s regex wraps only the number before the unit: '1/2 mm/s' -> 0.008 committed as 1 mm/min, '50+50 mm/s' -> 3050"},
    {"id": "X5-P3-5", "severity": "P3", "area": "X5", "file": "src/ui/state/laser-safety-notice.ts", "line": 210, "anchor": "U4-P3-5 fix wording; L9 promise vs GRBL buffers", "evidence": "REPRO+READ", "verdict": "PENDING", "known": false, "summary": "Cable-pulled card says the machine may keep moving 'for a few seconds'; a 100 mm square cut at 5 mm/s is 4 buffered G1 lines, ~80 s lit"},
    {"id": "X5-P3-6", "severity": "P3", "area": "X5", "file": "src/ui/commands/search-entries.ts", "line": 178, "anchor": "U6-P3-4 fix; ADR-604 Amd 1 D1 lesson entry point; L10", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Ctrl+K lesson rows ignore tutorial.pro while command rows say '(Pro)'; sibling of KNOWN V8-P3-5"}
  ]
}
```

## Refuter (2026-11-09)

- **Refuter:** a fresh session, which did not see the auditor's reasoning.
- **Tree:** origin/main @ `7c3c00971`. Repros ran on `zz-x5r\mut`, a copy of `j17-main` (`7c3c00971`) with `node_modules` junctioned and one repro test file added, and on Node runs of main's real modules against `j17-main`.
- **Vitest:** one worker, `--no-experimental-webstorage`. Each run started with at least 2.8 GB free. No browser was used.

### Verdicts

#### X5-P2-1 — CONFIRMED, P2

The finding holds, and it reaches further than the report says. No route offered on the PC releases the hold. Abort loses no work.

**Repro.** `zz-x5r-refute.simulator.test.tsx` → `refute.jsonl` `T*`, `A1`, `W1`, `Q1`, on the real store, `LiveMotionBar`, `LaserWindow` and the simulated GRBL:

- **Console `~`** (T2) is refused: "A job is active. Request ABORT before sending setup, jog, home, unlock, origin, settings, or autofocus commands." No `~` reached the wire.
  - A lone `~` is prepared with `requiresNoActiveOperation` (`src/core/controllers/grbl/console-command.ts:161-164`). `isActiveJob` includes `done` (`src/ui/state/console-command-readiness.ts:90-92`, `laser-store-helpers.ts:76-77`).
- **Keyboard / Ctrl+K:** no Pause or Resume command exists. `pauseJob` has only two production callers: `LiveMotionBar.tsx:176` and the remote `executePauseResume` (`src/ui/remote-control/machine-actions.ts:231-245`).
- **Phone / MCP:** the remote route accepts any `isActiveJob` stream, so it would pause a `done` stream. That is the same store call that T4 shows working. It needs a paired phone or MCP client and the owed Worker redeploy, so a beginner at the PC does not have it.
- **Waiting** (T3): 120 s after the door closed, the stream is still `done` / `Door:0` / `post-job-settle`, with no notice, and the bar still shows only ABORT JOB.
  - The settle marker's 30 s timeout runs in `non-idle-status-activity` mode (`src/ui/state/laser-post-job-settle.ts:40,122-130`). Door reports count as activity, so it never fires.
- **Door closing on its own:** on the simulator (GRBL 1.1 semantics), closing the door leaves `Door:0`, which waits for cycle start. Whether grblHAL or FluidNC resume on their own is UNVERIFIED; no external source was fetched.
- **The store's Pause then Resume in the tail** (T4–T5) finishes the job: `Idle`, the completion was offered, and the run receipt was written. So only the button is missing.
- **ABORT JOB in the door-held tail** (A1):
  - The controller ends `Idle` with the spindle at 0 and no alarm.
  - The recovery capsule records `cancelled` with `plannerBacklog {queuedBlocks: 15, bound: planner-size}`.
  - `automaticRecoveryRestart` restarts at raw line 34 of 50, stepping back 15 blocks. `CheckpointResumeBanner.tsx:29-34` shows the capsule.
  - So Abort loses neither the part nor the work, and the beam is dark throughout. The cost is a re-trace of up to 15 blocks, which ADR-398 Decision 2 prefers to skipping them (KNOWN design).
- **Reach is wider than "the finishing tail"** (Q1, plus `drain.mjs` → `drain.out.txt`):
  - A 100 mm square cut-out emits 6 motion blocks, fewer than GRBL's 15-block planner. The stream reaches `done` at 12/12 lines with all 6 moves still queued, so a lid opened at **any** moment of that 80 s cut (at 5 mm/s) gets the false sentence and only ABORT JOB.
  - Measured tails:
    - every plain rectangle: the whole job;
    - a 3-pass 100 mm square: the last 180–240 s;
    - the lesson's circle (80 mm at 5 mm/s): the last ~12 s of each run;
    - a 30 mm circle at 10 mm/s: ~4 s.
- **Control** (W1): a door opened while 6 lines were still unacknowledged left the stream `streaming` for 3 s with Pause offered. GRBL's frozen planner keeps the stream from reaching `done`, so the trap is exactly "every line acknowledged before the lid opens".

**Severity.** P2 stands. It is not P1:

- there is no lit beam and no wrong output;
- the operator sees the stop;
- Abort keeps a recovery capsule that restarts before the discarded moves.

It is above P3 because the sentence names a control that does not exist, on an ordinary route (any simple cut-out). The only offered exit is the red Abort.

#### X5-P3-1 — CONFIRMED, P3 (window narrower than "through Reset")

**Repro** (`L1`–`L5`):

| Step | Rail | Run lifecycle | Canvas `runStateLabel` |
|---|---|---|---|
| ALARM:1 +1.5 s | "~30s remaining" | `running` | "Run" |
| +6.5 s | "~25s remaining" | `running` | "Run" |
| After Reset | "~22s remaining" | `running` | "Run" |
| After Unlock (`$X`) | no countdown | `stopped`, timing `unavailable` | "Stopped" |

So the stale countdown lasts from the alarm until Unlock, beside a correct Alarm card. P3, as filed.

#### X5-P3-2 — CONFIRMED, P3

- **Two lines of evidence:**
  - The auditor's REPRO (`zz-x5\door-alarm.jsonl` `C-9-false-before-reset`): the card says to "turn Home off" while Home is off, and to "Home again" with no Home button. The "Set up homing / Turn on homing" row sits below it.
  - `src/ui/laser/alarm-card-advice.ts:36-50`: `alarmCardAction` branches on `homingEnabled` for codes 1 and 2 only, and returns the table text for 8 and 9.
- **Reach:** reachable. `$H` is a Console command allowed in Idle or Alarm (`console-command.ts:147-149`), and the firmware may have `$22=1` while the profile's Home is off.

#### X5-P3-3 — CONFIRMED, P3

- The auditor's REPRO (`D-alarm10`).
- READ: `alarmControllerKind` has a single caller, `src/ui/laser/LaserWindow.tsx:58`. The transcript decodes with the driver's kind (`src/ui/state/laser-transcript.ts:68,157`).
- The Console is an expert surface, and the stock text carries the grblHAL hint.

#### X5-P3-4 — RE-RATED to P1

This is a silent wrong speed with the beam lit, and nothing warns before output. The brief's own test applies: the input can be typed (a LightBurn import carries numbers, so this route is typed only), and a large wrong speed reaches the burn with no warning.

**Repro, real component.** The real `SpeedInput`, typed then blurred (`refute.jsonl` `S-*`):

- **mm display:**
  - `1/2 mm/s` → commit `{speed: 1}` (meant 30 mm/min, 30×);
  - `50+50 mm/s` → `{speed: 3050}` (meant 6000).
- **in display:** `1/2 in/s` → `{speed: 1}` (meant 762 mm/min, 762×).
- **Controls:** `0.5 mm/s` → 30 and `0.5 in/s` → 762 are right.
- **What shows on screen:**
  - `aria-invalid="false"`, and no alert or message;
  - the reading beside the label says "0 mm/s" (or "0 in/s");
  - the box shows the committed value after blur.
  - These are visible results, not warnings (METHOD §3).

**Repro, Node** (`mms2.mjs` → `mms2.out.txt`, main's `dimension-entry.ts` plus `SpeedInput`'s parse and commit arithmetic). Each of these is stored as 1 mm/min:

- `60/2 mm/s` (meant 1800, 1800×);
- `100-20 mm/s` (−1100, clamped to 1);
- `3/4 in/s`;
- `1/2 in/sec`.

`(1/2) mm/s` and `1 1/2 in/s` are rejected, so writing the expression more carefully gives an error rather than a fix.

**Twin.** The length fields evaluate the same shape as a whole:

- `1/2 in` → 12.7 mm;
- `50+50 mm` → 100;
- `100-20 mm` → 80.

So the feed box's `PER_SECOND` rewrite (`src/ui/layers/dimension-entry.ts:6,19`) breaks the box's own expression grammar. Anchor: Twin (length entry vs. feed entry), plus the U8-P3-4 contract to accept mm/s.

**Output** (`emit-f.mjs` → `emit-f.out.txt`):

- The stored 1 mm/min is emitted as `F1`. On the first-burn lesson's 90 mm circle that is 283 min lit, against 9.4 min at the meant 30 mm/min.
- No slow-speed check exists in the Speed field or Job Review (grep of `src/ui/layers`, `src/ui/laser/job-review`, `src/core/preflight*`).

**Severity.** Speed sets depth, and a 30–1800× slower lit cut is a burn-through and fire risk. METHOD §3 has no reach clause, and a refuter may lower a P1 only on a clear warning. There is none: only the visible "1" and "0 mm/s". So P1. The coordinator should re-verify it (METHOD §5) and may re-ID it as X5-P1-1.

#### X5-P3-5 — CONFIRMED, P3

The sentence is false for any straight-edged cut, but it does not steer the operator into harm.

**Measurement** (`drain.mjs` → `drain.out.txt`):

- **Method:** main's import, compile and GRBL emit. At every possible pull point it counts 15 planner blocks plus KerfDesk's 120-byte RX budget (`streamer.ts:24-29`), at constant feed with no acceleration, so the times are lower bounds.
- **Lit time the controller still holds:**

| Job | Lit time still held |
|---|---|
| 100 mm square, 5 mm/s | 80 s (the whole job) |
| Same, 3 passes | median 180 s, max 240 s |
| 300×200 outline, 3 mm/s | 333 s |
| 50×20 tag, 10 mm/s | 14 s |
| 100 mm square, 20 mm/s | 20 s |
| 80 mm circle, 5 mm/s | ~12 s |
| 30 mm circle, 10 mm/s | ~3.6 s |

- **Pattern:** "A few seconds" holds only for finely segmented curves. Straight edges put whole sides in the buffer.

**Why it stays P3:**

- The same card says the laser or spindle may still be on, and to use the E-stop or the power switch if the machine does not stop. A reader who waits "a few seconds" is told the right action next.
- The burn follows the job's own path, so the physical output is not wrong.
- The card does not suggest leaving the machine.

Network links (FluidNC, or grblHAL with deeper buffers) would hold more; not measured.

#### X5-P3-6 — CONFIRMED, P3

- READ, two places:
  - `src/ui/commands/search-entries.ts:171-185` builds the label from `tutorial.title`, with `tutorial.pro` unused;
  - `CommandSearchDialog.tsx:174-181` renders label, family and detail only.
- The Pro lessons' titles and summaries carry no Pro words: `production-generator-tutorials.ts:4-9` ("Generate a finger-jointed box") and `studio-tutorials.ts:4-8`.
- Not rendered in a browser.

### Challenges to "Verified clean"

- **"mm/s → F ×60":** holds for single values on both display units: `0.5 in/s` → 762; `5 mm/s` in inch display → 300; F equals the stored speed (`emit-f.out.txt`). It fails for expressions; see X5-P3-4, now P1.
- **"The Pause text is true on every driver that shows it":** holds.
  - GRBL's text was the only one #1609 changed (`d1609.diff` touches `job-control-copy.ts` at the GRBL constant only).
  - Marlin's stream-side beam-off text is backed by its tests on this tree: 4 files, 28 tests passed (`vt-marlin-pause.txt`). Those are `laser-stream-pause-beam`, `laser-stream-pause-beam-start`, `marlin/stream-pause-beam` and `marlin/stream-pause-beam-index`.
  - The only false Pause wording found is the door sentence in X5-P2-1.
- **"The origin offer names the corner that lands at the head":** holds for all five origins (`emit-f.out.txt`).
  - `anchorPointForOrigin(front-left)` picks (minX, minY) on front-left and center, (maxX, minY) on front-right, (minX, maxY) on rear-left and (maxX, maxY) on rear-right.
  - back-right is the mirror each time.
- **First-burn lesson:** its control names hold. One caveat, not raised:
  - "Put the job where the coaster is" assumes the Placement anchor is still front-left (the default, `src/core/job/job-origin.ts:76-79`).
  - If the user changed it earlier, the lesson does not say so, though the origin offer prompt names the actual anchor and the Frame step shows it.
- **"Door route while streaming: Pause, Resume, job completes":** holds, and holds even if the lid stays open (W1).
- **"Canvas 'Paused, laser off' for Door":** `runStateLabel` gives that label for every Door, including a lid hold the app never asked for and cannot resume from the bar (the X5-P2-1 state). The words "paused, laser off" are still physically true. Not raised.

### New findings

None. One candidate was dropped: an unrounded `0.03937…` in the inch Speed box after a clamped entry. It came from the test's mocked `commit` not updating the store; the real store re-renders `toDisplay(1)`.

### Not verified

- **Firmware sources:** grblHAL's and FluidNC's behaviour when the door closes in the tail, and GRBL's 15-block planner as a primary source. No external fetch was made, by rule; the simulator constant is `src/__fixtures__/controllers/grbl-sim-planner.ts:37`.
- **Remote:** that the phone UI offers Pause on a `done` stream (READ of the server route only).
- **Recovery card:** `CheckpointResumeBanner` rendering after the tail Abort (the capsule and restart line were reproduced; the banner was READ).
- **Real drain times:** the drain figures ignore acceleration and were not timed on hardware.
- **Browser:** the Ctrl+K rows (X5-P3-6) were not rendered in a browser.
- **Open PRs:** the files of open PRs #1623 and #1626 were not checked against `dimension-entry.ts` (no `gh` call).
- **Hardware:** none.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x5r\`.

| File | What it does |
|---|---|
| `mut\` | Copy of `j17-main` (`7c3c00971`). Its `node_modules` junction was removed after the runs. |
| `mut\src\ui\laser\zz-x5r-refute.simulator.test.tsx` | X5-P2-1: Console `~`, a 120 s wait, store Pause/Resume, Abort and recovery capsule, door near the end left open, a square all "tail". X5-P3-1: ALARM:1 → Reset → Unlock. X5-P3-4: the real `SpeedInput`. |
| `refute.jsonl` | Output of the test file. |
| `vt-refute.txt`, `vt-refute-abort.txt`, `vt-refute-square.txt` | Vitest runs: 9, 1 and 1 tests passed. |
| `vt-marlin-pause.txt` | Main's Marlin pause beam-off tests: 4 files, 28 tests passed. |
| `mms2.mjs` → `mms2.out.txt` | X5-P3-4: entry, commit and length twin. |
| `emit-f.mjs` → `emit-f.out.txt` | X5-P3-4: F word and lit time. Origin-offer anchors for all origins. |
| `drain.mjs` → `drain.out.txt` | X5-P2-1 reach and X5-P3-5: what GRBL still holds, per job. |
| `register.mjs`, `ts-resolve.mjs` | Node TS loader (from W4). |

Refuter counts: raised 7, refuted 0, P1 1, P2 1, P3 5, known 3
