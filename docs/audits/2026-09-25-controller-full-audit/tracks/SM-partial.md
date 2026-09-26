# Track SM (Smoothieware) — partial findings (work in progress)

Upstream: Smoothieware edge 38e2cc083db0e4f768535a9bf2d32cdf104ea980 (cite
`https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/FILE#Lnn`).
Firmware history questions were answered from a blobless clone of the edge branch
(`git log -S`), commit ids given below.

## SM-1 — Absolute jobs run displaced by a G92 origin Smoothieware still holds

- severity: high (wrong physical output; the job can run past the travel envelope)
- verdict: CONFIRMED (repro fails on current code)
- status: new (same root cause as CG-1 — KerfDesk takes a work offset only from `WCO:` —
  but a different failure: silent displacement instead of a refusal)
- failure scenario: operator sets an origin (`G92 X0 Y0`) at machine X110 Y60. Then any of:
  reconnect (page reload, cable replug, app restart), Abort / kill / limit halt + Unlock,
  Unlock + Home. Smoothieware still applies the G92 (every `?` report shows WPos = MPos − 110/60),
  but KerfDesk believes there is no origin. Absolute placement resolves `{ ok: true }` with no
  offset, so the Frame and the job are emitted in bed coordinates and the board adds the stale
  G92: everything lands 110/60 mm away. The canvas head and the Frame proof use WPos, so every
  on-screen position looks right; only the physical machine is displaced.
- kerfdesk evidence:
  - `src/ui/state/laser-status-position.ts:51-53` learns an offset only from `report.wco`
    (`if (report.wco === null) return { statusReport: report, ... }`); Smoothie never sends `WCO:`.
  - `src/ui/state/laser-status-line.ts:321-341` `originUnknownAfterControllerReset`: a `'g92'`
    origin becomes `workOriginActive: false, workOriginSource: 'none'` ("After an alarm or reset
    the controller has dropped G92") — applied on every Alarm report (L279) and by Abort
    (`laser-job-actions.ts:339`).
  - `src/ui/state/laser-console-completion.ts:78-90` `controllerUnlockedPatch` drops a `'g92'`
    origin after M999.
  - `src/ui/state/laser-connection-actions.ts:236-237` every connect starts with
    `workOriginActive: false, workOriginSource: 'none'`.
  - `src/ui/state/laser-home-action.ts:112-114` Home keeps only an origin KerfDesk still knows.
  - `src/ui/job-placement.ts:217-227` `resolveAbsolute`: `wco === null` and no custom origin →
    `{ ok: true }` (zero offset); `trustedMotionOffsetForPreflight` L169-175 then uses {0,0}.
- upstream evidence:
  - g92_offset changes only on G92/G92.x: `src/modules/robot/Robot.cpp#L624-L662`.
  - Robot registers only ON_GCODE_RECEIVED (`Robot.cpp#L133`); `Kernel::call_event(ON_HALT)`
    only re-syncs positions (`src/libs/Kernel.cpp#L359-L381`), so Ctrl-X, kill, limits and M999
    keep G92.
  - Homing resets axis positions only (`src/modules/tools/endstops/Endstops.cpp#L962-L973`).
  - USB re-attach prints `Smoothie\r\nok` without resetting (`src/libs/USBDevice/USBSerial/USBSerial.cpp#L328-L345`).
  - Every report prints `|MPos:` and `|WPos:` (WPos = `mcs2wcs`, which adds g92_offset), never WCO:
    `src/libs/Kernel.cpp#L261-L287`, `Robot.cpp#L448-L456`.
- reproduction: `src/__audit_repro__/SM/sm-1-retained-g92-absolute.test.ts` — 2 tests, both fail
  (`{"ok":true}: expected undefined to deeply equal { x: 110, y: 60 }`).
- fix: local. For a driver whose report carries both MPos and WPos but no WCO (Smoothieware),
  derive the work offset = MPos − WPos from the same report in `statusPositionPatch` (feed
  `wcoCache` and `workOriginActive` exactly as a GRBL `WCO:` frame does). That also closes CG-1.
  Additionally stop `originUnknownAfterControllerReset`/`controllerUnlockedPatch` from declaring a
  Smoothie G92 dropped (Smoothie keeps it until G92.1 or reboot).

## SM-2 — Constant-power layers run speed-proportional on Smoothieware older than 2021-06-15

- severity: medium (wrong physical output in narrower conditions)
- verdict: CONFIRMED (upstream history)
- status: new
- failure scenario: a layer set to constant power (per-layer override, or the `grbl-compatible`
  dialect) is emitted as `M400` + `M221 S100 P1`. On any Smoothieware build before edge commit
  971eb8cf (2021-06-15) `M221` ignores P and the laser module always scales power by the speed
  ratio, so corners and short segments get less power than requested. KerfDesk neither detects
  the build nor states the minimum version (the profile note says only "Power mode uses M221 P").
  The default `grbl-dynamic` dialect (M4 → `P0`) matches old firmware, so only constant-power
  output is affected.
- kerfdesk evidence: `src/core/output/smoothieware-strategy.ts:49-59` (`M221 S100 P${M3 ? 1 : 0}`);
  `src/core/devices/profile-catalog.ts:137` (no minimum build).
- upstream evidence: current `Laser.cpp#L206-L208` (`if(gcode->has_letter('P')) disable_auto_power= ...`)
  and `#L248-L251`; history: `git show 971eb8cf` ("finish up changimg PWM frequency for laser",
  2021-06-15) adds `disable_auto_power`, the P word and the new `M221` report text; before it
  `get_laser_power` always used `current_speed_ratio(block)`.
- reproduction: traced only (firmware history).
- fix: local. Probe `M221` (no arguments) at qualification: builds with P answer
  `Laser power: ..., disable auto power: N, PWM frequency: ...`, older builds answer
  `Laser power scale at ...`. Show a Job Review warning for constant-power layers on an old build
  and name the minimum build in the profile evidence.

## SM-3 — `fire off` never completes when the Laser module is not loaded: every Jog/Frame/Home/Start wedges

- severity: medium (wedged controller, narrower configuration)
- verdict: CONFIRMED by source trace (repro in progress)
- status: new
- failure scenario: `laser_module_enable` false, or a `laser_module_pin` that is not hardware-PWM
  (the module prints an error at boot and deletes itself). KerfDesk leads every jog, Frame tool-off
  prefix, Home and job with `fire off` and owes it one terminal line. Nobody answers it:
  SimpleShell deliberately prints nothing for `fire`, GcodeDispatch ignores lowercase lines. The
  owed ack is never released (acks never expire; no Alarm report resets it because the board is
  not halted), so Jog/Frame/Home/Start stay refused until reconnect — and the next jog wedges again.
- kerfdesk evidence: `src/core/controllers/smoothieware/commands.ts:36-44` (`fire off` first in
  `SMOOTHIE_FRAME_TOOL_OFF_LINES`), `:67-73` jog; `driver.ts:67` home; `smoothieware-strategy.ts:28`
  job; `response.ts:27` completion only on the exact Laser.cpp text;
  `src/ui/state/laser-safe-write.ts:294-299` one owed ack per newline.
- upstream evidence: `src/modules/tools/laser/Laser.cpp#L53-L57` and `#L69-L74` (module deletes
  itself); `src/modules/utils/simpleshell/SimpleShell.cpp#L286-L288` (`fire` → no output);
  `src/modules/communication/GcodeDispatch.cpp#L79-L82` (lowercase ignored).
- fix: local. Qualify the Laser module at connect (`M221` with no args prints a `Laser power`
  line only when the module is loaded) and refuse live laser output with that reason; or send
  `fire off` only after that probe succeeded.

## SM-4 — Smoothieware simulator is more forgiving than the firmware (hides SM-1, SM-3)

- severity: low (test fidelity) — verdict CONFIRMED by comparison — status new
- gaps: Ctrl-X prints `Smoothie` (a banner KerfDesk treats as a reboot boundary) and halts only
  when moving; the firmware prints `HALTED, M999 or $X to exit HALT state` (non-grbl) or
  `ALARM: Abort during cycle` (grbl mode), always halts and flushes its receive buffer
  (`USBSerial.cpp#L302-L314`, `SerialConsole.cpp#L227-L245`). `G92 X0 Y0` is executed as a move to
  X0 Y0 and WPos always equals MPos. While halted the sim answers `!!` to M5/M9/M114/M115, which
  the firmware allows (`GcodeDispatch.cpp#L34`). `fire off` always completes (no module-absent
  mode). Running reports lack `F:cur,req,ovr|L:|S:` (`Kernel.cpp#L236-L259`). USB attach prints
  `Smoothie` then `ok` in the firmware; the sim prints `Smoothie command shell` without `ok`.
- fix: local (fixture only).

## SM-5 — An aborted Frame or jog leaves its F as the G0 seek rate (ADR-361 item 6 incomplete)

- severity: low — verdict CONFIRMED by source — status incomplete fix of ADR-361 item 6
- scenario: Abort (Ctrl-X) or a halt during a Frame/jog after `M120` and a `G0 ... F<frame>`
  but before `M121`. Robot applies F to seek_rate at parse time (`Robot.cpp#L1143-L1148`), has no
  ON_HALT handler, so the pushed state is never popped; M999 keeps it. The next job's bare `G0`
  travel runs at the framing feed.
- fix: needs decision (explicit F on job G0 travel, or a known seek-rate restore line).

## Still to check

- SM-3 repro test; Home confirmed when `$H` runs no cycle (endstops module absent → `$H` prints
  `ok` at once); unsolicited `ALARM:`/`Error:` lines classified as terminal acks; status `F:` idle
  value used as live feed; remaining questions 1-10 summary for "checked and correct".
