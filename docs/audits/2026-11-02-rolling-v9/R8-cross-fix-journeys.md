# Rolling audit v9 — R8 Cross-fix journeys

- **When:** 2026-11-02, midday +0800   **Tree:** origin/main @ `54e0e19b8` (repros in the scratchpad `j7-main` copy of that SHA).
  - Main moved to `78babc811` during the audit (#1530, #1533, #1535). None of them touches a file cited below (`git diff --name-only 54e0e19b8 origin/main`). Each citation was re-read on `78babc811`, so line numbers hold there. R3-P1-1 and R3-P1-2 are being addressed by #1533; this report does not re-test them.
  - Older code: `git archive 33bc394c6 src public` (1.0.28, schema 19, emitter v40). Main is schema 20, emitter v41. The test loader served that export's source files in place of main's, so projects were saved by the real 1.0.28 code.
- **Scope:** seven journeys through the real store, real commands and real compile, ending in a simulated controller where a job runs. Includes #1478 (L10 + L11), #1528 and #1529 (L10). #1530 merged after this tree and only changes the phone pairing scanner, so it was not run.
- **Lenses run:** L10 (#1478, #1528, #1529), L11 (J3 and the #1478 output changes), L9 (Frame return, remote against desktop text edit, Save against Start compile), L4 (Undo across routes, stale phone revision, Abort at a tool change, end-of-job Pause).
  - Not run: L5, L2 beyond one firmware source check. No hardware was operated.
- **Refuter:** fresh context, judged on origin/main `ffd24869c`. No cited file differs from `54e0e19b8` (see Refuter method).
- **Counts:** 7 raised → 0 refuted → P1 1 / P2 3 / P3 3 (+ 4 KNOWN re-observed). All 7 CONFIRMED, no severity changed. 11 candidates dropped by the auditor and 5 sub-claims dropped by the refuter are listed under Refuted.

## Headline

**The fixes hold together on the journeys a user walks.** A traced, filled, captioned sign rotated and resized as a group burned what it showed. Pause and Resume changed nothing on the wire, and Undo returned byte-identical G-code. A project saved by the real 1.0.28 and edited in every object burned byte-identically after each revert and after each save and reopen. The A1 Pro's Start From burned exactly the tail of its 45° hatch. Undo across phone and desktop returned every state.

Four things go wrong where features meet:

- **R8-P1-1.** The Frame's return move reads the last status report's own `WCO:`. Within about a second of Set origin here, that report can predate the `G92`. In the simulator the head then returns to machine **X200 Y160 instead of X100 Y80**, with the beam off, and Frame ends with "did not return to the planned Frame work position". Nothing warned before the move.
- **R8-P2-1.** A 1.0.28 CNC job holding a bowtie pocket at User Origin moves **80 mm and 40 mm** on main (a collinear drill contour: 70 and 50 mm), with no notice. The new place is the right one. It is #1478's intended fix, and R7-P2-1's rule applies.
- **R8-P2-2.** #1528's warning does not retire as ADR-684 says. **A Frame returns to the same point, so the warning is still up after the very motion that ran the tail.** A jog away and back brings it back too.
- **R8-P2-3.** #1529: a recipe picked before the first preview says "Auto tones apply once the preview has read the photo". They never apply, and the sentence disappears.

## Matrix

| # | Journey | Steps run | Result | Where it first went wrong |
|---|---|---|---|---|
| 1 | Image sign, GRBL Dynamic | Photo + real Line Art trace of a logo with `deleteSourceAfterTrace`, separate hole object on the same Fill, framed Relief caption, group, rotate 30°, scale 1.25, real Frame, real Job Review gate, Start, Pause, Resume, finish, Undo resize, recompile | **Clean.** Wire program equals compile bar the two `G4 P0.01` fences; burn extent, length and dose equal; 0 Fill segments inside the hole; Job Review size 68.8 × 107.1 mm equals the burn; Undo byte-identical, scene JSON identical, one step | Nowhere |
| 2 | Batch name tags, Marlin worker | Framed `{{csv:name}}`, rounded rect with 2 placed tabs, 2 × 2 jig, Production run of 4, Save, reopen, rows 1, 3, 4, row 3 on the USB worker with a 1.6 s stall, plain and with Abort | **Clean except KNOWN.** All four copies burn, tabs in each at the same place; missing-glyph row warned at open and in advisories; manifest survives reopen; Save and Start compile identical; worker never stopped lit in the plain stall (0 ms), all 292 lines in order | KNOWN R4-P2-3 (toast repeats per copy) |
| 3 | Old project on main | Saved by real `33bc394c6`: Relief frame, Roboto frame, rounded rect + 2 tabs, Fill plate + hole object, constrained sketch + tab, two images (Blue Noise negative with tones and sharpen; Grayscale). Opened, each object edited and reverted, saved, reopened, compiled | **Clean.** Main equals 1.0.28 at first compile, 11,135-line file; every revert equals the first compile; every save and reopen equals its pre-save compile | KNOWN R3-P1-1 (sketch tab fraction kept, observed; reverted here) |
| 4 | Falcon A1 Pro | Published banner and full `$$`, Home (host commands only, see Not verified), jog, Set origin, Frame, Start Fill at 45°, Abort, Unlock, recovery capsule, Start From a mid-hatch line; second case near the far corner | **First Frame wrong within about 1 s of Set origin (R8-P1-1).** With a wait: Start From tail equals the original tail on all 164 burns; near the corner Job Review names `X out of bed: 359.536` | R8-P1-1 |
| 5 | CNC part | Panel part from the generator, 4 seeded tabs, canvas scale 1.5, Outside profile + pocket with a second bit, setup package, run, M0 tool change, Continue blocked until Zero Z, Continue, Abort. Bowtie, routes and camera below | **Part clean; #1478 older jobs move (R8-P2-1).** Package bytes equal the program; Abort at the tool change and in the second bit both end `cancelled`, spindle 0, reset on the wire. Routes: order only. Camera: repo suites pass | R8-P2-1 |
| 6 | Remote phone edit | Remote `update_text` on a frame (Relief and Roboto), `place_on_board` fit, second `update_text` on the scaled frame, desktop edit, stale phone revision, Undo desktop, phone, desktop, phone, Redo all, Save, reopen | **Clean.** Remote paths equal the desktop builder's; stale revision refused; each Undo returns the earlier G-code; depth back to start; Redo and reopen equal the last compile | Nowhere |
| 7a | #1528 | A1 Pro sim: mid-job Pause and Resume quiet; end-of-job Pause, Resume with Idle warns; Frame, jog away, jog back, Reset | **False "still held" after motion (R8-P2-2).** Quiet on normal Resume; Reset enabled once settled; Reset retires it | R8-P2-2 |
| 7b | #1529 | All six recipes through the shipping compiler; preview against compiled marks at 5, 40, 100 % power, 45° scan, turned, Grayscale, Negative, cross-hatch, 2 passes; real dialog with a late preview; 1.0.28 image compile | **Dose as stated; preview tracks the marks; old images unchanged.** Recipe before preview loses Auto tones (R8-P2-3) | R8-P2-3 |

## Findings

### R8-P1-1 — The Frame's return move uses the WCO in a status report older than Set origin, so the head goes to the wrong machine position

- **Where:**
  - `src/ui/state/canvas-motion-plan.ts:364`: `const wcoRaw = report.wco ?? machine.wcoCache ?? null;`
  - `src/ui/laser/frame-dispatch-support.ts:112` (`currentWorkXy` → `reportedWorkPositionMm`), `src/ui/laser/frame-trace-flow.ts:164` (`returnToWorkPosition`).
  - `src/ui/state/laser-origin-actions.ts:322`: Set origin asks for a fresh report only when `wcoCache === null`. `transientXyOriginPatch` (`:336`) writes the new offset into `wcoCache` and leaves `statusReport` as it was.
- **Anchor:** Twin: `src/ui/job-placement.ts:351-376` (`currentWorkPosition`) prefers the known cached WCO and the same frame's MPos − WPos, and its comment names this very case ("a just-applied G92/G10 can leave the cache a report behind"). `reportedWorkPositionMm`'s comment assumes the report's WCO is the fresh one, which holds until an origin write. Contract: WORKFLOW's Frame returns the head to where it started.
- **Scenario:** Head at machine (100, 80), last status report carries `WCO:0,0,0`. Set origin here sends `G54 G92 X0 Y0`; `wcoCache` becomes (100, 80), but `statusReport.wco` stays (0, 0, 0) until the next poll (idle cadence about 1 s). Frame starts inside that window. `currentWorkXy` computes work = (100, 80) − (0, 0) = (100, 80). The trace runs correctly, then the return is sent in the new work frame.
- **Evidence: REPRO** (`zz-r8-frameret.test.ts`; `createGrblSimulator`, real `setOriginHere`, real `runFrameNow`, real worker-side compile):
  ```
  before a1pro 600  wco {100,80,0}  report {m:{100,80,0}, wco:{0,0,0}}  sim {100,80,0}
  frame  a1pro 600  false "The machine did not return to the planned Frame work position..."
                    mposAfter {200,160,0}  last ["G1 X0.000 Y0.000 F10000 S0","M5\nG21 G90\nG1 X100.000 Y80.000 F10000 S0","G4 P0.01"]
  frame  a1pro 1200 true  mposAfter {100,80,0}
  frame  grbl  600  false mposAfter {200,160,0}  last ["$J=G90 G21 X0.000 Y0.000 F6000","$J=G90 G21 X100.000 Y80.000 F6000","G4 P0.01"]
  frame  grbl  1200 true  mposAfter {100,80,0}
  ```
  Delays of 1, 100 and 600 ms after Set origin all fail, on the A1 Pro's `G1` and stock GRBL's `$J`; 1,200 ms passes.
- **How often on real firmware.** The simulator prints `WCO:` on every report, which overstates the frequency. **SOURCE:** stock GRBL prints it on 1 report in 10 at idle ([report.c L603-607](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L603-L607), [config.h L288](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L288): `REPORT_WCO_REFRESH_IDLE_COUNT 10`). So it needs the last report before the `G92` to carry the field and Frame to start before the next poll. If that report has no `WCO:`, `report.wco ?? wcoCache` takes the fresh cache and the move is right (READ). The grblHAL cadence is UNVERIFIED. The P1 rule has no reach clause, so rarity does not lower it.
- **Effect.** A machine move differs from what is shown: the return overshoots by the whole offset, beam off, on no route the canvas shows. With soft limits off and the head far from zero it can reach past the travel. With `$20=1` it can raise an alarm. Frame then refuses a Start permit, so nothing burns, and the message describes the symptom after the move. Not found in an earlier report (searched `docs/audits` for `currentWorkXy`, `returnToWorkPosition`, stale WCO with Frame).
- **What would make it false:** an upstream replacement of `statusReport` at the end of the origin transaction, or a fresh status request before `currentWorkXy`. Neither is in the run above. The same selector feeds Run G-code file (`external-run.ts:74,141`) and CNC recovery's initial position; those were READ only. Place Board's corner origin and Restore saved origin write `G92` through the same transaction family and were not run.
- **Refuter: CONFIRMED, P1 kept, and wider than raised.** It would be false if something waited for a post-`G92` report, if real firmware never left a pre-`G92` `WCO:` in the stored report, or if a clear warning came before the move. None of these holds.
  - **Nothing waits on this route.** `waitForOriginWcoFrame` only waits when `wcoCache === null` (`laser-origin-actions.ts:322`). Neither `prepareFrameContext` nor `traceFrameOutline` asks for a fresh report.
  - **A stronger anchor.** Frame's own Set origin offer has this guard, and its comment names this defect: "a status from before Set origin still carries the old work offset" (`frame-blocker-repair.ts:75`, `waitForPostRepairPosition`). A plain click on Frame skips it. Offer route: 12 of 12 correct, across every-report, stock cadence and WPos.
  - **Own repro** (real `setOriginHere`, real `runFrameNow`, repo simulator, fake clock), head at machine (100, 80), Frame 1 ms after Set origin. Every wrong run ended at machine (200, 160):

    | Report model | Wrong return | What Frame said |
    |---|---|---|
    | Simulator as shipped (`WCO:` on every report), GRBL | 19 of 20 poll phases | "did not return" |
    | Same, grblHAL | 8 of 9 phases | "did not return" |
    | Stock GRBL cadence, modelled by a line filter on the simulator's reports (1 in 10 idle, forced after `G92`) | 4 of 48, all with `WCO:` on the last report before `G92` | "did not return" |
    | `$10=0` (`WPos:`, cadence as stock) | 19 of 20, not tied to the `WCO:` cadence | **Nothing: permit issued** |
    | Marlin, Smoothieware | 0 of 20 | |

  - **Real window.** Idle polling is 1 s (`laser-connection-actions.ts:80-81`: 250 ms × 4). Frame takes its return point only after compile, so a poll landing during compile saves it. With compile forced off-thread and delayed: 50 ms 4 of 4 wrong, 300 ms 3 of 4, 700 ms 1 of 4, 1,200 ms 0 of 4. So the operator's gap plus compile time must beat the next poll. Clicking Frame within a second of Set origin on a small job is quick but ordinary. Reach does not lower a P1 in any case.
  - **Firmware, fetched and pinned.** Stock GRBL as the auditor cites, and [`system_flag_wco_change`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L280-L285) zeroes the counter, so the first report after `G92` carries the new offset. grblHAL is the same: `REPORT_WCO_REFRESH_IDLE_COUNT 10` at the A1 Pro's core [`04a5edcf` config.h L209](https://github.com/grblHAL/core/blob/04a5edcf8353f7294167d12d32e4b073d9be9ce4/config.h#L209) and at head [`b5a202ce` report.c L1492-1504](https://github.com/grblHAL/core/blob/b5a202ce42e4dc5ebb40f6eb340c55bb3904d4ad/report.c#L1492-L1504). So about 1 report in 10 opens the window on MPos machines. The A1 Pro's own report stream was not observed.
  - **Why it stays P1.** Item one of §3: "move the machine unexpectedly". The move is beam-off, but it goes up to a whole offset past anything the canvas shows, and nothing warns first. The refusal comes after the move, and on `$10=0` there is no refusal.
  - **New, same root: a wrong burn on `$10=0`.** Current Position, Frame 1 ms after Set origin, then real Start through `startReviewedFrameOnClock`: the Frame traces X100..120 Y80..90, a permit is issued, and Start sends `G0 X100 Y90`, `G1 X120 Y80 S100`. The control run (Frame 1,500 ms after Set origin) sends `G0 X0 Y10`, `G1 X20 Y0 S100`. The burn lands 100 × 80 mm from the head's position with no toast. Job Review was auto-confirmed, so its text was not read. Frame is not a warning (§3). `currentWorkPosition` returns the stale `wPos` directly (`job-placement.ts:358`), so the fix must cover this selector as well as `reportedWorkPositionMm`. With `WCO:` on every report the same job only hits the return fault: it refuses and issues no permit.
  - **Twins.**
    - **Reset origin (repro: wrong on 1 of 2 phases).** `clearedOriginPatch` clears the cache, so a stale `report.wco` becomes the only offset. The head returns to machine (0, 0) instead of (100, 80). On Absolute without homing the trace itself is displaced by the old offset (`X-70 Y270` against `X30 Y350`). "did not return" refuses the permit afterwards. A homed machine waits for a fresh report (`needsAbsoluteFrameOffset`); that case was read, not run.
    - **Restore origin, Set origin at a machine point: refuted.** See Refuted.
    - **Move laser here: not affected (READ).** `headFrameContext` uses `wcoCache`, and `MPos` does not change with `G92`.
    - **Start: not independent (READ).** `transientXyOriginPatch` clears the permit, so Start needs a new Frame. The stale selector only feeds timing and the canvas start there.
    - **Jog: not affected on MPos (READ).** On a `WPos:` report with no `WCO:`, `inferCurrentMachinePosition` adds the new cache to the old `wPos`, which misleads only the hold-to-jog clamp and was not run.
  - **Fix direction, added:** give the plain Frame the offer route's wait (`waitForPostRepairPosition`) after any origin write, for `wPos` as well as `wco`. Clearing `wco` from the stored report alone misses `$10=0`.

### R8-P2-1 — A 1.0.28 CNC job with a bowtie pocket at User Origin moves 80 × 40 mm on main, and nobody is told

- **Where:** `src/core/cnc/cnc-design-bounds.ts:67` (`contributesClosedGeometry`, #1478); no notice in `src/ui/state/project-load-notices.ts` or `docs/releases/desktop-update-notes.json` (0 matches for Job Origin or bowtie).
- **Anchor:** ADR-327 Amd 1 "Implementation correction" (2026-10-27) ("The bounds calculation now resolves that ambiguous case"; says only "No placement policy or Frame/Start gate changes"). L11 of `AREAS.md`: every difference must be intended, named by an ADR, "and either harmless or announced". Twin: R7-P2-1, same class.
- **Scenario:** Save on the real 1.0.28 export, open on main, compile. User Origin jobs anchored on these contours move; Absolute is byte-identical. Current Position was not run; it takes the same anchor by READ.
- **Evidence: REPRO** (`zz-r8-j5-bowtie.test.ts`, 10 scenes × 3 origins):

  | Scene | Origin | Old cut X range | New cut X range | ΔX, ΔY |
  |---|---|---|---|---|
  | Pocket bowtie + square | User, front-left | −76.167..18.413 | 3.833..98.413 | **80, 40** |
  | Same | User, centre | | | 40, 20 |
  | V-carve bowtie + square | User, front-left | −79.987..19.998 | 0.013..99.998 | 80, 40 |
  | Drill bowtie + square | User, front-left | | | 80, 40 |
  | Drill collinear closed contour + square | User, front-left | −40..10 | 30..80 | **70, 50** |
  | Pocket bowtie alone | User, front-left | | | 2.246, 0 |
  | Pocket bowtie + far-left square | User, centre (front-left same) | | | −32.5, −40 |
  | Figure-eight (non-zero signed area), collinear on Pocket, Outside profile, plain square | all | | | 0 (byte-identical) |

  The new position equals the canvas anchor (0..100 × 0..60), and the old one cut left of work zero. So this is the fix working; the harm is only the silent move.
- **Why P2, not P1:** the same reasoning as R7-P2-1, whose ledger line says the moves are intended and the new place is on the canvas anchor. The old output was the wrong one. An operator who shifted stock to suit the old cut would now cut elsewhere, and Frame is not a warning.
- **Also noted:** the ADR text names the bowtie and Drill's collinear rule but not that saved jobs move. An operator's stored setup sheet from before the change no longer matches.
- **What would make it false:** a release note added before the next desktop release (none exists yet; the coordinator can resolve this at release time).
- **Fix direction:** one line in the next release's update notes, plus the R7-P2-1 fix card's open notice, for a CNC job whose design bounds now include a contour the older rule omitted.
- **Refuter: CONFIRMED, P2 kept.** It would be false if the move did not happen on a project really saved by 1.0.28, if an announcement existed, or if the new place were wrong (then P1).
  - **Repro.** Own export of `33bc394c6`; projects saved by its `serializeProject` (schema 19), opened by this tree's `deserializeProject` and compiled on each. Pocket bowtie + square at User front-left: old X −76.167..18.413, Y −38.412..18.413; new X 3.833..98.413, Y 1.588..58.413, so **80, 40**. User centre 40, 20. Drill bowtie 80, 40. Pocket bowtie alone 2.246, 0. Drill collinear + square: 80, 40 on my geometry (the auditor's 70, 50 used other geometry; the size is the distance from the contour to the remaining art). Absolute and a plain square are byte-identical on both trees.
  - **No announcement.** 0 matches for the change in `project-load-notices.ts` or the update notes. ADR-327 Amd 1 names the correction, not that saved jobs move.
  - **Correct against what?** The canvas anchor, which the design sits on (0..100 × 0..60). Job Review and Frame read the same bounds. 1.0.28 cut up to 76 mm left of work zero on a job whose anchor says it starts at zero, so the old burn was the wrong one.
  - **Why not P1.** §3's route to lowering is that the output is not wrong, and here it is not: main cuts what the canvas shows. The cost is real on a re-run: a part clamped to suit the old cut gets the bit 80 × 40 mm away, possibly into a clamp, and Frame is not a warning. That is the harm L11 calls unannounced, so it stays open, at the same rung as R7-P2-1. An operator who accepted a cut left of work zero and placed stock to match is the only one hurt.

### R8-P2-2 — #1528's warning returns once the head is back at the point where Resume confirmed, so it is still up after the Frame that ran the tail

- **Where:** `src/ui/state/held-resume-tail.ts:84`: `return now === null || samePoint(now, tail.machinePosition) ? tail : null;`. `heldResumeTail` is only ever set, never cleared on motion; retirement is recomputed from the current position on every read.
- **Anchor:** ADR-684 Decision 3 ("The warning retires itself … when the machine position moves more than 0.001 mm from where Resume confirmed. In both cases the tail is gone"). Twin: none; the session-epoch half of the same rule holds.
- **Scenario:** End-of-job Pause, Resume confirmed by Idle, warning shows. The operator clicks Frame. Frame traces and returns to the same machine point, as every clean Frame must (R8-P1-1's check enforces it). Now the warning and Job Review's "may hold a paused move, reset first" are up again, telling them to Reset "before the next Frame, jog or job". Following it drops the Frame's permit (`FRAME_START_SESSION_CHANGED_MESSAGE`; READ), and they Frame again.
- **Evidence: REPRO** (`zz-r8-j7a.test.ts`, A1 Pro banner and `$$`, `firmware: 'grblhal'`, real Pause, Resume, `runFrameNow`, `jog`, `wakeController`):
  ```
  resumed     {status:"done", sim:"Idle", field:{sessionEpoch:2, machinePosition:{100,80,0}}, held:true}
  settled     {streamer:null, op:null, held:true, buttonBusy:false}
  after Frame {held:true, mpos:{100,80,0}, before:{100,80,0}, sameAsBefore:true}
  jogged away {held:false, mpos:{110,80,0}}
  jogged back {held:true,  mpos:{100,80,0}, message:"warning shows again"}
  after Reset {held:false, epoch 2 -> 4}
  ```
- **What holds:** normal mid-job Pause and Resume stays quiet (`field: null`); Resume confirmed by Run stays quiet (repo test); Reset enabled once settled; a Reset retires it; Start, Frame and jog are never gated, as ADR-684 says.
- **Why P2:** a misleading notice with a real cost (a Reset and a re-Frame, and a Home if the controller asks), never a wrong burn. A warning a Frame cannot clear also teaches an operator to ignore the real one.
- **What would make it false:** a poll landing outside the point during the Frame does not help, because nothing latches it. Only a store write that clears the field would, and `grep heldResumeTail` shows none outside the patch.
- **Fix direction:** in the status patch, when the position differs by more than 0.001 mm, write `heldResumeTail: null`. A short Frame between two polls can still be missed, so also clear it when any motion owner (Frame, jog, job) starts.
- **Refuter: CONFIRMED, P2 kept, with one scope note.** It would be false if a motion latched the warning off, or if the permit survived a Reset.
  - **Repro** (grblHAL simulator, real `runFrameNow` and `wakeController`; `heldResumeTail` set in the store rather than through Pause, because retirement reads only the field and the position). After Frame: `true` from `runFrameNow`, permit present, warning still up. `framedRunStartHandoffIssue` returned null before the Reset. After Reset: warning gone, epoch 2 → 4, and the same permit now returns **"The controller session changed after Frame. Frame the exact job again before starting."** So the Frame permit claim, read-only in the report, is true.
  - **No latch.** The only writer on main is `heldResumeTailPatch` (`grep heldResumeTail`). The rail notice and Job Review both read `currentHeldResumeTail`. Jog away and back follows from `:84`; not re-run.
  - **Contract.** ADR-684 Decision 3 says the warning retires on motion and "a motion has already run it". Its Consequences say a false positive "retires at the next motion". A Frame is a motion and does not retire it.
  - **Scope note.** The simulator models no tail. If a real tail runs, its steps may leave MPos off the planned point (the firmware fix is titled "potential loss of position"), and then the warning would retire. UNVERIFIED: no grblHAL build was run. The finding holds regardless for the case ADR-684 itself names, a Pause after motion finished, and for fixed firmware whose build is unknown, which counts as affected.
  - **Why P2.** The notice is misleading and a Reset plus re-Frame is a real cost. Output is unchanged and the beam is not involved.

### R8-P2-3 — A recipe picked before the first preview promises Auto tones that never apply, and the promise then disappears

- **Where:** `src/ui/raster/PhotoEngravingDialog.tsx:145`: `update(photoRecipePatch(chosen, histogram));` runs once with the histogram of that moment; `src/ui/raster/photo-recipes.ts` (`photoRecipePatch`: "tones only when the histogram is known"); `src/ui/raster/PhotoEngravingFields.tsx:117`: the sentence ` Auto tones apply once the preview has read the photo.`
- **Anchor:** ADR-685 Decision 2 ("A recipe sets the marking … Blue Noise (finding 1), Auto tones"); the window's own sentence. Its test `PhotoEngravingDialog.recipes.test.tsx` covers waiting on the separate Auto tones button only.
- **Scenario:** Open Photo engraving on a large photo, pick Wood before the worker answers.
- **Evidence: REPRO** (`zz-r8-j7b.test.tsx`, real dialog with the preview hook mocked, as the repo's own test does):
  ```
  before preview {hint:"... Auto tones apply once the preview has read the photo.", brightness 0, contrast 0, gamma 1}
  after preview  {hint:"... (sentence gone)",                                       brightness 0, contrast 0, gamma 1,
                  expected {brightness:-14.5, contrast:100, gamma:1.28}}
  ```
  The operator reads that the tones will apply, and the sentence goes when the preview arrives, which reads as done. ADR-685 measures highlight speckle at 12.5 % without Auto tones and 3.6 % with, so the recipe's main benefit is silently absent.
- **Why P2:** a misleading notice. The On material preview shows the true result and the burn matches it, so output is not wrong against what is shown.
- **What would make it false:** an effect that re-applies the recipe when the histogram arrives. `useSourceHistogram` only stores it.
- **Fix direction:** keep a "tones pending" flag from `chooseRecipe` and apply `autoTonesPatch` when the histogram lands, unless the operator has since edited a tone. Or disable the picker until the preview answers.
- **Refuter: CONFIRMED, P2 kept.** It would be false if the real hook re-applied the recipe, or if the dialog prevented an early pick. Neither does.
  - **Repro with the real hook.** Real dialog and real `usePhotoEngravingPreview`; only the worker hop is replaced, by the worker's own `computePhotoEngravingPreview` delayed 400 ms. Wood picked before the preview: the sentence shows. After the preview: sentence gone, Auto tones button enabled, and Apply gives brightness 0, contrast 0, gamma 1, with Blue Noise applied. Control (same image, picked after the preview): brightness 1.1, contrast 63.5, gamma 0.97.
  - **Reachable.** The hook debounces 150 ms before asking the worker, so the gap exists on every open and lasts longer on a large photo.
  - **Why P2.** The tones are not power, position, depth or scale, and the preview and burn agree, so §3's wrong-output test is not met. ADR-685 Decision 2 ("A recipe sets the marking … Auto tones") and the window's own sentence are both broken.

### R8-P3-1 — Light-mark recipes burn a removed white background solid

- **Where:** `src/ui/raster/photo-recipes.ts` (slate, anodized, clear-back: `lightMarks: true`), `src/core/raster/image-processing.ts:25` (`maybeInvertLuma` after the tones).
- **Anchor:** ADR-685 Decision 1 names this background ("a removed or transparent background imports as white") and keeps it out of the histogram. The inversion then turns it into the darkest burn.
- **Evidence: REPRO:** slate recipe on a portrait with a pure white background: **74.3 %** of all cells burn, against 68.2 % for the same recipe with a light grey background and 28.6 % for no recipe. Compiled dose rises 2.38× (slate, against no recipe) from the same power; the recipes do keep power and speed, as stated (max S 400 on every recipe).
- **Why P3:** the On material preview shows the burned background, so the operator can see it. The hint could say so.
- **Fix direction:** one sentence in the three light-mark hints: remove the background with a mask, not with white.
- **Refuter: CONFIRMED, P3 kept.** `prepareImageLuma` with Negative on, run directly: luma 255, 200, 40 becomes 0, 55, 215, so a white background becomes the darkest burn. The percentages were not re-measured. The preview builds from the compiled raster (READ), so the operator can see it.

### R8-P3-2 — Auto tones counts pixels a mask or clip keeps from burning

- **Where:** `src/ui/raster/photo-engraving-preview.ts:64` (`sourceHistogram: lumaHistogram(decodeRasterLuma(input.image))`), ignoring `imageMaskId` and `imageClip`, which compile honours at `core/job/compile-job-raster.ts:319`.
- **Evidence:** READ for the mask route; REPRO for the size of the effect: a portrait with dark pixels outside the subject gets contrast 19.2, gamma 0.8; the subject's pixels alone give contrast 100, gamma 1.81.
- **Why P3:** tones only, visible in the preview, and the operator can edit them.
- **Fix direction:** build the histogram from the masked luma when the image has a clip or mask.
- **Refuter: CONFIRMED, P3 kept.** `photo-engraving-preview.ts:64` decodes the image alone; the compile applies the mask at `compile-job-raster.ts:319`. Own histograms through `portraitAutoTones`: subject only (levels 100..160) gives brightness −14.1, contrast 100, gamma 2.15; with a dark surround the mask would remove, 18.7, 59.4, 0.81. The size depends on the photo, as the auditor's own numbers do.

### R8-P3-3 — Test gaps behind this report

- Frame immediately after an origin write, with a pre-write report carrying `WCO:` (R8-P1-1). `frame-artwork-centre-led.test-support.ts` waits 2 s after `setOriginHere`, so the repo's Frame tests never enter the window.
- #1528: `laser-held-resume-tail.test.ts` retires the warning by moving away and stops; nothing moves back, and no test runs a Frame after the warning.
- #1529: nothing picks a recipe before the histogram and then delivers one.
- #1478: `prepare-output-cnc-design-anchor.test.ts` pins the new anchor but nothing pins a saved older job (L11), and V-carve's bowtie is untested (this report ran it: cuts stay on the new anchor).
- The repo's worker mock returns `response.result` unhydrated (`frame-artwork-centre-led.simulator.test.ts`). A job that reaches `buildJobReviewModel` through it fails in `packedMotionManifestBytes` (`manifest.blocks is not iterable`). A journey harness has to call `hydrateTransferredStartPreparation`, as production does.
- **Refuter: CONFIRMED, P3 kept (READ).** The Frame tests that set an origin wait first (`frame-artwork-centre-led.test-support.ts`, `frame-after-completed-coordinate.audit.test.ts`: 2,000 ms; `g92-only-origin-frame.test.ts`: `pump`). `frame-blocker-repair.simulator.test.ts` covers the offer route, which is guarded. Add `$10=0` and Reset origin to the Frame gap. The unhydrated mock is as described; the crash itself was not re-run.

## KNOWN re-observed

- **R3-P1-1** (being addressed by #1533): the sketch's tab keeps its fraction through a width edit (`pathT 0.0555…` before and after) in J3. Reverting restores byte-identical output.
- **R4-P2-3:** a production row repeats its missing-glyph sentence per jig copy: four identical sentences in one toast and four identical advisories on row 3.
- **R1 table / ADR-395:** Marlin inline after Abort stays lit about 212–228 ms at S77 on the USB worker in 2 of 3 runs of production row 3 (0 in the third; R1 measured up to about 1 s). Accepted residue.
- **R6-P2-3 family:** a Frame near the corner of the preset bed traces to machine X359.536 before Job Review names `X out of bed` ($20=0 on the published dump; within the 363 mm travel). Not raised: the art's runway is what reaches there and the Review warns before Start.

## Refuted

Candidates dropped by the auditor, so later audits need not raise them:

- **Marlin row 3 stream stops two lines short (`completed 504/506`).** The harness allows 15 s and real motion was still running. A shorter program finishes with every line in order. Not a hang.
- **Job Review crash `manifest.blocks is not iterable`.** Harness: the worker mock skipped hydration (R8-P3-3). Production hydrates.
- **Inside-first broken in 60 of 240 Nearest routes.** My check counted overlapping random rectangles, and old and new agreed. With non-overlapping parts: 0 of 240 on both trees.
- **Nearest point travels further than Drawn** in 22–36 of 240 scenes. Identical on 1.0.28 and main. ADR-669 promises no longer than the base under the same start policy, not than Drawn.
- **`startAddressCamera` takes no `current()`.** No `await` lies between the guard and `startRtspSource` or `startSnapshotSource`, so there is no window to cancel.
- **Half the rectangle missing in jig copies.** Harness: `perCell` measured against copy IDs, not boxes. The G-code has all four rectangles at the right places with tabs at 106.5–108.5 and on the right edge in each.
- **Relief text not single-line, `update_text` refused.** Harness: `ems-relief` is not a font key. `relief-single-line` works.
- **No missing-glyph warning on row 3.** Harness: the bare `renderVariableText` has no `missingCharacters`. `outputTextRenderer`, as the button uses, warns.
- **A1 Pro Home `error:3`.** The repo's simulator refuses the vendor's `$HX`; the repo's own test acknowledges by hand.
- **Position withheld after Unlock.** By design (`positionEvidenceSuppressed`); recovery offers Home.
- **`jobPlacement` absolute turning user-origin after reopen.** Harness: `prepareProjectForPersistence` was given `project` without `projectWithCurrentJobSetup`. Same on both trees.

Sub-claims dropped by the refuter. No finding was refuted whole:

- **R8-P1-1: Restore saved origin and Set origin at a machine point "take the same field".** They do read it, but they wait: 4 reports land during the origin action, the stored report already holds the new offset, and the return is correct (`X50 Y50` at WCO 50, 30, machine 100, 80) on 4 of 4 runs.
- **R8-P1-1: Frame's own Set origin offer.** Guarded by `waitForPostRepairPosition`. 12 of 12 correct.
- **R8-P1-1: Marlin and Smoothieware.** 0 of 20 wrong on the repo's simulators.
- **R8-P1-1: "Delays of 1, 100 and 600 ms all fail".** True for the auditor's phase, not in general. The result depends on where the poll falls: at one of 20 phases a report arrived before Frame read it, and the return was right. A compile long enough to span a poll also saves it.
- **J3 against R7, "byte-identical" against "records move".** No contradiction; see Refuter method.

## Verified clean

- **J1:** wire equals compile; separate hole object not burned after group turn and scale; total dose ratio 1.55 for scale 1.25 (expected about 1.56 for filled area); Job Review size equals the burn; `G4` fences the only extra lines; held-tail quiet on stock GRBL; Undo one step, scene identical.
- **J2:** rows allocate 0..3; reopen keeps the manifest with no active row; row text fixed in all four copies; Save and Start twins identical; worker `armAcks: ["marlin"]`, 0 ms lit in the plain stall, Abort has no job line after the stop.
- **J3:** every edit-and-revert byte-identical; tab fractions return to within 1e-15 after a Shape Properties round trip; images byte-identical across #1529.
- **J4:** detected `grblhal`, bed 358 × 268, settings verified; Start From burns equal the original tail (164 of 164); mid-job Pause and Resume clean; recovery names a missing origin instead of moving.
- **J5:** package SHA covers the same bytes as the run; M0 reached with spindle off; Continue refused without Zero Z, allowed after; Abort clean at both points; pockets before profile; tool plan 6 mm then 3.175 mm.
- **#1478 routes:** two sweeps of 240 routes on each tree. The 240 overlap-free routes are byte-identical old to new; of the 240 with overlaps, 14 change order. Travel never worse than 1.0.28, coverage never differs from Drawn or from 1.0.28, tabs stay where placed under Nearest point and Nearest corner.
- **#1478 camera:** `camera-helper-cancellation.test.ts` 21/21 and `bed-picture-frame.test.tsx` 17/17 pass on this tree; the code read found no gap in the source-epoch and document guards.
- **#1478 bounds:** collinear and retraced Pocket contours stay out; figure-eight unchanged; Outside profile unchanged; Absolute byte-identical in every scene.
- **#1528:** build-date gate and evidence route (repo tests 3/3 and own run); a Reset retires it; Reset button enabled after settle.
- **#1529:** every recipe keeps max S; speed and DPI untouched; Dots view equals the compiled mark share (0.286 / 0.286; 0.714 / 0.714 Negative) at 5, 40, 100 % power, 45° scan; tone order brightness, contrast, gamma, then Negative, as `portraitAutoTones` assumes; cross-hatch shows "first scan" and says so (`PhotoEngravingPreview.tsx:60`).
- **J6:** remote and desktop render equal paths; `stale_revision` refused with the text untouched; Undo by phone and desktop interleave correctly; Redo; reopen.

## Not verified

- **Real firmware for R8-P1-1:** source reading only. The refuter read stock GRBL's and grblHAL's WCO cadence; the A1 Pro's real reports were not observed, and the stock and `$10=0` report streams were modelled by filtering the simulator's lines. The Place Board corner route itself was not driven; `setOriginAtMachinePoint`, which the refuter ran, waits for its report.
- **A1 Pro Home:** `$HX` and `$HY` were not run in this journey, because the simulator refuses them. `homingState` was set by hand and the post-Unlock evidence cleared by hand. `falcon-a1-pro-connect-home.simulator.test.ts` covers Home.
- **The app's UI:** toasts, the rail notice and Job Review were read from the store and models, not seen in a window. Only the Photo engraving dialog was rendered, in jsdom, with its preview hook mocked. The canvas was not painted in J1, J2 or J6.
- **Workers:** jsdom has no Worker. Output preparation ran in process through the repo's fixture; the text worker fell back in process. J2's Marlin stall used real `worker_threads` on a real clock, with a shortened row 3 (first 300 lines at F9000) to fit the harness's 15 s budget.
- **Trace:** real Line Art on a synthetic 200 × 200 ring, not a photographed logo. The photo was a synthetic luma raster, committed with `traceExistingImage` rather than through the dialog.
- **Production Save and export path, tiled, rotary, two-sided CNC, CNC park with a Z top, relief.** Not run.
- **Camera (#1478) end to end:** no camera or helper was started; repo suites and reading only.
- **On material against a real burn:** the model was compared with compiled marks only. Nothing was burned.
- **#1530, #1533, #1535:** not run. They merged after this tree.
- **Hardware:** none, by instruction. Low memory (about 1 GB free) made module loading slow, and the one-off 47 ms Abort reading on a thread test is treated as timing jitter.

## Repro files

All deleted individually at the end. Nothing under the `node_modules` junction was touched, and no `zz-r6*` file was touched. No repo file other than this report changed.

| File | What it did |
|---|---|
| `j7-main\zz-r8-vitest.config.ts`, `zz-r8-fflate-stub.ts` | Repo config, `fflate` stub, one worker, `R8_TREE` serves an export's source files |
| `j7-main\src\ui\laser\zz-r8-common.ts` | Burn parser, wire filter, sim connect, real Frame and Start flow helpers |
| `j7-main\src\ui\laser\zz-r8-j1.test.ts` | Journey 1 |
| `j7-main\src\ui\state\zz-r8-j2.test.ts`, `zz-r8-j2-stall.thread.test.ts` | Journey 2 design to row 3; row 3 on the Marlin worker with a stall |
| `j7-main\src\ui\state\zz-r8-j3.test.ts` | Journey 3, `save` phase on 1.0.28, `open` phase on main |
| `j7-main\src\ui\laser\zz-r8-j4.test.ts`, `zz-r8-j4b.test.ts` | Journey 4; far corner and mid-job Pause |
| `j7-main\src\ui\laser\zz-r8-frameret.test.ts` | R8-P1-1: delay and firmware matrix |
| `j7-main\src\ui\state\zz-r8-j5.test.ts` | Journey 5 part to Abort |
| `j7-main\src\io\gcode\zz-r8-j5-bowtie.test.ts` | R8-P2-1: 10 scenes × 3 origins on both trees |
| `j7-main\src\core\job\zz-r8-route.test.ts` | Nearest routes on both trees |
| `j7-main\src\ui\remote-control\zz-r8-j6.test.ts` | Journey 6 |
| `j7-main\src\ui\laser\zz-r8-j7a.test.ts`, `j7-main\src\ui\raster\zz-r8-j7b.test.tsx` | #1528 retirement; #1529 dose, preview and dialog |
| `scratchpad\zz-r8-run.sh`, `zz-r8-show.mjs` | Runner; list of long burned spans |
| `scratchpad\zz-r8-old\33bc394c6\` | Export of 1.0.28 (no links) |
| `scratchpad\zz-r8-out\` | Saved `.lf2` files and G-code |

To reproduce R8-P1-1: connect a simulator that reports `WCO:` on each status, jog to (100, 80), call `setOriginHere`, and within 1 s call `runFrameNow` on a job at User Origin. Read the last outbound `G1` or `$J` and the simulator's `mpos`.

The refuter's own files, also deleted individually (the export and output folders, outside `j7-main`, as folders): `j7-main\zz-r8r-vitest.config.ts`, `zz-r8r-fflate-stub.ts`, `src\ui\laser\zz-r8r-frameret.test.ts`, `src\ui\raster\zz-r8r-recipe.test.tsx`, `src\io\gcode\zz-r8r-bowtie.test.ts`, `scratchpad\zz-r8r-run.sh`, `scratchpad\zz-r8r-old\`, `scratchpad\zz-r8r-files\`.

## Refuter method

- **Tree.** origin/main `ffd24869c` at the end of the run (#1530, #1533, #1534, #1535, #1536 since `54e0e19b8`). `git diff --stat 54e0e19b8 origin/main` over every cited file, plus `use-frame-action.ts`, `frame-blocker-repair.ts`, `laser-origin-transaction.ts` and `laser-status-position.ts`, is empty, and all cited lines were re-read at that SHA. Repros ran on `j7-main` at `54e0e19b8`; **no file was refreshed.**
- **Not re-tested.** #1536 ("text notices merge") and #1533 merged, so KNOWN R4-P2-3 and R3-P1-1 may have changed. That is outside this refutation.
- **Sources.** Fetched with `gh api`, pinned: gnea/grbl `bfb67f0c`, grblHAL/core `04a5edcf` and `b5a202ce`. ADR text read from `docs/decisions` at main.
- **PRs.** #1478, #1528, #1529 file lists read; ADR-327 Amd 1, ADR-684 and ADR-685 quotes checked against the ADRs and they match.
- **J3 spot-check.** A plain laser project (Line + Fill) saved by the 1.0.28 export compiles raw-byte-identical on this tree at all three origins, so emitter v40 → v41 adds no header difference. R7's moves are in variable records (`render-variable-text.ts`, which differs from 1.0.28) and in files saved by 1.0.27; #1478's move needs a CNC contour the old rule omitted. J3's scene has fixed text and no bowtie and was saved by 1.0.28, so "byte-identical" there and "records move" in R7 are both true. J3's own text frames were not re-run.
- **Limits.** Fake clock and in-process compile, except where off-thread delay is stated. No window was rendered apart from the Photo engraving dialog in jsdom. No hardware was operated.

```json
{
  "area": "R8",
  "id": "cross-fix-journeys",
  "tree": "54e0e19b8",
  "refuter_tree": "ffd24869c",
  "raised": 7,
  "refuted": 0,
  "confirmed": 7,
  "plausible": 0,
  "p1": 1,
  "p2": 3,
  "p3": 3,
  "known": 4,
  "findings": [
    {"id":"R8-P1-1","severity":"P1","area":"cross-fix-journeys","file":"src/ui/state/canvas-motion-plan.ts","line":364,"anchor":"Twin: src/ui/laser/frame-blocker-repair.ts:75 waitForPostRepairPosition guards the offer route and names this defect; src/ui/job-placement.ts:351-376; Contract: Frame returns to its start","evidence":"REPRO + SOURCE (stock GRBL and grblHAL cadence, pinned)","known":false,"summary":"Frame within about 1 s of Set origin here takes its return point from a status report older than the G92: report.wco ?? wcoCache uses the stale WCO. Simulator: head at machine (100,80) returns to (200,160), beam off, Frame then refuses a permit with 'did not return'. A1 Pro G1 and stock GRBL $J both; 1,200 ms passes. Needs the pre-G92 report to carry WCO (1 in 10 idle reports on stock GRBL). Refuter: also $10=0 WPos reports (19 of 20 phases, permit issued with no refusal; Current Position then burns 100 x 80 mm off), and Reset origin. Restore origin, Set origin at a machine point, the offer route, Marlin and Smoothieware are clean.","verdict":"CONFIRMED"},
    {"id":"R8-P2-1","severity":"P2","area":"cross-fix-journeys","file":"src/core/cnc/cnc-design-bounds.ts","line":67,"anchor":"Contract: AREAS L11 'harmless or announced'; ADR-327 Amd 1 implementation correction; Twin: R7-P2-1","evidence":"REPRO","known":false,"summary":"A 1.0.28 CNC job with a bowtie contour at User Origin moves 80 x 40 mm on main (Pocket, V-carve, Drill), a collinear Drill contour 70 x 50 mm. Intended and on the canvas anchor, Absolute unchanged, but no notice and no update note.","verdict":"CONFIRMED"},
    {"id":"R8-P2-2","severity":"P2","area":"cross-fix-journeys","file":"src/ui/state/held-resume-tail.ts","line":84,"anchor":"Contract: ADR-684 Decision 3","evidence":"REPRO","known":false,"summary":"The held-tail warning is derived from the current position and never latched off, so it is up again after a Frame (which returns to the same point) and after a jog away and back, telling the operator to reset a tail that already ran; following it drops the Frame permit.","verdict":"CONFIRMED"},
    {"id":"R8-P2-3","severity":"P2","area":"cross-fix-journeys","file":"src/ui/raster/PhotoEngravingDialog.tsx","line":145,"anchor":"Contract: ADR-685 Decision 2; the window's own sentence at PhotoEngravingFields.tsx:117","evidence":"REPRO","known":false,"summary":"A recipe chosen before the first preview applies no Auto tones and the sentence 'Auto tones apply once the preview has read the photo' then disappears; tones stay 0/0/1 where the histogram gives -14.5/100/1.28.","verdict":"CONFIRMED"},
    {"id":"R8-P3-1","severity":"P3","area":"cross-fix-journeys","file":"src/ui/raster/photo-recipes.ts","line":26,"anchor":"ADR-685 Decision 1","evidence":"REPRO","known":false,"summary":"Light-mark recipes burn a removed white background solid: 74.3 % of cells on slate. The preview shows it; the hint does not say.","verdict":"CONFIRMED"},
    {"id":"R8-P3-2","severity":"P3","area":"cross-fix-journeys","file":"src/ui/raster/photo-engraving-preview.ts","line":64,"anchor":"Twin: compile-job-raster.ts:319 applies the mask","evidence":"READ + REPRO of the effect","known":false,"summary":"Auto tones histogram counts pixels a mask or clip removes: contrast 19.2 against 100 on a synthetic subject.","verdict":"CONFIRMED"},
    {"id":"R8-P3-3","severity":"P3","area":"cross-fix-journeys","file":"src/ui/laser/frame-artwork-centre-led.test-support.ts","line":1,"anchor":"METHOD L7","evidence":"READ","known":false,"summary":"No test for Frame right after an origin write, a held-tail warning after Frame or a return, a recipe before the histogram, or a saved older CNC job through #1478; the repo's worker mock skips hydration.","verdict":"CONFIRMED"}
  ],
  "journeys": {
    "J1": "clean",
    "J2": "clean bar KNOWN",
    "J3": "clean",
    "J4": "R8-P1-1",
    "J5": "R8-P2-1",
    "J6": "clean",
    "J7a": "R8-P2-2",
    "J7b": "R8-P2-3"
  },
  "prs": {
    "#1478": "bounds fix holds; older jobs move silently; routes order-only; camera by repo suites",
    "#1528": "fires and stays quiet correctly; retirement wrong",
    "#1529": "dose and preview hold; recipe timing gap"
  },
  "hardware": "none"
}
```
