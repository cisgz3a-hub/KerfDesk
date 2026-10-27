# Rolling audit v5 — Failure paths

- **When:** 2026-10-27   **Tree:** origin/main @ `19a05d355` (fetched 2026-10-27; still the newest
  `origin/main`, and the audit worktree's `src/` equals it)
- **Scope:** area J2 `failure-paths`, run app-wide. Every error during a job, Frame, jog, Fire,
  save or autosave was traced against four questions: is the beam or spindle off, is motion stopped
  or left safe, is the port released, and is the user told the truth with their work kept. Code
  read or exercised:
  - transports: `src/platform/web/worker-serial-connection.ts`, `native-serial-connection.ts`,
    `serial-wire.ts`, `bounded-writer-close.ts`, `electron/machine-network-*.ts`,
    `src/platform/electron/desktop-machine-network.ts`;
  - store failure handling: `laser-connection-actions.ts`, `laser-store-helpers.ts`
    (`buildPortClosePatch`), `laser-error-line.ts`, `laser-job-stop.ts`, `laser-disconnect-stop.ts`,
    `laser-fire-actions.ts`, `positioning-light-*.ts`, `laser-job-start-mark-*.ts`,
    `laser-frame-dispatch.ts`, `laser-frame-modal-restore.ts`, `laser-job-pause-resume.ts`,
    `unowned-controller-motion.ts`;
  - app shell: `App.tsx`, `crash-recovery.tsx`, `ErrorBoundary.tsx`, `desktop-close-*.ts`,
    `use-unload-stop.ts`, `use-active-job-wake-lock.ts`, `use-autosave.ts`, `autosave-loop.ts`,
    `use-job-checkpoint.ts`, `electron/renderer-crash-recovery.ts`;
  - saves: `web-adapter.ts`, `electron/desktop-project-save.ts`, `desktop-project-files.ts`,
    `project-save-completion.ts`, `save-tiled-gcode.ts`, `tile-folder-check.ts`;
  - workers: output preparation, the compilation pool, autosave and save preparation clients;
  - licensing (`EditionProvider.tsx`, `use-trial-expiry.ts`) and the remote hold dead-man
    (`machine-hold.ts`).

  Governing decisions: ADR-117, ADR-354, ADR-375 decision 10, ADR-392 Amd 2, ADR-482, ADR-548,
  ADR-549, ADR-561 Amd 3, ADR-634 and ADR-664.
- **Lenses run:** L6 (failure path) and L4 (interleavings: crash then failure, failure then
  reconnect, partial multi-file write). L2 only for the GRBL accessory report (one pinned source).
  The other lenses were skipped: they belong to the J1/J3/J5/J7/J9 fix areas and to J4/J6/J8/J10.
- **Counts:** 4 raised → 0 refuted → P1 0 / P2 3 / P3 1 (+ 7 KNOWN re-observed). The refuter
  confirmed all four and changed no severity. It narrowed J2-P2-1: its CNC "no off control" half is
  refuted (see Refuted), and the finding stands for laser profiles and for the close on both kinds.

## Headline

The transport and job-stream failure paths hold up well:
- a cable pull, a serial-worker crash and a write error all end in an honest notice;
- the beam is turned off by reset or acknowledged `M5`;
- the port is released.

The gaps are at the edges of that machinery:
- **Unowned output.** A laser that the controller reports on while idle, with no owner in KerfDesk,
  gets no LASER OFF or Abort anywhere. (A CNC spindle does get a "Stop spindle & coolant" button.)
  An ordinary close leaves either one running. The update-close twin already counts the same
  evidence as busy (J2-P2-1).
- **Crash screen.** Under the workspace crash screen, every safety notice is invisible. This
  includes the result of the crash screen's own ABORT (J2-P2-3).
- **Tile save.** A tile save cut short by a disk error leaves the earlier save's tiles under this
  save's file names, and nothing flags them (J2-P2-2).

## Findings

### J2-P2-1 — A laser the controller reports on at Idle, with no owner in KerfDesk, gets no off control, and closing KerfDesk leaves a laser or spindle on; the update close counts the same evidence as busy

(The refuter narrowed this heading: a CNC spindle has an off control. See Refuted.)
- **Where:**
  - `src/ui/app/desktop-close-runtime.ts:68-80`: `stopBeforeClose` acts only on a latched
    Fire, an active job, a motion operation or an unsafe controller operation.
  - `src/ui/app/desktop-close-runtime.ts:49-64`: the twin. `observedControllerBusy`, for the
    update close, treats `accessories.spindleCw || spindleCcw` as busy.
  - `src/ui/app/desktop-close-controller.ts:198-203`: web `bestEffortStop` needs `active || fireLatched`.
  - `src/ui/state/unowned-controller-motion.ts:29-41`: only Run/Jog/Home/Hold/Door count.
  - `src/ui/laser/LiveMotionBar.tsx:238-252` and `src/ui/laser/use-job-shortcuts.ts:89-110`:
    LASER OFF and Ctrl+. need `fireActive` or a motion state.
  - `src/ui/app/crash-recovery.tsx:22-30`: the crash-screen Abort uses the same test.
  - `src/ui/state/laser-connection-actions.ts:288`: a new connection sets `fireActive: false`
    whatever the controller reports.
- **Anchor:**
  - Twin: `observedControllerBusy` (above).
  - Contract: ADR-561 Amd 3 says the update close stays open for "observed external motion or
    spindle-on state".
  - Contract: ADR-375 decision 10 added Abort for unowned *motion*, because "Disconnect was the
    only one" stop. Unowned *output* at Idle was left out.
  - Contract: ADR-548 (Context) says a spindle or a constant-power laser "can stay on until the
    controller is reset".
  - Ground truth: gnea/grbl `report.c` @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`
    (`report_realtime_status`, L627-L646; the refuter corrected the auditor's "about L495-L511",
    which is the Door sub-state). The firmware prints `|A:` with `S` (CW) or `C` (CCW) whenever
    `spindle_get_state()` is non-zero, so KerfDesk holds direct evidence.
- **Scenario:** the controller reports `<Idle|…|FS:0,12000|Ov:100,100,100|A:S>` while KerfDesk
  owns nothing. Reachable ways to get there:
  - a CNC operator types `M3 S12000` in the Console to warm the spindle;
  - an opened G-code program ends lit (ADR-630 only warns, see KNOWN);
  - the renderer crashed or reloaded while Fire or the Falcon laser dot (ADR-664) was on, and the
    board did not reset on reconnect, so the new session starts with `fireActive: false`.

  What happens:
  - The Live Motion bar shows nothing, Ctrl+. does nothing and the crash screen offers no ABORT.
  - Closing the desktop app is approved at once, with no Abort, no `M5` and no warning. Web
    unload sends nothing either.
  - On a board that does not reset when the port closes, the spindle or beam keeps running
    unattended.
  - The update close refuses in the same state, so KerfDesk does know the machine is busy.
- **Evidence:** REPRO. The test used the real `parseStatusReport` → `statusPositionPatch` →
  desktop close protocol (`rendererCloseRequestScript`), as `desktop-close-runtime.test.ts` does.
  - Command: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/app/zz-j2-unowned-output.test.ts`.
  - Output: `{"accessorySpindleCw":true,"reportedSpindle":12000,"unownedMotion":null,"crashScreenAbortOffered":false,"updateClose":{"status":"cancelled"},"ordinaryClose":{"status":"ready","dirty":false},"approve":{"status":"approved"},"stopJobCalls":0,"fireOffCalls":0,"safetyNotice":null}`.
  - SOURCE: gnea/grbl `report.c` as cited in the anchor. Quote: `if (sp_state) { // != SPINDLE_STATE_DISABLE`.
- **Refuter:** CONFIRMED, narrowed to laser profiles for the off-control half. P2 kept.
  - **What would make it false:**
    - an off control that is already offered;
    - a close path that resets or sends `M5` anyway;
    - no reachable route to `A:S` at Idle.
  - **CNC half refuted.** On a CNC profile, `AccessoryResetControls` (`src/ui/laser/AccessoryResetControls.tsx:52-66`,
    mounted in the Machine rail by `JobControls.tsx:110-116`) appears at Idle whenever the
    retained `accessoryCache` shows a spindle or coolant on. It shows a `role="alert"` row,
    "Controller reports active: clockwise spindle", and a **Stop spindle & coolant** button that
    sends one `M5 M9` block. The auditor's CNC Console `M3 S12000` example therefore has an off control.
    The control is hidden for `machineKind === 'laser'`.
  - **Laser half holds.** On a laser profile no surface names the lit output. `StatusDisplay`
    shows only the reported `S:` value. The remaining stops are ones the operator has to think of:
    - Disconnect: on the GRBL family it sends the soft reset plus `M5`/`M9`
      (`laser-disconnect-transaction.ts:136-160`);
    - a Console `M5`, which is allowed in every state as fail-off recovery
      (`console-command-readiness.ts:15,111-118`).

    ADR-375 decision 10 called exactly this "Disconnect was the only one" and fixed it for motion.
  - **Reachable on GRBL laser mode.** In laser mode (`$32=1`), an `M3` block is not PWM
    rate-adjusted (`stepper.c` L738-L748: only `PL_COND_FLAG_SPINDLE_CCW` blocks are). When the
    segment buffer empties, GRBL turns the PWM off only for a rate-adjusted block (L393-L397). So
    the following leave the beam lit at Idle:
    - a program that ends after `M3` moves (the E4 note);
    - a Console `G1 M3 S…`;
    - a Fire or laser dot that a crashed renderer never turned off.
  - **Ground truth on what turns it off.** Only a reset or an `M5` turns it off: `mc_reset`
    says "Kill spindle and coolant" and calls `spindle_stop()` (`motion_control.c` L372-L374).
    All pinned at gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`.
  - **Close path.** `prepare` sets `wasActive` only for a job, a latched Fire or owned motion
    (`desktop-close-controller.ts:77-81`), so `stopBeforeClose` never runs, and `closeWarning` is
    null. Nothing in `electron/desktop-window-close.ts` or `main.ts` (`beforeClose` only detaches
    ArtCraft windows) sends `M5` or a reset.
  - **Refuter REPRO:** `src/ui/app/zz-j2r-unowned-output.test.tsx` (deleted). It used the real
    status parse, a real `JobControls` mount for both kinds, and the real close protocol.
    - Output: `{"laserKind":"laser","cacheSpindleCw":true,"unowned":null,"laserButtons":[],"cncButtons":["Stop spindle & coolant","ALERT:Controller reports active: clockwise spindle. …"],"update":{"status":"cancelled"},"prepared":{"status":"ready","dirty":false},"approved":{"status":"approved"},"stopJobCalls":0,"fireOffCalls":0}`.
  - **Severity: P2 kept, not P1.**
    - KerfDesk turns nothing on: every route begins with an operator action, or with a program
      whose lit end the Run review already warns about (E4). Closing leaves the controller in the
      state it already had.
    - The fault is a missing off control on laser profiles, plus a close that leaves both kinds lit.
      That is a broken contract with a clear failure scenario, against ADR-375 decision 10's
      rationale and the update-close twin.
  - **Novelty:** no earlier audit and no open PR touches these files.
- **Fix direction:**
  - Treat a reported spindle or laser output at Idle with no owner like unowned motion:
    - the Live Motion bar shows it with a LASER OFF / SPINDLE OFF button (`M5`, or the
      driver's tool-off lines);
    - Ctrl+. and the crash screen offer the same control.
  - Make the ordinary close send that `M5` before it approves, as it does for a latched Fire, or
    at least warn.

### J2-P2-2 — A tile set cut short by a write error leaves the earlier save's tiles under this save's names, and the warnings say nothing about them
- **Where:**
  - `src/ui/app/save-tiled-gcode.ts:196-212`: the first failed write stops the set.
  - `:110-118`: the toasts.
  - `:128-134`: `writtenOnly` drops the unwritten names from "replaced".
  - `src/ui/app/tile-folder-check.ts:35,55`: "earlier" excludes every name this save *planned*,
    so a stale file with a planned name is never listed.
  - `src/platform/web/web-adapter.ts:139-151`: a failed write over an existing entry keeps its old
    contents.
- **Anchor:**
  - Contract: ADR-392 Amd 2 item 4. The tiled save names the files it replaces and the earlier
    save's tiles "so an old tile with an `M0` is not cut by mistake".
  - Twin: `tileFolderWarnings` already says "These tile files in the folder are from an earlier
    save, not this one … so only this save's files are cut" (`tile-folder-check.ts:100-104`). It
    covers stale files only when their names differ from this save's.
  - Contract: WORKFLOW F-CNC tiling, "no-partial-output over the whole set" (preflight error).
- **Scenario:**
  1. The operator saves a tiled job to a USB stick, then edits the design and saves again into the
     same folder.
  2. The stick fills up on tile 2.
  3. The folder now holds a complete-looking set: `job_tile-r1-c2.nc` from this save and
     `job_tile-r2-c1.nc` from the previous design, under the same name.
  4. The toasts say "Could not write job_tile-r2-c1: …", "Saved 1 of 2 tile files." and "This save
     replaced 1 file(s) … job_tile-r1-c2.nc". All auto-dismiss after 8 s.
  5. Nothing says that the `r2-c1` in the folder is the old design. Cutting the set in index order
     cuts the old geometry, bit plan and depths for that tile: wrong physical output.
  6. A failure on the first tile leaves the whole earlier set in place, with "Saved 0 of N".
- **Evidence:** REPRO. The test ran the real `handleSaveTiledGcode` twice with a reserved
  directory: the first save filled the folder, and on the second the directory's second write
  rejected with a disk-full error.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/app/zz-j2-tile-partial.test.ts`.
  - Output: `{"tileNames":["job_tile-r1-c2.nc","job_tile-r2-c1.nc"],"folderAfter":{"job_tile-r1-c2.nc":"NEW 1343","job_tile-r2-c1.nc":"OLD design version"},"toasts":[{"message":"Could not write job_tile-r2-c1: There is not enough space on the disk.","tone":"error"},{"message":"Saved 1 of 2 tile files.","tone":"warning"},{"message":"This save replaced 1 file(s) already in the folder: job_tile-r1-c2.nc.","tone":"warning"}]}`.
  - The error toast names the failed file but not that an older file of that name is still there.
    So this is not a clear warning of the specific mismatch (METHOD §3), and the finding is P2,
    not P1, only because the failure itself is announced.
- **Refuter:** CONFIRMED. P2 kept.
  - **What would make it false:**
    - a failed write that truncates or removes the old file;
    - a warning that names the stale same-named files;
    - an atomic, all-or-nothing set.
  - **None holds.**
    - The real web adapter's directory target (`web-adapter.ts:139-151`) removes only an entry
      that this save created.
    - Under the File System spec, a writable's bytes reach the file only on `close()`, and
      `writeAndClose` aborts the stream on failure (`web-adapter.ts:260-273`). The old bytes
      therefore stay.
    - `saveTileFiles` stops at the first failure (`save-tiled-gcode.ts:196-212`).
    - `tileFolderContents` excludes every *planned* name from "earlier" (`tile-folder-check.ts:35,55`).
    - `writtenOnly` drops the unwritten names from "replaced" (`save-tiled-gcode.ts:128-134`).
  - **Wider than reported.** Every tile after the failed one also keeps the older design's
    contents. Those tiles are named nowhere: no toast names them, and the count is the only hint.
  - **Refuter REPRO:** `src/ui/app/zz-j2r-tile-partial.test.ts` (deleted). It ran the real
    `handleSaveTiledGcode` against the real `webAdapter.reserveSaveDirectory`, using a fake
    `showDirectoryPicker` handle with spec swap-file semantics. The folder held an earlier 4-tile
    set, and the second write failed with `QuotaExceededError`.
    - Output: `{"folder":{"job_tile-r1-c1.nc":"NEW design …","job_tile-r1-c2.nc":"OLD design …","job_tile-r2-c1.nc":"OLD design …","job_tile-r2-c2.nc":"OLD design …"},"toasts":[["Could not write job_tile-r1-c2: There is not enough space on the disk.","error"],["Saved 1 of 4 tile files.","warning"],["This save replaced 1 file(s) already in the folder: job_tile-r1-c1.nc.","warning"]]}`.
    - Control: with the same old folder and an unmocked 1-tile output, the three differently
      named old tiles *were* listed as "from an earlier save". The gap is only for planned names.
  - **Anchor check.** ADR-392 Amd 2 item 4 is quoted correctly. WORKFLOW's "no-partial-output
    over the whole set" covers only the preflight error. The governing WORKFLOW F-CNC19 text says
    the save names the replaced and earlier files and leaves earlier files intact.
  - **Severity: P2 kept, not P1.** The output is not silent. An error toast names the first failed
    file, and "Saved 1 of 4" says the set is incomplete, before any tile is cut. Neither says that
    files with this save's names are an older design, so it is not P3 either.
  - **Novelty:** no earlier audit and no open PR touches these files.
- **Fix direction:**
  - After a cut-short set, list every file in the folder with an unwritten planned name as "from
    an earlier save, not this one" (the existing wording).
  - Or write the set to temporary names and rename it only when every tile is written.
  - Do not delete user files silently.

### J2-P2-3 — Under the workspace crash screen no safety notice is shown, so a failed crash-screen ABORT, a lost link or an alarm during the job goes unannounced
- **Where:**
  - `src/ui/app/App.tsx:79-87`: the `ErrorBoundary` wraps `AppWorkspace`.
  - `App.tsx:125`: `LiveMotionBar` is inside the boundary.
  - `App.tsx:209`: `WorkspaceSafetyNotice`, in `CanvasArea`, is inside it too.
  - `src/ui/app/crash-recovery.tsx:52-60`: `CrashScreenHosts` mounts only `DesktopCloseNotice`,
    `ProjectSaveDialog` and `Toasts`.
  - `crash-recovery.tsx:31-37`: the crash-screen ABORT swallows `stopJob`'s rejection.
  - `src/ui/common/ErrorBoundary.tsx:134-144`: the button gives no result.
- **Anchor:**
  - Contract: ADR-634 (Context): "A safety notice must stay until acknowledged and must keep its
    recovery actions."
  - Twin: the 27-P2-2 fix (`App.tsx:68-70`) keeps the job protections mounted beside the boundary
    because "the job … keeps streaming under the crash screen". The notices those protections and
    the store raise were left inside the crashed subtree.
  - Contract: ADR-375 decision 10 gives the crash screen the software Abort, but the screen shows
    nothing of that Abort's outcome.
- **Scenario:**
  1. A render bug crashes the workspace mid-burn, and the job keeps streaming (by design since
     #1364).
  2. The operator clicks the crash screen's ABORT. The write fails, or the USB cable drops
     mid-job, or the controller alarms.
  3. The store raises its notice, for example "use physical E-stop or power cutoff now", or the
     unconfirmed-stop notice. None of them is rendered, and the ABORT click shows nothing either
     way.
  4. The operator can believe the Abort worked while the controller finishes buffered moves with
     the beam lit.
- **Evidence:** REPRO. The test mounted the real `App` in the harness of
  `App.crash-protections.test.tsx` and crashed one status-bar leaf. `stopJob` was stubbed to set
  the store's unconfirmed-stop notice and reject, as a failed Abort does.
  - Command: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/app/zz-j2-crash-notice.test.tsx`.
  - Output: `{"shownBeforeCrash":true,"crashed":true,"abortButton":true,"stopJobCalls":1,"abortNoticeShown":false,"linkLostShownAfterCrash":false,"storeNotice":"disconnect-during-job"}`.
  - In the control step, before the crash the same `disconnectDuringJobNotice` text renders.
- **Refuter:** CONFIRMED. P2 kept.
  - **What would make it false:**
    - the notice is mounted outside the boundary;
    - the store mirrors safety notices into toasts, which `CrashScreenHosts` does mount;
    - the crash screen re-renders with the Abort's outcome.
  - **None holds.**
    - `WorkspaceSafetyNotice` and `SafetyNoticeBanner` are mounted only in `CanvasArea`
      (`App.tsx:209`), which is inside the boundary.
    - No laser-store safety path calls `pushToast`. Only connect, forget and jog warnings do.
    - `CrashScreen` reads `isMotionLive()` only when it renders, and the boundary does not
      subscribe to the store.
  - **Refuter REPRO:** `src/ui/app/zz-j2r-crash-notice.test.tsx` (deleted). It used the
    `App.crash-protections` harness and the real `App`, `ErrorBoundary` and
    `machineSoftwareAbort`. The store notices were the real `disconnectDuringJobNotice()` and
    `writeFailedNotice('stop')`, which `settleResetWrite` sets on a closed port
    (`laser-job-stop.ts:340-353`).
    - Output: `{"shownBefore":true,"crashed":true,"abortOffered":true,"stopJobCalls":1,"failedShown":false,"domChangedAfterClick":false,"linkLostShown":false,"unhandled":0,"storeNotice":"disconnect-during-job"}`.
    - The ABORT click changes nothing in the DOM, and its rejection is swallowed (no unhandled
      rejection either).
  - **Is the beam off anyway?**
    - **Alarm:** yes. GRBL's alarm path runs `mc_reset`, which calls `spindle_stop()`
      (`motion_control.c` L372-L374 @ `bfb67f0c`). The missing alarm notice is informational.
    - **Failed ABORT or lost link:** no. Buffered moves run on. An `M3` (constant-power) block
      also keeps its PWM after the buffer drains (`stepper.c` L393-L397, as in J2-P2-1).
    - Only hovering ABORT shows its title, which names the physical E-stop.
  - **Mitigation found.** `DesktopCloseNotice` is in `CrashScreenHosts`, and `closeWarning`
    surfaces a `write-failed` stop notice. A desktop close attempt therefore does show it. Nothing
    shows it otherwise.
  - **Severity: P2 kept, not P1.** KerfDesk does not fire or move anything itself. The job is the
    operator's. The fault is a missing failure report in a two-fault state (a render crash plus a
    failed Abort or a lost link), with a misleading result: the click shows nothing.
  - **Novelty:**
    - Distinct from G7's crash-screen finding, which is that ABORT appears late for motion started
      after the crash.
    - Distinct from 27-P2-2, which restored the protections and not the notices.
    - No open PR touches these files.
- **Fix direction:**
  - Mount the safety notice (and ideally `LiveMotionBar`) beside the boundary, or in
    `CrashScreenHosts`.
  - Have the crash-screen ABORT show "Abort requested" or the failure, instead of
    `.catch(() => undefined)`.

### J2-P3-1 — A desktop Save over an OS-opened project that fails for a full disk says the file "may be read-only or open in another program"
- **Where:**
  - `electron/desktop-project-save.ts:41-46`: every error except too-large becomes `'failed'`, and
    the cause goes only to `console.warn`.
  - `electron/desktop-project-routes.ts:122-123`: the route answers 500.
  - `src/platform/electron/desktop-project-files.ts:120-125`: the 500 message.
- **Anchor:** the L6 contract "the user is told the truth". Twin: the web path reports the
  platform's own error text (`project-save-completion.ts:52-57`, "Could not save project:
  <message>").
- **Scenario:**
  1. Disk full (`ENOSPC`) or a quota while saving over a project opened from Explorer (ADR-550).
  2. The original file stays whole, because the temporary file is removed (verified).
  3. The operator is told the file may be read-only or open in another program.
  4. They close other programs and retry, or Save As onto the same full disk. Neither helps.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (a main-side REPRO plus a READ of the route and the message). P3 kept.
  - **What would make it false:** the route or the renderer carries the `ENOSPC` cause through.
    Neither does.
  - **Refuter REPRO:** `electron/zz-j2r-enospc.test.ts` (deleted). It ran the real
    `saveDesktopProjectFile`, with `rename` rejecting `ENOSPC`.
    - Output: `{"result":"failed","original":"ORIGINAL","left":["p.lf2"]}`. The original file is
      whole and the temporary file is removed.
  - **The rest of the chain, read:**
    - `'failed'` → 500 (`desktop-project-routes.ts:122-123`) → `saveFailureMessage` → "KerfDesk
      could not write the file. It may be read-only or open in another program."
      (`desktop-project-files.ts:120-125`).
    - The web twin shows the platform's text (`project-save-completion.ts:52-57`).
  - **Severity: P3.** The wording is hedged ("may be") and no data is lost.
- **Fix direction:** Map `ENOSPC`/`EDQUOT` to a "the disk is full" kind (and `EACCES`/`EPERM` to
  read-only) in the route reply, and word the message from that kind.

## KNOWN (re-observed, not re-raised)

- **27-P3-1.** Web tab close during Frame, jog, Home or Probe sends no stop. `bestEffortStop`
  (`desktop-close-controller.ts:198-203`) is unchanged. J2-P2-1 is the output-at-Idle cousin.
- **04-P3-20.** The Electron renderer-crash prompt (`electron/renderer-crash-recovery.ts:45-55`)
  still does not say that a constant-power beam or spindle may stay on. J2-P2-1's reload route
  depends on it.
- **04-P3-23 and D7-P3-1.** The TCP bridge session outlives a crashed renderer for 15 s, and the TCP
  read loop has no subscriber isolation and a fatal UTF-8 decode
  (`desktop-machine-network.ts:32,118-127`).
- **27-P3-5.** An autosave failure is a one-time 8 s toast (`use-autosave.ts:46-54`).
- **ADR-373 residual / C3 note.** A `$J=` jog keeps the modal `M3` and `S`, so a jog from
  J2-P2-1's state burns.
- **E4 note.** An opened program that ends lit is only warned before the run.
- **ADR-664.** The laser dot's 30 s auto-off runs in the renderer, "while the app and connection
  remain responsive" (`positioning-light-on.ts:103`). A crash leaves the dot at its power.

**Refuter spot-check:** every KNOWN item above is still present on this tree.
- `bestEffortStop` still needs `active || fireLatched`.
- The renderer-crash prompt's detail (`renderer-crash-recovery.ts:45-55`) still names only
  streaming and moves.
- The bridge lease is still `15_000` ms (`machine-network-bridge.ts:64`), and the decoder is still
  `fatal: true` (`desktop-machine-network.ts:32`).
- `createAutosaveFailureReporter` still warns once.
- ADR-373 still lists the modal-spindle residual risk (L75-L76).
- `toolLeftOnWarnings` (`external-program-review.ts:359-372`) only warns. The JSON line for E4 is
  corrected to 361.
- The laser-dot log text matches.
- Each ID exists in its source report: rolling-v2 `27-app-shell.md` P3-1/P3-5, `04-electron-main.md`
  P3-20/P3-23, and controller-v3 `D7-ctl-network-link.md` D7-P3-1.

## Refuted

Refuter (part of a finding):
- **J2-P2-1, CNC half: "a spindle reported on at Idle gets no SPINDLE OFF".** This is false on a
  CNC profile. `AccessoryResetControls` shows, at Idle, "Controller reports active: clockwise
  spindle" as a `role="alert"` row, with a **Stop spindle & coolant** button that sends `M5 M9`.
  The refuter's REPRO rendered it from the same retained `A:S` evidence. J2-P2-1 keeps its ID for
  the laser-profile half and for the close, which still sends no `M5` on either kind.

Candidates the auditor dropped:
- **Autosave never runs during a job** (`autosave-loop.ts:95`, `if (snap.isStreaming) return;`).
  A renderer crash mid-job therefore loses every edit since Start. Dropped as disclosed: Settings
  says autosave runs "except while a job is running" (`SettingsGeneralSection.tsx:34-36`).
  H7 lists the policy as an open question.
- **Smoothieware Frame `M121` pop forgotten after a reconnect.** `connectionScopedEvidenceReset`
  (`laser-module-probe.ts:50-55`) clears it on purpose ("another board may be on the other end").
  The only effect is a slower `G0` seek rate. No wrong burn, position or depth.
- **A blocked second Fire activation clears the latch while the beam is lit**
  (`rejectFireActivation`, `laser-fire-actions.ts:317-324`). Unreachable from the UI:
  - the only caller is `MomentaryFireControl`;
  - it ignores key repeat and an already-held press;
  - it disables itself on every block condition that can change while lit (`MomentaryFireControl.tsx:29-35,129-145`).
- **A wedged USB write starves Abort's `0x18` with no bound.** During a job the stream heartbeat
  and the bounded writer close (`bounded-writer-close.ts`) bound it. Not raised without hardware
  evidence.
- **Licence lapse mid-job unmounts job controls.** No job, Frame, Abort or tool-change surface
  is edition-gated: `useEdition` appears only in authoring, camera setup and trace UI. A trial
  expiry "refreshes the edition … without closing an open tool or workspace"
  (`use-trial-expiry.ts:5`).

## Verified clean

- **USB unplug mid-stream, mid-Frame, mid-jog, mid-pause, during Fire:**
  - The unexpected `onClose` publishes an incident and applies `buildPortClosePatch`
    (`laser-store-helpers.ts:430-503`).
  - The stream is marked disconnected and the frame proof is cleared.
  - The notice depends on what was running: a job, motion or Fire each gets its own
    "may still be moving / beam on, use E-stop" notice, naming the link.
- **Serial worker crash (ADR-354):** `fail()` terminates the worker before it notifies the store,
  so no fallback can duplicate its writes. The focused test `native-serial-connection.test.ts -t
  "worker crashes"` passed on this tree. A hosted-refill write error goes to
  `containActiveStreamWriteFailure` (`laser-connection-actions.ts:151-154`).
- **Frame line write failure:**
  - The operation becomes `cancelRequested`.
  - The completed Frame, framed-run permit and trace are cleared (`laser-frame-dispatch.ts:49-59`).
- **Fire off and the laser dot:**
  - The latch drops only after an acknowledged `M5` (`laser-fire-actions.ts:100-111`). A failed
    off keeps LASER OFF.
  - The dot's auto-off retries every second and logs. GRBL Disconnect always resets.
  - A desktop close turns Fire off first.
- **Start mark failure:** the operation goes to `uncertain`, the frame proof is reset and `stopJob`
  runs (`laser-job-start-mark-actions.ts:225-252`).
- **Saves:**
  - A desktop save over an OS-opened project writes a temporary file and renames it. The temp file
    is removed on any failure, so the original stays whole.
  - Web saves abort the writable on failure, and a directory target removes an entry it created.
  - `failProjectSave` never marks the project saved.
- **Out of memory in compile and workers:**
  - Output preparation, the compilation pool, autosave and save preparation reject every pending
    caller on `onerror`/`onmessageerror`.
  - Start and Save show an infrastructure failure instead of hanging.
- **Relay outage:** the PC owns the hold dead-man, 600 ms (`machine-hold.ts:20-24`).
- **GPU context loss:** the camera bed overlay prevents default on `webglcontextlost`, rebuilds on
  restore and reports `lost` (`bed-overlay-renderer.ts:70-114`). The bit preview and Cut 3D
  renderer fail visibly.

## Not verified

- **OS sleep and resume mid-job** on real hardware: whether the USB port survives, and what GRBL
  does while starved. ADR-548 states that a forced sleep ends the connection, and nothing in
  `electron/` uses `powerMonitor` or `powerSaveBlocker`. The screen wake lock (ADR-117) stays
  held while minimised, because `backgroundThrottling` is false.
- **Which shipping boards keep the spindle or beam on when the port closes.** This is J2-P2-1's
  reach: DTR auto-reset boards reset, native-USB grblHAL and FluidNC usually do not.
  - Refuter note, UNVERIFIED (no hardware, no schematic fetched): the classic Arduino auto-reset
    pulses RESET when DTR is *asserted*, at port open. If so, an Uno-class GRBL board keeps the
    output on when KerfDesk closes, and resets only at the next Connect. The reach would then be
    wider than this line says.
  - KerfDesk itself sends no reset when it connects (`laser-controller-handshake.ts:79-111` sends
    only `?` and the queries).
- **Real renderer OOM, a GPU-process crash in Electron**, and three.js restoring the main 3D
  viewers after context loss.
- **Chrome Memory Saver** discarding a web tab with an open Web Serial port.
- **`error:N` and `ALARM:N` at every phase on Marlin and Smoothieware.** The GRBL paths were
  re-read. For the others this audit relied on rolling-v2 05/18 and controller audits v2–v4.
- **Repro files.** They were run and deleted from the tree. Copies are in
  `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j2-repros\`.
  To re-run one, copy it back as `src/ui/app/zz-j2-<name>.test.ts(x)`, dropping `.txt`.

```json
[
  {"id":"J2-P2-1","severity":"P2","area":"failure-paths","file":"src/ui/app/desktop-close-runtime.ts","line":68,"anchor":"Twin: observedControllerBusy (desktop-close-runtime.ts:49-64) counts A:S/A:C as busy for the update close; Contract: ADR-561 Amd 3 ('observed external motion or spindle-on state'), ADR-375 decision 10 (unowned motion only), ADR-548 Context; Ground truth: gnea/grbl report.c @ bfb67f0c L627-L646 prints |A:S when spindle_get_state() is non-zero","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CNC half refuted: AccessoryResetControls shows 'Stop spindle & coolant' (M5 M9) at Idle on CNC from the same A:S cache; laser profile has no off control (only Disconnect's reset or a Console M5); close never runs stopBeforeClose. Own REPRO (JobControls both kinds + real close protocol); GRBL bfb67f0c stepper.c L393-L397/L738-L748 keeps M3 PWM at Idle, motion_control.c L372-L374 reset kills it. P2 kept: KerfDesk turns nothing on.","known":false,"summary":"A laser reported on at Idle with no owner in KerfDesk gets no LASER OFF, Ctrl+. or crash-screen Abort (a CNC spindle does get Stop spindle & coolant), and an ordinary desktop close (or web unload) approves with no M5 on either kind while the update close refuses for the same state"},
  {"id":"J2-P2-2","severity":"P2","area":"failure-paths","file":"src/ui/app/tile-folder-check.ts","line":55,"anchor":"Contract: ADR-392 Amd 2 item 4 ('so an old tile with an M0 is not cut by mistake'); Twin: tileFolderWarnings 'from an earlier save' covers only differently named files; WORKFLOW tiling no-partial-output","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO with real webAdapter.reserveSaveDirectory and spec swap-file semantics: 4-tile set, write 2 fails, folder keeps 3 OLD tiles under this save's names; toasts name only the failed one plus 'Saved 1 of 4'. Later unwritten tiles are named nowhere. P2 kept: failure announced, stale same-named files not.","known":false,"summary":"A tiled save cut short by a write error (disk full) leaves the earlier save's tiles under this save's names (the failed tile and every later one); the toasts name only the first failed write and the replaced files, never the stale same-named tiles"},
  {"id":"J2-P2-3","severity":"P2","area":"failure-paths","file":"src/ui/app/crash-recovery.tsx","line":52,"anchor":"Contract: ADR-634 Context ('A safety notice must stay until acknowledged'); Twin: 27-P2-2 fix keeps protections beside the boundary (App.tsx:68-70) but WorkspaceSafetyNotice and LiveMotionBar stay inside it; ADR-375 decision 10 crash-screen Abort","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO on real App/ErrorBoundary: real disconnectDuringJobNotice and writeFailedNotice('stop') render before the crash, not after; ABORT click changes no DOM, rejection swallowed. No store safety path pushes a toast. Alarm path is beam-off by firmware (mc_reset); failed Abort and link loss are not. Only a desktop close attempt shows the write-failed warning. P2 kept.","known":false,"summary":"Under the workspace crash screen no safety notice renders: a failed crash-screen ABORT (rejection swallowed), a lost link or an alarm during the still-streaming job is never shown"},
  {"id":"J2-P3-1","severity":"P3","area":"failure-paths","file":"src/platform/electron/desktop-project-files.ts","line":124,"anchor":"Twin: web save reports the platform error text (project-save-completion.ts:52-57); L6 truthful message","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own REPRO of saveDesktopProjectFile with ENOSPC rename: 'failed', original whole, temp removed; route 500 maps to the read-only/open-elsewhere message. P3 kept.","known":false,"summary":"A desktop save over an OS-opened project that fails for a full disk is reported as 'may be read-only or open in another program'; the real cause stays in the main-process console"},
  {"id":"K-27-P3-1","severity":"P3","area":"failure-paths","file":"src/ui/app/desktop-close-controller.ts","line":200,"anchor":"Twin desktop stopBeforeClose","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: bestEffortStop still requires active || fireLatched","known":"rolling-v2 27-P3-1","summary":"Web unload sends no stop for Frame/jog/Home/Probe"},
  {"id":"K-04-P3-20","severity":"P3","area":"failure-paths","file":"electron/renderer-crash-recovery.ts","line":45,"anchor":"ADR-482","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: rendererGonePrompt detail still names only streaming and buffered moves","known":"rolling-v2 04-P3-20","summary":"Renderer-crash prompt omits that a constant-power beam or spindle may stay on"},
  {"id":"K-04-P3-23","severity":"P3","area":"failure-paths","file":"electron/machine-network-bridge.ts","line":63,"anchor":"Lease","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: lease still setTimeout 15_000 at machine-network-bridge.ts:64","known":"rolling-v2 04-P3-23","summary":"TCP bridge session outlives a crashed or reloaded renderer for 15 s"},
  {"id":"K-D7-P3-1","severity":"P3","area":"failure-paths","file":"src/platform/electron/desktop-machine-network.ts","line":32,"anchor":"Twin serial read loop","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: TextDecoder('utf-8', { fatal: true }) still at desktop-machine-network.ts:32","known":"controller-v3 D7-P3-1","summary":"TCP line delivery has no subscriber isolation and a fatal UTF-8 decode"},
  {"id":"K-27-P3-5","severity":"P3","area":"failure-paths","file":"src/ui/app/use-autosave.ts","line":46,"anchor":"Settings promise","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: createAutosaveFailureReporter still warns once","known":"rolling-v2 27-P3-5","summary":"Autosave failure is a one-time 8 s toast"},
  {"id":"K-ADR373","severity":"P3","area":"failure-paths","file":"src/ui/state/laser-jog-actions.ts","line":1,"anchor":"ADR-373 residual risk","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: ADR-373 L75-L76 still lists the modal-spindle residual risk","known":"controller-v2 C3 KNOWN note","summary":"A $J= jog keeps modal M3/S, so a jog from a lit Idle state burns"},
  {"id":"K-E4","severity":"P3","area":"failure-paths","file":"src/core/external-program/external-program-review.ts","line":361,"anchor":"ADR-630","evidence":"READ","verdict":"CONFIRMED","refuter":"Spot-check: toolLeftOnWarnings (external-program-review.ts:359-372) only warns; line corrected 309 -> 361","known":"controller-v4 E4 note","summary":"An opened program that ends lit is warned only"}
]
```
