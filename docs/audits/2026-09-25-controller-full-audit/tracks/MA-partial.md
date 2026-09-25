# Track MA (Marlin) — partial findings (work in progress)

Upstream: Marlin 2.1.2.8 (`1cd56c4c`), bugfix-2.1.x (`3b2b9ca6`). Repros live in
`src/__audit_repro__/MA/`; `marlin-fifo-model.ts` there is a small FIFO-faithful model of
Marlin's command queue / 16-block planner / host keepalive / M410 (the repo simulator answers
every line at once and runs queued moves concurrently, so it hides several of these).
Stock configuration assumed unless stated. No hardware.

## MA-1 — Stream-side Pause leaves the laser lit over the stopped head
- severity: critical (fan dialect: indefinite beam at a standstill; inline: ~1 s, or indefinite
  on a build without LASER_SAFETY_TIMEOUT_MS)
- verdict: CONFIRMED (repro with the repo's simulator + power model) · status: new
- failure scenario: Marlin job running; operator presses Pause. KerfDesk only stops sending
  (`laser-job-pause-resume.ts` `pauseByte === null` → `freezeStreamer`). Fan dialect: the last
  line Marlin got is `M106 S128` (written before its burn move by `marlin-fan-transform.ts`);
  buffered moves drain, then `Planner::check_axes_activity()` drives fan 0 from the current
  `fan_speed` → fan-header laser at 128/255 on a stationary head until Resume/Abort. Inline
  dialect: after the last burn block the continuous-mode output stays at that block's power
  (no idle blanking) until Temperature::isr's LASER_SAFETY_TIMEOUT_MS (1000 ms stock).
- kerfdesk evidence: `src/ui/state/laser-job-pause-resume.ts` (`if (pauseByte === null) { freezeStreamer(context); ... return; }`);
  `src/core/output/marlin-fan-transform.ts` `setFanPower` emits `M106 S<n>` before the move;
  copy `PAUSE_STREAM_SIDE_MESSAGE` only says buffered motion may finish.
- upstream: `module/planner.cpp` L1388-1399 (no blocks → `thermalManager.scaledFanSpeed(i)`);
  `gcode/temp/M106_M107.cpp` (fan speed set at once); `module/stepper.cpp` L2341-2345 (only
  CUTTER_MODE_DYNAMIC blanks when no block); `module/temperature.cpp` L3516-3521;
  `Configuration_adv.h` L3432. https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L1388-L1399
- reproduction: `src/__audit_repro__/MA/ma-1-pause-standing-beam.test.ts` — 2 tests FAIL
  (fanPower 128 with 0 pending motions; model output 128 in continuous mode).
- fix: local-ish — when pausing a Marlin stream queue a beam-off line behind the buffered
  motion (`M107` fan; `M5` inline) and on Resume restore the program's power before refilling
  (ADR-364 dialect rules: `M106 S<held>` / `M3 I S<held>`).

## MA-7 — ABORT does not stop Marlin; M410 (quickstop) exists and is never used
- severity: critical (a stop that does not stop; beam stays on for the rest of the planned moves)
- verdict: CONFIRMED (repro in the FIFO model; upstream traced) · status: new
- failure scenario: slow vector cut (300 mm/min, long edges). Ping-pong acks come back as soon
  as moves are planned, so up to 16 blocks are queued. ABORT writes `M5 I`, `M107`; M5 calls
  `planner.synchronize()` first, so the beam stays on for every queued move (~200 s in the
  repro). During the finishing tail Pause is not offered either (Marlin never reports `Run`).
  The notice says KerfDesk "could only stop sending and queue beam-off commands" — Marlin's
  M410 stops at once without a reset (position may be lost).
- kerfdesk evidence: `src/ui/state/laser-job-actions.ts` runStopJob `softReset === null` branch;
  `src/core/controllers/marlin/commands.ts` `MARLIN_STOP_LASER_LINES = ['M5 I','M107']`;
  `src/ui/state/laser-safety-notice.ts` DISCONNECT_STOP_UNCONFIRMED_MESSAGE; Marlin console
  treats M410 as an Idle-only ordinary command.
- upstream: `gcode/queue.cpp` L538-545 (M410/M112 acted on when read, EMERGENCY_PARSER off);
  `MarlinCore.cpp` manage_inactivity → `queue.get_available_commands()` (read during idle());
  `gcode/control/M108_M112_M410.cpp` L44-53; `module/planner.cpp` L1678-1705 quick_stop;
  `gcode/control/M3-M5.cpp` L142-154 (M5 synchronizes). https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L538-L545
- reproduction: `src/__audit_repro__/MA/ma-7-abort-keeps-burning.test.ts` — FAILS (beam on
  200 069 ms after ABORT; with `M410` then `M5 I` the same model is off in < 500 ms).
- fix: needs decision — send `M410` before `M5 I`/`M107` on ABORT (and Abort Motion), then
  treat position/homing/origin as lost (M410 has no deceleration). Product must accept the
  position loss vs. the continued burn.

## MA-2 — After "Set origin here" on Marlin, User Origin / Current Position / Absolute never resolve
- severity: high (default Marlin workflow blocked, with a remedy that cannot work)
- verdict: CONFIRMED (repro) · status: new
- failure scenario: Generic Marlin profile (homing off → default placement User Origin). Jog,
  Set origin (`G92 X0 Y0`), Frame → refused "the controller has not reported where it is yet.
  Wait a moment and try again, or Reset origin and set it again". Marlin never reports a WCO:
  M114 prints the LOGICAL position. Only Verified Origin works.
- kerfdesk evidence: `src/core/controllers/marlin/response.ts` (M114 → `mPos`, `wco: null`);
  `src/ui/state/laser-origin-actions.ts` transientXyOriginPatch (priorWco null → wcoCache null);
  `src/ui/job-placement.ts` resolveUserOrigin / resolveCurrentPosition / resolveAbsolute;
  `defaultJobPlacementForDevice` (no homing → user-origin).
- upstream: `module/motion.cpp` L192-212 (`rpos.asLogical()`); `gcode/geometry/G92.cpp`
  (position_shift). https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/motion.cpp#L192-L212
- reproduction: `src/__audit_repro__/MA/ma-2-marlin-origin-placement.test.ts` — FAILS.
- fix: needs decision — treat Marlin's M114 X/Y as the work position (logical frame) and track
  the G92 offset KerfDesk itself wrote (mPos = wPos + recorded shift), or stop offering
  placements that can never resolve on Marlin and say so.

## MA-3 — Marlin ABORT records "no origin" though the firmware keeps its G92 shift
- severity: medium · verdict: CONFIRMED (repro) · status: new
- failure scenario: Set origin, run, ABORT. runStopJob applies originUnknownAfterControllerReset
  (built for GRBL's soft reset) → `workOriginSource 'none'`. Marlin was not reset; its G92
  shift remains. Absolute placement then resolves with no offset while Marlin still runs every
  coordinate in the shifted frame (Frame shows the displaced path).
- kerfdesk evidence: `src/ui/state/laser-job-actions.ts` runStopJob `...originUnknownAfterControllerReset(state)`;
  `src/ui/state/laser-status-line.ts` originUnknownAfterControllerReset.
- upstream: `gcode/geometry/G92.cpp` L60-112; `gcode/control/M3-M5.cpp` L142-154 (M5 does not
  touch offsets). https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G92.cpp
- reproduction: `src/__audit_repro__/MA/ma-3-abort-forgets-g92.test.ts` — FAILS.
- fix: local — apply the reset-origin patch only when a reset byte was sent; otherwise keep the
  origin (or mark it 'unknown').

## MA-4 — Post-job M400 settle times out after 30 s while Marlin is busy
- severity: medium · verdict: CONFIRMED (repro, simulator + FIFO model) · status: new
- failure scenario: the last buffered move after the final `ok` takes > 30 s (e.g. KerfDesk's
  closing `G0 X0 Y0 S0` park runs at the 300 mm/min cut feed, see MA-8). M400 is answered only
  after the drain; Marlin prints `echo:busy: processing` every 2 s; KerfDesk discards busy and
  (no M114 polls while M400 is owed) sees no status activity → "post-job settle marker timed
  out", controller-error notice, run timing "could not be confirmed", run not counted as a
  clean completion (variables do not advance, recovery ledger says interrupted).
- kerfdesk evidence: `src/ui/state/laser-post-job-settle.ts` (30_000, 'non-idle-status-activity');
  `src/ui/state/laser-interactive-command.ts` keepCommandAliveFromStatus;
  `src/ui/state/laser-line-handler.ts` `if (cls.kind === 'busy') return;`;
  `src/ui/state/post-job-clean-settle.ts`.
- upstream: `gcode/motion/M400.cpp` L29-33; `gcode/gcode.cpp` L1204-1229 host_keepalive;
  `Configuration.h` L2228-2229. https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1204-L1229
- reproduction: `src/__audit_repro__/MA/ma-4-post-job-settle-busy.test.ts` — 2 tests FAIL.
- fix: local — let a `busy` line re-arm an owned command's 'non-idle-status-activity' timer
  (Marlin M400/G28/M5), or give queued-poll drivers an activity source.

## MA-8 — Marlin G0 runs at the last G1 feed; KerfDesk times it as a rapid
- severity: medium · verdict: CONFIRMED (upstream traced; FIFO-model run: ~18.5 s planned vs
  ~80 s) · status: new
- failure scenario: stock Marlin has no G0_FEEDRATE, so KerfDesk's bare `G0 ... S0` travel and
  the closing park run at the modal cut feed (e.g. 300 mm/min); the estimator uses maxFeed for
  rapids → wrong Job Review time/countdown, long parks (feeds MA-4).
- kerfdesk evidence: `src/core/gcode-time/segment-blocks.ts` (rapid → `limits.maxFeedMmPerMin`);
  Marlin output has F only on G1 (e.g. `G0 X0.000 Y0.000 S0`).
- upstream: `Configuration_adv.h` L3721 (`//#define G0_FEEDRATE`); `gcode/motion/G0_G1.cpp`
  L47-73; `gcode/gcode.cpp` get_destination_from_command F handling.
- reproduction: `src/__audit_repro__/MA/ma-8-g0-modal-feed.test.ts` (being finalised).
- fix: local — either give Marlin G0 its own F (and restate the cut F on the next G1), or time
  Marlin G0 at the modal feed.

## MA-5 — Comment-only Console line wedges a Marlin session
- severity: medium · verdict: CONFIRMED (repro with a queue.cpp-faithful fake) · status: new
- failure scenario: operator sends `; note` from the Console; Marlin sends no `ok` for a line
  that is empty after comment stripping; the owed ack is never expired → polls, Console, Jog,
  Frame, Start blocked until reconnect. (Same for `(note)` with PAREN_COMMENTS.)
- kerfdesk evidence: `src/core/controllers/marlin/console-command.ts` (accepts it);
  `src/ui/state/console-command-transport.ts` plain write with one owed ack.
- upstream: `gcode/queue.cpp` L369-405, L464-468. https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L396-L405
- reproduction: `src/__audit_repro__/MA/ma-5-console-comment-wedge.test.ts` — 2 tests FAIL.
- fix: local — refuse (or strip) Console lines that are blank after `;`/`(...)` comment removal
  on Marlin.

## MA-6 — M114 from a Marlin build without Z is not parsed
- severity: medium (fails closed: board reported silent, never qualifies) · verdict: CONFIRMED
  (unit repro) · status: new
- failure scenario: XY-only Marlin laser (NUM_AXES 2) answers `X:10.00 Y:5.00 Count X:800 Y:400`;
  POSITION_RE requires `Z:` → `unknown`.
- kerfdesk evidence: `src/core/controllers/marlin/response.ts` POSITION_RE.
- upstream: `inc/Conditionals_LCD.h` L233-262; `module/motion.cpp` L192-212; `module/stepper.cpp`
  L3260-3274.
- reproduction: `src/__audit_repro__/MA/ma-6-m114-without-z.test.ts` — 2 tests FAIL.
- fix: local — make `Z:` optional (z = 0) in the M114 pattern.

## Simulator fidelity (to be written up as a finding)
`src/__fixtures__/controllers/marlin-simulator.ts`: acks comment-only/empty lines; sends no
`ok` after `Error:`; answers later lines while an earlier M5/M400 blocks (not FIFO); runs
queued moves concurrently (each ends motionMs after it was queued); unlimited planner (ok never
delayed); no busy keepalives; boot prints only `start`; G92 treated as a move, G92.1 a no-op,
no G92/G28 position echo.

## Checked, not defects (so far)
- Boot `start` + `Marlin 2.1.2.8` both classify as welcome (double reset boundary) — store still
  qualifies (explored with 0/15/400 ms gaps).
- Error + trailing `ok` (handler errors) — ledger self-heals because Marlin is FIFO.
- Inline power: S0-255 for CUTTER_POWER_UNIT PWM255; G1 S sets block power; G0 zeroes it; `M5 I`
  exits inline; `M3 I S0` re-enters.
- G21 is a silent no-op without INCH_MODE_SUPPORT (`case 21: NOOP`).
- Home proof: G28's ok follows the homing moves; VALIDATE_HOMING_ENDSTOPS (stock) kills on a
  failed home → `Error:` → Home rejected.

## Still to check
- MA-8 repro assertion finalisation; busy liveness in stream-hold copy (stale "reports Idle").
- M112 console hint "reconnect required" vs reset required on native-USB boards.
- bugfix-2.1.x differences summary; resume-dialect files (native-laser-resume*.ts) against M5/M3 I semantics.
