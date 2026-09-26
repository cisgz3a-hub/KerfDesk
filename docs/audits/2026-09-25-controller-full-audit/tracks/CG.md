# Track CG — every machine control against every controller's capabilities (final track report)

Auditor: track CG (completed from `CG-partial.md`, which is left in place). Checked on the shared
checkout of `claude/focused-tesla-kb5if0` (HEAD e2e323b), 2026-09-25. No hardware.

- **Result:** 11 findings: 2 high, 4 medium, 5 low. Every finding has a reproduction except CG-5 and
  CG-7 (traced) and one sub-case of CG-9 (traced).
- **Repro tests:** `src/__audit_repro__/CG/` (10 test files, 19 tests). The 16 defect tests FAIL on
  the audited code and the 3 refutation controls pass. Run with
  `cd /home/user/KerfDesk && pnpm vitest run src/__audit_repro__/CG/`.
  - Helper: `src/__audit_repro__/CG/upstream-smoothie-fake.ts`. It is a Smoothieware V1 board that
    follows upstream for: Ctrl-X halt with no banner, the halted allow-list, SimpleShell `ok` rules,
    optional move timing, and an optional G92 model.
  - The CG files type-check (`tsc --noEmit` clean) and are Prettier-formatted. Like MA's
    `marlin-fifo-model.ts`, the fakes do not pass lint (complexity, max-lines,
    `boundaries/no-unknown-files`). They are scratch evidence: move or delete them before the PR.
- **Upstream source:** read locally at
  `/tmp/claude-0/-home-user-KerfDesk/846e3de7-61bf-5e5a-9b17-06175ede7599/scratchpad/upstream/`.
  The revisions are the brief's; each revision was checked with `git rev-parse`.

| id | severity | verdict | title |
|---|---|---|---|
| CG-12 | high | CONFIRMED (repro) | The keyboard Abort (Ctrl/Cmd+.) does not stop a Frame or jog on Smoothieware, the Falcon contract or Marlin |
| CG-1 | high (Marlin) / medium (Smoothieware) | CONFIRMED (repro) | After "Set origin here", origin placements cannot Frame on the g92-only drivers |
| CG-2 | medium | CONFIRMED (repro) | Frame's G54 "normalization" makes KerfDesk forget, or erase, the operator's G92 origin |
| CG-11 | medium | CONFIRMED (repro) | Reset origin on a stock Marlin build is a silent no-op that KerfDesk records as done |
| CG-9 | medium | CONFIRMED (repro; `$HZ1` sub-case traced) | Auto-focus bypasses the driver's command policy: a Smoothieware shell command wedges the session |
| CG-3 | medium | CONFIRMED (repro) | After Abort on Smoothieware, qualification stays "Waiting for fresh Idle" for the rest of the session |
| CG-4 | low | CONFIRMED (repro) | On a halted Smoothieware board the alarm fix offers Home, which the halted board always refuses |
| CG-10 | low | CONFIRMED (repro) | Marlin Abort and Disconnect never switch air assist off; Abort also shows air as OFF |
| CG-5 | low | CONFIRMED (trace) | Smoothieware jog, Frame and Home send M9, so Manual Air shows ON while the air is off |
| CG-7 | low | CONFIRMED (trace) | "Read ($$)" is offered on drivers that have no settings query |
| CG-8 | low | CONFIRMED (repro) | Wake from Sleep is reported as failed on stock GRBL 1.1h (extends HF-5) |

---

## Findings (most severe first)

### CG-12 — The keyboard Abort (Ctrl/Cmd+.) does not stop a Frame or jog on controllers without a jog-cancel byte

- **severity:** high. The brief's scale puts "a stop that does not stop" at critical. I rate it high
  for three reasons:
  - the beam is off during Frame and jog;
  - the motion is bounded by the Frame perimeter or the jog step;
  - the on-screen ABORT MOTION button does stop it (except on Marlin, see MA-7).

  If the lead treats Ctrl+. as the non-negotiable-9 path (the Abort that stays reachable when a
  modal covers the bar), rate it critical.
- **verdict:** CONFIRMED (repro against an upstream-shaped Smoothieware board; traced for the Falcon
  contract and Marlin).
- **status:** new.
- **failure scenario:**
  - Smoothieware, Falcon A1 Pro contract or Marlin. A Frame (or a step jog) is moving and the
    operator presses Ctrl+. to stop it.
  - The shortcut calls `cancelJog()`. On these drivers that writes nothing and then waits for the
    motion to finish.
  - The head traces the rest of the perimeter. The operator gets no error.
  - The Live Motion bar's ABORT MOTION for the same motion calls `stopJob`, which sends Ctrl-X on
    Smoothieware and Falcon and does stop.
- **kerfdesk evidence:**
  - `src/ui/laser/use-job-shortcuts.ts:4`: `//   Ctrl/Cmd+.       → Request the controller-specific Abort`.
    `:53-58`: "Same precedence as the Live Motion bar … the keyboard Abort must stop whatever the bar
    offers ABORT or LASER OFF for … Jog and Frame keep the gentler jog-cancel."
    `:66`: `if (laser.motionOperation !== null) return { label: 'Stop motion', run: () => laser.cancelJog() };`
  - `src/ui/state/laser-motion-cancel.ts:120-121`:
    `const jogCancel = context.refs.driver.realtime.jogCancel; if (jogCancel === null) return undefined;`
    Settlement then waits for the motion (`:52-58`).
  - `src/ui/laser/LiveMotionBar.tsx:64`:
    `const abort = description.abortLabel === 'LASER OFF' ? () => setFireActive(false) : stopJob;`
    For a jog or Frame the bar's ABORT MOTION therefore calls `stopJob`.
  - The code already knows about this gap elsewhere. `src/ui/laser/rotary-test-rotation.ts:135-137`:
    `await (moving && !state.capabilities.jogCancel ? state.stopJob() : state.cancelJog());`
  - `jogCancel` is null on:
    - `src/core/controllers/smoothieware/driver.ts:34,60`
    - `src/core/controllers/marlin/driver.ts:33,59`
    - `src/core/controllers/falcon-command-contract.ts:17,21` (`realtime: { ...driver.realtime, jogCancel: null }`)
  - `PROJECT.md:454` (non-negotiable 9): "the software Abort / Controller Reset control is reachable
    from any window state during a job. No modal can block it."
- **upstream evidence:**
  - None of these controllers can cancel an ordinary G-code move.
  - GRBL's jog cancel acts only on `$J=` jogs. gnea/grbl `grbl/serial.c:159-162`:
    `case CMD_JOG_CANCEL: if (sys.state & STATE_JOG) { // Block all other states from invoking motion cancel.`
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L159-L162
    So nulling the byte for the Falcon's plain-`G1` Frame is correct; the gap is in the shortcut.
  - Smoothieware stops queued moves only by halting. `src/libs/USBDevice/USBSerial/USBSerial.cpp:204-207`
    `if(b == 'X' - 'A' + 1) { // ^X … halt_flag = true;`, and `:302-313` `on_idle` →
    `THEKERNEL->call_event(ON_HALT, nullptr);`.
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L204-L313
  - Marlin has no realtime byte. Only M410 or M112 stop the planner (see MA-7).
- **reproduction:** `src/__audit_repro__/CG/stop-shortcut-without-jog-cancel.test.ts`.
  - "Ctrl+. stops the Frame motion on Smoothieware" FAILS:
    `["?","?","?","?","?","?"]: expected { resetSent: false, stillMoving: true } to deeply equal { resetSent: true, stillMoving: false }`.
  - Control "the Live Motion bar's ABORT MOTION (stopJob) does stop it" passes.
- **fix:** local. In `stopShortcutAction`, use `cancelJog()` for a jog or Frame only when
  `capabilities.jogCancel`; otherwise use `stopJob()`, exactly as the bar and
  `stopRotaryTestMotion` do. On Marlin this only helps once MA-7 (M410) is decided.
- **overlap:** MA-7 (Marlin Abort cannot stop the planner at all).

### CG-1 — After "Set origin here", origin placements cannot Frame on the g92-only drivers (Marlin, Smoothieware)

- **severity:** high on Marlin, medium on Smoothieware.
  - Marlin: no placement mode can Frame, so nothing can Start, until Reset origin. On stock builds
    Reset origin clears only KerfDesk's record (CG-11), so the Absolute Frame that follows is
    displaced by the retained shift.
  - Smoothieware: User Origin never resolves. Verified Origin and Current Position still work.
- **verdict:** CONFIRMED (repro + upstream).
- **status:** new.
- **overlaps:**
  - MA-2 covers the Marlin User, Current and Absolute refusals.
  - SM-1 covers the Smoothieware Absolute displacement.
  - Unique here: the Smoothieware User Origin refusal, and Marlin Verified Origin, which MA-2 lists
    as the mode that works, is refused at Frame dispatch.
- **failure scenario:**
  - Smoothieware:
    1. Jog, then "Set origin here" (`G92 X0 Y0`, acknowledged).
    2. Frame in User Origin. This is the no-homing default, and Set origin switches Absolute to it
       (`OriginRow.tsx:234-237`).
    3. It is refused for good: "The work origin is set, but the controller has not reported where it
       is yet. Wait a moment and try again, or Reset origin and set it again where the job should
       start." Neither suggestion can help.
    4. "Go to work zero" also stays disabled (`OriginRow.tsx:302` needs `wcoCache !== null`).
  - Marlin (from the second Frame of a session; the first one hits CG-2 instead):
    1. After Set origin, User Origin, Absolute and Current Position are refused (no WCO).
    2. Verified Origin resolves, but Frame dispatch refuses with "The controller did not report a
       usable work position." (`frame-dispatch-support.ts:17-18`).
- **kerfdesk evidence:**
  - `src/ui/state/laser-origin-actions.ts:153-157`: "g92-only (Smoothie) / WCS-less (Marlin)
    controllers never report WCO, so skip the wait there."
    `:338-349` `transientXyOriginPatch`: `inferredMachinePosition === null || priorWco === null ? null`
    means `wcoCache` stays null.
  - `src/ui/job-placement.ts`:
    - `:251-270` `resolveUserOrigin`: `if (wco === null) return { ok: false, messages: [CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE] };`
    - `:208-219` `resolveAbsolute` refuses a custom origin with no known WCO.
    - `:323-326` `knownWco = machine.wcoCache ?? machine.statusReport?.wco ?? null`.
    - Inconsistency: `:305-310` `currentWorkPosition` already derives the offset as MPos − WPos
      from the same frame (`subtractAxis(normalizedAxis(report.mPos, …), work)`). So Current
      Position works on Smoothieware while User Origin and Absolute ignore the same data.
  - `src/core/controllers/grbl/status-parser.ts:176` `wco: pickAxisField(fields, 'WCO')`.
    `src/ui/state/laser-status-position.ts:51-53`
    `if (report.wco === null) return { statusReport: report, … }`: WCO is never derived.
  - `src/core/controllers/marlin/response.ts:42-58`: M114 → `{ mPos: {x,y,z}, wPos: null, wco: null }`.
  - Marlin dispatch refusal:
    - `src/ui/state/canvas-motion-plan.ts:373-374` `if (wcoRaw === null && machine.workOriginActive === true) return null;`
    - → `src/ui/laser/frame-dispatch-support.ts:106-111` `currentWorkXy`
    - → `src/ui/laser/use-frame-action.ts:292-295` and `frame-trace-flow.ts:154-156`
      `reportFrameRefusal([FRAME_WORK_POSITION_UNKNOWN_MESSAGE])`.
- **upstream evidence:**
  - Smoothieware `src/libs/Kernel.cpp:217,234` (running) and `:271,287` (idle): every `?` report
    appends `|MPos:` and `|WPos:`, never `WCO:`. `src/modules/robot/Robot.cpp:449-455` `mcs2wcs`:
    `pos - wcs_offsets[current_wcs] + g92_offset - tool_offset`. So MPos − WPos is the whole work
    offset.
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L261-L287
  - Marlin 2.1.2.8 `Marlin/src/module/motion.cpp:192-193`:
    `inline void report_logical_position(const xyze_pos_t &rpos) { const xyze_pos_t lpos = rpos.asLogical();`.
    M114 prints logical (work) coordinates with no offset field.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/motion.cpp#L192-L212
- **reproduction:** `src/__audit_repro__/CG/g92-only-origin-frame.test.ts`.
  - "Smoothieware: a Set origin that succeeded lets a User Origin Frame resolve its placement" FAILS
    (`CUSTOM_ORIGIN_LOCATION_UNKNOWN`).
  - "Smoothieware: an Absolute Frame compensates the offset the board reports" FAILS (`{"ok":true}`,
    no offset; this is SM-1's case).
  - "Marlin: at least one placement mode can still Frame once an origin is set" FAILS. Absolute,
    Current and User are refused; Verified resolves but `currentWorkXy` is undefined.
- **fix:**
  - Smoothieware, local: when a report carries MPos and WPos but no `WCO:`, derive
    `wco = MPos − WPos` in `statusPositionPatch`. It then feeds `wcoCache` and `workOriginActive`
    exactly as GRBL's WCO does. This also closes SM-1 and the Smoothieware half of CG-2.
  - Marlin, needs decision (one decision with MA-2, MA-3, CG-11 and the stock-Marlin half of CG-2).
    M114 is the work position. Either model the G92 shift KerfDesk itself wrote
    (machine = logical − recorded shift), or treat Marlin origins like Verified Origin (size-only
    preflight, work position = M114) and stop requiring a WCO.

### CG-2 — Frame's G54 "normalization" makes KerfDesk forget, or erase, the operator's G92 origin

- **severity:** medium.
  - Common case: a misleading "Click Set origin here first" refusal on the first Frame of a session.
  - Wrong physical output in narrower cases:
    - Falcon Current Position is placed displaced by the G92 offset.
    - On stock Marlin and on Smoothieware an Absolute Frame, which was correctly refused before, is
      dispatched with no offset and displaced by the G92 the controller still applies.
    - On a `CNC_COORDINATE_SYSTEMS` Marlin build the origin is erased on the controller.

  The Frame traces the displaced path, so a watching operator can catch it.
- **verdict:** CONFIRMED (4 repro files + upstream).
- **status:** new.
- **failure scenario:**
  - Trigger: `activeWcs` is null, because it is never read on the Falcon contract, Marlin or
    Smoothieware. On GRBL-family it is null only when the connect-time `$G` read failed, or after a
    reboot banner until re-qualification.
  - Every such Frame runs `selectPrimaryWcsForFrame()`. It writes `G54` and applies the Console
    'coordinates-all' effect: `workOriginActive=false`, `workOriginSource='none'`, `wcoCache=null`,
    `workZZeroEvidence=null`, `statusReport=null`. This runs before the placement is resolved.
  - Falcon (grblHAL or GRBL contract):
    - G54→G54 changes nothing on the controller and forces no WCO report, so the fresh report the
      Frame waits for normally has no WCO (1 idle report in 10 carries it).
    - User or Verified Origin is refused "…needs a custom work origin. Click "Set origin here"
      first." On the next press it comes with an in-place one-click "Set origin here" offer
      (`start-blocked-setup-offers.ts:26-31`). That re-sets the origin wherever the head is now.
    - Current Position computes the head's work position as MPos, so the job is placed displaced by
      the G92 offset. The repro gives `currentPosition {100,50}` instead of `{0,0}`.
  - Stock Marlin (no `CNC_COORDINATE_SYSTEMS`):
    - G54 is answered `echo:Unknown command: "G54"` then `ok`, which KerfDesk accepts (MA-12's class,
      here for an owned command). The store forgets the origin; the controller keeps its shift.
    - An Absolute placement that was refused (custom origin, no WCO) now resolves `{ok:true}` with no
      offset, and the Frame and job run through the retained shift.
  - Marlin with `CNC_COORDINATE_SYSTEMS` (the driver's documented contract): G54 replaces
    `position_shift` with `coordinate_system[0]`, which erases the operator's origin on the
    controller.
  - Smoothieware: G54 keeps G92. The store forgets the origin, and an Absolute Frame resolves with no
    offset (repro).
  - `waitForAbsoluteFrameOffset` protects only homed `g92-and-g10` drivers (see refutation below).
- **refutation tried:**
  - GRBL-family Absolute is not affected. `src/ui/laser/frame-position-readiness.ts:45-55`
    `needsAbsoluteFrameOffset` waits for a WCO (with a burst of `?` queries) when
    `homingState === 'confirmed' && capabilities.wcs === 'g92-and-g10' && wcoCache === null`. So a
    homed GRBL, grblHAL, FluidNC or Falcon Absolute Frame re-learns the offset before it resolves.
    That wait does not exist for `g92-only` drivers or for the User Origin and Current Position
    modes.
  - `homingProof: null` in the same patch is harmless: `isCurrentHomingProof`
    (`laser-home-proof.ts:12`) has no production caller. It is dropped from the impact list.
- **kerfdesk evidence:**
  - `src/ui/laser/frame-controller-readiness.ts:44-51`:
    `if (before.capabilities.transport !== 'serial' || originalActiveWcs === 'G54') return { ok: true };`
    null takes the select path.
  - `src/ui/laser/use-frame-action.ts:192-215` `prepareFrameContext` normalizes (`:194`) before the
    placement (`:214`). The transient frames do the same at `:134`.
  - `src/ui/state/laser-console-actions.ts:128-168` `selectPrimaryWcsForFrame` →
    `consoleStateEffectPatch(state, stateEffect, 'G54')`.
    `src/core/controllers/console-state-effect.ts:19,35`: G54 → 'coordinates-all'.
    `laser-console-actions.ts:335-340,387-394` `unknownCoordinatePatch`.
  - The Falcon never reads `$G`:
    - `src/ui/state/laser-controller-handshake.ts:171-176` returns 'not-required' before the
      readback at `:218` whenever `settingsQuery` is null.
    - `grbl-settings-actions.ts:80-90` does the same on re-qualification.
    - `falcon-command-contract.ts:25` nulls `settingsQuery` but keeps the inherited
      `modalStateQuery: '$G'`.
  - KerfDesk's own Marlin emitter strips G54, `src/core/output/marlin-inline-transform.ts:27-31`:
    "G54 requires CNC_COORDINATE_SYSTEMS and would change the active origin".
- **upstream evidence:**
  - grblHAL `gcode.c:2990`
    `if((command_words.G12 &= gc_block.modal.g5x_offset.id != gc_state.modal.g5x_offset.id))`, and
    `:4483-4487`: WCO is flagged only when the WCS changes. `config.h:256`
    `#define REPORT_WCO_REFRESH_IDLE_COUNT 10`.
    https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L2990
  - gnea/grbl `grbl/gcode.c:995-999`
    `if (gc_state.modal.coord_select != gc_block.modal.coord_select) { … system_flag_wco_change(); }`.
    `system_flag_wco_change` is called only at `gcode.c:991,999,1017,1036,1040,1121` and
    `settings.c:262`, never after homing.
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L995-L999
  - Marlin 2.1.2.8:
    - `gcode/gcode.cpp:111` `int8_t GcodeSuite::active_coordinate_system = -1; // machine space`.
    - `gcode/geometry/G53-G59.cpp:35,42` `if (active_coordinate_system == _new) return false;` …
      `position_shift[i] = new_offset[i];`.
    - `gcode/geometry/G92.cpp:97` `position_shift[i] += d;` and `:123` (G92 is stored into
      `coordinate_system[]` only when a WCS is active).
    - Stock build: `gcode.cpp:1101/1119` `parser.unknown_command_warning()` then `:1122`
      `if (!no_ok) queue.ok_to_send();`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G53-G59.cpp#L34-L47
  - Smoothieware `src/modules/robot/Robot.cpp:612-614`
    `case 54: … current_wcs = gcode->g - 54;` (G92 untouched; `g92_offset` is reset only at
    `:123` and `:627`).
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L612-L662
- **reproduction (all FAIL on current code):**
  - `src/__audit_repro__/CG/falcon-frame-wcs-normalization.test.ts`: `currentPosition {"x":100,"y":50}`.
  - `src/__audit_repro__/CG/g92-only-origin-frame.test.ts`:
    - "Marlin: … does not write G54 or forget the origin" (G54 written);
    - "Smoothieware: … keeps the origin the controller still holds" ("Verified Origin needs a custom
      work origin").
  - `src/__audit_repro__/CG/marlin-stock-reset-origin.test.ts`, "CG-2 on stock Marlin":
    `{"normalization":{"ok":true},"after":{"ok":true},"controllerShift":{"x":-100,"y":-50}}`.
  - `src/__audit_repro__/CG/smoothie-frame-normalization-absolute.test.ts`:
    `{"normalization":{"ok":true},"waited":true,"after":{"ok":true},…}`, while the board still
    reports MPos 110,60 / WPos 0,0.
- **fix:** local. Apply it before, or together with, GP-1 (see "Fix order").
  1. When `activeWcs` is null and the driver has `modalStateQuery`, read it (the existing owned
     `requestTerminalOwnedActiveWcsReadback`) instead of selecting blindly, and select G54 only when
     the read shows another WCS. Give the Falcon handshake that readback. Give Smoothieware
     `modalStateQuery: '$G'`: SimpleShell answers `[GC:G0 G54 …]` then `ok`
     (`SimpleShell.cpp:218-222,879-882`), which the existing `[GC:` capture parses.
  2. Give the Frame's own selection a WCS-select effect instead of 'coordinates-all'. When the WCS
     really changed, drop `wcoCache`; GRBL-family then forces a WCO report. Keep
     `workOriginActive`/`workOriginSource`, because G92 is independent of G54–G59 on GRBL, grblHAL,
     FluidNC and Smoothieware. When nothing changed, change nothing.
  3. Never send G54 on Marlin: its program carries none.

### CG-11 — Reset origin on a stock Marlin build is a silent no-op that KerfDesk records as done

- **severity:** medium. The result is wrong physical output: Absolute Frames and jobs are displaced
  by the old origin. The prerequisite is a build option that KerfDesk documents in the profile note
  but never detects, and that is off in stock Marlin. The Frame shows the displaced path. KerfDesk's
  own CG-1 message steers operators to "Reset origin and set it again".
- **verdict:** CONFIRMED (repro with a stock-Marlin fake that follows G92.cpp and motion.cpp, plus
  upstream).
- **status:** new. Same family as MA-3 (Abort forgets a G92 the firmware keeps).
- **failure scenario:** stock Marlin 2.1.2.8 or bugfix-2.1.x.
  1. The head is at native X100 Y50. "Set origin here" (`G92 X0 Y0`) works; M114 now reads 0,0.
  2. "Reset origin" sends `G92.1`. Marlin answers `ok` and changes nothing.
  3. KerfDesk applies `clearedOriginPatch` and toasts "Temporary work offsets cleared (G92.1); saved
     G54 is unchanged."
  4. An Absolute placement now resolves `{ok:true}` with no offset. A bed point (10,10) is driven to
     native (110,60).
  5. The DRO shows M114's logical position, so the canvas looks right and only the physical head is
     displaced.
- **kerfdesk evidence:**
  - `src/core/controllers/marlin/driver.ts:40-43`: "Qualified origin contract:
    CNC_COORDINATE_SYSTEMS on a non-SCARA build … Marlin 2.1.2.6 compiles G92.1 only with that
    prerequisite … This is a documented build requirement, not detected firmware evidence."
    `:74` `clearOrigin: 'G92.1'`.
  - `src/ui/state/laser-origin-actions.ts:207-227` `resetOrigin` → `:224` `clearedOriginPatch()`
    (`:379-390` `workOriginActive: false, workOriginSource: 'none'`).
  - `src/ui/laser/OriginRow.tsx:263`: the success toast.
  - `src/core/devices/profile-catalog.ts:111`: the profile note "Origin reset requires
    CNC_COORDINATE_SYSTEMS and a non-SCARA build."
  - `src/ui/job-placement.ts:214` `if (!customOriginIsActive(machine)) return { ok: true };`.
- **upstream evidence:**
  - Marlin 2.1.2.8 `Marlin/Configuration_adv.h:3600` `//#define CNC_COORDINATE_SYSTEMS` (off). The
    same in bugfix-2.1.x at `:4068`.
  - `Marlin/src/gcode/geometry/G92.cpp:62,65`: `default: return; // Ignore unknown G92.x` and
    `case 1:` exists only `#if ENABLED(CNC_COORDINATE_SYSTEMS) && !IS_SCARA`.
  - Without any subcode feature the parser does not read `.1` at all
    (`src/inc/Conditionals_post.h:3177-3180`
    `#if ANY(G38_PROBE_TARGET, CNC_COORDINATE_SYSTEMS, POWER_LOSS_RECOVERY) #define USE_GCODE_SUBCODES 1`;
    `parser.cpp:215-221`), so `G92.1` is a bare `G92` with no axis words.
  - Either way `position_shift` is untouched and `gcode.cpp:1122` `if (!no_ok) queue.ok_to_send();`
    acknowledges it.
  - Plain `G92 X0 Y0` works on the same build (`G92.cpp:97` `position_shift[i] += d;`).
  - https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G92.cpp#L55-L99
  - https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/Configuration_adv.h#L3600
- **reproduction:** `src/__audit_repro__/CG/marlin-stock-reset-origin.test.ts`, "does not record
  the origin as cleared while the controller keeps its G92 shift", FAILS:
  `{"workOriginActive":false,"workOriginSource":"none","placement":{"ok":true},"controllerShift":{"x":-100,"y":-50}}`.
- **fix:** needs decision. It belongs to the MA-2 Marlin origin model. Options:
  - (a) record the logical position before Set origin and reset with `G92 X<x0> Y<y0>`, which works
    on every build with workspace offsets;
  - (b) verify the reset by the M114 change and keep the origin (with a message) when it did not
    move;
  - (c) offer Reset origin on Marlin only for profiles that declare the build option.

### CG-9 — Auto-focus bypasses the driver's command policy: a Smoothieware shell command wedges the session

- **severity:** medium. The controller is wedged: Jog, Frame, Home, origin actions and Start are
  refused until Abort or reconnect. The trigger is operator-configured.
- **verdict:** CONFIRMED (repro). The `$HZ1` sub-case is traced only.
- **status:** new. The same class as GP-3 (`!`/`~`/`?` in the auto-focus command) and SM-3 (an owed
  `fire off` never answered).
- **failure scenario:**
  - Smoothieware profile with an auto-focus command such as `switch focus on` (a SimpleShell switch
    command). The same applies to any lowercase shell command other than `version`/`fire off`, and
    to `$I`, `$S…`, `$J` without `-r`, or `$X` while not halted.
    1. Auto-focus sends it as one owned line that owes one terminal ack.
    2. The board prints `switch focus set to: on` and never `ok`.
    3. After 15 s: "Auto-focus timed out after 15s. The machine may still be moving; use the
       physical stop or power cutoff now if unsafe."
    4. The owed ack stays. `pendingUntrackedAcks` is still 1 a minute later.
    5. Jog: "Wait for the previous controller write and acknowledgement to settle before jogging."
       Frame and Start say to disconnect and reconnect. Abort clears it (the Alarm report resets the
       ledger), but then hits CG-3.
  - The Console refuses exactly these lines on Smoothieware. Auto-focus does not ask it.
  - `$HZ1` sub-case (traced). The only auto-focus preset is the Falcon's `$HZ1`, offered for every
    driver:
    - Smoothieware answers it as `$H`: a full all-axis homing cycle, then `ok`, and KerfDesk reports
      "Auto-focus complete".
    - Stock GRBL 1.1h with homing enabled answers `error:3` but leaves `sys.state = STATE_HOMING`:
      the status reads Home, no motion or `$J=` runs, and only a reset clears it.
    - grblHAL and FluidNC answer `error:3` harmlessly.
- **refuted parts:**
  - A comment-only auto-focus command on Smoothieware is answered `ok` (GcodeDispatch below); this is
    the passing control test.
  - On Marlin (and Ruida) auto-focus never sends anything. `src/ui/state/autofocus-fresh-idle.ts:28-29`
    `if (query === null) throw new Error('This controller cannot provide live status for auto-focus.');`
    (passing control test). So MA-5's comment-only wedge has no auto-focus entry point.
- **kerfdesk evidence:**
  - `src/ui/state/autofocus-action.ts:74-89` `checkPreflight`: refuses only an empty or multi-line
    command. `:56-67` sends it through `startControllerCommand`.
  - `src/ui/state/laser-safe-write.ts:294-299` `owedTerminalAcks` (one per newline), reserved at
    `:99`. `src/ui/state/laser-interactive-command.ts:373-385` `finishControllerCommand` releases
    only the command owner.
  - Smoothieware Console policy: `src/core/controllers/smoothieware/console-command.ts:6-13,89-108`
    `shellLineRefusal`/`acklessShellReason`: "Smoothieware's shell answers <word> without an ok, so
    KerfDesk cannot tell when it has finished."
  - Blast radius:
    - `laser-autofocus-actions.ts:96-103`
    - `laser-home-action.ts:59` (`hasPendingControllerWrite`)
    - `laser-origin-actions.ts:71-77`
    - `frame-controller-readiness.ts:11-13`
    - `laser-start-queue-fence.ts:12-13,16-36`
  - Preset: `src/ui/laser/AutofocusEditor.tsx:14-24` (static list with the Falcon preset only).
    `DeviceSetupOptionsStep.tsx:110-118` renders it for every controller.
    `JobSetupControls.tsx:35` shows the button on every laser profile.
- **upstream evidence:**
  - Smoothieware `src/modules/communication/GcodeDispatch.cpp:75-82` `if(first_char == '$') {
    // ignore as simpleshell will handle it` / `}else if(islower(first_char)) { // ignore all
    lowercase as they are simpleshell commands`.
  - `src/modules/utils/simpleshell/SimpleShell.cpp:268-296`: the generic shell path prints no `ok`
    (`:292-294` only `error:Unsupported command - %s` when unknown).
  - `SimpleShell.cpp:1011` `stream->printf("switch %s set to: %s\n", …)`. `:241-252`: `case 'H':`
    runs `G28`/`G28.2` then `ok`, ignoring the rest of the line.
  - `GcodeDispatch.cpp:467-469`: `// Ignore comments and blank lines` → `printf("ok\n")`.
    https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L205-L297
  - gnea/grbl `grbl/system.c:182` `sys.state = STATE_HOMING;` precedes `:194`
    `} else { return(STATUS_INVALID_STATEMENT); }`. `config.h:124`
    `// #define HOMING_SINGLE_AXIS_COMMANDS // Default disabled.` Cycle start is only from Idle
    (`protocol.c:348-349`), and `$J=` needs Idle or Jog (`system.c:130-132`).
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L179-L200
  - grblHAL matches system commands exactly (`system.c:1169-1214`, `strcmp`) and FluidNC by exact
    name (`ProcessSettings.cpp:1099-1113`), so `$HZ1` ends in `error:3` on both.
- **reproduction:** `src/__audit_repro__/CG/smoothie-autofocus-shell-wedge.test.ts`.
  - The defect test FAILS:
    `{"result":{"kind":"timeout"},"pendingUntrackedAcks":1,"jog":"Wait for the previous controller write and acknowledgement to settle before jogging."}`.
  - Controls pass: the Smoothieware comment-only command is acked, and Marlin refuses at preflight.
- **fix:** local.
  - At auto-focus preflight, run the command through the active driver's `prepareConsoleCommand`
    and refuse with its reason. This picks up Smoothieware's shell refusal now and GP-3's realtime
    character refusal once implemented.
  - Offer the `$HZ1` preset only when the Falcon command set is selected.

### CG-3 — After Abort on Smoothieware, controller qualification stays "Waiting for fresh Idle" for the rest of the session

- **severity:** medium.
  - It blocks the ADR-364 laser recovery and CNC supervised recovery after an Abort, which is
    exactly when recovery is wanted, until reconnect.
  - It leaves a permanent misleading status line.
  - Ordinary Start is not gated (`laser-controller-qualification.ts:73-77`).
- **verdict:** CONFIRMED (repro against the upstream-shaped fake + upstream).
- **status:** new. ADR-364 made Smoothieware resume possible; this blocks it after an in-session
  Abort.
- **failure scenario:** qualified Smoothieware ('not-required') → Abort (Ctrl-X) → the board halts
  and reports Alarm → Unlock (M999) → Idle.
  - `controllerQualification` stays `{kind:'qualifying', phase:'reset-cleanup'}`.
  - ConnectionBar shows "Controller reset detected. Waiting for fresh Idle before reading settings…"
    with no Retry control.
  - Supervised recovery refuses: "Controller qualification is still in progress…".
  - Incidental hidden workaround: CG-7's "Read ($$)" button, and the Super Console pane's per-epoch
    auto-read (`SuperConsoleSettingsPane.tsx:65`), call `readMachineSettings`. With no settings query
    that marks the session qualified at once, even in Alarm (`machine-settings-read-readiness.ts:33-36`
    allows Alarm).
- **kerfdesk evidence:**
  - `src/ui/state/laser-job-actions.ts:294` Abort applies `invalidateControllerSessionEvidence`
    (`laser-controller-evidence.ts:15`
    `controllerQualification: qualifyingController(nextEpoch, 'reset-cleanup')`).
  - The only re-arm is `scheduleControllerQualification` from `handleWelcomeLine`
    (`laser-line-handler.ts:390`), which needs a reboot banner.
  - `src/ui/laser/ConnectionBar.tsx:112-117,157-158`; `start-job-source.ts:312-325`;
    `recovery-start-authorization.ts:10-26`.
  - The stream-error auto-stop does the same (`laser-error-line.ts:132`).
- **upstream evidence:** Smoothieware `SerialConsole.cpp:206` / `USBSerial.cpp:206`
  `halt_flag = true;`; `on_idle` (`SerialConsole.cpp:235-243`, `USBSerial.cpp:306-310`) calls
  `THEKERNEL->call_event(ON_HALT, nullptr)` and prints `"ALARM: Abort during cycle"` (grbl mode) or
  `"HALTED, M999 or $X to exit HALT state"`. There is no reboot and no banner: `Smoothie` + `ok` is
  printed only on USB attach (`USBSerial.cpp:332`).
  https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/SerialConsole.cpp#L199-L245
- **reproduction:** `src/__audit_repro__/CG/smoothie-abort-qualification.test.ts` FAILS:
  `{"kind":"qualifying","epoch":3,"phase":"reset-cleanup"}`.
- **fix:** local. After a soft reset on a driver that does not reboot (Smoothieware), call
  `scheduleControllerQualification` right after the reset write; the scheduler already waits for a
  fresh Idle and tolerates Alarm. Land it with or before CG-7, which removes the accidental
  workaround.

### CG-4 — On a halted Smoothieware board the alarm fix offers Home, which the halted board always refuses

- **severity:** low. A wrong fix is offered and run on confirmation. It adds a spurious "The
  controller rejected a command" safety notice and leaves the board halted. The banner's correct
  "M999 — Unlock" button is next to it.
- **verdict:** CONFIRMED (repro).
- **status:** new.
- **failure scenario:** Smoothieware with homing enabled, halted (after Abort or a limit).
  1. Frame → `offerAlarmFixForBlockedStart` chooses Home.
  2. Home's first line, `M400`, draws `!!`.
  3. The result is "Homing failed: !!" plus a safety notice. M999 is never offered.
- **kerfdesk evidence:**
  - `src/ui/laser/start-blocked-alarm-offers.ts:52-53`
    `return homingEnabled ? offerHomeCycle() : offerUnlock();`
  - `src/core/controllers/smoothieware/driver.ts:63-67`: Home starts with M400 on purpose, "so a
    halted board rejects it".
  - `src/ui/state/laser-home-action.ts:201-221` raises the notice.
  - `AlarmRecoveryActions.tsx:22-29` also shows Home while in Alarm.
- **upstream evidence:** Smoothieware `GcodeDispatch.cpp:34`
  `static const int allowed_mcodes[]= {2,5,9,30,105,114,115,119,80,81,911,503,106,107};`, and
  `:158-180`: halted, everything else is answered `!!` (or `error:Alarm lock` in grbl mode); only
  M999 (`:160-167`) clears the halt.
  https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L158-L180
- **reproduction:** `src/__audit_repro__/CG/smoothie-alarm-fix-offer.test.ts` FAILS: `M400` is
  sent and the board is still halted.
- **fix:** local. Add a driver capability "Home clears Alarm" (false for Smoothieware). When it is
  false, offer Unlock (M999) and disable Home in the Alarm banner while halted.

### CG-10 — Marlin Abort and Disconnect never switch air assist off; Abort also shows air as OFF

- **severity:** low. Air assist stays running, which is not a hazard, but the rail misreports it and
  the stop sets are incomplete.
- **verdict:** CONFIRMED (repro with the repo Marlin simulator).
- **status:** new.
- **failure scenario:** a Marlin profile with Air output M8 on a build with `AIR_ASSIST`.
  - Manual Air ON (`M8`), or a job's air layer, then Abort. KerfDesk sends `M5 I`, `M107`, no `M9`,
    and sets `airAssistOn: false`: the rail shows air off while the pump runs.
  - Disconnect with Manual Air ON sends `M5 I`, `M107`: the air keeps running after the port closes.
- **kerfdesk evidence:**
  - `src/core/controllers/marlin/commands.ts:14-17` `MARLIN_STOP_LASER_LINES = ['M5 I', 'M107']`.
  - `src/ui/state/laser-job-actions.ts:314-324` (the `softReset === null` stop loop) and `:335`
    `airAssistOn: false,`.
  - `src/ui/state/laser-store-helpers.ts:207`
    `if (state.airAssistOn) return driver.commands.stopLaserLines.map(…)`, used by
    `laser-connection-actions.ts:345-367`.
  - Manual Air: `laser-store.ts:389`.
- **upstream evidence:** Marlin 2.1.2.8 `gcode/control/M7-M9.cpp:64-75`. Only `M9()` calls
  `cutter.air_assist_disable(); // Turn off Air Assist` (the one caller); M5 and M107 do not touch
  it. `gcode.cpp:500,504` dispatch M8/M9 only `#if ANY(AIR_ASSIST, COOLANT_FLOOD)` /
  `ANY(AIR_ASSIST, COOLANT_CONTROL)`.
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M7-M9.cpp#L64-L75
- **reproduction:** `src/__audit_repro__/CG/marlin-stop-leaves-air-on.test.ts`. Both tests FAIL:
  - Abort: `{"outbound":["M8\n","M5 I\n","M107\n","M114\n"],"airAssistOn":false}`.
  - Disconnect: `["M114\n","M8\n","M5 I\n","M107\n"]`.
- **fix:** local. Append `M9` to Marlin's Abort and Disconnect stop set only, not to
  `frameToolOffLines` (that would switch air off before every Frame, as CG-5 does on Smoothieware).
  On a build without the option `M9` is a harmless `Unknown command` + `ok` (MA-12). Clear
  `airAssistOn` only when an air-off line went out.

### CG-5 — Smoothieware jog, Frame and Home send M9, so Manual Air shows ON while the air is off

- **severity:** low. **verdict:** CONFIRMED (trace). **status:** new.
- **failure scenario:**
  - Manual Air ON on Smoothieware, with a switch module bound to M8/M9, then any jog, Frame or Home.
  - `M9` in the tool-off prefix switches the air off. The rail still shows ON.
  - The next click sends `M9` again, so it takes two clicks to get air back.
- **kerfdesk evidence:**
  - `src/core/controllers/smoothieware/commands.ts:37-43`
    `SMOOTHIE_FRAME_TOOL_OFF_LINES = ['fire off','M400','M221 S0','M5','M9']`, used by the jog
    (`:66-73`), the Frame (`driver.ts:76`) and Home (`driver.ts:67`).
  - The Manual Air latch is re-synced only from GRBL `A:`/`Ov:` fields
    (`src/ui/state/laser-status-position.ts:106-113`).
- **upstream evidence:** Smoothieware reports only `MPos`/`WPos`/`F`/`L`/`S`, with no accessory
  field (`Kernel.cpp:206-287`).
  https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L177-L300
- **reproduction:** traced only.
- **fix:** local. Clear `airAssistOn` when the driver's own tool-off lines contain `M9`, or drop `M9`
  from the Smoothieware jog prefix.

### CG-7 — "Read ($$)" is offered on drivers that have no settings query

- **severity:** low (misleading control and text). **verdict:** CONFIRMED (trace). **status:** new.
- **failure scenario:**
  - Marlin, Smoothieware or Falcon. The Super Console settings pane shows "Read ($$)", toasts
    "Reading machine settings ($$)...", and says it "Reads live controller settings with `$$`".
  - Nothing is read. `readMachineSettings` only marks qualification 'not-required' (see CG-3 for the
    side effect).
  - Machine Setup's firmware step is not affected: it shows the external-configuration notice for
    these drivers.
- **kerfdesk evidence:**
  - `src/ui/laser/MachineSettingsPanel.tsx:42-46,98-106,124-128`.
  - `src/ui/laser/super-console/SuperConsoleSettingsPane.tsx:25,65` (always mounted; auto-read).
  - `src/ui/state/grbl-settings-actions.ts:80-90`.
- **upstream evidence:** not firmware-dependent. The driver tables have `settingsQuery: null`
  (`marlin/driver.ts:65`, `smoothieware/driver.ts:70`, `falcon-command-contract.ts:25`).
- **reproduction:** traced only.
- **fix:** local. Gate the Read button and the auto-read on `capabilities.settings !== 'none'`,
  after the CG-3 fix.

### CG-8 — Wake from Sleep is reported as failed on stock GRBL 1.1h too (extends HF-5)

- **severity:** low. **verdict:** CONFIRMED (repro).
- **status:** new. HF-5 covers grblHAL and FluidNC and left stock GRBL to another track.
- **failure scenario:** Release motors (`$SLP`) → Sleep → Wake (Ctrl-X). GRBL reboots into Alarm
  (`[MSG:'$H'|'$X' to unlock]`). `wakeController` waits for Idle and rejects with "Controller
  entered Alarm.", so the toast says "Wake failed" although the wake worked.
- **kerfdesk evidence:** `src/ui/state/laser-controller-recovery-actions.ts:90`
  `await waitForFreshIdle(refs, { kind: 'recovery', requiredReports: 1 });`.
  `laser-interactive-command.ts:337-339` rejects the wait on Alarm.
- **upstream evidence:** gnea/grbl `grbl/protocol.c:51-54` "Re-initialize the sleep state as an
  ALARM mode to ensure user homes or acknowledges." / `if (sys.state & (STATE_ALARM | STATE_SLEEP))
  { … sys.state = STATE_ALARM; }`. `main.c:74-76` preserves `sys.state` across the reset.
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L49-L54
- **reproduction:** `src/__audit_repro__/CG/grbl-wake-from-sleep.test.ts` FAILS:
  `'Controller entered Alarm.'`.
- **fix:** as HF-5. Accept a post-reset Alarm as a completed wake and hand over to the Alarm banner.
  One change covers GRBL, grblHAL and FluidNC.

---

## Fix order and combined fixes

- **CG-2 before GP-1 (required).**
  - GP-1 proposes `activeWcs: null` after every `$H`. With today's normalization, that routes every
    post-Home Frame on every driver through `selectPrimaryWcsForFrame`.
  - Home keeps the origin only as an unresolved record (`laser-home-action.ts:110-114`:
    `workOriginSource … 'unknown'`, `wcoCache: null`). The 'coordinates-all' effect then drops it.
  - On GRBL the post-G54 report normally has no WCO, because G54→G54 forces none (`gcode.c:995-999`).
    So the first post-Home Frame would refuse User and Verified Origin (with a one-click re-set offer
    at the current head position) and place Current Position displaced by the G92 offset.
  - Absolute would still be safe on homed GRBL-family (`needsAbsoluteFrameOffset` waits for WCO).
  - Recommended combined fix:
    1. land CG-2's items 1–3: read-before-select, a WCS-select effect that keeps the G92 origin
       record, and no G54 on Marlin;
    2. then implement GP-1 as an owned `$G` re-read after any `$H` (rail, Console, Alarm banner),
       using the existing `requestTerminalOwnedActiveWcsReadback`. Nulling `activeWcs` also becomes
       safe once item 1 turns null into a read, but the re-read is simpler and keeps the WCS known.
  - GP-1's real case (a `$N0=G55` startup line) then selects G54 as a genuine change. GRBL forces the
    WCO report (`gcode.c:995-999`) and the G92 record survives.
- **CG-1 + SM-1 (Smoothieware): one local fix.** Derive `wco = MPos − WPos` from the same report in
  `statusPositionPatch`. It fixes the Smoothieware User Origin refusal (CG-1), the Absolute
  displacement (SM-1) and the Smoothieware Absolute half of CG-2, because the offset is re-learned
  from the next report. Add SM-1's second part: stop declaring a Smoothieware G92 dropped on Alarm
  and M999.
- **Marlin origin model (needs one product decision):** CG-1 (Marlin), MA-2, MA-3 (Abort), CG-11
  (stock `G92.1` no-op) and CG-2's stock-Marlin case. Each is a place where KerfDesk's origin record
  and Marlin's `position_shift` diverge. Decide the model once (MA-2's "record the shift KerfDesk
  wrote" makes CG-11's `G92 X<x0> Y<y0>` reset possible) and never mark a Marlin origin cleared
  without proof.
- **CG-8 = HF-5:** one change for GRBL, grblHAL and FluidNC.
- **CG-3 with or before CG-7:** CG-7's fix removes the only in-session workaround for CG-3.
- **CG-12 + MA-7:** mapping Ctrl+. to `stopJob` fixes Smoothieware and the Falcon now. On Marlin even
  `stopJob` cannot stop the planner until MA-7's `M410` decision.
- **CG-10 + MA-7 + MA-12:** Marlin Abort becomes `M410` (if accepted), then `M5 I`, `M107`, `M9`.
  The M9 is harmless on builds without the option (MA-12's unknown-command echo).
- **CG-9 + GP-3 + SM-3:** all are auto-focus or tool-off lines whose terminal reply never comes.
  Validating the auto-focus command with the driver's Console policy covers CG-9 and, once GP-3
  lands, GP-3's auto-focus case.

## Dropped, refuted or narrowed

- **"Still to check" 1 — Marlin Abort (M410 never used):** covered by MA-7; cross-referenced only,
  not duplicated.
- **"Still to check" 2 — auto-focus with a shell-style or comment-only command:**
  - Confirmed for Smoothieware shell commands (CG-9).
  - Refuted for Smoothieware comment-only lines (`GcodeDispatch.cpp:467-469` answers `ok`).
  - Refuted for Marlin: auto-focus never sends there (`autofocus-fresh-idle.ts:28-29`); both are
    passing control tests.
- **"Still to check" 3 — hard-coded GRBL literals:**
  - `origin-actions.ts` hard-codes `G92 X0 Y0`/`G92.1`, the same strings Marlin and Smoothieware
    declare (`marlin/driver.ts:73-74`, `smoothieware/driver.ts:78-79`), so there is no behavioural
    difference.
  - The persistent pair (`G10 L20/L2 P1`) is reachable only through `AdvancedOriginControls`, which
    renders only for `wcs === 'g92-and-g10'` (`OriginRow.tsx:208-214`; no other caller).
  - `$SLP` is refused by the store itself when `capabilities.sleep` is false
    (`laser-origin-actions.ts:273-274`, `controller-sleep.ts:23`).
  - `G92 Z0` is shown only for CNC projects (`FocusJogControls.tsx:59-69`) and is valid on Marlin and
    Smoothieware.
  - Dropped: nothing reachable is wrong. The one concrete defect found in this area is the Marlin
    `G92.1` build contract (CG-11), which is not a GRBL literal.
- **CG-6 (simulator fidelity):** dropped as duplicate of SM-4 and MA's simulator-fidelity item
  (MA-11). Note for SM-4: the simulator's Ctrl-X banner is what hides CG-3.
- **CG-2 narrowed:** `homingProof: null` has no production consumer (harmless). GRBL-family Absolute
  after the normalization is protected by `waitForAbsoluteFrameOffset` when homed.
- **CG-4 re-rated:** from low-medium to low. The correct M999 control is on the same banner and
  nothing moves.

---

## Driver × action matrix

Each cell says OK, gives a finding id, or says n/a (the control is hidden or refused by capability).
† means unverifiable: it depends on an undocumented vendor build or on the firmware configuration.
The Falcon column covers both `falcon-grbl` and `falcon-grblhal`, which share the contract.

| action | grbl | grblhal | fluidnc | falcon | marlin | smoothieware | ruida |
|---|---|---|---|---|---|---|---|
| Connect | OK | OK | OK | CG-2 (no `$G`) | MA-6 | OK | RU-6 |
| Home | GP-1, GP-7 | GP-1 | OK | HF-1 | OK | CG-4, SM-3 | n/a |
| Unlock | GP-2 | HF-3 | HF-2 | HF-3† | n/a | OK (M999); CG-4 | n/a |
| Jog | OK | OK | OK | OK; CG-12 | CG-12 (+MA-7) | CG-5, SM-3, SM-5, CG-12 | n/a |
| Frame | GP-1 (CG-2 if `$G` failed) | GP-1 | OK | CG-2, CG-12 | CG-1, CG-2, MA-2, CG-12 | CG-1, CG-2, SM-1, SM-3, CG-12 | n/a |
| Set origin | OK | OK | OK | OK (forgotten at 1st Frame: CG-2) | CG-1 / MA-2 | CG-1 | n/a |
| Reset origin | OK | OK | OK | OK | CG-11 | OK | n/a |
| Zero Z | OK | OK | OK | n/a (laser) | CN-2 | CN-2 | n/a |
| Probe | OK | OK | OK | n/a† (inherited) | n/a | n/a | n/a |
| Air on/off | OK | OK | OK† | OK† | MA-12†, CG-10 | CG-5† | n/a |
| Fire | OK | OK | † | † | n/a | n/a | n/a |
| Overrides | OK | OK | OK | † | n/a | n/a | n/a |
| Pause/Resume | OK | OK | OK | † | MA-1 | OK | n/a |
| Stop/Abort | OK | OK | OK | OK; CG-12 (keys) | MA-7, MA-3, CG-10, CG-12 | CG-3, SM-1, SM-5, CG-12 | n/a |
| Release motors / Wake | CG-8 | HF-5 | HF-5 | HF-4 (+HF-5†) | n/a | n/a | n/a |
| Console | GP-3, GP-4 | GP-3† | GP-3†, HF-6 | GP-3† | MA-5 | OK | n/a |
| Machine Settings read/write | GP-5 (write) | OK read; write † | OK (read-only) | CG-7 | CG-7 | CG-7 | n/a |
| Start (laser) | OK | OK | OK | OK | MA-1, MA-4, MA-8, MA-12 | SM-2, SM-3 | export: RU-1..5, RU-7 |
| Start (CNC) | OK | OK | OK | † (inherited) | refused (CN-1, CN-2) | refused (CN-1, CN-2) | CN-3 |
| Auto-focus (extra row) | CG-9 (`$HZ1` → stuck Home), GP-3 | OK (`$HZ1` → error:3) | OK (error:3) | OK (`$HZ1`, vendor) | n/a (refused at preflight) | CG-9 | n/a |

Notes on the cells that are not plain OK or a finding:

- **Falcon Unlock / Wake (HF-3†, HF-5†):** these hold only if the vendor build follows grblHAL core.
  The Creality bundle labels it "GRBL-LPC" and the build is unknown.
- **Falcon Probe, Fire, Overrides, Pause, Start (CNC) (†):** these capabilities are inherited from
  GRBL/grblHAL (`falcon-command-contract.ts:14-20` keeps `...driver.capabilities`). Nothing documents
  them for the vendor firmware; Probe and CNC are for a laser-only machine (CN notes the same).
- **Air on/off:**
  - Marlin: M7/M8/M9 exist only with `COOLANT_MIST`/`AIR_ASSIST`/`COOLANT_*` (`gcode.cpp:495-505`).
    Without them `M8` is `Unknown command` + `ok` and the latch shows ON (MA-12's class).
  - Smoothieware: M7/M8/M9 act only through a switch module bound to them. With no module, `M8` is
    acknowledged with `ok` and nothing happens.
  - FluidNC: depends on configured coolant pins (not checked).
- **FluidNC Fire (†):** the laser-mode rule behind KerfDesk's `G1 F… M3 S…` fire was checked against
  GRBL and grblHAL only.
- **grblHAL settings write (†):** GP-5's precision issue was proven on GRBL 1.1h. grblHAL's setting
  storage was not checked.
- **Console GP-3 (†) on grblHAL, FluidNC and Falcon:** the same `!`/`~`/`?` realtime bytes
  (FluidNC `RealtimeCmd.h:19-23`). GP-3 was proven on GRBL 1.1h only.
- **FluidNC Home/Frame:** GP-1 does not apply. FluidNC v4.0.3 runs startup lines only at protocol
  init (`Protocol.cpp:441` is the sole caller of `runStartupLinesEvent`), not after homing. grblHAL
  does run them after a full home (`system.c:499-500`), so GP-1 applies there.

## Checked and correct

- **GRBL realtime and override bytes** match `grbl/config.h:51-54,64-65,67-83`
  (`#define CMD_RESET 0x18` … `CMD_JOG_CANCEL 0x85`, `CMD_FEED_OVR_RESET 0x90` …).
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L51-L83
- **FluidNC v4.0.3** `RealtimeCmd.h:19-40` has the same Reset, SafetyDoor, JogCancel and override
  bytes. Its Door substates in `Report.cpp:442-450` match KerfDesk's settled-pause and door logic.
  https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/RealtimeCmd.h#L19-L40
- **GRBL jog cancel acts only on `$J=` jogs** (`serial.c:159-162`). Nulling `jogCancel` for the
  Falcon's plain-`G1` jog and Frame is therefore correct (the gap is CG-12's shortcut).
- **Smoothieware realtime and halt:**
  - `!`/`~` work only with feed hold enabled (`USBSerial.cpp:220`), so the driver's hold/resume are
    null.
  - Halted, M5/M9 are still accepted (`GcodeDispatch.cpp:34`), so Abort's delayed M5/M9 cleanup is
    acknowledged.
  - M999 clears the halt and answers `ok` (`GcodeDispatch.cpp:160-167`).
- **Smoothieware `$H`** homes in both dialects and prints `ok` after the cycle
  (`SimpleShell.cpp:241-252`). GcodeDispatch ignores `$` and lowercase lines (`GcodeDispatch.cpp:75-82`).
  The `fire off` completion text is `Laser.cpp:154`; it prints nothing while halted (`Laser.cpp:126`).
- **Smoothieware Console policy** (`console-command.ts:38-108`) matches SimpleShell: `ok` only for
  `$G`/`$#`/`$H`/`$X`-while-halted, a text completion for `version` and `fire off`, and comment-only
  lines are acknowledged (`SimpleShell.cpp:205-297`, `GcodeDispatch.cpp:467-469`).
- **Smoothieware stream-side Pause cannot leave the beam on.** `Laser::set_proportional_power` turns
  the laser off every millisecond when no G1–G3 block is executing (`Laser.cpp:239-286`).
  https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L239-L286
- **Smoothieware Reset origin:** `G92.1` clears `g92_offset` (`Robot.cpp:625-627`).
- **Marlin air assist:** M7/M8/M9 are air assist and coolant when built with `AIR_ASSIST`
  (`M7-M9.cpp:49-75`), so the Manual Air bytes are valid on such builds. The build gate is MA-12's.
- **GRBL M7** needs `ENABLE_M7` (`config.h:169`; `gcode.c:264-283` → `error:20`). KerfDesk warns from
  `$I` `[OPT]` (`src/core/preflight/m7-air-assist-readiness.ts:10`).
- **Fire** uses `G1 F<feed> M3 S<n>` (`laser-fire-actions.ts:36-39`), which respects GRBL laser mode's
  `GC_PARSER_LASER_DISABLE` for non-G1-G3 blocks (`gcode.c:872-932`). It is gated on `lowPowerFire`
  (`laser-fire-actions.ts:141`).
- **Capability gating** was checked at each call site:
  - Overrides: `JobRunControls.tsx:28`, `JobControls.tsx:85`, `laser-store.ts:507`,
    `laser-start-override-reset.ts:50`.
  - Probe: `ProbeControls.tsx:50`.
  - Pause wording: `LiveMotionBar.tsx:96`.
  - CNC Start: `laser-start-program-assertions.ts:78`.
  - Console input: `use-console-command-deck-model.ts:128`.
  - Setting writes: `grbl-settings-actions.ts:211-216` needs `grbl-dollar`.
  - Unlock offer: `start-blocked-alarm-offers.ts:76`.
  - Board-capture and rotary moves already fall back to Abort without jog-cancel
    (`rotary-test-rotation.ts:135-137`, `CircleCenterConfirmation.tsx:49`).
- **Release motors** is refused by the store when `capabilities.sleep` is false
  (`controller-sleep.ts:20-27`), and the no-homing guide passes the same reason
  (`NoHomingPositionGuide.tsx:48`).
- **Disconnect:**
  - GRBL-family: Ctrl-X, wait for the reboot boundary, then M5/M9
    (`laser-disconnect-transaction.ts:70-119`).
  - Marlin and Smoothieware: the state-driven `stopLaserLines`, plus a soft reset where the driver
    has one (`laser-store-helpers.ts:190-213`). The air gap on Marlin is CG-10.
- **Falcon Home** `$HX` then `$HY` are separately owned lines, and GRBL single-axis homing ends Idle
  (`system.c:179-200`). HF-1 covers the grblHAL relock between them.
- **Marlin pause and stop are stream-side.** No Hold or realtime wait is attempted on Marlin or
  Smoothieware (`realtimePause: false`, `LiveMotionBar.tsx:96`).
- **grblHAL and GRBL** flag WCO only on a WCS change, G92, G10 or G43.1 (`gcode.c:991-1121`;
  grblHAL `gcode.c:2990,4483-4487`). This is what makes a no-change G54 report WCO-less (CG-2).

## Not covered

- Vendor behaviour of the Falcon A1 Pro firmware for Fire, Overrides, Pause, Probe and CNC (inherited
  capabilities). There is no source; marked † in the matrix.
- FluidNC: the laser-mode rule for the Fire block, and coolant or air configuration dependence.
- grblHAL setting-write precision (GP-5 is proven for GRBL 1.1h only).
- The GP-3 realtime-character hazard on grblHAL, FluidNC and the Falcon was not re-verified.
- Marlin `CNC_COORDINATE_SYSTEMS` builds that restore `coordinate_system[]` from EEPROM at boot. The
  Frame's G54 would then apply a stored offset that KerfDesk never saw (a CG-2 variant). Not traced.
- Smoothieware grbl-mode variants beyond those cited (`error:Alarm lock` for halted lines,
  `ALARM: Abort during cycle`; the unsolicited-ALARM booking is SM-8's).
- The worker-hosted transport (ADR-334) paths for these controls; I used the main-thread transport
  only.
- Ruida live UDP (not wired in this build).
- CG-5 and CG-7, and the `$HZ1` sub-case of CG-9 (the GRBL stuck-Home state), are traced, not
  reproduced.
