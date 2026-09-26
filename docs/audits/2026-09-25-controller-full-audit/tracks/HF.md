# Track HF — grblHAL, FluidNC and the Creality Falcon A1 Pro command set (final track report)

Status: final, 2026-09-25. Finishes `HF-partial.md` (left in place). Not yet verified by the lead.

- **Result:** 8 findings: 1 high, 3 medium, 4 low. None of HF-1 to HF-6 was dropped on re-check.
  HF-1 stays PLAUSIBLE and is now written up as a timing race. HF-6 is wider than first reported
  (`$NVX` too). HF-7 and HF-8 are new.
- **Repro tests:** `src/__audit_repro__/HF/`, 8 files and 31 tests. 25 tests fail on the audited
  code, one or more per defect. The other 6 pass: 5 are control cases and 1 records a consequence.
  Run one file with `cd /home/user/KerfDesk && pnpm vitest run src/__audit_repro__/HF/<file>`.
  All 8 files pass Prettier, ESLint and `tsc`.
- **Upstream sources:** at the pinned revisions in `method.md`. grblHAL core `d7aaee3d`, FluidNC
  v4.0.3 `25ae119b` and main `fdc17a2c`, gnea/grbl `bfb67f0c`. URLs below use
  `https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/FILE#Lnn` and
  `https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/FILE#Lnn`.

| id | severity | verdict | title |
|---|---|---|---|
| HF-7 | high | CONFIRMED (grblHAL default build); PLAUSIBLE for the Falcon | After one refused line, grblHAL refuses every later G-code line with the same `error:N`. KerfDesk's own actions fail, and a refused jog or Frame stays stuck |
| HF-3 | medium | CONFIRMED | grblHAL ALARM:1/2 (and 10/17/20) need a reset first. The alarm text points to `$H`; Home and Unlock get `error:79`, which KerfDesk shows with no description |
| HF-2 | medium | CONFIRMED | In its Critical state FluidNC answers `$X` with `ok` but stays locked; KerfDesk records "unlocked" |
| HF-1 | medium | PLAUSIBLE | Falcon Home (`$HX` then `$HY`): an Alarm report between the two lines aborts a Home that goes on to succeed |
| HF-6 | low | CONFIRMED | FluidNC's long command names and `$NVX` get past the Console's block on `$RST=` |
| HF-4 | low | CONFIRMED | Falcon: when Release motors is refused, the message says to set `$62=1`, which the Falcon profile cannot write |
| HF-8 | low | CONFIRMED (mechanism); PLAUSIBLE for the Falcon | grblHAL at COMPATIBILITY_LEVEL ≥ 1 prints the stock "Grbl 1.1f" banner, and KerfDesk treats it as a firmware mismatch |
| HF-5 | low | CONFIRMED | Wake from Sleep is reported as failed; grblHAL and FluidNC restart into Alarm by design |

## Findings (most severe first)

### HF-7 — After one refused line, grblHAL refuses every later G-code line with the same `error:N`; KerfDesk's own actions fail, and a refused jog or Frame stays stuck

- **severity:** high. The jog or Frame owner is never released, so Jog, Frame, Home, origin
  actions and Start all refuse as busy while the machine sits Idle. ADR-361 decision 1 was meant to
  end exactly this state. Disconnect is disabled while a motion owner exists, which leaves two ways
  out:
  - ABORT MOTION, which soft-resets the controller.
  - Ctrl+. (0x85), which works on generic grblHAL but not on the Falcon contract.
- **verdict:**
  - CONFIRMED for grblHAL at its default COMPATIBILITY_LEVEL 0 (upstream source and repro).
  - PLAUSIBLE for the Falcon A1 Pro. Its compatibility level is unknown; a "GrblHAL" banner would
    mean level 0.
- **status:** new. It is also an incomplete fix of ADR-361 decision 1 on grblHAL. That decision's
  regression test (`src/ui/state/laser-motion-release.test.ts:94-127`, "grblHAL" case) runs the
  GRBL simulator with a grblHAL banner, and the simulator does not model the sticky error.
- **failure scenario:** grblHAL, default build.
  1. **Jog past the soft limits** (`$20=1`, homed; jog clipping `$40` is off by default). The
     `$J=…` jog gets `error:15`, and grblHAL keeps 15 as its last error. The automatic release
     (ADR-361) then writes its settle marker `G4 P0.01` twice, and both get `error:15`.
     - The jog owner stays `{kind:'jog', cancelRequested:true, automaticReleaseAttempts:2}`.
     - The log says "Releasing the stopped motion needs attention: error:15".
     - The live bar shows JOGGING / ABORT MOTION although the machine is Idle.
     - A Frame leg refused at the soft limits ends the same way.
  2. **Console typo**, for example `G1 X10` with no feed rate, gets `error:22`. Every later
     G-code-only action then gets `error:22` and is not executed:
     - Set origin (`G54 G92 X0 Y0`) and Zero Z (`G54 G92 Z0`) are rejected, and Set origin marks
       the work origin as unknown.
     - Manual air on (`M8`) and off (`M9`) are rejected. The rail shows the state that was
       requested, so it shows air off while the pump keeps running, until a later `A:`/`Ov:`
       report corrects it.
     - A Frame's first line, `M5`, is rejected, and the Frame owner then stays stuck as in 1.
  3. **Falcon contract.** Jog and Frame are plain G-code, and the contract sends no `$J=` and no
     0x85. After any refused line, every jog and Frame line is rejected and the owner stays stuck.
     Two ways to get a refused line:
     - a Console typo;
     - Release motors, when `$SLP` gets `error:3` because sleep is off (`$62=0`, the grblHAL
       default). Release motors is the first step of the no-homing guide, which is the Falcon
       profile's default flow (see HF-4).

     Ctrl+. sends nothing on this contract, and Home is refused as busy, so only ABORT MOTION gets
     out.
- **kerfdesk evidence:**
  - `src/ui/state/laser-motion-release.ts:31,45` `const MAX_AUTOMATIC_RELEASE_ATTEMPTS = 2;` …
    `if ((operation.automaticReleaseAttempts ?? 0) >= MAX_AUTOMATIC_RELEASE_ATTEMPTS) return;`
  - `src/ui/state/laser-motion-cancel.ts:270-278`: the release crosses
    `command: \`${context.refs.driver.commands.settleDwell}\n\`` (that is, `G4 P0.01`,
    `grbl/driver.ts:33`), which is G-code.
  - `src/ui/state/laser-error-line.ts:46`: for a non-stream error it only records
    `if (ackSettlement.owner === 'untracked') return;`. Nothing re-arms the parser. The stream
    path does soft-reset (l.47).
  - `src/core/controllers/grblhal/driver.ts:12-21`: the grblHAL driver is the GRBL driver apart
    from `buildInfoQuery`.
  - G-code-only actions affected:
    - `src/ui/state/origin-actions.ts:52-69` (`G54 G92 …`)
    - `src/ui/state/laser-store.ts:389,409` (manual air `M7`/`M8`/`M9`)
    - `src/core/controllers/grbl/driver.ts:79` `frameToolOffLines: [CMD_SPINDLE_OFF, CMD_COOLANT_OFF],`
    - `src/core/controllers/falcon-command-contract.ts:74-79` (Falcon jog `M5` / `G21 G91` / `G1 …` / `G90`)
  - `src/ui/state/laser-origin-transaction.ts:131,140`: a refused origin line applies
    `unknownOriginPatch()` and logs "Work-origin state is unknown".
  - `src/ui/laser/ControllerConnectionControls.tsx:67-69,113`: connection controls are busy while
    `motionOperation !== null`.
- **upstream evidence:**
  - grblHAL `protocol.c:246-286`
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L246-L286
    - `else if(*line.data == '\0') // Empty line. For syncing purposes.` →
      `gc_state.last_error = Status_OK;` (l.247-248)
    - `$` lines assign it too:
      `if((gc_state.last_error = system_execute_line(line.data, hal.stream.write)) == …` (l.250)
    - `#if COMPATIBILITY_LEVEL == 0` /
      `else if(gc_state.last_error == Status_OK || gc_state.last_error == Status_GcodeToolChangePending) { // Parse and execute g-code block.`
      (l.265-266). Otherwise the block is skipped and
      `grbl.report.status_message(gc_state.last_error);` (l.286) repeats the old code.
    - At level ≥ 1 the `#else` branch (l.267-268) always parses the block.
  - Level 0 is the default: `#define COMPATIBILITY_LEVEL 0` (config.h:96-98).
  - What clears the error:
    - ASCII_CAN: `if(c == ASCII_CAN) { clear_line(&line); gc_state.last_error = Status_OK;`
      (protocol.c:214-217).
    - 0x85 jog-cancel, which flushes the input and inserts ASCII_CAN (protocol.c:896-899;
      stream.h:372 "flushing the input buffer and inserting an #ASCII_CAN character").
    - A soft reset: `memset(&gc_state, 0, offsetof(parser_state_t, g92_offset));` (gcode.c:787),
      and `last_error` sits before `g92_offset` in the struct (gcode.h:719).
  - The triggers used in the repro:
    - `$J=` past soft limits → `Status_TravelExceeded` (motion_control.c:832-835). Jog clipping
      is off by default: `DEFAULT_JOG_LIMIT_ENABLE Off` (config.h:1945-1947).
    - `$SLP` with sleep off → `Status_InvalidStatement` (system.c:572-576). Sleep is off by
      default: `DEFAULT_SLEEP_ENABLE Off` (config.h:841-843).
    - `G1` with no feed rate → `Status_GcodeUndefinedFeedRate` (gcode.c:3485-3486).
  - Stock GRBL and FluidNC parse every line independently:
    - gnea/grbl protocol.c:93-95 answers an empty line `ok`;
    - FluidNC `ProcessSettings.cpp:1224-1253` checks each line on its own.
- **reproduction:** `src/__audit_repro__/HF/hf-7-grblhal-sticky-gcode-error.test.ts`, with a
  grblHAL line-loop fake reduced to protocol.c:244-286.
  - 2 control cases pass:
    - Set origin with no pending error;
    - a refused jog at COMPATIBILITY_LEVEL 1, which is released.
  - 8 cases FAIL:
    - a jog refused past the soft limits stays stuck (owner as above, `refused: ['G4 P0.01','G4 P0.01']`);
    - Set origin and Zero Z after a Console typo return `'error:22'`;
    - Manual air on gives `{refused:['M8'], flood:false}`;
    - Manual air off gives `{refused:['M9'], flood:true}` while the rail shows off;
    - the Frame prelude `M5` is refused and the Frame owner stays stuck;
    - Falcon: a jog after a Console typo, and a jog after a refused `$SLP`, run no motion line.

  A scratch run (not kept) confirmed that when 0x85 clears the error, Ctrl+. (`cancelJog`)
  releases the stuck generic-grblHAL owner.
- **fix (local):**
  - On the grblHAL driver, including the Falcon wrapper, re-arm the parser after any `error:N`
    to a non-stream line:
    - Write one owned empty line (`\n`). grblHAL answers `ok` and clears `last_error`
      (protocol.c:247-248).
    - Send it before the next command, and after the refused operation's own in-flight lines
      have drained.
    - Stock GRBL and FluidNC also answer an empty line `ok`, so the change is harmless there.
  - Teach the repository's GRBL simulator the sticky `last_error` when it plays grblHAL, so the
    ADR-361 regression test covers it.

### HF-3 — grblHAL ALARM:1/2 (and 10/17/20) need a reset first; the alarm text points to `$H`, and Home and Unlock get `error:79`, which KerfDesk shows with no description

- **severity:** medium. The controller stays locked until Disconnect (which sends Ctrl-X) or a
  hardware reset, and the app gives no guidance.
- **verdict:** CONFIRMED (repro and grblHAL source)
- **status:** new. Same root cause as GP-2 for stock GRBL; see Overlaps.
- **failure scenario:**
  1. grblHAL raises ALARM:1 (hard limit) or ALARM:2 (soft limit) and prints
     `[MSG:Reset to continue]`. It then blocks until a reset. While blocked it still answers `?`,
     but refuses `$X`, `$H`, `$HX` and `$SLP` with `error:79` and G-code with `error:9`.
  2. KerfDesk's banner says, for alarm 1, "Re-home the machine ($H) after clearing the
     obstruction." and, for alarm 2, "Check the design fits the bed; re-import or shrink."
  3. It offers Home and `$X — Unlock`. Both fail with a raw `error:79` that has no description.
     There is no Reset control: the banner's "Reset controller" appears only in Sleep.
  4. The only way out is Disconnect, which sends Ctrl-X, then reconnect.

  Falcon context: the vendor contract jogs and frames with plain `G1`. A `G1` past the soft limits
  raises critical ALARM:2, where `$J=` would only return `error:15`. KerfDesk's jog-bounds checks
  only warn, by policy, so an over-travel click-jog on a Falcon with soft limits enabled ends
  here. The Falcon's soft-limit setting is unknown, because `$$` is disabled.
- **kerfdesk evidence:**
  - `src/core/controllers/grbl/alarm-codes.ts:60`
    `action: 'Re-home the machine ($H) after clearing the obstruction.',`
  - `src/core/controllers/grbl/alarm-codes.ts:67`
    `action: 'Check the design fits the bed; re-import or shrink.',`
  - The same file's header (l.11-12) already says "hard and soft limit alarms (1, 2) first need a
    soft reset".
  - `src/core/controllers/grbl/error-codes.ts:150,155-157`: the table ends at 38, so
    `describeError(79)` returns null.
  - `src/ui/laser/AlarmRecoveryActions.tsx:22-52` offers Home and Unlock and nothing else.
  - `src/ui/laser/SafetyNoticeBanner.tsx:39`
    `const resetAvailable = connection.kind === 'connected' && statusState === 'Sleep';`
  - `src/ui/laser/start-blocked-alarm-offers.ts:38-53,65-70`: only alarm 10 is special-cased.
  - `src/core/controllers/falcon-command-contract.ts:74-79` (G1 jog);
    `src/ui/state/laser-jog-warnings.ts:1-3` (warn only).
- **upstream evidence:**
  - grblHAL `alarms.h:73-80`: `alarm_is_critical` returns true for `Alarm_HardLimit`,
    `Alarm_SoftLimit`, `Alarm_EStop`, `Alarm_MotorFault` and `Alarm_ExpanderException`.
  - `protocol.c:468` `if((sys.blocking_event = alarm_is_critical((alarm_code_t)rt_exec))) {`
  - `protocol.c:485-487` `grbl.report.feedback_message(Message_CriticalEvent);`, where
    messages.c:28 has `"Reset to continue"`.
  - `protocol.c:495-509`: the blocking loop serves `?` (l.503-506) and `protocol_poll_cmd()`.
    Inside that, l.428 sends `$` lines to `system_execute_line` and answers other lines
    `Status_SystemGClock`.
  - `system.c:990-994`: `{ "X", disable_lock, { .allow_redirect = On } … }`, `{ "H", home, … }`,
    `{ "HX", home_x }`; none of them has `allow_blocking`.
  - `system.c:1179-1181`
    `if(sys.blocking_event && !cmd->commands[idx].flags.allow_blocking) { retval = Status_NotAllowedCriticalEvent;`
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L1179-L1181
  - `errors.h:113` `Status_NotAllowedCriticalEvent = 79`; `errors.c:101` "Not allowed while critical event is active."
  - G1 past the soft limits:
    `machine_limits.c:647-648` `mc_reset(); … system_set_exec_alarm(Alarm_SoftLimit); // Indicate soft limit critical event`
  - `$J=` past the soft limits: `motion_control.c:834-835` `return Status_TravelExceeded;`
- **reproduction:** `src/__audit_repro__/HF/hf-3-grblhal-critical-alarm-guidance.test.ts`, 3
  cases FAIL:
  - the grblHAL ALARM:1 action does not mention a reset;
  - the grblHAL ALARM:2 action does not mention a reset;
  - `presentError('grblhal', 79)` is null.
- **fix:** local for the text:
  - make the grblHAL (and GRBL, see GP-2) ALARM:1/2 actions say "Reset (Ctrl-X) first, then home
    or unlock";
  - describe grblHAL error 79, plus 45, 46 and 50 from errors.c.

  A Reset control in the Alarm banner can reuse the existing Sleep "Reset controller" control
  (`SafetyNoticeBanner.tsx:64-73`). Decide this once, together with GP-2 and HF-2.

### HF-2 — In its Critical state FluidNC answers `$X` with `ok` but stays locked; KerfDesk records "unlocked"

- **severity:** medium. Not high, because every motion action still gates on the reported
  "Alarm", so nothing acts on the false record. The operator is steered to repeat Unlock, and the
  app never says a reset is needed.
- **verdict:** CONFIRMED (repro; FluidNC v4.0.3 and main source)
- **status:** new
- **failure scenario:**
  1. FluidNC hits a hard limit, a soft limit (for example a `G1` job move past travel) or a hard
     stop. It enters State::Critical and prints `[MSG:INFO: ALARM: Soft Limit]`, `ALARM:2` and
     `[MSG:ERR: Reset to continue]`. The status report still reads "Alarm".
  2. The operator clicks Unlock, from the Alarm banner, the Start-blocked offer or the no-homing
     guide.
  3. FluidNC answers `ok` and stays Critical. v4.0.3 also runs the user's `after_unlock` macro.
  4. KerfDesk applies `controllerUnlockedPatch`: it clears `alarmCode`, logs "Controller
     unlocked…", and the offer path toasts "Alarm cleared. Jog the head…".
  5. The next `<Alarm|…>` report does not restore the code. The banner falls back to "GRBL has
     locked jog, frame, and start until the machine is homed or unlocked." plus
     STATUS_ALARM_START_MESSAGE, and offers `$X` again.
  6. The no-homing guide times out with "…Check the limit switches and the door, then unlock
     again."

  FluidNC's alarm entries carry no action text, so nothing tells the operator a reset is required.
  Ways out: Disconnect, which sends Ctrl-X, or Home on a machine that has homing, because FluidNC
  `$H` works from Critical.
- **kerfdesk evidence:**
  - `src/ui/state/laser-autofocus-actions.ts:36-44` (owned `$X`, then `set(controllerUnlockedPatch);`)
  - `src/ui/state/laser-console-completion.ts:82` `alarmCode: null,`
  - `src/ui/state/laser-status-line.ts:269` `...(alarm ? {} : { alarmCode: null }),` (an Alarm report
    keeps the null)
  - `src/ui/laser/start-blocked-alarm-offers.ts:27-29,83`
  - `src/ui/laser/NoHomingPositionGuide.tsx:194`
  - `src/ui/laser/LaserWindow.tsx:299,314-320`: for FluidNC with a code, the banner returns
    `action`, which is undefined.
  - `src/core/controllers/grbl/response-presentation.ts:113-131`: the FluidNC alarm entries have
    titles only.
- **upstream evidence:**
  - FluidNC v4.0.3 `ProcessSettings.cpp:269-286`: only `if (state_is(State::Alarm)) { … set_state(State::Idle); }`
    unlocks; then `// Run the after_unlock macro even if no unlock was necessary` … `return Error::Ok;`
    https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L269-L286
  - `Protocol.cpp:458-470`: HardLimit, HardStop and SoftLimit lead to
    `set_state(State::Critical); alarm_msg(lastAlarm); report_error_message(Message::CriticalEvent);`
  - `Report.cpp:104` `{ Message::CriticalEvent, "Reset to continue" }`; `Logging.h:78` prefixes
    `"[MSG:ERR: "`.
  - `Report.cpp:436-439`: `case State::Critical:` … `return "Alarm";`
  - `Protocol.cpp:1152-1157`: only the realtime reset leaves Critical.
  - FluidNC main `ProcessSettings.cpp:309-318`: `// Nothing is locked, so $X is a no-op.` …
    `return Error::Ok;`
- **reproduction:** `src/__audit_repro__/HF/hf-2-fluidnc-critical-unlock.test.ts` FAILS:
  `{ outcome: 'resolved', alarmCode: null }`.
- **fix (local):**
  - On FluidNC, treat the `ok` to `$X` as unproven: keep `alarmCode` until a non-Alarm report
    arrives.
  - Latch "reset required" on `[MSG:ERR: Reset to continue]`. This is shared with GP-2 and HF-3.
  - Add action text for FluidNC alarms 1, 2 and 13 ("Reset (Ctrl-X), then home or unlock") and 16
    ("Reboot FluidNC", Report.cpp:119).

### HF-1 — Falcon Home (`$HX` then `$HY`): an Alarm report between the two lines aborts a Home that goes on to succeed

- **severity:** medium. The Home is reported as failed and the homing state is left unknown,
  although the machine homed; retrying works. The window is narrow (see timing).
- **verdict:** PLAUSIBLE.
  - Reproduced in KerfDesk.
  - The grblHAL behaviour is proven from source.
  - Not known: whether the A1 Pro firmware is grblHAL with homing init lock. Creality's own Home
    macro `$HX\n$HY\n` does prove that single-axis homing is enabled on it.
- **status:** new. It corrects the CG track's "checked" note that single-axis homing ends Idle,
  which holds only for stock GRBL.
- **failure scenario:** Falcon profile (kind `grblhal`, Falcon command set) on grblHAL with homing
  init lock.
  1. The machine powers up in ALARM:11, or is Idle after `$X` with the axes still unhomed. The
     operator clicks Home.
  2. `$HX` homes X. Because Y is not yet homed, grblHAL goes back into Alarm (code 11, with no
     `ALARM:` line printed) and acknowledges `ok`.
  3. KerfDesk writes `$HY`. A `?` that reaches grblHAL between the re-lock and the start of `$HY`
     is answered `<Alarm|…>`.
  4. KerfDesk treats that report as a new alarm. It clears the Home owner, and the pending `$HY`
     is rejected with "Controller entered Alarm.".
  5. The machine then homes Y and goes Idle, but the toast says "Home: Controller entered Alarm."
     and `homingState` is `unknown`.

  Timing: status reports while homing are off by default, and grblHAL forces one `<Home|…>`
  report as each cycle starts. A `?` sent during the `$HX` cycle is therefore answered at the end
  of that cycle, still in the Homing state. An Alarm report needs a `?` inside a gap of roughly
  one host round trip. KerfDesk fast-polls every 250 ms during Home, so this is a race of a few
  percent per Home, not every Home.
- **kerfdesk evidence:**
  - `src/core/controllers/falcon-command-contract.ts:24` `home: '$HX\n$HY',`
  - `src/ui/state/laser-home-action.ts:150-162`: one owned command per line.
  - `src/ui/state/laser-home-action.ts:279`
    `...(fromAlarm ? { awaitingFirstNonAlarmReport: true } : {}),`
  - `src/ui/state/laser-home-alarm-reply.ts:27-36,55-70`: the stale-Alarm window exists only
    before the first non-Alarm report of the whole Home. `$HX`'s `<Home|…>` closes it, and a Home
    that starts from Idle never opens it.
  - `src/ui/state/laser-status-line.ts:54`, then `handleInvalidatingStatus` (l.252-293):
    `controllerOperation: null` (281), `homingState: 'unknown'` (286),
    `cancelControllerLifecycleRefs(refs, \`Controller entered …\`)` (293).
  - `src/ui/state/laser-connection-actions.ts:78` `const STATUS_POLL_MS = 250;`
- **upstream evidence:**
  - grblHAL `system.c:494-505` (`go_home`): `state_set(STATE_IDLE);` … `else if(limits_homing_required()) { // Keep alarm state active if homing is required and not all axes homed.`
    `sys.alarm = Alarm_HomingRequired; state_set(STATE_ALARM); }`
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L494-L505
  - `machine_limits.c:668-673` (`limits_homing_required`)
  - `system.c:483-487`: single-axis homing is allowed in Idle or Alarm.
  - `protocol.c:145-153`: power-up alarm 11 with init lock.
  - `config.h:745-753` `DEFAULT_REPORT_WHEN_HOMING Off`
  - `motion_control.c:918-923` (forced report at cycle start) and `:960` (a pending `?` is served
    after the cycle).
- **reproduction:** `src/__audit_repro__/HF/hf-1-falcon-home-relock.test.ts`
  - The control case, with no report between the lines, passes.
  - 2 cases FAIL with `{ outcome: 'Controller entered Alarm.', homingState: 'unknown' }`: one
    starting from ALARM:11, one starting from Idle after `$X`.
- **fix (local):** For every further line of a multi-line Home, re-open the stale-Alarm tolerance,
  whether or not the Home started in Alarm. A real failure still arrives as `ALARM:N` or `error:N`
  on the owned line.

### HF-6 — FluidNC's long command names and `$NVX` get past the Console's block on `$RST=`

- **severity:** low. The operator types the command, and the Frame-first contract still shows the
  real outline.
- **verdict:** CONFIRMED (repro and FluidNC source)
- **status:** incomplete fix of ADR-362 decision 1 ("every `$RST=` form is blocked").
- **failure scenario:** FluidNC profile.
  - `$Settings/Restore=#` (or `=gcode`, `=$`, `=*`) is FluidNC's long name for `$RST=`. KerfDesk
    prepares it as an ordinary command (kind `gcode`, effect `machine-state`, no confirmation) and
    sends it. FluidNC resets every G54–G59, G28 and G30 offset, or the settings, or both.
  - `$NVX` / `$Settings/Erase` runs `nvs.erase_all()`, which erases the settings and the stored
    coordinate offsets.
  - The `machine-state` effect keeps `workOriginSource`, so the store goes on believing in a
    persistent origin that the controller has erased.
  - Milder cases:
    - `$Home`, `$Home/X` and `$H=XY` are classified as `machine-state` rather than `reference`, so
      the homing state and origin are not invalidated.
    - `$Alarm/Disable` is not treated as the owned unlock.
- **kerfdesk evidence:**
  - `src/core/controllers/grbl/console-command.ts:55-57` (the block check)
  - `src/core/controllers/grbl/console-command.ts:83-85`
    `/^\$H(?:[XYZABC])?$/i.test(compact) ? 'reference'`
  - `src/core/controllers/grbl/console-command.ts:144-146`
    `return /^\$RST=/.test(upper) || STARTUP_WRITE_RE.test(upper) || BUILD_INFO_WRITE_RE.test(upper);`
  - `src/core/controllers/fluidnc/driver.ts:38-53` (only read-only reports are special-cased)
  - `src/ui/state/laser-console-actions.ts:315-316`: `case 'machine-state': return positionPatch;`
- **upstream evidence:** FluidNC v4.0.3 `ProcessSettings.cpp`:
  - `:1067` `new UserCommand("RST", "Settings/Restore", restore_settings, notIdleOrAlarm, WA);`
    https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1067
  - `:1034` `new UserCommand("NVX", "Settings/Erase", Setting::eraseNVS, notIdleOrAlarm, WA);`
  - `:1044-1047` `"H", "Home"`, `"HX", "Home/X"` …
  - `:1100-1101`: the key matches `getGrblName()` or `getName()` with `equal_ignore_case`.
  - `:540-556` (`restoreCommands`: `#`/`gcode`, `$`/`settings`, `*`/`all`) and `:157-162`
    (coordinate reset).
  - `:425-455`: `$H=<axes|cycles>` homes the listed axes.
  - `Settings.h:136-139` `nvs.erase_all();`
  - Authentication is compiled out: `Config.h:29` `// #define ENABLE_AUTHENTICATION`, and
    `ProcessSettings.cpp:64-66` `auth_failed` returns `false`.
  - FluidNC main is the same: `ProcessSettings.cpp:1089`, `:1122`, `:1161`.
- **reproduction:** `src/__audit_repro__/HF/hf-6-fluidnc-long-form-restore.test.ts`
  - The control case (`$RST=#` is blocked) passes.
  - 5 cases FAIL: `$Settings/Restore=#`, `$settings/restore=gcode`, `$Settings/Restore=*`, `$NVX`
    and `$Settings/Erase` are all prepared (`ok: true`).
- **fix (local):** In `prepareFluidncConsoleCommand`:
  - map FluidNC long names to their Grbl names (case-insensitive) before the shared classifier;
  - block `$RST=`, `$Settings/Restore=`, `$NVX` and `$Settings/Erase`;
  - classify `$Home…` and `$H=…` as `reference`, and `$Alarm/Disable` as the unlock.

### HF-4 — Falcon: when Release motors is refused, the message says to set `$62=1`, which the Falcon profile cannot write

- **severity:** low (misleading text). It sits on the Falcon's default flow. With the grblHAL
  defaults it also leaves a sticky `error:3` (HF-7).
- **verdict:** CONFIRMED in KerfDesk (reproduced through the store). It shows whenever the Falcon
  firmware answers `$SLP` with `error:3`, which is grblHAL's answer when sleep is off, the default.
- **status:** new. Same class as the ADR-370 `$152` advice.
- **failure scenario:**
  1. The Falcon profile inherits `homing.enabled: false`, so the no-homing guide ("Position job")
     is the default flow. Its first action is Release motors, which sends `$SLP`.
  2. The firmware answers `error:3`.
  3. KerfDesk shows "Sleep ($SLP) is disabled in this grblHAL build ($62=0). Set $62=1 in the
     controller settings to release the motors from KerfDesk."
  4. That advice cannot be followed from KerfDesk:
     - The Falcon Console refuses `$62=1` ("KerfDesk does not send numeric $ setting writes other
       than $150, $151, $152 …").
     - The contract has no settings panel.
     - `$62=0` was never read, because the contract sends no `$$`. On some builds `$62` does not
       exist at all.
- **kerfdesk evidence:**
  - `src/ui/state/controller-sleep.ts:15-16,30-38`: `sleepRefusalMessage` checks only
    `activeControllerKind === 'grblhal'`.
  - `src/ui/state/laser-origin-actions.ts:296-300`
  - `src/core/controllers/falcon-command-contract.ts:14-20` (`settings: 'none'`,
    `firmwareSetupPanel: 'none'`) and `:45-46,54-58` (only `$150–$152`).
  - `src/core/controllers/console-setting-writes.ts:21-37`
  - `src/ui/laser/NoHomingPositionGuide.tsx:56,133-138`
  - `src/core/devices/device-profile.ts:365`
- **upstream evidence:**
  - grblHAL `system.c:574-575` `if(!settings.flags.sleep_enable) return Status_InvalidStatement;`
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L572-L576
  - `config.h:841-843` `DEFAULT_SLEEP_ENABLE Off`; `settings.c:80`
  - `settings.c:2141-2142`: `$62` exists only when `SLEEP_DURATION > 0.0f`.
- **reproduction:** `src/__audit_repro__/HF/hf-4-falcon-sleep-refusal-advice.test.ts` FAILS. The
  refusal contains `$62=1` while the Console refuses `$62=1`.
- **fix (local):**
  - Name `$62=1` only when the driver can write it (`capabilities.settings === 'grbl-dollar'`, or
    `consoleSettingWriteIssue` allows it).
  - State "($62=0)" only if `$$` reported it.
  - Otherwise say the firmware refused `$SLP` (sleep disabled or not supported) and that the
    motors are still energized.

### HF-8 — grblHAL at COMPATIBILITY_LEVEL ≥ 1 prints the stock "Grbl 1.1f" banner, and KerfDesk treats it as a firmware mismatch

- **severity:** low. The advisory is wrong and cannot be cleared. Following it on the Falcon
  costs the 1024-byte streaming window and the vendor bed convention.
- **verdict:**
  - CONFIRMED as a mechanism: the upstream banner is proven from source, and KerfDesk is
    reproduced.
  - PLAUSIBLE for the Falcon, whose banner is not recorded anywhere in the repository.
- **status:** new
- **failure scenario:** grblHAL built at COMPATIBILITY_LEVEL ≥ 1, the documented option for
  "reporting itself as Grbl", prints `Grbl 1.1f ['$' for help]`. With a grblHAL profile (for
  example the Falcon catalog profile, whose vendor file labels the device GRBL-LPC):
  - Detection returns `grbl-v1.1`.
  - Every banner logs "[lf2] Controller banner looks like grbl-v1.1, but the profile selected
    grblhal. Check the device profile's controller setting."
  - Every Job Review warns "…the firmware banner identifies GRBL 1.1. Reconnect using the selected
    profile…". Reconnecting cannot change it.
  - Machine Setup shows "Connection does not match the setup draft" and offers "Use detected GRBL
    1.1 in draft". On the Falcon profile that keeps the command set but:
    - drops the window from 1024 to 120 bytes, bringing back the ADR-331 stop-and-go;
    - with the kind no longer `grblhal`, loses the vendor bed convention for good.
  - Even without that change, a homed Falcon loses its vendor bed frame on this banner and falls
    back to "the controller-to-bed coordinate mapping is unverified".
- **kerfdesk evidence:**
  - `src/core/controllers/detect-controller.ts:16-17`
    `{ kind: 'grblhal', pattern: /^GrblHAL [\d.]+/i }, { kind: 'grbl-v1.1', pattern: /^Grbl [\d.]+/i },`
  - `src/ui/state/laser-line-handler.ts:337`
  - `src/ui/laser/controller-identity-warnings.ts:35-40`
  - `src/ui/laser/device-setup/DeviceSetupConnectStep.tsx:47-51,157-169`
  - `src/ui/laser/device-setup/device-setup-controller-selection.ts:15-21`
  - `src/core/devices/controller-profile-compatibility.ts:119-130`
  - `src/ui/state/native-bed-frame.ts:104-105`
    `evidence.activeControllerKind === 'grblhal' && (evidence.detectedControllerKind == null || evidence.detectedControllerKind === 'grblhal')`
- **upstream evidence:**
  - grblHAL `report.c:311-315`:
    `#if COMPATIBILITY_LEVEL == 0 write(… "GrblHAL " GRBL_VERSION " ['$' or '$HELP' for help]" …); #else write(… "Grbl " GRBL_VERSION " ['$' for help]" …);`
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L311-L315
  - `config.h:89`: "Set to `1` to disable some extensions, and for reporting itself as "Grbl"."
  - `grbl.h:40-43`: `GRBL_VERSION "1.1f"` at every level, so grblHAL never prints "1.1h".
  - `report.c:918-920`: `extended = true` only at level 0. `[FIRMWARE:grblHAL]` (l.1111) is
    printed only in the extended report, so at level ≥ 1 a plain `$I` does not identify grblHAL
    either.
- **reproduction:** `src/__audit_repro__/HF/hf-8-grblhal-compat-banner-identity.test.ts`
  - The control case (a "Grbl 1.1h" banner is still flagged) passes.
  - The consequence case (the 120-byte window after "Use detected") passes, as documentation.
  - 3 cases FAIL:
    - the Job Review mismatch warning;
    - the Falcon vendor bed frame is withdrawn;
    - the connect-time notice.
- **fix (local):**
  - Treat "Grbl 1.1f" as ambiguous (stock GRBL 1.1f, or grblHAL at level ≥ 1). For a grblHAL
    profile, show no mismatch and offer no "Use detected"; keep both for other versions.
  - With the Falcon command set, accept a "Grbl …" banner in `hasVendorPositiveContract`. The
    vendor file itself labels the device GRBL-LPC.

### HF-5 — Wake from Sleep is reported as failed; grblHAL and FluidNC restart into Alarm by design

- **severity:** low
- **verdict:** CONFIRMED (reproduced through the store for both firmwares)
- **status:** new. Merge with CG-8 (stock GRBL); see Overlaps.
- **failure scenario:**
  1. Release motors (`$SLP`) puts the controller in Sleep.
  2. The operator wakes it with Wake or "Reset controller", which sends Ctrl-X.
  3. The firmware comes back in Alarm:
     - grblHAL re-enters Alarm and prints `[MSG:'$H'|'$X' to unlock]`;
     - FluidNC prints `ALARM:3` before its banner.
  4. `wakeController` waits for a fresh Idle, so the Alarm report or the `ALARM` line rejects it.
     The log says "Controller recovery failed" and the toast says "Wake: Controller entered
     Alarm." or "Wake: ALARM:3".

  The no-homing guide already expects this; the Sleep banner path does not.
- **kerfdesk evidence:**
  - `src/ui/state/laser-controller-recovery-actions.ts:88-90`
    `await waitForFreshIdle(refs, { kind: 'recovery', requiredReports: 1 });`, and l.105 logs the
    failure.
  - `src/ui/laser/LaserWindow.tsx:174`
  - `src/ui/laser/NoHomingPositionGuide.tsx:141-155`
  - `src/__fixtures__/controllers/grbl-sim-machine.ts:225-228`: a reset from Sleep goes to Idle,
    which does not match any of the three firmwares.
- **upstream evidence:**
  - grblHAL `protocol.c:167-174`
    `} else if (state_get() & (STATE_ALARM|STATE_SLEEP)) { … // Re-initialize the sleep state as an ALARM mode … state_set(STATE_ALARM);`
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L167-L174
  - The state survives the reset loop: `sys_state` is static in state_machine.c (l.55), and the
    reset loop clears only `sys` (grbllib.c:458-461).
  - FluidNC v4.0.3 `Protocol.cpp:1158-1159`
    `} else if (state_is(State::Sleep)) { protocol_do_alarm((void*)ExecAlarm::AbortCycle);`
    https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Protocol.cpp#L1158-L1159
  - FluidNC `alarm_msg` (l.228-232) prints `ALARM:3`, and then the soft restart prints the banner
    (l.397).
- **reproduction:** `src/__audit_repro__/HF/hf-5-wake-from-sleep-alarm.test.ts`, both cases FAIL
  (grblHAL `'Controller entered Alarm.'`, FluidNC `'ALARM:3'`).
- **fix (local):**
  - Accept the post-reset Alarm as a completed wake on the GRBL family: resolve, and let the Alarm
    banner take over.
  - Fix the simulator's reset-from-Sleep state.

## Answers to the partial's "Still to check"

**1. The Falcon's banner and firmware identity.** Neither is recorded in the repository. The only
live evidence is a maintainer's report, `<Idle|MPos:191.500,106.500,-21.100,0.000|Bf:512,65535|FS:0,0>`.
Its 4 axes and 512 planner blocks fit grblHAL but do not show the compatibility level. What
KerfDesk does, for each banner the A1 Pro could print:

| banner | detected | notice / Job Review | vendor bed frame (homing on, homed) | RX window |
|---|---|---|---|---|
| `GrblHAL 1.1f ['$' or '$HELP' for help]` (grblHAL level 0) | grblhal | none | yes | 1024, bounded by `Bf:` |
| `Grbl 1.1f ['$' for help]` (grblHAL level ≥ 1, or a GRBL-LPC-style build, the vendor's own label) | grbl-v1.1 | mismatch at every banner and every Job Review; Machine Setup offers "Use detected GRBL 1.1" (HF-8) | withdrawn (HF-8) | unchanged; 120 if the operator follows the advice |
| no banner (opening the port does not reset the board) or vendor text | null | "identity unconfirmed" note at each Job Review; jobs with dwells show no time estimate (`canvas-job-timing-plan.ts:106-116` needs a detected kind) | kept (`null` is accepted) | unchanged |

Only the middle row is wrong behaviour; it is HF-8. The table also sorts the grblHAL findings:

- A grblHAL-based Falcon has exactly one of HF-7 (level 0, "GrblHAL" banner) or HF-8 (level ≥ 1,
  "Grbl 1.1f" banner). The banner in the Console says which.
- HF-1 needs grblHAL (any level) with homing init lock.

An unrecognised reboot banner is not handled as a reset boundary:

- `handleWelcomeLine` returns early (`laser-line-handler.ts:318-319`);
- the worker's refill check needs a recognised banner (`serial-worker-core.ts:190-195`).

This applies to every firmware, not only the Falcon. Both grblHAL banners and the stock GRBL
banner are recognised, so it is listed under "Not covered".

**2. Can `select-controller-driver` pair the Falcon command set with the FluidNC or Marlin
drivers?** No, and the pairing that can reach it is harmless. See "Checked and correct".

## Overlaps for the lead

- **HF-2 + HF-3 + GP-2: one root cause.** KerfDesk has no "reset required" state. All three
  firmwares announce it with "Reset to continue", and each then does something different:

  | firmware | message | answer to `$X` / `$H` | finding |
  |---|---|---|---|
  | stock GRBL | `[MSG:Reset to continue]` | no answer at all (owed-ack wedge) | GP-2 |
  | grblHAL | `[MSG:Reset to continue]`, messages.c:28 | `error:79` | HF-3 |
  | FluidNC | `[MSG:ERR: Reset to continue]` | `ok`, with no effect | HF-2 |

  One fix covers all three:
  - latch "reset required" on that message, and on the critical codes:
    - GRBL 1/2;
    - grblHAL 1/2/10/17/20;
    - FluidNC 1/2/13/16;
  - offer Reset (Ctrl-X), reusing `SafetyNoticeBanner.tsx:64-73`;
  - hold Unlock and Home until the reboot banner;
  - fix the ALARM:1/2 text.
- **HF-5 + CG-8:** the same `wakeController` fix, for grbl, grblhal and fluidnc.
- **HF-7 confirms the ST track's lead** ("grblHAL sticky G-code error", `ST-partial.md`). Mid-job
  the error is absorbed, because a stream error soft-resets the controller. The damage happens
  outside jobs, and in the ADR-361 release marker.
- **CG-partial "Checked and correct":** "Falcon Home `$HX` then `$HY` … single-axis homing ends
  Idle" is true only for stock GRBL. grblHAL goes back into Alarm between the lines (HF-1).
- **GP-7** (the Home budget assumes `<Home|…>` replies) also applies to grblHAL. Status while
  homing is off by default (config.h:745-753); only one forced report comes at the start of each
  cycle (motion_control.c:918-923).
- **CG-2** covers the Falcon's never-read `$G` (the G54 normalisation in Frame). It is not
  repeated here.
- **HF-4 ↔ HF-7:** on a level-0 grblHAL Falcon with sleep off, the no-homing guide's Release
  motors shows HF-4's text and also leaves `error:3` sticky (HF-7), so the next jog is refused and
  stays stuck.

## Checked and correct

- **`select-controller-driver`** (still-to-check 2). The Falcon command set pairs only with
  `grblhal` and `grbl-v1.1`. For `fluidnc`, `marlin`, `smoothieware` and `ruida` the plain driver
  is returned (`select-controller-driver.ts:22-40`).
  - Every consumer goes through `selectControllerDriver` or the live driver's `commandSet`:
    - `native-bed-frame.ts:102-103`;
    - `machine-setup-controller-guide.ts:35-38`;
    - `ConnectedMachineProfile.tsx:18`;
    - `AlarmRecoveryActions.tsx:57-61`;
    - `JobSetupControls.tsx:56`;
    - `DeviceSetupConnectStep.tsx:47-51`.

    So a mismatched pair is inert.
  - Machine Setup drops the command set when a non-GRBL family is chosen
    (`device-setup-controller-selection.ts:13-21`).
  - Only a hand-edited or imported profile or project can carry the pair. Those checks validate
    each field on its own (`machine-profile-shape.ts:119-127`,
    `project-controller-normalization.ts:10-15`), and the command set is then ignored.
- **Banner detection** recognises each firmware's default banner:
  - grblHAL level 0 → grblhal (report.c:311-312);
  - FluidNC's default `$Start/Message` `"Grbl \V [FluidNC \B (\X) \H]"` → fluidnc
    (FluidNC v4.0.3 SettingsDefinitions.cpp:107-108, Report.cpp:141-165,
    git-version.py:62 `grbl_version`);
  - stock GRBL → grbl-v1.1.
- **The RX window at Start** comes from the active driver kind plus live `Bf:` evidence, not the
  banner (`laser-job-effective-stream-options.ts:60-99`). `profileWithControllerFacts`, which
  would adopt the detected kind, has no production caller (`core/devices/profile-application.ts:23-50`;
  tests only).
- **No sticky parser error outside grblHAL:**
  - FluidNC parses every line independently (ProcessSettings.cpp:1224-1253);
  - stock GRBL answers an empty line `ok` (protocol.c:93-95).

  A soft reset clears grblHAL's `last_error` (gcode.c:787, gcode.h:719), so Stop, Abort, the
  error auto-stop, Disconnect and Wake all end a sticky error.
- **`$SLP` and `$62` on generic grblHAL:**
  - grblHAL refuses `$SLP` with `error:3` when sleep is off (system.c:572-576), and sleep is off
    by default (config.h:841-843).
  - KerfDesk disables Release motors when `$$` reported `$62=0` (`controller-sleep.ts:20-27`), so
    only the Falcon path is affected (HF-4).
- **grblHAL answers `?` inside its critical-event loop** (protocol.c:503-506), so KerfDesk keeps
  receiving Alarm reports and never sees a stale Idle.
- **FluidNC `$H` works from Critical.** `allowConfigStates` allows Critical (Settings.cpp:58-60),
  and `home()` has no Critical check (ProcessSettings.cpp:387-411). Offering Home there is
  therefore valid.
- **Alarm and error tables:**
  - grblHAL alarms 1–22, including the split meaning of code 10 (alarms.h:29-53, alarms.c:29-52);
  - grblHAL errors 1–38, which match stock GRBL (errors.h:31-71);
  - FluidNC alarms 1–18 (Alarm.h:4-24, Protocol.cpp:28-48), which match
    `response-presentation.ts:113-131`.
- **Status parsing:**
  - grblHAL states (report.c:1259-1314) and Door substates 0–4 (system.h:139-143);
  - FluidNC states, where Critical and ConfigAlarm report as "Alarm" (Report.cpp:421-457);
  - FluidNC always reports at least 3 axes (Machine/Axes.cpp:188-191).
- **RX buffers and `Bf:`:**
  - grblHAL `RX_BUFFER_SIZE 1024` (stream.h:52-53); `Bf:` is planner blocks free plus RX bytes
    free (report.c:1341-1347).
  - FluidNC's `Bf:` RX value is the free space of the UART FIFO (esp32/fnc_uart.cpp:161-167, with
    a 256-byte ring at l.47-49). KerfDesk keeps the profile window, which is conservative.
- **Jog-cancel:** grblHAL's jog-cancel flushes the RX buffer and inserts CAN (protocol.c:896-906,
  stream.h:372). KerfDesk never queues a line behind an active jog.
- **FluidNC line limit:** more than 127 characters gives `error:14` (GCode.cpp:246-249).
- **Falcon contract:** no `$J=`, `$$`, `$I` or 0x85; Frame sends `M5` and no `M9`; the
  `$150–$152` 0–100 writes (Creality A1 parameter page, re-fetched by the earlier session on
  2026-09-25).

## Not covered

- **No hardware.** The A1 Pro's banner, compatibility level, homing init lock, `$62`/`$SLP`
  support and soft limits are unknown. HF-1, HF-4, HF-7 and HF-8 affect the Falcon only
  conditionally on them.
- **grblHAL keeps G92 through a reset and a power cycle by default** (`$384`, config.h:882-894;
  gcode.h:722-726). KerfDesk's model assumes a reset clears G92 (`laser-status-line.ts:337-342`,
  `origin-actions.ts` header). Placement compensates any WCO it observes
  (`job-placement.ts:208-219`), so the effect is probably limited to origin labels. Not traced;
  lead for CG/OR.
- **Unrecognised reboot banners** (vendor-rewritten, or a FluidNC `$Start/Message` changed by an
  OEM) are not treated as a reset boundary; see above.
- **Sticky errors during a CNC tool-change hold** (touch-off lines followed by Continue): not
  traced (ST/CN).
- **grblHAL MPG takeover** (the ST track's lead): not traced.
- **FluidNC v4.0.3 runs the `after_unlock` macro on `$X` even in Critical**
  (ProcessSettings.cpp:283-284; fixed on main, l.313-318). FluidNC executes G-code in Critical
  (ProcessSettings.cpp:1242 blocks only Alarm, ConfigAlarm and Jog). KerfDesk gates motion on the
  reported "Alarm"; not traced further.
- **Descriptions for grblHAL error codes 39 and above**, other than 79: not reviewed one by one.
