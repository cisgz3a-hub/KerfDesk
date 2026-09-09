# Controller systems audit — 2026-07-26 exact main

Status: complete, read-only source/protocol audit; hardware qualification remains open
Repository: `https://github.com/cisgz3a-hub/KerfDesk.git`
Audited commit: `de36b8674a8abf0c9276f5666ae34e14a3791476`
Commit date: `2026-07-26 11:56:22 +0800`
Clean audit worktree: `C:\Users\Asus\LaserForge\controller-systems-audit-20260726`
Prepared: 2026-07-26 (Asia/Shanghai)

## Executive verdict

KerfDesk's stock-GRBL transport core is substantially stronger than a typical sender. It has
session epochs, explicit acknowledgement ownership, terminal stream errors, automatic reset on
GRBL-family stream rejection, planner-drain markers, fresh-status fences, exact Frame permits,
origin invalidation, bounded serial parsing, and persistent uncertainty notices. The focused
controller suite passed 393/393 tests.

The integration is not yet uniformly safe or truthful across every advertised controller
configuration. This audit found:

- no P0 defect in the currently supported stock-GRBL happy path;
- three high-priority design gaps:
  1. ordinary Start intentionally permits profile, connection-driver, and detected-firmware
     identities to disagree;
  2. reset-based Abort/Disconnect does not inventory or causally drain controller startup
     programs that the reset itself can execute;
  3. the Smoothieware driver assumes `grbl_mode` without documenting or proving that prerequisite,
     yet can mint Home proof;
- one medium capability-boundary gap: Marlin `M114` position replies are represented as `Idle`
  despite not being machine-state reports;
- one lower-impact capability overclaim: Marlin is advertised as able to clear `G92` with `G92.1`
  even though that command is build-dependent.

These findings do not mean every connected machine is currently unsafe. The first and third are
source-backed design gaps whose physical effect depends on what firmware is actually connected.
The second is dormant when GRBL startup blocks and FluidNC lifecycle macros are empty. The Marlin
issues apply only to builds/configurations that exercise those optional boundaries.

No source, setting, controller, or hardware was modified. Installing dependencies and running
tests created only ignored local package artifacts.

## Scope and evidence boundary

Included:

- controller identity and driver selection;
- Web Serial connection, replacement, teardown, and reset boundaries;
- response framing, classification, acknowledgement attribution, and stream refill;
- machine state, alarms, errors, position, WCO, overrides, accessories, and input-pin parsing;
- controller settings reads/writes and machine-profile application;
- G-code strategy selection, line limits, transport modes, completion markers, and abort paths;
- homing, unlock, origin, WCS, coordinate-unit handling, Frame, and Start handoff;
- pause/resume, safety-door behavior, disconnect uncertainty, and fail-dark paths;
- stock GRBL v1.1, grblHAL, FluidNC, Marlin, Smoothieware, and Ruida file export.

Excluded from certification:

- physical motion, beam power, spindle RPM, relay polarity, interlock wiring, limit-switch
  behavior, USB bridge behavior, EMI resilience, and real-controller timing;
- Ruida `.rd` acceptance by a production controller;
- every OEM fork or plugin combination of grblHAL, FluidNC, Marlin, and Smoothieware.

The audit distinguishes reproducible source behavior from facts that require a machine. Simulator
success is not treated as burn, spindle, or controller qualification.

## Independent end-to-end rubric

A robust controller integration should satisfy all of the following.

1. **One coherent identity contract.** Profile, active driver, detected firmware, output dialect,
   baud, power scale, status grammar, and stop semantics must describe the same controller session,
   or the discrepancy must be made unmistakable before output is handed off.
2. **Session ownership.** A replaced, reset, closed, or forgotten port must not publish stale
   replies, settle a new command, restart polling, or retain trusted coordinate evidence.
3. **Framing and flow control.** Lines must be byte-bounded for the target, acknowledgements must
   have one owner, push/status messages must not advance the stream, write failure must stop refill,
   and a rejection must contain already-buffered work.
4. **Truthful state interpretation.** `Idle`, `Run`, `Hold`, `Door`, `Alarm`, position, WCO,
   accessories, and completion must mean what the firmware can actually prove. A projected
   position must not silently become physical completion.
5. **Capability proof.** Compile-time features, protocol dialects, optional G-codes, safety-door
   semantics, overrides, probing, homing, and setting writes must be qualified or explicitly
   labeled unknown.
6. **Configuration provenance.** Geometry, units, power range, spindle range, startup programs,
   macros, limit/homing settings, and controller-specific configuration sources must be visible and
   should not be inferred from a generic profile.
7. **Coordinate integrity.** Homing and origin proof must be session-bound; reset, alarm, motor
   release, manual state mutation, and WCS change must invalidate the right evidence. Inch reports
   must be normalized before comparison with millimetre output.
8. **Safe job generation and handoff.** Output must pin critical modal state, keep travel tool-off,
   validate line size, use the correct power dialect, finish with tool-off, and cross a causal
   planner-drain boundary.
9. **Safe pause, stop, and disconnect.** The app must distinguish host-side freeze, feed hold,
   safety-door suspension, controller reset, and physical E-stop. It must not claim a physical stop
   that it cannot prove.
10. **Actionable faults.** Errors, alarms, resend requests, hard limits, reset, lost link, and
    uncertain stop must remain visible and must not allow silent continuation.
11. **Hardware qualification.** Each advertised controller family needs a versioned physical test
    matrix. Code and simulators can prove protocol logic, not relay polarity, output power, motion,
    or safety performance.

## Prioritized findings

### CS-01 — High — ordinary Start permits a split controller identity contract

Classification: **source-backed design gap; intentional policy; physical consequence is
controller-dependent**

The controller driver is selected once, at connection time:

- `src/ui/state/laser-connect-action.ts:57-60`

Firmware identity is later inferred from a banner. A mismatch only appends a log notice; it does
not change the connection-bound driver:

- `src/ui/state/laser-line-handler.ts:282-306`

Output strategy is independently selected from the current project profile:

- `src/core/output/select-output-strategy.ts:15-29`

Streaming mode and receive-window options are also taken from the current project profile at
transmission time:

- `src/ui/laser/start-job-transmission.ts:70-84`

Current tests explicitly require ordinary Start to succeed when:

- the active driver is GRBL but detected firmware is Marlin; and
- the project profile is changed to Marlin while the active connection remains GRBL.

Evidence:

- `src/ui/laser/start-job-controller-compatibility.test.ts:54-88`
- `src/ui/laser/MachineSetupProfiles.test.tsx:25-44`

Machine Setup's Connect step does contain a useful alert and “Reconnect using selected profile”
action:

- `src/ui/laser/device-setup/DeviceSetupConnectStep.tsx:127-155`

But the ordinary Start policy is deliberately permissive, and the overview test deliberately
expects no alert. The result can be:

| Source of truth | Controls |
| --- | --- |
| project profile | output dialect, power scale, streaming mode, RX window |
| connection-bound driver | response grammar, pause, resume, abort, status, home, origin |
| detected banner | informational identity only |

This is not harmless for cross-family changes. Smoothieware's common `S0..1` power convention,
Marlin's configurable `S` units, GRBL's `$30` scale, different status grammars, and different
stop semantics are not interchangeable. A beam-off Frame checks geometry, not power-scale or
emergency-control compatibility.

Recommended correction:

- preserve the user's authority to choose a profile and preserve Frame as the sole spatial guard;
- make a cross-family profile/active-driver/detected mismatch a prominent Job Review item;
- on profile family change, either rebind the live driver only after a fresh identity/status
  handshake or require the existing “Reconnect using selected profile” workflow on the factual
  basis that the active transport contract no longer matches the prepared stream;
- keep GRBL-family compatibility (`grbl-v1.1`/grblHAL/FluidNC) separately classified from
  cross-family compatibility rather than treating every mismatch alike;
- add end-to-end tests proving the same controller kind selects output, stream mode, parser,
  status, and stop behavior.

### CS-02 — High — reset-based Abort/Disconnect can execute uninspected startup automation

Classification: **source-backed mechanism and design gap; active risk requires controller
configuration/hardware verification**

For GRBL-family drivers, Abort uses realtime Ctrl-X. Disconnect also sends Ctrl-X, waits only for
the reset banner, writes `M5` and `M9`, then allows the link to close:

- `src/ui/state/laser-job-actions.ts:209-276`
- `src/ui/state/laser-disconnect-transaction.ts:58-119`

KerfDesk does not query `$N` startup blocks during handshake. It queries `$$`, build info, `$G`,
and other evidence, but there is no startup-block inventory:

- `src/ui/state/laser-controller-handshake.ts:188-230`
- `src/core/controllers/grbl/driver.ts:69-78`

GRBL's own documentation says `$N0/$N1` run on power-up/reset and explicitly warns that motion in
them can make an emergency/reset situation worse. The banner is printed before the startup-block
echo, so observing the banner is not proof that startup work has drained:

- [GRBL `$N` startup block documentation](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md#n---view-startup-blocks)
- [GRBL interface message ordering](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md#message-summary)

There is a second controller-specific version of the same boundary. FluidNC supports configured
macros around reset, homing, and unlock. Current FluidNC source schedules `after_reset` after the
reset banner and schedules `after_unlock` as a nested job:

- [FluidNC `Protocol.cpp` reset lifecycle at audited upstream commit](https://github.com/bdring/FluidNC/blob/3eccd9ccd280186c059ca08f06123b8883a29706/FluidNC/src/Protocol.cpp#L392-L443)
- [FluidNC `ProcessSettings.cpp` unlock lifecycle](https://github.com/bdring/FluidNC/blob/3eccd9ccd280186c059ca08f06123b8883a29706/FluidNC/src/ProcessSettings.cpp#L274-L290)
- [FluidNC `Macros.cpp` nested job scheduling](https://github.com/bdring/FluidNC/blob/3eccd9ccd280186c059ca08f06123b8883a29706/FluidNC/src/Machine/Macros.cpp#L59-L68)

The app's post-reset `M5/M9` writes are transport completions, not owned terminal-ack plus fresh
Idle fences. With a configured motion/output startup block or macro, cleanup may queue behind the
automation. Disconnect can then close while that work is still executing.

Default empty startup blocks/macros are not affected. This audit did not inspect or alter any
controller. The actual risk on a machine is therefore **unverified until `$N` and FluidNC YAML
macros are inspected**.

Recommended correction:

- read and archive GRBL `$N` startup blocks as controller evidence;
- obtain or import FluidNC lifecycle-macro evidence from YAML/WebUI rather than pretending `$$`
  is the complete configuration;
- label reset-based Abort/Disconnect as unable to certify fail-dark behavior when an executable
  startup program is present;
- after a commanded reset, consume startup echoes, use an owned tool-off command/settle marker,
  and require a later fresh Idle before declaring the connected controller settled;
- do not delay a physical E-stop recommendation: software reset remains a control stop, not a
  safety-rated stop.

### CS-03 — High — Smoothieware's required GRBL dialect is neither documented nor qualified

Classification: **source-backed defect/design gap; actual behavior requires a non-`grbl_mode`
controller to reproduce**

The Smoothieware driver unconditionally advertises:

- realtime `?`, `!`, `~`, and Ctrl-X behavior;
- realtime status reports;
- Home support via `G28.2`;
- halt recovery via `M999`;
- `G92`/`G92.1` origin behavior.

Evidence:

- `src/core/controllers/smoothieware/driver.ts:27-75`
- `src/core/controllers/smoothieware/commands.ts:7-25`

The generic profile and setup guide mention fractional power and external SD-card configuration,
but never state that `grbl_mode true` is a prerequisite:

- `src/core/devices/profile-catalog.ts:167-189`
- `src/ui/laser/device-setup/machine-setup-controller-guide.ts:88-97`

Smoothieware's primary documentation says it supports two G-code dialects. In `grbl_mode`, `$H`
homes and CNC/GRBL response semantics apply; in the RepRap-style mode, commands are interpreted
differently. The same documentation calls out homing/park differences:

- [Smoothieware `grbl_mode` documentation](https://smoothieware.org/grbl-mode)
- [Smoothieware endstop/homing documentation](https://smoothieware.org/endstops.html)
- [Smoothieware supported G-codes](https://smoothieware.org/supported-g-codes)

KerfDesk's Home transaction treats acknowledgement of `G28.2`, acknowledgement of `M400`, and a
later Idle-shaped report as proof of homing:

- `src/ui/state/laser-home-action.ts:62-155`

That proof establishes command completion, but it cannot prove that the command meant “home” under
the configured Smoothie dialect. The simulator encodes only KerfDesk's assumed grammar and command
meaning:

- `src/__fixtures__/controllers/smoothie-simulator.ts:1-8`

Recommended correction:

- state `grbl_mode true` as an explicit Smoothieware profile/setup prerequisite;
- add a read-only qualification query or operator-visible imported config fact for
  `grbl_mode`, status format, and `laser_module_maximum_s_value`;
- never label Smoothieware Home “confirmed” unless the dialect prerequisite is current for that
  controller session;
- keep the comma-format status parser tolerance, but do not confuse tolerant parsing with proof
  that realtime control and homing semantics match.

### CS-04 — Medium — Marlin position reports are represented as machine `Idle`

Classification: **source-backed capability-boundary gap; app-owned motion is mitigated; external
or panel-started motion requires hardware verification**

Marlin `M114` reports position. It does not report the controller's Run/Hold/Idle state. KerfDesk
nevertheless converts every valid `M114` position line into a shared `StatusReport` with
`state: 'Idle'`:

- `src/core/controllers/marlin/response.ts:33-66`

The source comment correctly admits that default `M114` is normally a projected destination and
not physical completion. KerfDesk mitigates its own Jog, Frame, Home, and end-of-job paths with an
owned `M400` marker before trusting a later position report:

- `src/core/controllers/marlin/commands.ts:6-19`
- `src/ui/state/laser-jog-actions.ts:177-183`
- `src/ui/state/laser-home-action.ts:118-145`

Marlin's primary documentation supports that distinction:

- [Marlin `M114` current-position semantics](https://marlinfw.org/docs/gcode/M114.html)
- [Marlin `M400` planner-drain semantics](https://marlinfw.org/docs/gcode/M400.html)

The residual gap is external activity: an SD/LCD-started job, another control surface, or a
firmware-specific asynchronous action cannot be distinguished from Idle by this protocol model.
KerfDesk can therefore display Idle and use an Idle-based readiness path without actual state
evidence.

Recommended correction:

- represent Marlin state as `unknown`/`position-only`, not literal Idle;
- make owned `M400` settlement a distinct readiness fact rather than overloading a status state;
- document KerfDesk as the sole command sender for Marlin sessions;
- qualify behavior with a real Marlin laser running an SD/LCD job while USB polling is active.

### CS-05 — Low/Medium — Marlin `G92.1` clear-origin support is build-dependent but unconditional

Classification: **source-backed capability overclaim; current owned-command error handling is
fail-closed**

The Marlin driver advertises `wcs: 'g92-only'` and unconditionally supplies `G92.1` as
`clearOrigin`:

- `src/core/controllers/marlin/driver.ts:31-79`

The source comment associates support with a different build condition, but Marlin's current
documentation says `G92.1` is available with `CNC_COORDINATE_SYSTEMS`:

- [Marlin `G92`/`G92.1` documentation](https://marlinfw.org/docs/gcode/G092.html)

KerfDesk's origin transaction is acknowledgement-owned. If the controller rejects the command, it
does not publish a successful cleared-origin patch, which limits the impact:

- `src/ui/state/laser-origin-actions.ts:175-193`
- `src/ui/state/laser-origin-transaction.ts`

Recommended correction:

- split “can set G92” from “can clear G92” in capabilities;
- qualify `G92.1` from Marlin build/config evidence or offer a profile flag;
- correct the source/profile wording to name `CNC_COORDINATE_SYSTEMS`.

## Intentional policies that are sound

The following choices are well-supported and should be preserved.

1. **Frame is the spatial authorization boundary.** The exact-artifact Frame permit is
   single-use, session/position-bound, invalidated by motion/setup change, and consumed at final
   handoff. It does not pretend warnings are physical proof.
2. **Tool-off framing.** Controller-specific Frame builders prepend explicit beam/tool-off commands,
   and Frame completion crosses an acknowledgement-owned planner-drain marker plus fresh status.
3. **Terminal errors.** A stream `error` stops refill. GRBL-family paths immediately request Ctrl-X
   to wipe already-buffered work, then defer beam-off cleanup until the reset boundary.
4. **One-ack ownership.** Stream, interactive command, motion operation, and untracked write ledgers
   prevent a terminal response from advancing two operations.
5. **Session epochs.** Reconnect, replacement, reset, alarm, close, and Forget invalidate stale
   status/settings/origin/Home evidence. Late old-session replies are quarantined.
6. **Truthful Marlin stop warning.** Marlin has no guaranteed realtime reset without optional
   firmware support. KerfDesk freezes host refill, sends `M5/M107`, and explicitly warns that
   physical stop is unconfirmed rather than claiming success.
7. **Laser pause semantics.** GRBL-family Pause uses the safety-door realtime command and waits for
   a settled Door/Hold state plus beam/accessory-off evidence. A failed confirmation escalates the
   laser path to fail-dark reset and tells the operator to use the physical E-stop.
8. **FluidNC settings boundary.** Numeric configuration writes are disabled; configuration is
   correctly directed to YAML/WebUI.
9. **Marlin streaming boundary.** Ping-pong streaming, `M400` settlement, no realtime overrides,
   and no false realtime-pause claim are correct conservative choices.
10. **Ruida boundary.** Ruida is file-only; live connection, Jog, Home, Console, Start, and settings
    are capability-gated off. The `.rd` encoder remains explicitly experimental.
11. **Line and parser containment.** GRBL's 127-byte receive window is modeled, oversized lines are
    rejected before Start, the Web Serial line accumulator is bounded, and subscriber exceptions
    do not kill the reader.
12. **Modal pinning.** Emitted GRBL jobs explicitly select `G21`, `G90`, `G54`, and `G94`; CNC also
    pins `G17`. This contains stale modal state from console/external sessions.

## Controller-by-controller result

| Controller | Source-level result | Required hardware/config evidence |
| --- | --- | --- |
| Stock GRBL v1.1 | Strongest path; transport and causal settlement are well tested | `$N0/$N1`, `$30/$31/$32`, homing/limits, door behavior, output polarity, M7 compilation, real power |
| grblHAL | GRBL-compatible architecture is reasonable; unknown extended codes remain raw and visible | exact board/plugin/version, axes/status fields, settings extensions, safety-door and override behavior |
| FluidNC | Streaming boundary and read-only settings policy are sound | full YAML, startup/after-reset/after-home/after-unlock macros, configured banner, pins, spindle/laser mapping |
| Marlin | Conservative ping-pong and `M400`; incomplete state and stop semantics | `LASER_FEATURE`, `CUTTER_POWER_UNIT`, S range, `EMERGENCY_PARSER`, `CNC_COORDINATE_SYSTEMS`, M5/M107 wiring, Home axes |
| Smoothieware | Simulator path is coherent only under assumed dialect | `grbl_mode true`, status grammar, `laser_module_maximum_s_value`, `M400`, `M999`, homing and realtime bytes |
| Ruida | Correctly isolated as experimental file export | controller accepts file, origin/axis mapping, scale, layer power/speed, checksum, vendor-panel behavior |

## Hardware qualification plan

No controller family should graduate from simulator-only evidence without the following recorded
tests on an identified firmware build and machine profile.

1. Record firmware/version, controller board, connection transport, profile hash, configuration
   backup, startup blocks/macros, and output wiring.
2. Connect, reset, reconnect, replace port, Forget, and disconnect while Idle; prove stale replies
   cannot reappear and no startup automation moves or energizes the tool.
3. Run Home/unlock/origin/set-clear-origin; power-cycle between steps; independently measure machine
   and work coordinates.
4. Exercise status while Idle, Run, Hold, Door, Jog, Alarm, and local-panel/SD activity.
5. Stream a line-window stress program; inject malformed line, controller error, ALARM, USB loss,
   delayed ack, duplicate ack, reset, and write failure.
6. Verify Frame with a disabled tool, all device origins, inch reporting where supported, limits,
   and nonzero WCO.
7. Verify Pause/Resume and Abort with an instrumented output. Measure beam/spindle/coolant state and
   motion timing; do not infer it from UI state.
8. Verify power words at minimum, 10%, 50%, and maximum against the controller's actual configured
   unit/range.
9. Confirm that a physical E-stop and hardwired interlocks work without the PC, application, USB,
   or network.
10. For Ruida, compare exported geometry, origin, speed, power, layers, and checksum against the
    vendor workflow before any production material.

## Unconfirmed hypotheses and non-findings

- A configurable FluidNC start message can look like stock GRBL, so banner detection is not a
  cryptographic identity source. This is an identity limitation, not independently counted beyond
  CS-01.
- Smoothieware's tolerant comma-status parser is useful; this audit did not reproduce which current
  hardware builds emit pipe versus comma status under each mode.
- The alarm-unlock latch is **not** stuck: `unlockAlarm` clears the app latch after transport write,
  and the Start repair waits for a later controller Idle before retry.
- FluidNC `after_homing` is naturally crossed by KerfDesk's subsequent settle marker when it is
  queued in the same command stream; the reset/disconnect gap is different because teardown waits
  only for the banner and transport writes.
- A missing/failed `$13` read can make inch-form status appear to be millimetres. Frame and Start
  use the recorded setting when available, and physical Frame remains the spatial truth; real
  qualification must still test `$13=1`.
- No claim is made that green simulator tests certify a safe burn, safe spindle stop, or safe
  interlock.

## Verification performed

Source state:

```text
HEAD de36b8674a8abf0c9276f5666ae34e14a3791476
2026-07-26 11:56:22 +0800
refactor(ui): extract tile emission and advisory reporting into a module (#446)
```

Focused command:

```text
pnpm exec vitest run src/core/controllers \
  src/ui/state/laser-lifecycle.simulator.test.ts \
  src/ui/state/laser-lifecycle-marlin.simulator.test.ts \
  src/ui/state/laser-lifecycle-smoothie.simulator.test.ts \
  src/ui/state/laser-home-action.test.ts \
  src/ui/state/laser-error-line.test.ts \
  src/ui/state/laser-connection-epoch.test.ts \
  src/ui/state/laser-store-untracked-ack-guard.test.ts \
  src/ui/state/laser-active-job-write-containment.test.ts
```

Result:

```text
Test Files  34 passed (34)
Tests       393 passed (393)
Duration    33.83s
```

Passing tests establish consistency with the encoded controller contracts. They do not invalidate
findings where the encoded contract itself is incomplete, such as cross-family identity drift,
uninspected startup automation, Smoothieware dialect prerequisites, or Marlin's lack of state
reporting.

## Primary references

- [GRBL interface and streaming protocol](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md)
- [GRBL realtime commands, Home, unlock, and startup blocks](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md)
- [GRBL settings](https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md)
- [grblHAL core and protocol extensions](https://github.com/grblHAL/core)
- [FluidNC repository and GRBL-compatibility statement](https://github.com/bdring/FluidNC)
- [FluidNC commands/settings](https://github.com/bdring/FluidNC/wiki/FluidNC-Commands-and-Settings/ea5af623daa9a360b57d7af3101514b2102c7f35)
- [Marlin Home (`G28`)](https://marlinfw.org/docs/gcode/G028.html)
- [Marlin position (`M114`)](https://marlinfw.org/docs/gcode/M114.html)
- [Marlin planner drain (`M400`)](https://marlinfw.org/docs/gcode/M400.html)
- [Marlin full shutdown (`M112`)](https://marlinfw.org/docs/gcode/M112.html)
- [Marlin spindle/laser power (`M3`)](https://marlinfw.org/docs/gcode/M003.html)
- [Smoothieware `grbl_mode`](https://smoothieware.org/grbl-mode)
- [Smoothieware supported G-codes](https://smoothieware.org/supported-g-codes)
- [Smoothieware laser module](https://smoothieware.org/laser)
- [Ruida vendor software/manual downloads](https://www.rdacs.com/en/download?a=RDWorksV8&id=1&m=software&v=4)

## Recommended disposition

Treat CS-01 through CS-03 as the next controller-safety slice, in that order:

1. unify or visibly reconcile profile/active/detected controller identity at ordinary handoff;
2. inventory and settle reset-triggered startup automation before claiming Abort/Disconnect
   settlement;
3. make Smoothieware `grbl_mode` a qualified session prerequisite.

Keep Marlin and Smoothieware labeled simulator-only until the hardware matrix is executed. Preserve
the current acknowledgement, epoch, planner-drain, Frame-permit, fail-dark, FluidNC read-only, and
Ruida file-only policies.
