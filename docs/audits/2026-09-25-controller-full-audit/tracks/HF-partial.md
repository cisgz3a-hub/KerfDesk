# Track HF (partial) — grblHAL, FluidNC and the Creality Falcon command contract

Status: work in progress (2026-09-25). Rewritten as findings are confirmed or dropped.
Upstream trees are the pinned clones listed in the shared brief (grblHAL core d7aaee3d,
FluidNC v4.0.3 25ae119b, FluidNC main fdc17a2c, gnea/grbl bfb67f0c). Repro tests live in
`src/__audit_repro__/HF/` and are left in place.

## Findings (most severe first)

### HF-1 — Falcon Home ($HX then $HY) is aborted by grblHAL's own Alarm between the two lines
- severity: medium
- verdict: PLAUSIBLE (KerfDesk behaviour reproduced; grblHAL core behaviour proven from source;
  whether the real A1 Pro firmware re-locks between the lines is unverified — its build is unknown)
- status: new
- failure scenario: Falcon A1 Pro profile (controllerKind `grblhal`, Falcon command set) on a
  grblHAL build with homing init lock and single-axis homing. Machine powers up in Alarm 11.
  Operator clicks Home. `$HX` homes X; grblHAL then re-enters Alarm (Y not homed yet), acks `ok`.
  KerfDesk writes `$HY`. A `?` serviced before `$HY` executes (any 250 ms poll landing in the
  ok→$HY round trip) answers `<Alarm|...>`. KerfDesk treats it as a new alarm, clears the Home
  owner and rejects `$HY` with "Controller entered Alarm."; the machine goes on to home Y.
  Result: toast "Home: Controller entered Alarm.", homingState `unknown`, although the machine
  homed. Retry succeeds (both axes then marked homed).
- kerfdesk evidence:
  - `src/core/controllers/falcon-command-contract.ts:24` `home: '$HX\n$HY',`
  - `src/ui/state/laser-home-action.ts:150-162` sends each line as its own owned command.
  - `src/ui/state/laser-home-alarm-reply.ts:27-36` the stale-Alarm tolerance only applies while
    `awaitingFirstNonAlarmReport === true`; `homeAlarmReplyWindowPatch` (l.55-70) closes it on the
    first non-Alarm report of the whole Home (the `$HX` cycle's `<Home|...>`).
  - `src/ui/state/laser-status-line.ts:53-56,252-294` any later Alarm report runs
    `handleInvalidatingStatus` → `controllerOperation: null`, `cancelControllerLifecycleRefs(...)`.
- upstream evidence: grblHAL core `system.c:494-505` (go_home):
  `state_set(STATE_IDLE); ... else if(limits_homing_required()) { // Keep alarm state active if homing is required and not all axes homed.`
  `sys.alarm = Alarm_HomingRequired; state_set(STATE_ALARM); }` — no `ALARM:` line is printed.
  https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L494-L505
  `machine_limits.c:668-673` limits_homing_required(); `system.c:486` single-axis `$HX` is
  accepted in Alarm. Creality's bundle (sha256 11b13328…, re-downloaded 2026-09-25, hash
  matches `falcon-vendor-configuration.json`) Home macro is `"$HX\n$HY\n"`.
- reproduction: `src/__audit_repro__/HF/hf-1-falcon-home-relock.test.ts` — control case passes;
  the case with the between-lines `<Alarm|...>` FAILS on current code
  (`{ outcome: 'Controller entered Alarm.', homingState: 'unknown' }`).
- fix (local): re-open the stale-Alarm window for each further line of a multi-line Home that
  started from Alarm (set `awaitingFirstNonAlarmReport` again when the next Home line is
  dispatched). A genuine failure still arrives as `ALARM:N` or `error:N` on the owned command.

### HF-2 — FluidNC acks `$X` in its Critical state without unlocking; KerfDesk records "unlocked"
- severity: low (misleading state/guidance; no motion)
- verdict: CONFIRMED (reproduced; FluidNC v4.0.3 and main source)
- status: new
- failure scenario: FluidNC hard limit, soft limit (e.g. a job past travel) or hard stop →
  `State::Critical`, `ALARM:N`, `[MSG:ERR: Reset to continue]`, status still "Alarm". Operator
  clicks Unlock (banner or Start-blocked offer). FluidNC answers `ok` but stays Critical. KerfDesk
  applies `controllerUnlockedPatch` (alarmCode null, log "Controller unlocked", offer path toasts
  "Alarm cleared. Jog the head…"); the next `<Alarm|>` does not restore the code, so the banner
  falls back to the generic "…until the machine is homed or unlocked" and offers `$X` again.
  Nothing tells the operator a reset (Ctrl-X) is required; the banner has no Reset control
  (`LaserWindow.tsx:285-321`, `AlarmRecoveryActions.tsx`), and the FluidNC alarm table has no
  action text (`response-presentation.ts:113-136`, `LaserWindow.tsx:314-321`).
- kerfdesk evidence: `src/ui/state/laser-autofocus-actions.ts:28-45` (unlockAlarm applies
  `controllerUnlockedPatch` on the bare `ok`); `laser-console-completion.ts:78-101`;
  `laser-status-line.ts:269` (Alarm report keeps alarmCode as is).
- upstream evidence: FluidNC v4.0.3 `ProcessSettings.cpp:269-286` — only
  `if (state_is(State::Alarm))` unlocks; otherwise `return Error::Ok;`
  https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L269-L286 ;
  `Protocol.cpp:458-471` hard/soft limit → `set_state(State::Critical)` + `Message::CriticalEvent`;
  `Report.cpp:436-439` Critical reports "Alarm"; `Protocol.cpp:1152-1157` only reset leaves it.
  Same on FluidNC main (`ProcessSettings.cpp:309-318`: "Nothing is locked, so $X is a no-op").
- reproduction: `src/__audit_repro__/HF/hf-2-fluidnc-critical-unlock.test.ts` FAILS on current
  code (`{ outcome: 'resolved', alarmCode: null }`).
- fix (local): on FluidNC, treat `$X`'s `ok` as unproven until the next status report; if it
  still reads Alarm, keep the alarm and say a reset is required. Add action text for FluidNC
  alarms 1, 2, 13 ("Reset (Ctrl-X) to continue").

### HF-3 — grblHAL critical alarms (1, 2, 10, 17, 20) refuse `$X`/`$H` until reset; banner advice and error:79 give no way out
- severity: low
- verdict: CONFIRMED (traced; grblHAL source)
- status: new (partly generic: stock GRBL 1.1h also needs a reset after ALARM:1/2 — other track)
- failure scenario: grblHAL ALARM:1 or ALARM:2 → `[MSG:Reset to continue]`, grblHAL blocks
  until reset and answers `$X`, `$H`, `$HX`, `$SLP` with `error:79` ("Not allowed while critical
  event is active"). KerfDesk's banner action for alarm 1 is "Re-home the machine ($H)…", for
  alarm 2 "Check the design fits the bed…", offers Home/Unlock (both → "error:79" with no
  description) and no Reset. Only alarm 10 is special-cased (`start-blocked-alarm-offers.ts:38-70`).
  Workaround: Disconnect (sends Ctrl-X on GRBL-family) and reconnect.
- kerfdesk evidence: `src/core/controllers/grbl/alarm-codes.ts:55-68` (actions for 1 and 2);
  `error-codes.ts` stops at 38 (no 79); `LaserWindow.tsx:290-320`.
- upstream evidence: grblHAL `alarms.h:73-80` `alarm_is_critical` = HardLimit, SoftLimit, EStop,
  MotorFault, ExpanderException; `protocol.c:467-514` blocking loop + `Message_CriticalEvent`;
  `system.c:1179-1181` `if(sys.blocking_event && !...allow_blocking) retval = Status_NotAllowedCriticalEvent;`
  (`X`, `H`, `HX`… have no `allow_blocking`, `system.c:990-1012`); `errors.h:113` = 79.
  https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L1179-L1181
- reproduction: traced only (unit repro pending).
- fix: local for text (grblHAL alarm 1/2 actions say "soft-reset first"; describe error 79/46/45/50);
  offering a Reset control in the Alarm banner needs a product decision (it is a new control).

### HF-4 — Falcon: a refused Release motors tells the operator to set `$62=1`, which the Falcon Console refuses
- severity: low (misleading text)
- verdict: CONFIRMED (traced)
- status: new (same class as the ADR-370 `$152` advice)
- failure scenario: Falcon profile (kind grblhal). Release motors → `$SLP` → `error:3` (sleep
  disabled or unsupported on the vendor build) → `sleepRefusalMessage('grblhal', 'error:3')`
  returns "Sleep ($SLP) is disabled in this grblHAL build ($62=0). Set $62=1 in the controller
  settings…". The Falcon Console refuses `$62=1` (only `$150-$152` allowed) and the Machine
  Settings panel is unavailable; `$62=0` was never read (no `$$` on this contract).
- kerfdesk evidence: `src/ui/state/controller-sleep.ts:15-16,30-38`;
  `src/core/controllers/falcon-command-contract.ts:46,54-58`; `console-setting-writes.ts:21-36`.
- upstream evidence: grblHAL `system.c:572-576` `if(!settings.flags.sleep_enable) return Status_InvalidStatement;`;
  `settings.c:2141-2143` `$62` exists only when `SLEEP_DURATION > 0`.
- reproduction: traced only (unit repro pending).
- fix (local): only name `$62=1` when the driver can write it (`capabilities.settings === 'grbl-dollar'`);
  otherwise say the firmware refused sleep.

### HF-5 — Wake from Sleep is reported as failed on grblHAL and FluidNC; both reboot into Alarm by design
- severity: low
- verdict: CONFIRMED (traced)
- status: new (stock GRBL 1.1h behaves the same — other track; the GRBL simulator models Idle)
- failure scenario: Release motors (`$SLP`) → Sleep → Wake/Reset (Ctrl-X). grblHAL re-enters Alarm
  with `[MSG:'$H'|'$X' to unlock]`; FluidNC prints `ALARM:3` before its banner. `wakeController`
  waits for a fresh Idle, so the Alarm report/ALARM line rejects it: log "Controller recovery
  failed", toast "Wake: Controller entered Alarm." / "Wake: ALARM:3". The no-homing guide already
  handles this (`NoHomingPositionGuide.tsx:141-155`); the SleepBanner path does not.
- kerfdesk evidence: `src/ui/state/laser-controller-recovery-actions.ts:90-108`;
  `src/__fixtures__/controllers/grbl-sim-machine.ts:224-228` (reset → Idle);
  `laser-store-sleep-recovery.test.ts:156` emits Idle after wake.
- upstream evidence: grblHAL `protocol.c:167-174` ("Re-initialize the sleep state as an ALARM mode");
  FluidNC v4.0.3 `Protocol.cpp:1158-1159` `else if (state_is(State::Sleep)) { protocol_do_alarm((void*)ExecAlarm::AbortCycle); }`;
  gnea/grbl `protocol.c:49-54`.
- reproduction: traced only (repro pending).
- fix (local): accept the post-reset Alarm as a completed wake (hand over to the Alarm banner) and
  fix the simulator's reset-from-Sleep state.

## Checked and correct (so far)
- grblHAL alarm table 1-22 matches `alarms.h:29-53`/`alarms.c:29-52`; alarm 10 split by firmware.
- grblHAL errors 1-38 match vanilla meanings (`errors.h:31-69`); 39+ surface as raw `error:N`.
- FluidNC error and alarm presentation tables match v4.0.3 `Error.cpp` and `Protocol.cpp:28-48` exactly.
- Status parser: grblHAL states incl. Tool, `Run:1/2`, `Hold:0/1`, `Alarm:N`, `Door:0-4`
  (`report.c:1259-1314`); FluidNC states (`Report.cpp:421-457`); extra fields ignored safely;
  >3 axes handled; FluidNC forces >=3 axes (`Machine/Axes.cpp:188-191`). Unknown state
  (FluidNC "Starting") is dropped as an unknown line and never counts as Idle.
- grblHAL Door:4 = `Parking_Resuming`; Door:3 never assigned (`system.h:139-143`).
- grblHAL RX default 1024 (`stream.h:52-53`); `Bf:` = planner free, `get_rx_buffer_free()`
  (`report.c:1341-1347`). FluidNC `Bf:` RX is `UART_HW_FIFO_LEN - buffered` (`fnc_uart.cpp:161-167`; ring installed with 256 bytes, l.47-49),
  not channel capacity; KerfDesk's use is conservative.
- grblHAL defers jog-cancel to the main loop reading ASCII_CAN (`protocol.c:214-221,896-906`); KerfDesk
  never queues a line behind an in-progress jog (next line only after Idle, `laser-frame-status.ts:43-49`).
- Falcon air writes `$150`/`$151`/`$152` 0-100 match Creality's A1 page (re-fetched 2026-09-25).
- No `$J=`, `$$`, 0x85 or Frame M9 on the Falcon contract; M9 only on explicit Air-off/stop/disconnect.
- FluidNC line limits: 254 retained, >127 → error:14 (`GCode.cpp:246-249`); fixtures faithful.

## Still to check
- Unit repros for HF-3, HF-4, HF-5.
- Falcon banner/firmware identity (unknown in repo): consequences for detection advisory,
  native bed frame (`native-bed-frame.ts:98-107`) and RX window reconciliation.
- select-controller-driver Falcon command set on fluidnc/marlin reachability (appears harmless).
- Remaining console classification gaps for FluidNC long-form commands (`$Home`, `$H=XY`, `$MD`).
