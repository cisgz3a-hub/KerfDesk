# Track CG — cross-firmware capability gating and store actions (PARTIAL, in progress)

Auditor: track CG. Status: partial save, rewritten as findings are confirmed or dropped.
Repro tests: `src/__audit_repro__/CG/` (run with
`pnpm vitest run src/__audit_repro__/CG/<file>`; every listed test FAILS on current code).
Upstream root: `/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/upstream/`.

## Findings (most severe first)

### CG-1 — Origin workflows cannot Frame on the g92-only controllers (Marlin, Smoothieware)

- severity: high on Marlin (no placement mode can Frame, so nothing can Start, once "Set origin here"
  was used); medium on Smoothieware (User Origin never resolves; Verified Origin works)
- verdict: CONFIRMED (repro + upstream)
- status: new. Overlaps: MA-2 (Marlin User/Current/Absolute refusals) and SM-1 (Smoothieware Absolute
  displacement, same root cause). Unique here: Smoothieware User Origin refusal, and Marlin Verified
  Origin — which MA-2 lists as the one mode that works — is refused at Frame dispatch too, so no
  placement mode can Frame on Marlin once an origin is set.
- failure scenario:
  - Smoothieware: jog, "Set origin here" (G92 X0 Y0, acknowledged), Frame in User Origin (the
    default for no-homing profiles, and the mode Set origin switches Absolute to) → refused forever:
    "The work origin is set, but the controller has not reported where it is yet. Wait a moment and
    try again, or Reset origin and set it again". Neither suggestion can ever help.
  - Marlin: after Set origin, User Origin, Absolute and Current Position are refused (no WCO), and
    Verified Origin resolves but Frame dispatch refuses with "The controller did not report a usable
    work position" (M114 has no WCO and `workOriginActive` makes `reportedWorkPositionMm` return null).
  - Smoothieware, Absolute mode, board still holding a G92 from earlier (Smoothieware keeps it through
    Abort/halt, M999 and host reconnect): the offset is visible (MPos ≠ WPos) but ignored, so the
    Absolute Frame/job runs displaced by the offset (the Frame shows it) and the bounds preflight
    uses offset 0.
- kerfdesk evidence:
  - `src/ui/job-placement.ts:251-270` resolveUserOrigin: `if (wco === null) return { ok: false,
    messages: [CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE] }`; `:323-326` knownWco =
    `machine.wcoCache ?? machine.statusReport?.wco ?? null`; `:208-219` resolveAbsolute refuses a
    custom origin with unknown WCO; `:328-330` defaultWco is null when `workOriginActive`.
  - `src/core/controllers/grbl/status-parser.ts:176` `wco: pickAxisField(fields, 'WCO')` — WCO only
    from a `WCO:` field; `src/ui/state/laser-status-position.ts:51-53` never derives it from MPos−WPos.
  - `src/core/controllers/marlin/response.ts:42-58` M114 → `{ mPos: {x,y,z}, wPos: null, wco: null }`.
  - `src/ui/state/canvas-motion-plan.ts:373-374` `if (wcoRaw === null && machine.workOriginActive
    === true) return null;` → `src/ui/laser/frame-dispatch-support.ts:106-111` currentWorkXy →
    `use-frame-action.ts:292-295` / `frame-trace-flow.ts:154-156` FRAME_WORK_POSITION_UNKNOWN_MESSAGE.
  - `src/ui/laser/OriginRow.tsx:234-237` Set origin switches Absolute → User Origin;
    `src/ui/job-placement.ts:28-38` no-homing default is User Origin.
- upstream evidence:
  - Smoothieware `src/libs/Kernel.cpp:206-234` (running) and `:261-285` (idle): every `?` report
    prints `|MPos:` and `|WPos:` (mcs2wcs), never `WCO:`.
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L177-L300
  - Smoothieware `src/modules/robot/Robot.cpp:449-455` mcs2wcs subtracts wcs_offsets and adds
    g92_offset; `:123` and `:624-627` are the only resets of g92_offset (boot, G92/G92.1) — halt and
    M999 keep it. https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L449-L455
  - Marlin 2.1.2.8 `module/motion.cpp:192-233` `report_current_position()` →
    `report_logical_position(current_position)` (M114 prints logical, i.e. work, coordinates; no
    offset field). https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/motion.cpp#L192-L233
- reproduction: `src/__audit_repro__/CG/g92-only-origin-frame.test.ts` —
  "Smoothieware: a Set origin that succeeded lets a User Origin Frame resolve its placement" (FAILS:
  CUSTOM_ORIGIN_LOCATION_UNKNOWN), "Smoothieware: an Absolute Frame compensates the offset the board
  reports" (FAILS: `{ok:true}` no offset), "Marlin: at least one placement mode can still Frame once
  an origin is set" (FAILS: absolute/current/user refused, verified has no work position).
- fix: Smoothieware — local: derive `wco = MPos − WPos` when a report carries both (Smoothie
  classifier or statusPositionPatch), which feeds wcoCache/workOriginActive exactly like GRBL's WCO.
  Marlin — needs decision: M114 is the work position, so either parse it as `wPos` (and use `M114 D`
  / `M114_DETAIL` where available for the machine position) or treat g92-only origins like Verified
  Origin (size-only preflight, work position = M114) and stop requiring a WCO for them.

### CG-2 — Frame's G54 "normalization" runs on every driver that never reads its WCS, and erases the origin

- severity: medium (worst cases: Marlin CNC_COORDINATE_SYSTEMS loses the operator's G92 origin on
  the controller; Falcon A1 Pro Current-Position first Frame traced displaced by the G92 offset;
  otherwise a misleading "Set origin here first" refusal once per session/reset)
- verdict: CONFIRMED (repro + upstream)
- status: new
- failure scenario: connect a Falcon A1 Pro (grblHAL contract), Marlin or Smoothieware; Set origin;
  Frame. `activeWcs` is null (never read), so Frame sends `G54` and applies the Console
  'coordinates-all' effect: `workOriginActive=false`, `workOriginSource='none'`, `wcoCache=null`,
  `workZZeroEvidence=null`, `homingProof=null`.
  - Falcon/grblHAL (and stock GRBL builds): G54→G54 changes nothing on the controller and does not
    force a WCO report, so the fresh report the Frame waits for normally has no WCO. User/Verified
    Origin → refused "…needs a custom work origin. Click 'Set origin here' first."; Current Position
    → head work position computed as MPos (G92 treated as 0) → job/Frame placed displaced by the G92
    offset (repro: currentPosition {100,50} instead of {0,0}).
  - Marlin: G54 is "Unknown command" without CNC_COORDINATE_SYSTEMS (store still forgets the origin);
    with CNC_COORDINATE_SYSTEMS (the driver's documented origin contract) it erases the G92 origin on
    the controller. KerfDesk's own Marlin emitter strips G54 because "G54 … would change the active
    origin" (`src/core/output/marlin-inline-transform.ts:27-31`).
  - Smoothieware: G54 keeps G92 (independent of WCS) but the store forgets the origin.
- kerfdesk evidence:
  - `src/ui/laser/frame-controller-readiness.ts:43-51` `if (… originalActiveWcs === 'G54') return
    {ok:true}` — null (unknown) takes the select path.
  - `src/ui/state/laser-console-actions.ts:128-168` selectPrimaryWcsForFrame applies
    `consoleStateEffectPatch(state, stateEffect, 'G54')`; `src/core/controllers/console-state-effect.ts:19,35`
    G54 → 'coordinates-all'; `laser-console-actions.ts:166,335-340,387-394` → unknownCoordinatePatch.
  - `src/ui/state/laser-controller-handshake.ts:171-176` returns 'not-required' before the `$G`
    readback at `:218` whenever settingsQuery is null; `src/ui/state/grbl-settings-actions.ts:80-90`
    same on re-qualification. The Falcon contract has `settingsQuery: null` but keeps
    `modalStateQuery: '$G'` (`src/core/controllers/falcon-command-contract.ts:25`, inherited).
  - `src/ui/laser/use-frame-action.ts:192-215` prepareFrameContext runs the normalization (`:194`) before placement is resolved (`:210`); also `:134` for transient frames.
- upstream evidence:
  - grblHAL `gcode.c:2990` `if((command_words.G12 &= gc_block.modal.g5x_offset.id !=
    gc_state.modal.g5x_offset.id))` and `:4483-4486` (WCO flagged only when the WCS changes);
    `config.h:256` REPORT_WCO_REFRESH_IDLE_COUNT 10; `report.c:1466-1480`.
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L2990
  - GRBL 1.1h `gcode.c:996-1000` (system_flag_wco_change only on a changed coord_select);
    `report.c:602-611`, `config.h:288`.
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L996-L1000
  - Marlin 2.1.2.8 `gcode/gcode.cpp:111` `active_coordinate_system = -1; // machine space`;
    `gcode/geometry/G53-G59.cpp:33-46` select_coordinate_system replaces position_shift with
    coordinate_system[new]; `gcode/geometry/G92.cpp:98-128` a G92 in machine space only shifts
    position_shift. https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G53-G59.cpp#L33-L46
  - Smoothieware `Robot.cpp:612-617` G54 sets only current_wcs; `:449-455` G92 applied separately.
- reproduction: `src/__audit_repro__/CG/falcon-frame-wcs-normalization.test.ts` (FAILS:
  currentPosition {100,50}); `src/__audit_repro__/CG/g92-only-origin-frame.test.ts` "Marlin: preparing
  a Frame after Set origin does not write G54…" (FAILS: G54 written) and "Smoothieware: preparing a
  Frame after Set origin keeps the origin…" (FAILS: "Verified Origin needs a custom work origin").
- note: GP-1 proposes nulling `activeWcs` after every `$H` so Frame re-selects G54; with the current
  normalization that would route every post-Home Frame on every driver through this origin-erasing
  path. Fix CG-2 first.
- fix: local — (1) run the owned `$G` readback whenever `modalStateQuery` exists, not only after a
  `$$` read (Falcon); (2) do not select G54 on drivers whose programs do not carry it (Marlin) and treat
  `activeWcs === null` as "read it first", not "not G54"; (3) when the selected WCS was already G54 (or
  unknown) keep the G92 origin record — G92 is independent of G54-G59 on GRBL/grblHAL/FluidNC/Smoothie.

### CG-3 — After Abort on Smoothieware, controller qualification stays "Waiting for fresh Idle" for the rest of the session

- severity: medium (blocks the ADR-364 laser recovery and CNC supervised recovery after an Abort
  until reconnect: `finalRecoveryStartAssertion` → "Controller qualification is still in progress…";
  permanent misleading status line)
- verdict: CONFIRMED (repro against an upstream-shaped Smoothie fake + upstream source)
- status: new (ADR-364 made Smoothieware resume possible; this blocks it after an in-session Abort)
- failure scenario: Smoothieware connected and qualified ('not-required') → Abort (Ctrl-X) → board
  halts (Alarm) → Unlock (M999) → Idle. `controllerQualification` stays
  `{kind:'qualifying', phase:'reset-cleanup'}`; ConnectionBar shows "Controller reset detected. Waiting
  for fresh Idle before reading settings…" forever (no Retry button in that state); supervised
  recovery refuses ("has not completed fresh qualification").
- kerfdesk evidence: `src/ui/state/laser-job-actions.ts:294` Abort applies
  `invalidateControllerSessionEvidence` (`src/ui/state/laser-controller-evidence.ts:15`
  `controllerQualification: qualifyingController(nextEpoch, 'reset-cleanup')`); the only re-arm is
  `scheduleControllerQualification` from `handleWelcomeLine` (`src/ui/state/laser-line-handler.ts:390`),
  i.e. a reboot banner. Same for the stream-error auto-stop (`src/ui/state/laser-error-line.ts:132`).
  `src/ui/laser/ConnectionBar.tsx:111-117,151-163`; `src/ui/laser/start-job-source.ts:312-325`.
- upstream evidence: Smoothieware `SerialConsole.cpp:205-208,231-245` / `USBSerial.cpp:204-207,304-312`
  — Ctrl-X sets halt_flag; on_idle calls ON_HALT and prints "ALARM: Abort during cycle" (grbl mode) or
  "HALTED, M999 or $X to exit HALT state"; no reboot, no banner. `Kernel.cpp:359-385` ON_HALT(nullptr)
  sets halted. https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/SerialConsole.cpp#L199-L245
- reproduction: `src/__audit_repro__/CG/smoothie-abort-qualification.test.ts` (FAILS:
  `{"kind":"qualifying","epoch":3,"phase":"reset-cleanup"}`). Helper
  `src/__audit_repro__/CG/upstream-smoothie-fake.ts`.
- fix: local — when the driver's soft reset does not reboot (softReset present but no banner expected,
  e.g. a driver flag), schedule qualification right after the reset write (the scheduler already waits
  for fresh Idle and tolerates Alarm), or have Abort call scheduleControllerQualification itself.

### CG-4 — On a halted Smoothieware board the alarm fix offers Home, which the Smoothie Home sequence always refuses

- severity: low-medium (wrong fix offered; spurious "Controller rejected a command … home before
  continuing" safety notice; board stays halted; the Alarm banner's M999 button still works)
- verdict: CONFIRMED (repro)
- status: new
- failure scenario: Smoothieware with homing enabled, halted (after Abort or a limit) → Frame → pre-Frame
  alarm fix `offerAlarmFixForBlockedStart` chooses Home → Home's first line `M400` → `!!` → "Homing
  failed: !!" + safety notice; M999 is never offered.
- kerfdesk evidence: `src/ui/laser/start-blocked-alarm-offers.ts:53`
  `return homingEnabled ? offerHomeCycle() : offerUnlock();`; `src/core/controllers/smoothieware/driver.ts:263-267`
  Home deliberately starts with M400 so a halted board refuses it; `src/ui/state/laser-home-action.ts:201-221`
  raises the safety notice; the Alarm banner also shows Home (`src/ui/laser/AlarmRecoveryActions.tsx:22-29`).
- upstream evidence: Smoothieware `GcodeDispatch.cpp:34,158-180` — halted kernel answers every G-code
  outside allowed_mcodes with `!!` (or `error:Alarm lock` in grbl mode); only M999 clears the halt.
  https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L158-L180
- reproduction: `src/__audit_repro__/CG/smoothie-alarm-fix-offer.test.ts` (FAILS: `M400` sent, board
  still halted, notice "The controller rejected a command (unrecognized controller error response: !!)").
- fix: local — a driver capability "home clears alarm" (true for the GRBL family, false for
  Smoothieware); when false, offer Unlock first and hide/disable Home in the Alarm banner while Alarm.

### CG-5 (low) — Smoothieware jog, Frame and Home send M9, so Manual Air shows ON while the air is off

- verdict: CONFIRMED by trace. `src/core/controllers/smoothieware/commands.ts:67-73,96-103`
  (SMOOTHIE_FRAME_TOOL_OFF_LINES incl. `M9` prefix every jog/Frame/Home); the Manual Air latch is
  re-synced only from GRBL `A:`/`Ov:` fields (`src/ui/state/laser-status-position.ts:106-113`), which
  Smoothieware never reports (`Kernel.cpp:177-300`). After any jog the rail still shows air ON; the next
  click sends M9 again. fix: local — clear `airAssistOn` when the driver's own tool-off lines include
  M9, or drop M9 from the jog prefix.

### (dropped as duplicate) Simulator fidelity — covered by SM-4 (Smoothieware) and MA "Simulator
fidelity" (Marlin). Note for SM-4: the Ctrl-X banner is also what hides CG-3.

### CG-7 (low) — "Read ($$)" is offered on drivers without a settings query

- `src/ui/laser/MachineSettingsPanel.tsx:42-46,98-106,124-128` (also in the Super Console pane) shows
  "Read ($$)" and toasts "Reading machine settings ($$)..." on Marlin/Smoothieware/Falcon, where
  `readMachineSettings` only marks qualification 'not-required' (`grbl-settings-actions.ts:80-90`);
  nothing is read. fix: local — gate on `capabilities.settings !== 'none'`.

### CG-8 (low) — Wake from Sleep is reported as failed on stock GRBL 1.1h too (extends HF-5)

- verdict: CONFIRMED (repro). HF-5 covers grblHAL and FluidNC and left stock GRBL to another track.
  GRBL `protocol.c:52-54` re-enters ALARM after a reset from Sleep; `wakeController` waits for Idle
  (`src/ui/state/laser-controller-recovery-actions.ts:90`) and rejects "Controller entered Alarm.".
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L52-L54
- reproduction: `src/__audit_repro__/CG/grbl-wake-from-sleep.test.ts` (FAILS: 'Controller entered Alarm.').
- fix: as HF-5.

## Driver × action matrix (so far; only wrong/unverifiable cells listed)

- grbl (stock 1.1): origin/Frame OK (activeWcs read via `$G`); Wake → CG-8.
- grblhal: as grbl. Frame normalization only when `$G` readback failed.
- fluidnc: no wrong cells found (checked realtime bytes, `$SLP`, Door substates, `$32` proxy, overrides).
- falcon-grbl / falcon-grblhal: Frame/origin → CG-2 (`$G` never read); settings panel → CG-7.
- marlin: set origin + Frame (all placement modes) → CG-1 (+MA-2); Frame → CG-2 (G54 sent); Abort does
  not stop the planner → MA-7; settings panel → CG-7.
- smoothieware: User Origin / Absolute offset → CG-1; Frame → CG-2; Abort → CG-3; alarm recovery → CG-4;
  manual air → CG-5; settings panel → CG-7.
- ruida: file-only; every live control gated off by transport (checked).

## Checked and correct (so far)

- GRBL realtime and override bytes match `grbl/config.h:51-80` (`?` `~` `!` 0x18 0x84 0x85 0x90-0x9D).
- FluidNC v4.0.3 `RealtimeCmd.h:19-30` has the same Reset/SafetyDoor/JogCancel/override bytes; Door
  substates `Report.cpp:442-450` match isSettledPauseState/isDoorTransitionProgress.
- Smoothieware `!`/`~` only with feed hold enabled (`USBSerial.cpp:220-229`) → driver hold/resume null.
- Smoothieware halt allows M5/M9 (`GcodeDispatch.cpp:34`) → Abort's delayed M5/M9 cleanup is acked.
- Smoothieware `$H` homes in both dialects and prints ok after the cycle (`SimpleShell.cpp:239-251`);
  GcodeDispatch ignores `$`/lowercase lines (`GcodeDispatch.cpp:72-80`); `fire off` completion text
  (`Laser.cpp:152-155`).
- Marlin M7/M8/M9 = coolant/air assist with AIR_ASSIST (`gcode/control/M7-M9.cpp:40-75`) → Manual Air
  bytes valid.
- Falcon Home `$HX` then `$HY`: each owned; GRBL single-axis homing ends Idle (`system.c` `$H` case).
- Overrides, Fire, Probe, CNC jobs, tool change, work-Z recovery gated on capabilities
  (overrides/lowPowerFire/probing/cncJobs/modalStateQuery+offsetsQuery).
- Marlin pause/stop are stream-side; no Hold/realtime wait on Marlin or Smoothieware.

## Still to check

- Marlin Abort is queued `M5 I`/`M107` behind the planner (documented); M410/quickstop semantics not
  researched — possible "needs decision" note only.
- Autofocus on Smoothieware with a shell-style command (owes an ack that never comes) — edge case.
- Remaining hard-coded GRBL literals (reviewed: origin-actions.ts uses GRBL constants instead of the
  driver table; persistent origin gated only in the UI) — low, not filed yet.
