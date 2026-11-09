# Rolling audit v12 — X1 Fix verification: job safety

- **When:** 2026-11-09 (UTC 04:40–06:30)   **Tree:** main `29e3406e0` (code identical to `743d37bc4`). Repros ran on the scratchpad export `j13-main` (`743d37bc4`) and on my own export `zz-x1/mut` (`git archive 743d37bc4`, `node_modules` a junction to the main checkout's). `origin/main` has since moved to `7cd9ff49f` (#1626, simulator fixture only); nothing in this report depends on it.
- **Scope:**
  - #1615 (ADR-207 Amd 3): held Enter on Pause/Resume, Frame job, Set origin here (V8-P2-1 raised to P1; V9-P3-1).
  - #1616 (ADR-337 Amd 2): the staged archive is validated once (V1-P1-1).
  - #1620 (ADR-637 Amd 9, ADR-341 Amd 12): Reconnect waits for the job (V3-P2-1); Restore on `$10=0` and Frame's offer of the saved origin (V3-P2-2, re-rated P1 by the V9 refuter).
  - #1628 (ADR-398 Amd 8, ADR-482 Amd 1, ADR-548 Amd 2): main stops a network machine when no window can (W3-P1-1); a laser on at Idle delays session end (W3-P2-1).
  - #1612: Preview shows the worker's progress and offers Leave Preview. Its PR names **S8-P3-3**, not S1-P2-1. S1-P2-1 was fixed by #1548 (2026-11-02/03), outside this window; I checked only that #1612 does not undo it.
- **Lenses run:** L10 (all five steps, per PR), L6 and L4 (crash during Pause, crash during a close, reload during a job, Abort during the restore, held key during Start), L12 (PR and main CI history), and L3 where a twin turned up.
- **Counts:** 3 raised → refuter pending → P1 1 / P2 1 / P3 1 (+ 1 KNOWN re-measured: V1-P3-1).

## Headline

The five PRs fix what they were written to fix, and each regression test fails without its fix:
- A held Enter no longer resumes, re-frames or pauses. The held-Enter e2e passes 3/3 in Chrome.
- Activation runs no long task in Chrome 156: 2.9 ms at 375k lines and 4.4 ms at 841k. The removed pass costs 209–292 ms and 487 ms there.
- Reconnect refuses mid-job. Restore works on `$10=0`.
- Main sends `0x18`, `M5` and `M9` on a crash, the lease and the quit.

Two gaps remain in the new safety paths:
- **X1-P1-1 (proposed P1).** #1620's new Frame offer restores the aborted job's origin in machine coordinates even after the controller has been hard-reset. A power cycle, or the DTR auto-reset of an Arduino- or ESP32-class board on Connect, re-zeroes machine position on a machine without homing. The offer still says "The job you stopped ran from X 20, Y 30 mm from machine zero" and writes that G92. In the simulator repro the re-run's origin landed (+20, +68) mm from where the job ran. The interrupted job's own Review warns about this case; the new offer does not.
- **X1-P2-1.** Main's crash stop, which ADR-398 Amd 8 and ADR-482 Amd 1 say runs "whatever the close guard is doing", actually waits behind the close guard's synchronous "App controls unavailable" box when the renderer dies during a close. In the Node repro the reset reached the controller 3,002 ms after the crash, against 13 ms without a close.

CI: each PR's checks were green on its final head, but against a merge base from the time the run was created:
- #1615, #1616 and #1620: 2026-11-08 08:23 UTC.
- #1612: 2026-11-05.

So no PR run covered #1615, #1616 and #1620 together. Main's own runs on the merge commits of #1616 and #1620, and the CI and Desktop runs on #1615's, were cancelled by later pushes. The full suite (4 e2e shards, unit tests, desktop package) then ran green on:
- `a3965a77d`, which contains #1612, #1615, #1616 and #1620;
- `f4d18e348`, which also contains #1628.

## Findings

### X1-P1-1 — After a hard controller reset, Frame's "unrestored origin" offer puts back the aborted job's origin in the new machine frame, so the re-run burns elsewhere

- **Where (`743d37bc4`):**
  - `src/ui/laser/unrestored-abort-origin.ts:29-35`: `unrestoredAbortOrigin` keys the offer on the stop request's `reason` and `streamerEpoch` only. There is no controller session, reset or homing check.
  - `:54-78`: the prompt says "The job you stopped ran from X …, Y … mm from machine zero, and that origin was not restored… OK: put the saved origin back with one G92 (the head does not move)".
  - `:81-96`: OK homes first only when the profile has homing (`homeFirst`), then `restoreAbortOriginFromIdle` writes `G92` against the controller's current machine position.
  - `src/ui/laser/start-blocked-setup-offers.ts:67-70`: this offer replaces the plain set-origin offer whenever it returns non-null.
  - `src/ui/state/job-stop-request.ts:32-38`: `currentJobStopRequest` matches on `streamerEpoch` alone. `streamerEpoch` changes only at the next Start (`laser-job-actions.ts:403`).
  - `src/ui/state/laser-job-stop.ts:341-351` and `:370-377`: the request and its `originAtStopMm` are set at Abort. No disconnect, connect or forget path clears them (`laser-disconnected-state.ts`, `laser-connect-action.ts`, `laser-connection-teardown.ts`: no reference).
- **Anchor:**
  - **Ground truth:** GRBL clears machine position only at power-up, not at a soft reset. gnea/grbl `grbl/main.c:47` `memset(sys_position,0,sizeof(sys_position)); // Clear machine position.` runs before the reset loop, and `:75` clears only `sys`. Read from the local copy in scratchpad `grbl-src/main.c`, the same file the v10 V3 refuter cited as `main.c:75`. Pinned upstream: <https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L47>. That the local copy matches this SHA was not re-checked (no download rule), so the pin is **UNVERIFIED**; the line content was read.
  - KerfDesk's own code says the browser's port open resets an Arduino-class board: "the browser asserts DTR when it opens the port … so the board resets" (`src/core/recovery/link-loss-restart.ts:7-11`).
  - **Twin:** the interrupted job's Review, which covers the same lost origin, tells the operator to "home the machine if it was reset, then use Restore saved origin" (`src/ui/laser/laser-recovery-origin.ts:58-70`). The new Frame offer has no such caveat and acts on OK.
  - **Contract:** ADR-341 Amd 12 Decision 5 says the offer's OK "puts the saved origin back". After a power-up re-zero, the G92 it writes is not the saved origin.
- **Scenario:**
  1. A stock-GRBL diode laser (Arduino/CH340) or a FluidNC board on USB, with no homing. The operator sets the origin with Set origin here, starts the job and presses ABORT JOB.
  2. They do not restore (or the restore fails). Then they Disconnect and Connect, power-cycle the laser, or press the toolbar's Reconnect now. The board resets on DTR or power-up, so machine zero is now wherever the head stopped.
  3. They press Frame. The offer names the old origin "from machine zero" and computes the head's distance in the new frame, so the numbers look consistent.
  4. OK writes `G54 G21 G92 X-20.000 Y-30.000` against the new zero, and the Frame and the re-run go there.
  5. The physical origin is the head's position at the reset plus (20, 30) mm, not where the job ran.
  - **A sibling route:** an operator who set a new origin after the Abort and then lost it to any reset gets the old Abort's origin offered back, not their own.
  - **On a profile with homing:** OK homes first, which is correct only if the job's origin was set relative to a homed zero.
- **Evidence:** REPRO (Vitest on the real store, checkpoint tracker and repo GRBL simulator; `zz-x1/mut/src/ui/laser/zz-x1-reboot-offer.simulator.test.tsx`, output `zz-x1/reboot-offer.jsonl`; 1 test passed, memory 1.6 GB).
  - The run: set the origin at (20, 30), start a framed job, ABORT JOB, Disconnect, then connect a fresh simulator, as `recovery-origin-after-reboot.simulator.test.tsx` models a rebooted controller.
  - The new session: `epochsBefore {streamerEpoch 1, session 4}` → `epochsAfter {streamerEpoch 1, session 9}`, with `stopRequest {reason operator, originAtStopMm {20,30}}` still in place.
  - Frame's confirm: "User Origin needs a custom work origin. The job you stopped ran from X 20, Y 30 mm from machine zero, and that origin was not restored. The head is 36.06 mm from it (X −20, Y −30 mm). OK: put the saved origin back with one G92 (the head does not move)…"
  - Wire: `G54 G21 G92 X-20.000 Y-30.000`. The simulator's WCO afterwards is (20, 30) in the new frame.
  - The head was at old MPos (20, 68) at the Abort, which is the new zero. So the restored origin sits physically at (40, 98) against the job's (20, 30): **(+20, +68) mm**.
- **Severity: P1 (proposed).**
  - It is silently wrong physical output (position), reachable today on the most common hobby boards with homing off.
  - The only text before the output asserts the opposite: that this is where the job ran. G6: Frame is not a warning.
  - Before #1620 the same journey offered "set the work origin where the head is now", which at least described what it did. #1620 replaced it with a confident claim that is false after a reset.
  - Reach (a reconnect or power cycle between Abort and the re-run) cannot lower a P1 (METHOD §3).
- **Novelty:** new, introduced by #1620. V3, V9 and the #1620 tests cover only the same controller session. No open PR touches `unrestored-abort-origin.ts`.
- **Fix direction:**
  - Record the controller session with `originAtStopMm` (or note a restart banner since the Abort). After a new session or restart, make no saved-origin offer on a machine without homing: fall back to the plain offer with the Review's reset wording. On a machine with homing, say that Home is needed.
  - Also drop the offer once the operator sets an origin themselves.
  - Extend `abort-restore-work-position.simulator.test.tsx` with a reconnect to a fresh simulator.
- **Refuter:** PENDING.

### X1-P2-1 — Main's crash stop waits behind the close guard's synchronous "App controls unavailable" box when the renderer dies during a close

- **Where (`743d37bc4`):**
  - `electron/main.ts:400` installs the close guard; its `render-process-gone` listener (`electron/window-close-guard.ts:58-60`) is registered before crash recovery's (`main.ts:420` → `electron/desktop-renderer-crash.ts:13-15` → `electron/renderer-crash-recovery.ts:81-83`). Node's emitter calls them in that order.
  - `window-close-guard.ts:205-220`: `onRendererUnavailable` → `void this.unavailable(...)`, which runs synchronously to `:169` `this.options.decideUnavailable()`.
  - That is `dialog.showMessageBoxSync` (`electron/desktop-window-close.ts:89-101`), which blocks main's thread, so neither the crash stop nor the 15 s lease timer can run until the operator answers.
- **Anchor:** **Contract.**
  - ADR-482 Amd 1 Decision 1 (`docs/decisions/ADR-482-amendment-1-a-crash-stops-a-network-machine-and-names-a-lit-beam.md:20-22`): main first sends the stop "for every reason and whatever the close guard is doing".
  - ADR-398 Amd 8 Decision 2 (`docs/decisions/ADR-398-amendment-8-main-sends-the-stop-when-no-window-can.md:40-41`): "before the reload prompt and before the close guard is asked anything".
  - **Test truth:** `renderer-crash-recovery.test.ts` checks the order against a stand-in with no close guard installed.
- **Scenario:**
  1. A network (grblHAL or FluidNC) job runs under M3, or Fire is latched. The operator closes KerfDesk.
  2. The close guard starts preparing (`preparing = true`). The renderer's own stop (`desktop-close-controller.ts:80-108`, `stopForAttempt`) has not gone out yet, or it failed and the window shows Retry.
  3. The renderer dies (OOM, crash or kill). Main shows "KerfDesk cannot reach its controls to finish closing… Use the physical E-stop or power cutoff if the machine may be unsafe" synchronously.
  4. Until the operator answers, main sends nothing and the beam stays lit. After the answer, the stop goes out.
- **Evidence:** REPRO, Node, using the real modules in main's order (`zz-x1/w3/crash-during-close.mjs`, output `crash-during-close.json`).
  - Setup: the real `WindowCloseGuard`, `installRendererCrashRecovery` with `stopMachine: () => bridge.stopAll() > 0`, and `MachineNetworkBridge`. A loopback grblHAL-raw controller answers `0x18` with its banner. `decideUnavailable` is a 3 s synchronous busy-wait standing in for `showMessageBoxSync`.
  - Results:

    | | Box shown | Reset at controller | `M5` at controller |
    |---|---|---|---|
    | Control (no close under way) | none | **13 ms** | 19 ms |
    | Renderer dies during a close | 0 ms (closed at 3,000 ms) | **3,002 ms** | 3,004 ms |
- **Severity: P2 (proposed; P1 candidate under this round's rule, for the refuter to weigh).**
  - The beam stays lit, and main's stop waits on a dialog for an unbounded time.
  - The case for P2:
    - The window is narrow: a crash between the close click and the renderer's own stop, or after that stop failed.
    - The box that holds the stop appears at once and says plainly that "Software Abort … cannot be confirmed" and names the E-stop. That is a specific warning before the dwell continues, which W3-P1-1's prompt was not.
  - It is a clear break of both amendments' own ordering contract.
- **Novelty:** new; a gap in #1628. It is distinct from KNOWN R1-P2-2 / K-R1-P2-2-dialog, which is the sync box stalling `app://` routes while the renderer lives.
- **Fix direction:** install crash recovery's `render-process-gone` listener before the close guard (or `prependListener`), or run `stopDesktopMachineNetwork()` at the top of the close guard's handler. Add a test with both installed in `main.ts`'s order.
- **Refuter:** PENDING.

### X1-P3-1 — The crash prompt says main "sent the network machine a reset, then M5 and M9" when it only counted a session

- **Where:**
  - `electron/renderer-crash-recovery.ts:83,88`: `networkStopped = stopMachine(options)`, which is `bridge.stopAll() > 0`, the number of sessions (`machine-network-bridge.ts:68-74`).
  - The prompt (`:59-62`) is shown at once.
  - `MachineNetworkSession.stopAndClose` (`machine-network-session.ts:129-139`) returns without writing when the session already closed on a socket `error` or `close` (`:42-45`).
  - A failed or timed-out reset write ends the stop early (`:163`).
- **Anchor:** Contract, ADR-482 Amd 1 Decision 2 (the prompt "says what happened to the machine").
- **Scenario:** the Wi-Fi link drops (the socket errors), and within the 15 s lease the renderer dies. The prompt says a reset, `M5` and `M9` were sent. Nothing was. In the ordinary case the prompt also appears before the bytes leave: 11 ms against the reset at 13 ms in my control run.
- **Evidence:** READ, plus the control timing above.
- **Severity: P3.** The prompt goes on: "Check that it stopped. If the beam or spindle is still on, use the physical E-stop or power cutoff now." So the operator is still told to check, and a TCP machine whose link died could not be stopped by any route.
- **Fix direction:** report "sending" rather than "sent", or report the per-session result of `stopAndClose`.
- **Refuter:** PENDING.

## Refuted

Candidates the auditor dropped:
- **#1628 resets an idle network machine 15 s after a plain reload (the lease), clearing a FluidNC G92.** The desktop menu omits Reload (`electron/application-menu-policy.ts:11`). The renderer reloads only on a startup error, with no session, and from the crash prompt, after the crash stop has already run. A reload mid-job already aborts through `use-unload-stop.ts`. Not reachable as a new harm.
- **The "busy" gate means session end ignores a CNC spindle on at Idle.** That is deliberate and matches the ordinary close (`unowned-controller-output.ts:1-13`: laser only; the spindle has its own asked-for stop).
- **#1612's per-report `setToolpath` re-runs the Preview timeline.** The object it replaces is the empty `too-complex` placeholder (`use-preview-toolpath.ts:175`), and #1548's route summary makes the timeline cost nothing per step. No main-thread work is added during a job.
- **Write-queue overflow closes with no stop (`machine-network-session.ts:109-113`).** ADR-398 Amd 8 Decision 3 says so on purpose. It needs 512 KiB of unsent bytes, which an ack-windowed stream cannot build: latent.

## Verified clean

### #1615 (ADR-207 Amd 3)

**CI:** green on head `6499de623`, across CI, Browser smoke and the Desktop package check. Main's run on `c70612b58` had Browser smoke green, with CI and Desktop cancelled by the next push. The full suite then ran green on `a3965a77d`.

- **The original repro is fixed:**
  - `e2e/live-motion-held-enter.e2e.ts` in my export: **3/3 pass** in headless Chrome 156 (`zz-x1/e2e-held-enter.txt`).
  - A 2.5 s hold on Pause sends one `0x84` and no `0x7E` or `0x18`.
  - A 2 s hold on Start job sends no realtime byte.
  - A 4 s hold on Frame again runs one Frame.
- **Test truth:**
  - With `{...keys}` removed from `LiveMotionActionButton`, 3 of the guard's button cases fail (`zz-x1/vt-guard-mutant.txt`); with it, all pass (`vt-guard-main.txt`).
- **Fast double presses still work.**
  - `freshActivationKeyUp` clears the held key on keyup (`use-fresh-key-activation.ts:34-46`), so press, release, press acts twice, exactly as a mouse double click does.
  - A lost keyup is cleared by `onBlur` (`:65-67`). `useFocusThroughDisable` moves focus to the group while Frame runs, which also clears it.
- **Coverage of in-place buttons:**
  - The Live Motion primary action covers Pause, Pausing…, Resume, Lifting…, Returning… and Continue (`LiveMotionBar.tsx:161-210`).
  - Frame job, which comes back as Frame again (`JobActionControls.tsx:171`), and Set origin here (`OriginRow.tsx:72`) are covered.
  - ABORT JOB, ABORT MOTION and LASER OFF are left unguarded on purpose: every press there stops something.
  - Fire is a momentary hold that already filters `repeat` (`MomentaryFireControl.tsx:50`).
  - LED on and LED off are separate buttons.
  - No other focused button in the laser panel changes meaning in place.
- **Keyboard accessibility (U7):**
  - Focus stays on the button, Space and Enter still activate on a fresh press, and mouse clicks are untouched.
  - Assistive-technology activation (a click event, not keys) is unaffected.

### #1616 (ADR-337 Amd 2)

**CI:** green on head `65c7ff48d`. Main's run on `0410b6b47` was cancelled; `2826e2932` CI and `a3965a77d` (all three workflows) ran green.

- **The original repro is fixed:**
  - The V1 refuter's `activate-block.mjs`, rebuilt against `j13-main` with the instrumented `work-steps` (`zz-x1/v1/activate-out.txt`): **0 drains crossing a checkpoint at activation**.
  - Activation took 1.7 ms at 388k lines, 3.4 ms at 375k raster lines and 8.9 ms at 1.0 M raster lines.
  - The removed pass on a fresh identity cost 136 ms, 274 ms and 781 ms respectively (loaded PC).
- **The owed Chrome measure, now taken:**
  - Method: `e2e/zz-x1-activate.e2e.ts` in my export, headless Chrome 156 against my Vite server on 4811. It stages through the real cooperative runner, then calls the real `activateAcceptedFreshRun` with a `longtask` observer (`zz-x1/v1/chrome-activate.json`).

    | Job | Backend | Activation | Long tasks during activation | Old pass (fresh identity) |
    |---|---|---|---|---|
    | 375,381-line raster | memory | 2.9 ms | **none** | 239 ms |
    | 375,381-line raster | **IndexedDB** | 139.8 ms (async) | **none** | 209 ms |
    | 840,846-line raster | memory | 4.4 ms | **none** | 487 ms |

  - V1-P1-1 is fixed in Chrome.
  - **KNOWN V1-P3-1 re-measured:** staging into IndexedDB ran one 81 ms task at 375k lines, and the memory backend's record clone ran 66 ms at 375k and 128 ms at 841k. This is consistent with the `add`/clone that ADR-337 Amd 2 lists under "What still runs in one task". It is not counted again here.
  - The 1,198 ms and 2,592 ms "stage" tasks in the JSON are my harness generating the program in the same task. They are not app work.
- **Test truth:** with `noteValidatedExecutionArtifact` removed, the new guard fails (`checkpointsCrossed` ≠ 0, `vt-guard-mutant.txt`).
- **Trust boundary unchanged:** only `stage` notes an identity, after `artifactMayStage` (`recovery-artifact-store.ts:60-94`). Storage reads stay full (`:119-142`).
- **The ADR matches the code.**

### #1620 (ADR-637 Amd 9, ADR-341 Amd 12)

**CI:** green on head `ac60d207a`. Main's run on `24d09318f` was cancelled; `968c7b749` CI and `a3965a77d` (all three) ran green.

- **V3-P2-1 is fixed.** `assertReconnectAllowed` guards the toolbar's `reconnectWithSavedProfile` and step 1's reconnect and Find's reconnect (`reconnect-job-guard.ts:34-51`, `use-find-machine.ts:157-174`). It covers every `isActiveJob` status, including paused, tool-change, done and errored.
- **V3-P2-2 is fixed for the same controller session.**
  - `e2e/abort-unrestored-origin.e2e.ts`: **1/1 pass** in Chrome 156 (`zz-x1/e2e-abort-origin.txt`).
  - Focused suites: `reconnect-job-guard.simulator`, `abort-restore-work-position.simulator`, `start-blocked-setup-offers`, `laser-status-position` and `AbortStoppedCard`, run together with the #1628 and #1612 suites. **12 files, 90 tests pass** (`zz-x1/vt-focused.txt`).
- **The restore never moves the head without Home.**
  - The wait sends only realtime `?` queries (`laser-origin-restore.ts:332-375`).
  - The Frame offer's OK says when it homes (`unrestored-abort-origin.ts:66-70`).
  - Within one session, no unexpected motion was found. The cross-session case is X1-P1-1.
- **Abort during the restore wait:** the wait ends on a new session, Alarm or Sleep, and re-checks readiness before the G92 (`laser-origin-restore.ts:198-204`). READ.

### #1628 (ADR-398 Amd 8, ADR-482 Amd 1, ADR-548 Amd 2)

**CI:** green on head `48fb122e3`, including the Linux package and launch. Main's run on `a8dabc789` had CI and Desktop green, with Browser smoke cancelled; `f4d18e348` ran all three green.

- **The original repro is fixed.** The W3 refuter's own `crash-repro.mjs`, run unchanged against `j13-main` (`zz-x1/w3/w3r-crash-on-main.json`):
  - The lease now writes 7 bytes (`0x18`, `M5`, `M9`) and the controller closes at 15.3 s.
  - `dispose()` writes the same 7 bytes.
  - (That harness predates the `stopMachine` option, so its crash leg exercises the lease. My `crash-during-close.mjs` control exercises the crash leg: reset after 13 ms.)
- **No-window paths:**
  - The stop is sent on `render-process-gone` (every reason), the lease, `dispose()` on `will-quit`, `session-end` and a critical query (synchronous), and on a refused write, receive overflow or bad framing.
  - The `app.exit(1)` calls (`main.ts:119,554`) run only before any session exists.
  - The update quit's `will-quit` `preventDefault` comes after every window has already closed.
- **Reloads:**
  - Nothing new is sent when the window reloads mid-job. The unload stop already aborts (`use-unload-stop.ts:28-35`).
  - The desktop menu has no Reload.
- **W3-P2-1:** `desktop-session-end` and `session-end-guard` pass (in the 90 above). An `A:S` report at Idle now reports busy.

### #1612 (S8-P3-3)

**CI:** green on head `c19479c2d`, but against a merge ref created **2026-11-05 19:21**. The attempt-3 reruns reuse it. Main's run on `82458c902` then ran all three green.

- Progress is ignored after the route settles or after cancellation (`use-preview-toolpath.ts:222-262`). Leave Preview cancels the worker.
- S1-P2-1's fix (#1548, a route summary instead of a per-step walk, `preview-timeline.ts:21-26`) is intact.
- The `preview-issue-banner` and `use-preview-toolpath-progress` suites pass.

### L6/L4 interleavings

- **Crash during Pause:** main's `0x18` reaches a GRBL in a completed hold with no alarm (pro-loop v3 C4, KNOWN), and the laser is already off in a hold under `$32=1`. On USB the prompt names the hazard. READ.
- **Crash during a close:** X1-P2-1.
- **Held key during Start:** e2e above, no realtime byte.
- **Reload during a job:** unchanged by these PRs.

### L12: main after the train

- The full e2e suite ran green on `a3965a77d` (4/4 shards, 2026-11-08 15:04) and on `f4d18e348` (2026-11-09 01:23).
- **Noted for X6/X7, not X1:** main `743d37bc4`'s Browser smoke **failed** (run 42560980577, 04:57 UTC). Shard 2: `e2e/gcode-viewer-stock.e2e.ts:421` "Cut too deep: 0%" timed out after its retry. That spec is the ADR-487 relief path from #1622; shard 2 passed on `281ace097` just before. `7cd9ff49f`'s Browser smoke was cancelled.

## Not verified

- **Hardware and Electron:**
  - No real controller, packaged Electron 44 (Chromium 152), real renderer crash or real Windows session end.
  - X1-P1-1's physical re-zero is from the GRBL source and KerfDesk's own DTR note, not observed on a board.
  - X1-P2-1's sync box is a busy-wait stand-in.
- **A held Enter reaching a native `window.confirm`.** Frame's setup offers, including #1620's offer whose OK may Home, use `window.confirm` through `jobAwareConfirm` (`job-aware-dialogs.ts:33-39`). Whether an auto-repeated Enter accepts the Windows message box Electron shows, or Chrome's JS dialog, could not be tested headless. It is not raised. A refuter with a safe desktop probe could check it.
- **grblHAL and FluidNC `$10=0` cadence.** ADR-341 Amd 12 Decision 1's "WCO: on the next report after any offset change" is checked for GRBL only (`grbl-src/system.c:285`). No grblHAL or FluidNC source is local, and nothing was downloaded: **UNVERIFIED** there.
- **e2e specs not run:** `controller-recovery-toast`, `first-connect-machine-setup`, `production-workflows:573` and `recovery-deep-audit:436`. CI ran them green on `a3965a77d`.
- **Memory gate (stated plainly):**
  - One Vitest run (the guard suites, 587 MB) and the held-Enter browser run (334 MB) started below the gate. The reading was taken while my V1 Node repro was still running.
  - Both completed. Every other run met the gate.

Repro files (scratchpad `zz-x1/`):
- `v1/` (bundle, `activate-out.txt`, `chrome-activate.json`);
- `w3/crash-during-close.mjs` with `.json`, and `w3/w3r-crash-on-main.json`;
- `reboot-offer.jsonl`;
- `vt-*.txt`;
- `e2e-*.txt`;
- `mut/src/ui/laser/zz-x1-reboot-offer.simulator.test.tsx` and `mut/e2e/zz-x1-activate.e2e.ts`.

The Vite server on 4811 was stopped; nothing of mine is still running.

```json
[
  {"id":"X1-P1-1","severity":"P1","area":"X1","file":"src/ui/laser/unrestored-abort-origin.ts","line":29,"anchor":"Ground truth gnea/grbl main.c:47 (power-up clears sys_position; soft reset :75 does not) + link-loss-restart.ts:7-11 (DTR resets the board on port open); Twin laser-recovery-origin.ts:58-70 ('home the machine if it was reset'); Contract ADR-341 Amd 12 D5","evidence":"REPRO (Vitest, real store + GRBL simulator, reconnect to a fresh simulator: offer names X 20, Y 30 after session 4->9, writes G54 G21 G92 X-20.000 Y-30.000; restored origin physically (+20,+68) mm from the job's)","verdict":"PENDING","known":false,"summary":"Frame's unrestored-origin offer (#1620) survives a controller power-up/DTR reset on a no-homing machine and restores the aborted job's machine-coordinate origin in the new frame; the re-run lands offset by the head's position at the reset, under a prompt that says this is where the job ran"},
  {"id":"X1-P2-1","severity":"P2","area":"X1","file":"electron/main.ts","line":400,"anchor":"Contract ADR-482 Amd 1 D1 ('whatever the close guard is doing') and ADR-398 Amd 8 D2 ('before the close guard is asked anything')","evidence":"REPRO (Node, real WindowCloseGuard + installRendererCrashRecovery + MachineNetworkBridge in main.ts order; reset at controller 13 ms without a close vs 3,002 ms when the renderer dies during a close)","verdict":"PENDING","known":false,"summary":"The close guard's render-process-gone listener runs first and opens the synchronous 'App controls unavailable' box; main's network stop (and the lease) wait until the operator answers"},
  {"id":"X1-P3-1","severity":"P3","area":"X1","file":"electron/renderer-crash-recovery.ts","line":83,"anchor":"Contract ADR-482 Amd 1 D2 (the prompt says what happened to the machine)","evidence":"READ (+ control timing: prompt 11 ms, reset 13 ms)","verdict":"PENDING","known":false,"summary":"networkStopped counts sessions, so the prompt says a reset, M5 and M9 were sent even when the session's socket had already failed and nothing was written"},
  {"id":"K-V1-P3-1","severity":"P3","area":"X1 (re-measured)","file":"src/ui/state/recovery/recovery-artifact-store.ts","line":79,"anchor":"ADR-337 Amd 2 'What still runs in one task'","evidence":"REPRO (Chrome 156: one 81 ms task staging a 375k raster into IndexedDB; memory-backend clone 66/128 ms at 375k/841k)","verdict":"KNOWN","known":"rolling v10 V1-P3-1","summary":"The IndexedDB add/clone is the one task over 50 ms left at staging; activation itself now has none"}
]
```

## Refuter (2026-11-09)

Fresh context; I raised none of these findings. Tree: `743d37bc4`. Every file cited below compared byte-equal between `j13-main` and my own export `zz-x1r/mut` (`git archive 743d37bc4`, `node_modules` a junction to the main checkout's). My files are in scratchpad `zz-x1r/`, not in the repo.
- **Memory:** 3.3 GB free for the one Vitest run. Free memory then fell to 0.2–0.9 GB, so the browser runs and the 1.4M-line activation run did not start (see "Not verified").

### X1-P1-1: CONFIRMED, P1

**What would make it false:**
- the reconnect clears the stop request;
- the app notices the reset (banner, alarm, position jump) and drops or rewords the offer;
- a warning that names the mismatch reaches the operator before the burn;
- GRBL keeps machine position through a hard reset.

None holds.

- **The offer survives any new controller session (READ):**
  - `unrestored-abort-origin.ts:29-35` reads only `currentJobStopRequest`, and `job-stop-request.ts:32-38` keys that on `streamerEpoch` alone.
  - The request is written at `laser-job-stop.ts:346-351` (with `g92OriginAtStop`, `:370-377`), and at `:201` and `:310` without an origin.
  - No path in `src/` writes `jobStopRequest: null`.
  - Only two readers use `originAtStopMm`: `AbortStoppedCard.tsx:46` and the offer.
  - `start-blocked-setup-offers.ts:67-70` puts the offer in place of the plain one.
- **REPRO, by a second route** (`zz-x1r/mut/src/ui/laser/zz-x1r-powercycle-offer.simulator.test.tsx`; output in `zz-x1r/powercycle.jsonl` and `vt-powercycle.txt`; 1 test passed).
  - **Setup:** real store, checkpoint tracker and repo GRBL simulator; homing off; origin set at (35, 15); framed job; ABORT JOB.
  - **What differs from the auditor:** there is no operator Disconnect. The laser is power-cycled while connected: the cable link drops (`yankCable`). The operator then connects to a fresh simulator, as `recovery-origin-after-reboot.simulator.test.tsx` models a reboot.
  - **Between the link loss and the offer's OK** the app showed:
    - no toast;
    - no `jobAwareAlert`;
    - no `safetyNotice`;
    - no alarm (`alarmCode null`, state Idle).
  - **The app had the evidence and did not use it:**
    - `controllerSessionEpoch` went from 4 (after the Abort's banner) to 7;
    - the last report before the cut had MPos (35, 15), and the first after it had (0, 0) with no motion sent;
    - `jobStopRequest {operator, epoch 1, originAtStopMm {35,15}}` was still in place.
  - **Frame's only prompt:** "…The job you stopped ran from X 35, Y 15 mm from machine zero, and that origin was not restored. The head is 38.08 mm from it (X −35, Y −15 mm). OK: put the saved origin back with one G92 (the head does not move)…".
  - **Wire:** `G54 G21 G92 X-35.000 Y-15.000`, then the Frame's `$J=` box from the new WCO (35, 15).
  - **Toasts after OK:** "Origin restored at X 35, Y 15 mm from machine zero." and "Frame complete — press Start…". Both affirm the wrong placement.
  - **Physical result:**
    - The head stopped at old MPos (35, 15), which is the new zero. The restored origin is therefore at old (70, 30) against the job's (35, 15): **(+35, +15) mm**.
    - Here the head was sitting on the job's own origin, yet the offer said it was 38 mm away. The numbers are self-consistent only in the new frame.
- **Ground truth (READ of the local copy):** scratchpad `grbl-src/main.c:47` `memset(sys_position,0,…); // Clear machine position.` runs once, before the `for(;;)` reset loop at `:71`, which clears only `sys` (`:75`). So a soft reset (Abort, Disconnect) keeps MPos and a power-up or DTR reset clears it. The auditor's upstream pin is **UNVERIFIED** by me (no download rule).
  - The DTR reset on port open is KerfDesk's own statement (`src/core/recovery/link-loss-restart.ts:7-11`).
- **Is there a warning?** None that names the mismatch:
  - Job Review's sources never read `jobStopRequest`, `originAtStopMm` or a session change (`grep` over `src/ui/laser/job-review/`: only build-info session checks).
  - The recovery Review's caveat ("home the machine if it was reset", `laser-recovery-origin.ts:58-70`) is not on this path.
  - Frame is not a warning (G6).
- **Severity:** P1 kept. It is wrong physical output (position), reachable today, and the only text on the path asserts the opposite. Before #1620 this journey got the neutral "set the origin where the head is now".
- **Correction to the auditor's Where:** the stop request is also written at `laser-job-stop.ts:201` and `:310` (without an origin). This changes nothing.

### X1-P2-1: CONFIRMED, P2 kept (P1 weighed and rejected)

**What would make it false:**
- the crash stop runs before the close guard's listener;
- the box is asynchronous;
- another `render-process-gone` listener ahead of it stops the machine.

None holds.

- **Order (READ, `main.ts`):** the guard's listener (`window-close-guard.ts:58-60`) is added at `:400`, then `:417` (licence), then crash recovery at `:420` (`renderer-crash-recovery.ts:81-83`).
  - The earlier `render-process-gone` listeners do not block: `window-readiness-policy.ts:45` only shows the window, `session-end-guard.ts:101` only sets idle.
  - `onRendererUnavailable` (`:205-220`) → `unavailable` runs synchronously to `decideUnavailable()` (`:169`). That is `showMessageBoxSync` (`desktop-window-close.ts:89-102`); `reportFailure` before it is only `console.warn` (`:55`).
- **REPRO (independent Node harness, `zz-x1r/order.mjs` → `order-out.txt`):** the real `WindowCloseGuard` and `installRendererCrashRecovery` on an EventEmitter window, in `main.ts`'s order, with a 1 s synchronous `decideUnavailable`.

  | Case | Crash | Box | STOP |
  |---|---|---|---|
  | No close under way | 31 ms | none | **31 ms** |
  | Close, answer Keep app open | 96 ms | 97 ms → answered 1,097 ms | **1,098 ms** |
  | Close, answer Close app | 1,158 ms | 1,158 ms → answered 2,158 ms | **2,159 ms** |

  Either answer releases the stop within 1 ms. In the Keep case the crash prompt follows too, since the cancel ends `isClosing()`.
- **Why P2, not P1:**
  - **How long the delay lasts.** It is bounded only by the operator's answer, so it is not bounded in time. But one keypress ends it, because the default button is Keep app open and Enter answers.
  - **Whether the operator must act.** Yes: the operator has to answer the box. They have just pressed Close and are in front of the screen. The box opens within 1 ms of the crash, before the dwell begins (the controller first drains its buffered moves).
  - **What the box says.** It names the specific hazard, not a generic one: "Software Abort … cannot be confirmed", plus the E-stop. W3-P1-1's prompt implied the machine would stop, and K1-P1-3's stall had no text at all. METHOD §3 allows a P1 to be lowered when "a clear warning reaches the operator before the output is produced", and this box does that.
  - **Where it can happen.** The renderer's own stop starts synchronously inside `prepare` (`desktop-close-controller.ts:80-110`, `:107`). The exposure is therefore:
    - the IPC milliseconds before that write;
    - or a stop that already failed, where the window's failed-Abort notice with Retry is already on screen and main's write would use the same socket.
  - **What the box's wording lacks.** Its E-stop line is conditional ("if the machine may be unsafe"), the weakness the W3 refuter named. I keep P2 because the line before it says the Abort itself is unconfirmed. The coordinator may weigh this.
- The broken contract (ADR-398 Amd 8 D2, ADR-482 Amd 1 D1) is real and matches the P2 definition: a broken contract with a clear failure scenario.

### X1-P3-1: CONFIRMED, P3

- `renderer-crash-recovery.ts:83` takes `stopMachine()`, which is `bridge.stopAll() > 0` (`machine-network-routes.ts:20-21`). `stopAll` returns `ids.length` (`machine-network-bridge.ts:68-74`), whatever each session did.
- A session closed by its socket's `error` or `close` (`machine-network-session.ts:42-45`) stays in the bridge's map until the window's own close or the lease. `stopAndClose` then returns at once (`:133`), and a failed reset write ends `sendStop` before `M5` (`:163`).
- The prompt (`:59-62`) therefore says "sent … a reset, then M5 and M9" in that case.
- **The P3 holds:** the window is short (the window's read loop sees `closed` and closes the session), and the prompt still orders a check and the E-stop. A dead socket could not carry any stop.

### Challenges to "Verified clean"

- **#1615: is the key guard too strict? No wrong press found; one unverified extra-press case.**
  - `use-fresh-key-activation.ts:23-46`:
    - keydown refuses only `repeat` or a second key while one is held;
    - keyup always clears the held key;
    - `onBlur` (`:65-67`) clears a keyup that went elsewhere.
  - A quick double press (down, up, down) acts twice. Screen-reader and switch activation arrive as click events and are untouched.
  - Space whose keydown went to another element is refused on keyup. That is correct: it was not a press of this button.
  - **The one gap I could not test:** an Enter on Frame job whose keyup is eaten by the native `window.confirm` the Frame offer opens. If no `blur` reaches the button, the next fresh Enter is refused once, and the press after that works. At worst that costs one extra press and never a wrong one. Not raised.
- **#1628: does a legitimate reload during a job trigger its stop? No new stop and no new abort.**
  - On Windows and Linux the app menu is `null` (`application-menu-policy.ts:14-19`), so there is no Ctrl+R.
  - The renderer reloads only:
    - from the startup-error page (`browser-entry.ts:21`), where no session exists;
    - from the crash prompt (`renderer-crash-recovery.ts:90`), after the crash stop.
  - `PwaUpdateWatcher.tsx:48-51,89` is the web build, with no network sessions.
  - Aborting a job on a reload is pre-existing by design (`use-unload-stop.ts:28-35`), not #1628's.
  - The 15 s lease already existed at `5f09e1110` (`close` with no stop, `machine-network-bridge.ts:64`); #1628 only makes it send a stop first (`:103`).
  - Native dialogs are refused during a job (`job-aware-dialogs.ts:33-39`), and job reads run in the network worker (`network-serial-worker-runtime.ts:1-11`). So no in-job renderer stall reaches the lease.
  - **Not verified:** a window-hosted session (worker unavailable) left at Idle behind a native confirm for over 15 s now gets a reset before the close, which on FluidNC clears a G92 that the old silent close kept. Not raised: it rests on a worker fallback I did not trigger.
- **#1616: is activation still under 50 ms at 1.4M lines? Very likely yes (READ plus scaling); not measured.**
  - Activation is an identity lookup: `activateAcceptedFreshRun` → `repository.activateFreshRun` (`start-job-execution-tracking.ts:188-203`), and `isValidatedExecutionArtifact` hits the WeakSet before any full pass (`validated-execution-artifacts.ts:27-33`).
  - The auditor's times grow about linearly: Node 1.7, 3.4 and 8.9 ms at 388k, 375k and 1.0M lines; Chrome 2.9 and 4.4 ms at 375k and 841k. Extrapolated to 1.4M that is about 12 ms (Node) and about 7 ms (Chrome).
  - The step that would cross 50 ms (`isExecutionArtifact` on a fresh identity: 781 ms at 1.0M) is not on that path.
  - I could not run `zz-x1/v1/activate-block.mjs raster1400`: free memory was 0.2–0.9 GB.

### New findings

None.

### Not verified (refuter)

- No browser run, so neither e2e was re-run and the held-Enter on a native `window.confirm` was not tried. Memory was under the 2 GB gate.
- The 1.4M-line activation timing (above).
- No Electron, packaged build, or real board power cycle. X1-P1-1's re-zero is the simulator's fresh connect plus the GRBL source.
- K-V1-P3-1: not re-measured; I accept it as KNOWN.

```json
[
  {"id":"X1-P1-1","severity":"P1","verdict":"CONFIRMED","file":"src/ui/laser/unrestored-abort-origin.ts","line":29,"evidence":"REPRO (refuter, second route: power cycle via cable loss, no Disconnect; no toast/alert/notice/alarm after reconnect; session 4->7, MPos (35,15)->(0,0); offer names X 35, Y 15; G54 G21 G92 X-35.000 Y-15.000; burn origin +35,+15 mm off; success toasts affirm it) + READ (no path clears jobStopRequest; Job Review never reads it) + local GRBL main.c:47","summary":"Frame's unrestored-origin offer ignores a controller power-up/DTR reset on a no-homing machine and restores the saved origin in the new machine frame with no warning"},
  {"id":"X1-P2-1","severity":"P2","verdict":"CONFIRMED (P1 weighed, rejected)","file":"electron/window-close-guard.ts","line":169,"evidence":"REPRO (refuter Node harness, real guard + crash recovery in main.ts order: STOP at 31 ms without a close; with a close STOP waits for the 1 s sync box and goes 1 ms after either answer)","summary":"Crash stop waits behind the close guard's synchronous box; bounded by one answer, and the box names the unconfirmed Abort and the E-stop at once"},
  {"id":"X1-P3-1","severity":"P3","verdict":"CONFIRMED","file":"electron/renderer-crash-recovery.ts","line":83,"evidence":"READ (stopAll counts map entries; a socket-closed session stays mapped and stopAndClose returns early)","summary":"Prompt says the reset, M5 and M9 were sent when only a session was counted"}
]
```

Refuter counts: raised 3, refuted 0, P1 1, P2 1, P3 1, known 1
