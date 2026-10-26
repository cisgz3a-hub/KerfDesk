# Rolling audit v2 — Controllers delta

- **When:** 2026-10-21 23:10 +0800   **Tree:** origin/main @ `902f1d0c0` (worktree HEAD
  `639ff4216`; `git diff HEAD origin/main -- src` is empty).
- **Scope:** only code changed since the five controller audits of 2026-10-16 to 2026-10-20, in
  `src/core/controllers/**`, `src/core/devices/**` and the controller part of `src/ui/state/**`
  and `src/ui/laser/**`. `src/ui/machine/**` (CNC bit library) had no controller change. The
  merged PRs in scope:

  | PR | ADR | What changed |
  |---|---|---|
  | #1305 | ADR-640 | Jog cancel waits for owed replies on every driver; a missing reply no longer locks Disconnect |
  | #1315 | ADR-644 | EEPROM-writing lines stream alone (P-1); alarms judged per firmware (P-5); grblHAL/FluidNC `Pn:` E, M, F (P-6) |
  | #1328 | ADR-611 Amd 2 | Status line shows "Connecting…"/"Reading settings…"; toast only for news; new titles (F-5, F-9) |
  | #1333, #1338 | ADR-648 | `$$`/`$I` snapshot kept across KerfDesk's own resets; `$G`-only re-read (D-5) |
  | #1296 | ADR-635 | Falcon A1 Pro red pointer over HTTP (state side; the bridge was audited in area 04) |
  | #1294 | ADR-639 | Quiet auto-connect, Disconnect pause, motion-only lost-link banner (F-1..F-3) |
  | #1300 | ADR-637 | Machine Setup picker (UI; checked only where it touches controller/profile data) |

  The design audit (`9c6e6a3d8`) already contains #1294, #1300, #1310, #1315 and #1275; this
  audit re-checked the fixes they claim and audited #1305, #1296, #1328, #1333 and #1338 in full.
- **Lenses run:** L1, L2, L3, L4 (interleavings) and L7, as separate passes in one session (no
  subagents, to keep machine load low). L5 skipped: the Falcon pointer bridge is area 04's and
  already reported there. L6 only where a fix changed a failure path (Cancel failure, reset banner
  window).
- **Counts:** 3 raised → refuter: 3 confirmed, 0 plausible, 0 refuted → P1 0 / P2 0 / P3 3
  (+ 4 KNOWN re-observed). No severity changes.

## Headline

The five fixes do what their ADRs and findings say, and the protocol facts they rest on hold
against primary sources: stock GRBL and FluidNC act on `0x85` only while jogging and flush
nothing, grblHAL flushes unparsed input on `0x85` in every state, GRBL loads settings once at
power-up so a soft reset keeps them, FluidNC feed-holds before its soft-limit alarm, and the
grblHAL/FluidNC `Pn:` letters E, M and F mean what ADR-644 says. ADR-648 is the riskiest change
and holds up: every scheduler entry that could take the new `$G`-only path either follows an owned
reset banner or a new session, and every write path (Console, settings, macros, a job program)
retires the snapshot before the bytes go out. What is left is small: the new status line says
"Reading settings…" for as long as the machine sits in Alarm after an Abort or a homing-machine
connect (nothing is being read; F-4 is the root cause); GRBL's ignored `/` block-delete lets
`/$RST=*` past the Console's persistent-command block and leaves `$$` stale after `/$30=…`, which
#1338 itself recognised only in the ADR-648 classifier; and ADR-640's Disconnect escape exists on
the machine rail but not in the menu or command palette.

## Findings

### P3-1 — "Reading settings…" stays on (amber) while qualification only waits for the operator to clear an Alarm

- **Where:**
  - `src/ui/laser/ConnectionBar.tsx:338-353`: `connectionStatusText` maps the qualifying phase
    `reset-cleanup` to "Reading settings…", and `:103` turns the dot amber for any qualifying
    phase.
  - `src/ui/state/laser-line-handler.ts:396`: every banner, including the one that closes
    KerfDesk's own Abort reset, sets `qualifyingController(nextSessionEpoch, 'reset-cleanup')`.
    `resumeQualificationInSession` does the same for an Alarm met during the connect handshake
    (`laser-controller-qualification.ts:217`).
  - `src/ui/state/machine-settings-read-readiness.ts:55-56`: the automatic read waits for Idle.
  - `src/ui/state/laser-controller-qualification-wait.ts:58`: each Alarm report pushes the
    deadline out, so the phase never ends while the controller answers Alarm.
- **Anchor:** Contract. ADR-611 Amendment 2: "Reading settings… (after a reset, and while `$$`
  runs) … turns to Connected when the read ends". WORKFLOW "Controller qualification" (line
  3336): "While the read runs, the status beside the dot reads … 'Reading settings…'". Ground
  truth: GRBL raises `ALARM:3` on a reset during motion, and with `HOMING_INIT_LOCK` a homing
  machine boots in Alarm (`grbl/main.c`: "if HOMING_INIT_LOCK … sys.state = STATE_ALARM").
- **Scenario:**
  1. Abort a running job on stock GRBL. The reset lands mid-motion, GRBL reboots into
     `ALARM:3`, and the banner sets phase `reset-cleanup`.
  2. ADR-648 keeps the `$$` snapshot, so there is nothing to read except `$G`, and that waits for
     Idle.
  3. Until the operator presses Unlock or Home, the connection status reads "Reading settings…"
     with an amber dot, although no read is running or queued.
  4. The same happens on every connect to a machine with homing enabled, because it boots locked
     in Alarm.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-17-reading-settings-alarm.test.ts`.
  - The test uses the real `scheduleControllerQualification` with fake timers, and feeds an Alarm
    report every second for 120 s.
  - Output: the test passed, which asserts that the qualification run was never called and that
    `connectionStatusText({kind:'connected'}, qualification)` returned `'Reading settings…'`.
  - Novelty: the root cause, no automatic read while in Alarm, is KNOWN as F-4 (2026-10-19,
    re-listed open by the design audit §4). This status-line wording is new from #1328. The popover
    copy F-4 named ("Controller reset detected. Waiting to read…") is a different surface.
- **Refuter:** CONFIRMED (P3 unchanged).
  - Reproduced on its own (`zz-17r-reading-settings.test.ts`, deleted). The real
    `scheduleControllerQualification` was fed an Alarm report every second for 600 s. It never ran
    the read, the phase stayed `reset-cleanup`, and `connectionStatusText` returned
    "Reading settings…". `resumeQualificationInSession` for a handshake that met Alarm gives the same.
  - Ground truth re-fetched at gnea/grbl `bfb67f0`:
    - `main.c` boots into `STATE_ALARM` under `HOMING_INIT_LOCK`, which `config.h` enables by default.
    - `main.c` keeps `prior_state` across the reset loop.
    - `mc_reset` raises `EXEC_ALARM_ABORT_CYCLE` during motion.
  - Nothing in `src/ui/state` sends `$X` by itself, and the status poll keeps answering in Alarm,
    so the deadline never lapses.
  - Novelty caveat: F-4's own fix line, "add a `waiting-idle` phase or message for the Alarm case",
    would cover this surface too. The coordinator may fold this finding into F-4.
- **Fix direction:** Map a `reset-cleanup` wait whose latest report is Alarm to something true,
  such as "Connected — locked (Alarm)" with the ordinary dot. Show "Reading settings…" only while
  a read operation is in flight. Fixing F-4 (read `$$`/`$G` in Alarm) would also remove the wait.

### P3-2 — GRBL's ignored `/` lets `/$RST=*` past the Console block, and `/$30=…` leaves the `$$` snapshot stale

- **Where:**
  - `src/core/controllers/grbl/console-command.ts:79-90`. `compact` is space-stripped only when
    the line starts with `$`. `isBlockedPersistentCommand` (`:227-233`) and `SETTING_WRITE_RE`
    test `^\$`, so a leading `/` makes the line ordinary `gcode`.
  - Twin, changed in #1338: `src/core/controllers/grbl/eeprom-write-line.ts:52-54`.
    `settingCommand` strips a leading `/` because "Stock GRBL also ignores `/` (block delete) as
    it reads a line", so `isStoredSettingWriteLine('/$30=500')` is true.
  - The same file's `isEepromWriteLine` (`:18-27`, ADR-644) does not strip `/`, so it returns
    false for the same line.
- **Anchor:**
  - Ground truth: gnea/grbl `protocol.c` `protocol_main_loop` reads `} else if (c == '/') {` /
    "Block delete NOT SUPPORTED. Ignore character.", then dispatches on
    `line[0] == '$'` to `system_execute_line`.
  - Twin: `isStoredSettingWriteLine` against the Console classifier and against
    `isEepromWriteLine`.
  - Contract: the Console's block on `$RST=`, `$N…=`, `$I=` and `$DWNGRD` ("This persistent
    controller command is blocked in the Console"). ADR-375 C-4: a setting write is re-read with
    `$$`.
- **Scenario:** On stock GRBL, the operator types `/$RST=*` in the Console or saves it as a
  macro.
  1. `$RST=*` is refused, but `/$RST=*` is accepted as `gcode` and sent.
  2. GRBL drops the `/` and wipes every setting, offset and startup line.
  3. `/$32=0` or `/$30=500` is likewise sent as plain G-code. No `grblSettingWriteEvidencePatch`
     and no `$$` re-read follow.
  4. Controller info, Home's timeout bound and Job Review's `$30`/`$32` advisory keep reading the
     old values for the rest of the session. ADR-648 correctly refuses to carry the snapshot over
     the next reset, because its own classifier saw the write.
  5. In a job stream the `/` gap in `isEepromWriteLine` is latent. External programs are
     canonicalized, with `/` removed, before streaming (`normalize-external-program.ts:192-197`),
     and KerfDesk's own programs carry no `$` lines.
  6. Needs deliberate input with a leading `/`.
- **Evidence:** REPRO and SOURCE.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/core/controllers/grbl/zz-17-block-delete.test.ts`.
  - The test passed, asserting:
    - `prepareConsoleCommand('$RST=*').ok === false`, while `/$RST=*` is `ok` with kind `gcode`.
    - `/$30=500` is kind `gcode`.
    - `isStoredSettingWriteLine('/$30=500') === true` and `isEepromWriteLine('/$30=500') === false`.
    - `step(createStreamer('G0 X1\n/$30=500\nG0 X2\n'))` sends all three lines in one window.
  - SOURCE: https://raw.githubusercontent.com/gnea/grbl/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c.
    grblHAL does not drop `/` at line collection (`protocol.c` @ `d7aaee3d`), so this is stock
    GRBL only.
  - Novelty: no earlier audit names block delete. `console-command.ts` is unchanged since
    2026-09-29; it is raised here because #1338 made the twin explicit.
- **Refuter:** CONFIRMED (P3 unchanged).
  - Primary source fetched: gnea/grbl `protocol.c` @ `bfb67f0`, in `protocol_main_loop`.
    - It drops `/` wherever it appears in a line ("Block delete NOT SUPPORTED. Ignore character.").
    - This happens before the `line[0] == '$'` dispatch.
    - `system.c` then runs `$RST=*` as `settings_restore(SETTINGS_RESTORE_ALL)`.
  - Repro (`zz-17r-block-delete.test.ts`, deleted):
    - `$RST=*` is refused.
    - `/$RST=*`, `/ $RST = *`, `/$N0=G20` and `/$I=x` are all `ok`, with kind `gcode` and no
      confirmation.
    - The repo's own `canonicalLine`, its model of what GRBL collects, turns each of them into the
      blocked form.
  - The hole is wider than reported, in two ways:
    - A slash inside the command passes too (`$/RST=*`, `$RST/=*`), because the `$` checks run on
      a form that still contains the `/`.
    - `/$30=500` also skips the setting-write confirmation and the `consoleSettingWriteIssue`
      value check.
  - grblHAL is not affected:
    - `d7aaee3d` `protocol.c` has no `/` case at line collection.
    - `gcode.c:1099-1104` handles a leading `/` inside the G-code parser, so the `$` command never
      runs.
  - Severity stays P3, because every path needs an operator to type a `/` into the Console or a
    macro on purpose. Opened programs are canonicalized, so no file or generated path reaches it.
  - Fix caution: the GRBL classifier is shared with the grblHAL and FluidNC drivers, and FluidNC
    keys contain `/` (for example `$Sta/SSID`). Strip `/` only for classification, not from the
    wire, or only in the stock GRBL driver.
- **Fix direction:**
  - Classify Console and macro lines from the form GRBL collects: drop `/` and blanks the way
    `canonicalLine` in `normalize-external-program.ts` does, before the `$` checks.
  - Strip a leading `/` in `isEepromWriteLine` too, so the three classifiers agree.

### P3-3 — ADR-640's Disconnect escape exists only on the machine rail; the menu and command-palette Disconnect stay disabled

- **Where:**
  - `src/ui/commands/use-app-commands.ts:218-222`: `machineBusy` is true for any
    `motionOperation !== null`.
  - `src/ui/commands/laser-command-family.ts:23`: `laser.disconnect` is enabled only when
    `!ctx.machineBusy`.
  - The rail exempts the case: `src/ui/laser/ControllerConnectionControls.tsx:156-172`, through
    `motionOwnerAwaitsMissingReply` (`src/ui/state/laser-motion-release.ts:40-48`). The safety
    banner's Reconnect does too (`WorkspaceSafetyNotice.tsx:25-27`).
- **Anchor:**
  - Contract: ADR-640 Decision 2, "When a cancelled motion owner … still owes a reply, and the
    controller reports Idle, Disconnect and Connect stay available".
  - Contract: Decision 3's message, which tells the operator to "Disconnect and connect again to
    clear it".
  - Twin: the rail's `connectionControlsBusy(…, missingReply)` against the command family's
    `machineBusy`.
- **Scenario:**
  1. On a grblHAL board, a quick jog release loses the jog's reply.
  2. Cancel fails with ADR-640's message.
  3. The controller reports Idle, so the rail's Disconnect is enabled.
  4. The menu and palette **Disconnect** stay disabled with "Machine is busy. Use the machine
     panel controls first." Nothing is unsafe, because the rail works, but the two surfaces
     disagree on the state ADR-640 was written for.
  5. The phone's Disconnect is also refused (`remote-control/machine-actions.ts:110-118`). That is
     consistent with its ADR-585 contract ("disconnect refused during a job or motion"), so it is
     noted, not raised.
- **Evidence:** READ. The two predicates are evaluated on the same store fields. With
  `motionOperation` an abandoned owner, `pendingUntrackedAcks: 1` and `statusReport.state: 'Idle'`,
  `connectionControlsBusy(op, null, true)` is false, while `machineBusy` is true. Novelty: not in
  ADR-640's verification list, any audit, or open PRs.
- **Refuter:** CONFIRMED (P3 unchanged).
  - Reproduced with the real `useAppCommands` hook (`zz-17r-disconnect.test.tsx`, deleted). The
    state was an abandoned jog owner, `pendingUntrackedAcks: 1` and an Idle report.
  - In that state, `motionOwnerAwaitsMissingReply` is true and `connectionControlsBusy` is false.
    Even so, `laser.disconnect` is disabled with "Machine is busy…".
  - The two always disagree. The exemption requires `motionOperation !== null`, and that alone
    sets `machineBusy`.
  - `AppMenuBar` renders the `laser` family, so the disabled item is a visible surface.
  - ADR-640 Decision 2 says Disconnect and Connect stay available, without limiting that to the
    rail.
- **Fix direction:** Compute the command family's Disconnect availability with the same exemption,
  for example by reusing `connectionControlsBusy` and `motionOwnerAwaitsMissingReply`.

## Refuted

Candidates this audit raised and dropped itself. The refuter moved no finding here: all three were confirmed.

- **#1338 broadened the `$G`-only path to every scheduled qualification, so a session whose `$$`
  went stale after a write could be marked verified.** Dropped.
  - Every scheduler entry either follows a banner or claim that bumps the session epoch
    (`laser-line-handler.ts:362`, `invalidateControllerSessionEvidence`), or runs before any `$$`
    of the session (handshake, `awaitPolledQualification`).
  - Numeric `$N=` writes clear the snapshot first (`grbl-settings-evidence.ts:24`), and so does a
    Console `$$` (`laser-console-completion.ts:36-47`).
  - The operator's Retry calls the full read (`laser-store.ts:551`).
- **ADR-640 delays the stop on stock GRBL by up to 8 s, because the byte waits for transport
  writes.** Dropped. Writes are FIFO on both the window and worker transports, with no realtime
  priority lane in `src/platform/web`, so the byte could never overtake a pending write. On a
  running hold jog the `$J=` was acknowledged long before the release, so the byte goes at once.
- **A banner from a power-glitch reboot that lands inside the 500 ms window is taken as the owned
  reset's, and keeps the snapshot.** Dropped as harmless. EEPROM settings survive a power cycle
  too, and any write since the read has already disabled retention.
- **`isBuildInfoWriteLine` misses FluidNC `$Build/Info=…`.** Dropped. FluidNC answers
  `InvalidStatement` to any value (`ProcessSettings.cpp` `get_report_build_info`), so `$I` cannot
  be written there.

## Verified clean

- **ADR-640 ground truth.**
  - Stock GRBL: `serial.c` acts on `CMD_JOG_CANCEL` only `if (sys.state & STATE_JOG)`. The jog
    cancel at cycle stop runs `plan_reset`/`st_reset` and never `serial_reset_read_buffer`
    (`protocol.c`).
  - FluidNC v4.0.3: `RealtimeCmd.cpp` sends `motionCancelEvent` only `if (state_is(State::Jog))`.
    `protocol_do_cycle_stop` flushes the planner, not RX.
  - grblHAL `d7aaee3d` `protocol.c`: `CMD_JOG_CANCEL` always runs `clear_line` and
    `hal.stream.cancel_read_buffer()`; motion cancel from the byte is under `KINEMATICS_API`.
  - The new wait applies to every driver with `jogCancel !== null`. The Falcon command set keeps
    `null`.
  - The simulator tests (`laser-motion-release.test.ts`, 10 passed) exercise real flush and
    no-flush firmware, not restated predicates.
- **ADR-644 P-1.**
  - The EEPROM list matches GRBL `interface.md` ("`G10 L2`, `G10 L20`, `G28.1`, `G30.1`, `$x=`,
    `$I=`, `$Nx=`, `$RST=`").
  - The worker refill uses the same `step()` (`stream-pump.ts:46-51`), so hosted streams obey the
    sync point.
  - `eeprom-write-line.test.ts`: 61 passed.
- **ADR-644 P-5.**
  - The FluidNC soft-limit alarm 2 is raised only after `protocol_buffer_synchronize()` and a feed
    hold to Idle (`Limit.cpp:67-83` @ v4.0.3), so `positionLost: false` holds.
  - Alarm 17 (GCode Error) is sent only while a FluidNC file `Job::active()`
    (`ProcessSettings.cpp:1245-1250`), never for a KerfDesk serial stream.
  - grblHAL-as-GRBL banners still reach the grblHAL meanings for 11–22, because the stock table
    falls back to them (`alarm-codes.ts:235-240`).
- **ADR-644 P-6.**
  - grblHAL `report.c`'s `signals_map "RHSDLTEOFM Q  P "` gives E = E-stop, F = motor fault and
    M = motor warning.
  - FluidNC `Control.cpp`: `fault_pin` 'F', `estop_pin` 'E'.
  - No axis letter collides.
- **ADR-648.**
  - GRBL `main.c` calls `settings_init()` once before the reset loop, so a soft reset keeps
    settings. FluidNC's soft restart does not reload config.
  - FluidNC `$NVX` is `Settings/Erase` and `$RST=` is `Settings/Restore` (`ProcessSettings.cpp`).
  - The snapshot is taken before invalidation, only on the same connection and only for the first
    banner within 500 ms. It is nulled at `onResetBoundary` and at window expiry.
  - Writes are noted before `conn.write` (`laser-safe-write.ts:122`) and per program at Start
    (`laser-job-actions.ts:156`). The only `createStreamer` in the store is Start's.
  - Wake sends Ctrl-X directly, so it keeps the full re-read as the ADR says.
  - `laser-owned-reset-settings.test.ts` (6 passed) runs the real disconnect transaction and line
    handler.
- **ADR-611 Amendment 2.**
  - The toast is keyed by profile signature and the read time; the kept snapshot keeps its read
    time, so an Abort is silent.
  - The recovery card opens only for `stoppedResponding` (`controllerRecoveryKey`).
  - The titles are as decided.
- **ADR-639.** Read-only operations (`readOnlyControllerOperation`) are settings, build-info,
  firmware report, `M221` module query, Console `$$` and the `$G`-only re-read; none moves
  anything. GRBL refuses `$x=` outside Idle/Alarm.
- **ADR-635 (state side).**
  - The pointer light is valid only on the `creality-falcon-a1-pro` command set
    (`devicePositioningLightIssue`).
  - Discovery runs before the transaction holds the controller, and admission is re-checked after
    it.
  - Disconnect's off request is fire-and-forget and reads the host synchronously.
  - No G-code is sent for the pointer.
- **Caution for the open D-4/P-4 fix.** FluidNC maps realtime `0x87` to `Macro0`
  (`RealtimeCmd.h:26` @ v4.0.3). Sending grblHAL's "complete report" byte to a FluidNC board that
  is on a grblHAL profile would run macro 0. Nothing sends `0x87` today.

## KNOWN re-observed (still open on `902f1d0c0`)

- **F-4 (2026-10-19)**: the automatic settings read requires Idle
  (`machine-settings-read-readiness.ts:55-56`). It is the root cause of P3-1.
- **D-1 (2026-10-20 design)**: owned stops reset mid-motion (`laser-job-stop.ts:121`), also K-3
  in area 05.
- **D-4/P-4 (2026-10-20)**: the generic grblHAL driver still has `buildInfoQuery: null`
  (`grblhal/driver.ts:84`), and no `0x87` is sent anywhere in `src/`.
- **CS-04 (2026-07-26)**: a Marlin `M114` report is still recorded as `Idle`
  (`marlin/response.ts:108`).

## Not verified

- No hardware. Whether a Falcon A1 Pro (grblHAL-based Creality firmware) behaves like upstream
  grblHAL on `0x85` was not checked. The ADR-635 HTTP contract rests on Creality binary analysis
  that cannot be checked against a public source.
- grblHAL's soft-reset handling of settings was taken from its shared GRBL lineage, not re-read in
  `grbl.c`.
- `src/ui/state/canvas-coordinate-frame.ts` (#1304, ADR-642 burn trail) belongs to live-view and
  canvas, and was not audited.
- #1300/ADR-637 was checked only where it changes controller or profile data (controller selection
  drops a Falcon pointer light). The rest is Machine Setup UI.
- Marlin, Smoothieware and Ruida drivers had no protocol change in the delta, apart from a Ruida
  `.rd` coordinate check that belongs to laser output. Their protocol claims were not re-fetched.

```json
[
  {"id":"P3-1","severity":"P3","area":"controllers-delta","file":"src/ui/laser/ConnectionBar.tsx","line":348,"anchor":"Contract: ADR-611 Amd 2 and WORKFLOW 3336 ('Reading settings…' while the read runs); ground truth GRBL ALARM:3 / HOMING_INIT_LOCK (main.c)","evidence":"REPRO","verdict":"CONFIRMED","known":"related: 2026-10-19 F-4 (root cause, open)","summary":"Status line reads 'Reading settings…' with an amber dot for as long as the machine sits in Alarm after an Abort or a homing-machine connect; nothing is read until Idle"},
  {"id":"P3-2","severity":"P3","area":"controllers-delta","file":"src/core/controllers/grbl/console-command.ts","line":79,"anchor":"Ground truth gnea/grbl protocol.c ignores '/' then dispatches '$'; Twin eeprom-write-line.ts:54 (#1338) vs console classifier and isEepromWriteLine","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A leading or interior '/' sends /$RST=* past the Console's persistent-command block and makes /$30=… plain G-code with no $$ re-read; isEepromWriteLine also misses it (latent in streams)"},
  {"id":"P3-3","severity":"P3","area":"controllers-delta","file":"src/ui/commands/use-app-commands.ts","line":220,"anchor":"Contract ADR-640 Decision 2/3; Twin ControllerConnectionControls.tsx:172 motionOwnerAwaitsMissingReply","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Menu/palette Disconnect stays disabled for a motion owner held only by a missing reply on an Idle machine, while the rail's Disconnect (ADR-640's escape) is enabled"},
  {"id":"K-1","severity":"P3","area":"controllers-delta","file":"src/ui/state/machine-settings-read-readiness.ts","line":55,"anchor":"Ground truth: GRBL answers $$ in Alarm","evidence":"READ","verdict":"PENDING","known":"2026-10-19-controller-behaviour-audit.md F-4","summary":"Automatic settings/$G read requires Idle"},
  {"id":"K-2","severity":"P2","area":"controllers-delta","file":"src/ui/state/laser-job-stop.ts","line":121,"anchor":"Ground truth: GRBL reset mid-motion raises ALARM:3","evidence":"READ","verdict":"PENDING","known":"2026-10-20-controller-design-audit.md D-1 (also 05 K-3)","summary":"Owned stops reset mid-motion on GRBL-family controllers"},
  {"id":"K-3","severity":"P3","area":"controllers-delta","file":"src/core/controllers/grblhal/driver.ts","line":84,"anchor":"Ground truth: grblHAL sender guide ($I+, 0x87)","evidence":"READ","verdict":"PENDING","known":"2026-10-20-controller-design-audit.md D-4 / protocol audit P-4","summary":"Generic grblHAL driver sends no $I and no 0x87 (note: 0x87 is Macro0 on FluidNC)"},
  {"id":"K-4","severity":"P3","area":"controllers-delta","file":"src/core/controllers/marlin/response.ts","line":108,"anchor":"Ground truth: Marlin M114 is the projected position","evidence":"READ","verdict":"PENDING","known":"2026-07-26 CS-04","summary":"Marlin M114 report recorded as Idle"}
]
```
