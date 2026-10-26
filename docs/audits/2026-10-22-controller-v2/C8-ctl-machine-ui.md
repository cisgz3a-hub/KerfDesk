# Controller audit v2 — C8 Machine UI: DRO, overrides, jog pad, move to position (`ctl-machine-ui`)

- **When:** 2026-10-22 10:40   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD `052b86ca2`;
  `git diff 99a2e64b7 HEAD -- src` is empty, only audit docs differ)
- **Scope:**
  - Status/DRO: `src/ui/laser/StatusDisplay.tsx`, `settled-head-position.ts`, `hand-position-copy.ts`,
    `saved-head-positions.ts`, `MoveToPositionSection.tsx`, `frame-position-readiness.ts`,
    `frame-status-wait.ts`, plus what they read: `src/core/controllers/grbl/status-parser.ts`,
    `src/ui/state/laser-status-position.ts`, `infer-machine-position.ts`, `controller-report-units.ts`,
    `head-move-dispatch.ts`, `src/core/devices/head-position-frames.ts`.
  - Overrides: `src/ui/laser/OverrideControls.tsx`, `src/ui/state/override-actions.ts`,
    `laser-override-admission.ts`, `laser-write-reservation.ts`,
    `src/core/controllers/controller-capabilities.ts`, the mounts in `JobControls.tsx` /
    `JobRunControls.tsx`, and the CNC override policy text in `cnc-accessory-readiness.ts`.
  - Jog pad: `JogPad.tsx`, `JogArrowGrid.tsx`, `FocusJogControls.tsx`, `JogSettingsRow.tsx`,
    `jog-control-policy.ts`, `jog-control-preferences.ts`, `jog-keyboard-map.ts`, `use-jog-shortcuts.ts`,
    `use-hold-jog.ts`, `JogPadAirAssist.tsx`, `src/ui/common/keyboard-targets.ts`.
  - Toolbar and setup panels: `MachineConnectionToolbar.tsx`, `MachineToolsDropdowns.tsx`,
    `MachineSettingsPanel.tsx`, `NoHomingPositionGuide.tsx`, `NoHomingPositionChoices.tsx`,
    `machine-job-warnings.ts`, `laser-machine-limit-warnings.ts`, `cnc-machine-limit-warnings.ts`,
    `src/ui/machine/MachineModeToggle.tsx`, `machine-capability-messages.ts`.
  - Governing: ADR-355 and Amendment 1 (laser Start resets overrides), ADR-375 decision 4 (Fire at the
    power it shows) and decision 3 (jog limits), ADR-493 (move to position, saved positions, keyboard
    XY jog), ADR-629 (inch display), ADR-373 (jog residual modal-spindle risk), ADR-228 (Frame-first:
    advisories never gate), ADR-362 (PageUp/PageDown Z jog), PROJECT.md non-negotiable 6 (units honest).
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes, L5 folded into L4 (the inputs are status
  reports, `$$`, saved positions from project/profile files and keyboard events). L6 was folded in
  (override write failures, refused jogs). Nothing was skipped.
- **Primary sources fetched this session:**
  - gnea/grbl `bfb67f0c`: `grbl/config.h` (override bytes, clamps, increments, Ov/WCO refresh counts,
    `RESTORE_OVERRIDES_AFTER_PROGRAM_END`), `grbl/protocol.c` (override application, clamping,
    `report_ovr_counter = 0`, Idle `spindle_set_state`), `grbl/jog.c` (`PL_COND_FLAG_NO_FEED_OVERRIDE`),
    `doc/markdown/settings.md` (`$10`, `$13`), `doc/markdown/interface.md` (WCO, Ov, A:, FS units).
  - grblHAL core master: `grbl.h` (override bytes and clamps), `config.h` (`$10` defaults,
    `COMPATIBILITY_LEVEL 0`, refresh counts), `settings.h` (`reportmask_t`), `settings.c`
    (`set_report_mask`), `report.c` (WCO/Ov/A: gating in `report_realtime_status`).
  - FluidNC main: `RealtimeCmd.h` (override bytes), `Protocol.cpp` (clamps, `update_velocities`,
    `protocol_do_spindle_override`), `GCode.cpp` (`gc_ovr_changed`).
  - W3C UI Events KeyboardEvent code Values (`Numpad3`, `Numpad9`) and UI Events (key location table).
  - LightBurn docs, "Setting Up CNC-Based Lasers" (`$10=0` advice).
- **Counts:** 5 raised → 0 refuted (confirmed 4, plausible 1) → P1 0 / P2 2 / P3 3 (+ 4 KNOWN
  re-observed). No severity changes.

## Headline

The override buttons are right: every byte matches GRBL, grblHAL and FluidNC, the readout shows the
controller's own `Ov:` values (never a prediction), and inch reports (`$13=1`) are converted on every
path checked, including a From-origin move (repro: 1 in WCO → 25.4 mm target).

Two P2s:

1. **NumLock-off keypad jogs Z.** With NumLock off, keypad 9 and 3 send `PageUp`/`PageDown`, which
   the jog shortcut reads as Z focus jogs. The same keys jog XY diagonally with NumLock on, and the jog
   pad's own tooltip advertises "Numpad 3" for the down-right arrow. On a CNC, Numpad 3 drives the bit
   down one Z step. ADR-493 states that a NumLock-off keypad never jogs.
2. **grblHAL `$10` is read as stock GRBL.** KerfDesk parses `$10` but nothing uses it. On grblHAL
   (default `COMPATIBILITY_LEVEL 0`), `$10` is a 16-bit mask whose bits 5 and 6 gate `WCO:` and `Ov:`.
   A stock-GRBL value such as LightBurn's recommended `$10=0` (or `$10=1`) switches them off. KerfDesk
   then says "not reported yet" / "wait for a status report" forever. With `$10=0` it also has no
   machine position at all, so Move to position, saved positions, Use current and Move laser here never
   work. Job Review already names grblHAL's `$10` buffer-state bit for `Bf:`, but not these bits.

## Control → bytes/lines → source

| Control | Bytes / lines sent | Source |
|---|---|---|
| Feed −10 / −1 / +1 / +10 / 100% | `0x92` / `0x94` / `0x93` / `0x91` / `0x90`, no newline | `OverrideControls.tsx:44-52` → `override-actions.ts:19-28` → `safeWrite`; retires `ovCache` in `laser-write-reservation.ts:40` |
| Laser power (laser job) / Spindle (CNC job) −10 / −1 / +1 / +10 / 100% | `0x9B` / `0x9D` / `0x9C` / `0x9A` / `0x99` | `OverrideControls.tsx:61-69` |
| Rapids 25 / 50 / 100 | `0x97` / `0x96` / `0x95` | `OverrideControls.tsx:70-97` |
| (all overrides) refused when | no `overrides` capability (Marlin, Smoothieware, Ruida: byte dropped); MPG active; Start arming; job start mark; Fire held; probe | `override-actions.ts:24-26`, `laser-override-admission.ts:19-32` |
| Laser Start (automatic) | `0x90 0x95 0x99` before the first program window | `laser-start-override-reset.ts:71` (ADR-355 Amd 1) |
| Fire (automatic) | `0x99`, then the capped Fire-on line | `laser-fire-actions.ts:134` (ADR-375 d.4) |
| Arrow click; keypad 8/2/4/6/7/9/1/3 with NumLock on; `Ctrl+Alt+[`/`]`, `Ctrl+Shift+]`/`[` | `$J=G91 G21 X±step Y±step F<jog feed>` | `JogArrowGrid.tsx:71-79`, `use-jog-shortcuts.ts:48-52` → `laser-jog-actions.ts:136-189` → `commands.ts:125-147` |
| Arrow hold (250 ms) | `$J=G91 G21 X±<to limit> F`, release `0x85` | `use-hold-jog.ts:74-89`, C3 |
| PageUp / PageDown, **and keypad 9 / 3 with NumLock off** | `$J=G91 G21 Z±<focus step> F<min(maxFeed, 600)>` | `use-jog-shortcuts.ts:15-18, 38-44, 69-72`, `JogPad.tsx:76-83` (P2-1) |
| Z+ / Z− buttons | same as PageUp / PageDown | `FocusJogControls.tsx:47-59` |
| Move to position Go, saved position Go | CNC: safe-Z retract first; then `$J=G91 G21 X<dx> Y<dy> F<jog feed>` from a fresh-Idle MPos; no M5 | `MoveToPositionSection.tsx:93, 242` → `head-move-dispatch.ts:70-94` → `laser-jog-actions.ts:82-134` |
| Use current, Save, Delete, Finish jobs here | nothing on the wire (reads MPos/WCO, or edits the profile) | `MoveToPositionSection.tsx:55-65, 128-133, 179-215` |
| Manual Air | profile `M7`/`M8`; off `M9` | `JogPadAirAssist.tsx:36-43` → `laser-store.ts:405-420` |
| Release motors | `$SLP` | `NoHomingPositionGuide.tsx:133-140` |
| Use this position (hand positioning) | `0x18`, then `$X` if Alarm, then `G92 X0 Y0` | `NoHomingPositionGuide.tsx:141-153`, `commands.ts:84` |
| Read (`$$`) | `$$` | `MachineSettingsPanel.tsx:45-49` |
| Status poll | `?` every 250 ms while busy, every 1 s idle | `laser-connection-actions.ts:80-81, 413-458` |
| Laser / CNC mode toggle | nothing; locked while a job is active | `MachineModeToggle.tsx:29-38` |

## Findings

### P2-1 — With NumLock off, keypad 9 and 3 jog Z (PageUp/PageDown), although the same keys jog XY diagonally with NumLock on and the jog pad advertises "Numpad 3" as an XY key

- **Where:**
  - `src/ui/laser/use-jog-shortcuts.ts:15-18` binds `PageUp`/`PageDown` by `event.key`.
    `:69-72` (`focusJogDirection`) never looks at `event.code`, and `:38-44` checks focus keys before
    the XY map.
  - `src/ui/laser/jog-keyboard-map.ts:10-12` and `:77-82` assume a NumLock-off keypad sends only arrow
    keys.
  - `src/ui/laser/JogArrowGrid.tsx:75` puts "Numpad 3" in the down-right arrow's tooltip.
  - `src/ui/laser/JogPad.tsx:76-83` sends `jog({ dz: ±focusStep, feed })`. On a CNC, `focusJogReady`
    is always true (`FocusJogControls.tsx:80-86`), and the step is 0.1–5 mm.
- **Anchor:**
  - Contract, ADR-493 decision 6: keypad digits jog "while Num Lock is on" and "with Num Lock off the
    keypad sends arrow keys, so one key never both nudges and jogs". The same claim is in the
    `jog-keyboard-map.ts` header.
  - Ground truth:
    - W3C UI Events code Values lists `Numpad9` as "9 PgUp" and `Numpad3` as "3 PgDn" on a keyboard.
    - The UI Events key location table lists `PageUp`/`PageDown` (and `Home`/`End`) as valid at
      `DOM_KEY_LOCATION_NUMPAD`, the NumLock-off keypad.
    - The repo's own test names "NumLock-off Numpad 7 (sends Home)" (`use-jog-shortcuts.test.ts:267`).
- **Scenario:**
  - Setup: a CNC project, connected and Idle, with a 1 mm Z step. The bit was just touched off at Z0
    on the stock.
  - The operator has learned from the tooltip that Numpad 3 is "Jog +X −Y". NumLock is off.
  - The operator presses keypad 3 to move toward the front-right corner.
  - The keypad sends `key:"PageDown" code:"Numpad3"`. KerfDesk sends `$J=G91 G21 Z-1.000 F600`, so the
    bit goes 1 mm into the stock instead of moving XY.
  - Keypad 9 does the same upward.
  - On a laser profile with confirmed Z travel, the same key lowers the head toward the material.
- **Evidence:** REPRO.
  - Temporary `src/ui/laser/zz-c8-numpad-numlock.test.tsx` (deleted) mounts the real `JogPad` with
    the store's `jog` spied, in CNC mode, front-left origin.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/zz-c8-numpad-numlock.test.tsx`.
  - Output:
    - `down-right arrow title: Jog +X -Y 10 mm (Numpad 3). Hold for continuous jog.`
    - `NumLock ON  Numpad3 -> [{"dx":10,"dy":-10,"feed":3000}]`
    - `NumLock OFF Numpad3 (key PageDown) -> [{"dz":-1,"feed":600}] defaultPrevented true`
    - `NumLock OFF Numpad9 (key PageUp) -> [{"dz":1,"feed":600}]`
    - Control: `NumLock OFF Numpad8 (key ArrowUp) -> undefined`.
  - L7: `use-jog-shortcuts.test.ts:265-267` covers NumLock-off 8, 4 and 7 but not 9, 3 (or 1).
- **Refuter:** CONFIRMED (reproduced, plus two independent outside sources). Severity stays P2.
  - What would refute it: ADR-493 meaning to give keypad 9/3 to Z, as LightBurn's own keys do; a
    check on `event.code` or `location` that tells keypad Page keys from the dedicated ones; or
    browsers never sending `PageDown` from the keypad.
  - Contract. ADR-493 decision 6 binds the keypad digits "while Num Lock is on" and gives the
    reason that with Num Lock off the keypad sends arrow keys, "so one key never both nudges and
    jogs". That reason is wrong for 7/9/1/3, which send Home/PageUp/End/PageDown. No ADR maps
    keypad 9/3 to Z on purpose. The repo's intent is that a NumLock-off keypad never moves the
    machine:
    - The `use-jog-shortcuts.test.ts` header says the keys a NumLock-off keypad sends "must never
      move the machine".
    - Its "NumLock-off Numpad 7 (sends Home) never moves the machine" case asserts that
      `onFocusJog` is not called.
    - `shortcut-list.ts:33` documents the keypad as "(Num Lock on)".
  - LightBurn. The Move window page (fetched, `docs.lightburnsoftware.com/latest/Reference/MoveWindow/`)
    requires Num Lock on for keypad jogging. It lists no keyboard key for Z: the dashed on-screen
    arrows move Z. A LightBurn forum reply and a closed feature request ("Pg-Up and Pg-Down to
    control Z axis") show that PageUp/PageDown Z jog is KerfDesk's own binding (MCH-07), not
    LightBurn parity. So LightBurn never jogs from a NumLock-off keypad.
  - W3C sources (fetched):
    - `w3.org/TR/uievents-code/` lists `Numpad3` as "3 PgDn" and `Numpad9` as "9 PgUp". Its
      NumLock text says the keys switch to "mimicking the keys of the control pad".
    - `w3.org/TR/uievents/` lists `End`/`Home`/`PageDown`/`PageUp` as valid at
      `DOM_KEY_LOCATION_NUMPAD`.
  - Code. Searching `src` for `DOM_KEY_LOCATION`, `event.location` and `startsWith('Numpad')` finds
    nothing. `focusJogDirection` reads `event.key` only, and it runs before the XY map.
  - Repro. A temporary `src/ui/laser/zz-c8r-numpad.test.tsx` (deleted) mounted the real `JogPad`
    in CNC mode (`DEFAULT_CNC_MACHINE_CONFIG`, front-left) with the store's `jog` spied. It
    dispatched events with `location: 3`. Output:
    - Tooltip: `Jog +X -Y 10 mm (Numpad 3). Hold for continuous jog.`
    - `ON  Numpad3 -> [{"dx":10,"dy":-10,"feed":3000}]`
    - `OFF Numpad3 PageDown -> [{"dz":-1,"feed":600}] prevented true`
    - `OFF Numpad9 PageUp -> [{"dz":1,"feed":600}] prevented true`
    - `OFF Numpad1 End -> []`, `OFF Numpad7 Home -> []`, `OFF Numpad2 ArrowDown -> []`
    - The dedicated PageDown key sends the same `dz -1`, which cannot be told apart by `key`.
    - `buildJogCommand` turns that into `$J=G91 G21 Z-1.000 F600`.
  - Severity check. The move is bounded: one focus step (0.1, 0.5, 1, 2 or 5 mm; 1 mm by default,
    `FocusJogControls.tsx:4`, `JogPad.tsx:47`) at `min(maxFeed, 600)`. It needs Num Lock off, and
    it comes from a key the operator pressed to jog. On a CNC `focusJogReady` is always true. On a
    laser it needs the `z-axis` capability and confirmed Z travel. It is a wrong-axis move toward
    the work, not an unbounded or unrequested one, so it is P2, not P1.
  - Not checked: a real Windows capture. Windows also turns Shift+Numpad3 with Num Lock on into a
    PageDown press with Shift released, which may reach the same path.
- **Severity note:** this is P2, not P1. The move is one focus step (at most 5 mm), it comes from a key
  the operator pressed to jog, and the spindle is off. But it is on the wrong axis, toward the work,
  from a key the UI advertises for XY.
- **Fix direction:** Ignore a Page key whose `event.code` starts with `Numpad` (or whose `location` is
  `DOM_KEY_LOCATION_NUMPAD`). Add NumLock-off 9/3/1/7 cases to both keyboard-jog test files.

### P2-2 — grblHAL's `$10` report mask is read but never used: with a stock-GRBL value (`$10=0` per LightBurn, or `$10=1`), `WCO:` and `Ov:` never arrive, and the DRO, Move to position and Job Review say "not reported yet / wait" forever; with `$10=0` there is no machine position at all

- **Where:**
  - `src/core/controllers/grbl/parse-settings.ts:182` parses `statusReportMask`. Its only reader is the
    dead `validateEnvelopeSettings` (C3-P3-2).
  - `src/ui/laser/StatusDisplay.tsx:103` prints "not reported yet" for any GRBL-family driver
    (`work-offset-assumption.ts:27-31`).
  - `src/ui/laser/head-move-dispatch.ts:35-36` says "has not reported its work offset yet. Wait for a
    status report and try again."
  - `src/ui/state/laser-jog-actions.ts:99` says "Jog to point needs a live machine position. Wait for
    an Idle status report."
  - `src/ui/state/cnc-accessory-readiness.ts:72-76` says "requires a fresh GRBL override observation …
    Wait for an Ov: status report".
  - `src/ui/laser/frame-position-readiness.ts:71-86` (with `frame-status-wait.ts:133-155`) makes every
    Frame spend its 3 s status burst waiting for a WCO that cannot come.
- **Anchor:**
  - Ground truth, grblHAL core master:
    - `settings.h` `reportmask_t`: bit 0 `machine_position`, bit 3 `feed_speed`, bit 4 `pin_state`,
      bit 5 `work_coord_offset`, bit 6 `overrides`.
    - `settings.c` `set_report_mask`: at `COMPATIBILITY_LEVEL <= 1`,
      `settings.status_report.mask = int_value` (the whole value is stored).
    - `config.h`: `#define COMPATIBILITY_LEVEL 0`.
    - `report.c` `report_realtime_status` prints `|WCO:` only `if(settings.status_report.work_coord_offset)`
      and `|Ov:` only `if(settings.status_report.overrides)`.
    - Stock GRBL has no such bits: its `$10` is MPos/WPos plus buffer (gnea `settings.md`), and it
      sends WCO and Ov on its refresh counts whatever `$10` holds (`interface.md`).
  - Ground truth, LightBurn "Setting Up CNC-Based Lasers": "Type `$10=0` in to the Console Window".
  - Twin: `src/ui/laser/job-review/stream-throughput-warnings.ts:131` already reads grblHAL's `$10` as a
    bitfield for `Bf:`. It tells the operator the "grblHAL status-report mask $10 buffer-state bit" is
    off and to enable it. The `WCO:` and `Ov:` bits of the same mask get no such treatment.
- **Scenario:**
  - Setup: a grblHAL laser or router whose owner followed LightBurn's CNC-laser advice and typed
    `$10=0`, or copied a stock-GRBL `$10=1`. On grblHAL that leaves WPos-only (or MPos-only) reports
    with no `WCO:`, `Ov:`, `FS:` or `Pn:`.
  - DRO: the `MPos:` row never appears (`$10=0`), and "Origin: not reported yet" never changes.
  - Move to position:
    - From origin always toasts "Wait for a status report and try again".
    - Canvas, Go to a saved position and Use current always fail with "needs a live machine position".
    - The hold jog has no position (see C3-P2-1).
  - Job Review: every CNC job carries the "fresh GRBL override observation … Wait for an Ov: status
    report" line, and every job carries the zero-work-offset assumption.
  - The override readout shows "—" through the whole job, so the operator cannot see the live feed and
    power percentages.
  - If the controller holds a persistent G54 or a kept G92, the canvas head marker and Absolute
    placement stay shifted by it. This part is disclosed by Job Review.
- **Evidence:** REPRO + SOURCE.
  - Temporary `src/ui/laser/zz-c8-grblhal-report-mask.test.tsx` (deleted):
    - Builds the real `settingsMapToControllerSettings` from a grblHAL `$$`.
    - Puts the real `grblHalDriver` capabilities in the store.
    - Feeds 40 grblHAL-shaped reports through the real `parseStatusReport` → `statusPositionPatch`.
    - Renders `StatusDisplay`.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/zz-c8-grblhal-report-mask.test.tsx`.
  - Output with `$10=0`:
    - `statusReportMask parsed: 0`
    - `after 40 reports: wcoCache null ovCache null`
    - `DRO text: State: IdleOrigin: not reported yet`
    - `machine position: null`
    - `Use current (origin): null`
    - `CNC Job Review override line: CNC Start requires a fresh GRBL override observation … Wait for an Ov: status report …`
  - Output with `$10=1`: `DRO text: State: IdleMPos: X -390.000 Y -280.000 Z -1.000Origin: not reported yet`.
    WCO and Ov stay `null`.
  - grep: `statusReportMask` has no consumer outside `parse-settings.ts` and `machine-envelope.ts`.
- **Refuter:** CONFIRMED (reproduced, plus primary firmware source). Severity stays P2. One anchor
  needs a correction.
  - What would refute it:
    - grblHAL sending WCO/Ov whatever `$10` holds, or `$10` being only the stock two bits.
    - A default `COMPATIBILITY_LEVEL` above 1.
    - KerfDesk getting the work offset some other way, such as a `$#` read or a host-recorded
      offset.
  - grblHAL core master (fetched from `raw.githubusercontent.com/grblHAL/core/master`):
    - `settings.h` `reportmask_t` is a `uint16_t` whose bits are `machine_position` (0),
      `buffer_state` (1), `line_numbers` (2), `feed_speed` (3), `pin_state` (4),
      `work_coord_offset` (5) and `overrides` (6), then probe, sync-on-WCO, parser, alarm and run
      substate, when-homing and distance-to-go.
    - `settings.c` `set_report_mask` stores the whole value under `#if COMPATIBILITY_LEVEL <= 1`.
      Only above level 1 does it keep just `& 0b11`. The `$10` definition's legacy form lists only
      "Position in machine coordinate,Buffer state".
    - `config.h` has `#define COMPATIBILITY_LEVEL 0`, and every `DEFAULT_REPORT_*` from position
      through overrides is `On`.
    - `report.c` `report_realtime_status`:
      - Bit 0 picks the position field: with it clear, grblHAL subtracts `gc_get_offset` and
        writes `|WPos:`, otherwise `|MPos:`.
      - `|Ov:` is written only `if(settings.status_report.overrides)`; otherwise
        `report->flags.overrides = Off`.
      - `|WCO:` is written only `if(settings.status_report.work_coord_offset)`; otherwise
        `report->flags.wco = Off`. That clears even a forced WCO flag from an offset change.
    - So clearing bit 5 suppresses WCO completely, not just extra fields. With `$10=0` the report
      is `<Idle|WPos:…>` and nothing more (no Bf, FS, Pn, WCO or Ov).
  - Stock GRBL contrast. gnea `report.c` gates WCO and Ov only by the compile-time
    `REPORT_FIELD_WORK_COORD_OFFSET` / `REPORT_FIELD_OVERRIDES`. `$10` there is only
    `BITFLAG_RT_STATUS_POSITION_TYPE` and `…BUFFER_STATE`, so the same value is harmless on stock
    GRBL.
  - What actually breaks with `$10=0`: KerfDesk has the work position but no machine position,
    because MPos = WPos + WCO (`infer-machine-position.ts:15-24`) and WCO never arrives. Nothing
    else supplies an offset:
    - `wcoCache` is written only from status WCO, from KerfDesk's own origin writes (which need a
      prior WCO), or on the Marlin-only `host-recorded` path.
    - The `$#` readback (`work-offset-readback.ts`) seeds the WCS name only, not `wcoCache`.
    - KerfDesk never writes `$10`.
  - LightBurn "Setting Up CNC-Based Lasers" (fetched, `docs.lightburnsoftware.com/2.1/Troubleshooting/CNCBasedLasers/`)
    says "Type `$10=0` in to the Console Window and press Enter". The page names only GRBL and
    never grblHAL, so this is GRBL advice that a grblHAL owner may follow.
  - Repro. A temporary `src/ui/laser/zz-c8r-mask.test.tsx` (deleted) used the real
    `settingsMapToControllerSettings`, `grblHalDriver.capabilities`, `parseStatusReport` and
    `statusPositionPatch` (40 reports each), and rendered `StatusDisplay`:
    - `$10=0`, `<Idle|WPos:10,20,-1>`: mask parsed 0, wco null, ov null, MPos null, DRO
      `State: IdleOrigin: not reported yet`.
    - `$10=1`, `<Idle|MPos:…>`: wco null, ov null, MPos known, DRO `…Origin: not reported yet`.
    - Control, `$10=511` with WCO and Ov: wco and ov filled, and the origin shown.
  - The wait texts are verbatim:
    - `head-move-dispatch.ts:35-36`: "Wait for a status report and try again."
    - `laser-jog-actions.ts:99`: "Wait for an Idle status report."
    - `cnc-accessory-readiness.ts:72-76`: "Wait for an Ov: status report…"
  - Correction to the anchor. `stream-throughput-warnings.ts:131` does not read `$10` as a
    bitfield. It only names "grblHAL status-report mask $10 buffer-state bit" in the text shown
    when no `Bf:` has been seen. The twin is weaker than stated, but the ground-truth anchor
    stands without it.
  - Severity check. This is a broken feature with a misleading, permanent message, not a silent
    wrong position. The DRO hides the position rather than showing a wrong one, and every move
    that needs a position is refused. It is P2 because the messages say "wait" when waiting can
    never help. It needs a non-default grblHAL `$10`. Not verified: the Frame 3 s WCO burst
    (`frame-status-wait.ts`).
- **Severity note:** P2, because every message is wrong and permanent ("not reported yet", "wait"), and
  it is reachable by following LightBurn's own published advice on a grblHAL board. It is not P1:
  nothing moves or burns unexpectedly, and the zero-offset placement is disclosed by Job Review and
  traced by Frame. Prevalence of `$10=0` on grblHAL boards is unmeasured.
- **Fix direction:**
  - On a grblHAL `$$` (compatibility level ≤ 1), read `$10` bits 0, 5 and 6, like the `Bf:` message.
  - When WCO or Ov reporting is off, say so in the DRO origin row, the Move-to toasts and Job Review
    (name the bit and the `$10` value to set). Skip the 3 s WCO burst.
  - With `$10` bit 0 clear and no WCO, say that the machine position cannot be known.

### P3-1 — The laser feed-vs-`$110/$111` advisory ignores enabled sub-layers, which compile and emit their own speeds

- **Where:**
  - `src/ui/laser/laser-machine-limit-warnings.ts:79-80` (`maxOutputSpeed`) takes
    `project.scene.layers.filter(layer => layer.output)` and `layer.speed`. Object overrides are read
    per parent layer only.
  - The compiler emits every enabled sub-layer as its own operation (`compile-job.ts:98`,
    `outputOperationLayers`, `layer.ts:430-434`).
- **Anchor:** Twin. The advisory's "fastest emitted feed" against `compile-job.ts` `outputOperationLayers`.
  The module header says it compares "what the emitter actually WRITES".
- **Scenario:**
  - Setup: layer speed 1000 mm/min, with an enabled sub-layer at 15000 mm/min. Profile `maxFeed` is
    20000, and the controller reports `$110=$111=10000`.
  - The job emits F15000 and GRBL clamps it to 10000. Job Review gives no "runs slower than planned"
    advisory, while the same 15000 on the parent layer gives one.
- **Evidence:** REPRO.
  - Temporary `src/ui/laser/zz-c8-sublayer-feed.test.ts` (deleted).
  - Output:
    - `operations compiled: [{"id":"L1","speed":1000},{"id":"L1:sub-1","speed":15000}]`
    - `advisory: []`
    - Control: `control (parent at 15000): ["A layer's feed 15000 mm/min is above the machine's reported max rate 10000 mm/min …"]`.
- **Refuter:** CONFIRMED by two code facts. The refuter did not re-run the repro.
  - `maxOutputSpeed` (`laser-machine-limit-warnings.ts:79-86`) reads only
    `project.scene.layers[].speed` and the parent-layer object overrides.
  - The compiler loops over `outputOperationLayers(layer)` (`compile-job.ts:98`). That function
    (`layer.ts:430-434`) builds each enabled sub-layer through `layerFromSubLayer`, which spreads
    `captureLayerOperationSettings(subLayer.settings)`, so each sub-layer carries its own speed.
  - No other laser advisory prints "reported max rate". The only other one is the CNC
    `cnc-machine-limit-warnings.ts`.
- **Fix direction:** Iterate `outputOperationLayers(layer)` (with the sub-operation's object overrides)
  instead of the parent layers.

### P3-2 — During an Alarm the DRO keeps showing the alarm reports' MPos as the head position, and Use current / Save capture it, while Unlock throws the same number away as "stale"

- **Where:**
  - `src/ui/state/laser-status-line.ts:312, 335` stores each Alarm report whole.
  - `src/ui/laser/StatusDisplay.tsx:39, 49-53` renders its `MPos:` unqualified.
  - `MoveToPositionSection.tsx:55-65, 100-101, 199` (Use current and Save are never disabled).
  - Against `laser-console-completion.ts:108, 113-121`: Unlock sets `positionEvidenceSuppressed` and
    logs "Cleared stale position".
- **Anchor:**
  - Twin: the store's own unlock path treats the post-alarm position as untrusted, but the DRO and
    head-position readers do not.
  - Ground truth: GRBL ALARM:1/2/3 mean the position is likely lost.
  - KerfDesk's own alarm text says so: `alarm-codes.ts:77`, "Position is lost".
- **Scenario:**
  - ALARM:3 (reset while moving). The DRO still reads "MPos: X 120.000 Y 80.000" in normal text beside
    the banner.
  - Use current fills those numbers, and Save stores them as a Canvas or From-origin position.
  - The moment the operator clicks Unlock, the same readout disappears as stale.
  - The Origin row also says "not reported yet" during Alarm and suppression, where in fact KerfDesk
    discards the WCO frames (`laser-status-position.ts:61-68`).
- **Evidence:** READ.
- **Refuter:** PLAUSIBLE. The code path was traced but not reproduced.
  - On entering Alarm, `handleInvalidatingStatus` (`laser-status-line.ts:333-362`) stores the whole
    report (`statusReport: report`). It also clears `wcoCache`, `homingProof` and Frame, and bumps
    `trustedPositionEpoch`. It does not set `positionEvidenceSuppressed`.
  - `handleRepeatedInvalidatingStatus` (`:303-316`) stores each later Alarm report the same way.
  - `StatusDisplay` shows `MPos:` whenever `inferCurrentMachinePosition` returns one.
  - `currentHeadPosition` (`head-move-dispatch.ts:57-63`) reads the same report. Use current
    (`MoveToPositionSection.tsx:96-102`) has no `disabled`, and the section is always mounted in
    `LaserWindow.tsx:139`.
  - Unlock's `positionLostAtUnlockPatch` sets `positionEvidenceSuppressed: true`.
  - Limits on the finding:
    - Only the Canvas frame captures the alarm MPos. From origin needs the WCO, which Alarm
      cleared, so it gets the "not known yet" toast.
    - Not every alarm loses position (ALARM:4/5 probe failures do not).
    - The number is what the controller itself holds (the `withheldControllerMPos` comment).
  - Stays P3. Refuse
  Use current then. Word the origin row "withheld" rather than "not reported yet".

### P3-3 — Saved positions, their tooltips and the Finish-position toast print bare numbers with no unit, beside a DRO that may read inches

- **Where:**
  - `src/ui/laser/MoveToPositionSection.tsx:230` (`X${xMm} Y${yMm} (Canvas)`).
  - `:132` (`Laser jobs now finish at canvas X… Y….`).
  - `head-move-dispatch.ts:91` (`Cannot move to X… Y…`).
- **Anchor:**
  - Contract: ADR-629 decision 3 and its Consequences. Surfaces not yet moved to the inch preference
    "keep showing millimetres … and say so with its own `mm` label"; the operator should "never see a
    wrong unit label".
  - PROJECT.md non-negotiable 6 ("Units honest").
- **Scenario:** With Settings → Units = Inches, the DRO reads "X 10.0000 in". The saved row beside it
  reads "Corner X254 Y127 (Canvas)".
- **Evidence:** READ.
- **Refuter:** CONFIRMED by the source strings and the ADR clause.
  - `SavedPositionRow` builds `` `X${position.xMm} Y${position.yMm} (${FRAME_LABEL[…]})` ``, used
    for both the row text and its `title`, with no unit.
  - `SetFinishButton` toasts `` `Laser jobs now finish at canvas X${props.x} Y${props.y}.` ``.
  - `dispatchHeadMove` toasts `` `Cannot move to ${what}: …` ``, where `what` is `X${x} Y${y}`.
  - The typed fields beside them say "X mm" / "Y mm" (`CoordinateField`), so only these
    surfaces are unlabelled.
  - ADR-629 line 24 requires unmigrated surfaces to say mm "with its own `mm` label".
  - Stays P3.
- **Fix direction:** Append ` mm` (or format through the display unit) in the row, its tooltip and
  both toasts.

## KNOWN (re-observed, not re-raised)

- **Beam-off claims on moves that keep the modal spindle** (ADR-373 residual; C3 KNOWN).
  - Move to position says "The head moves there with the beam off". Saved Go says "Move the head, beam
    off". `head-move-dispatch.ts:1-9` says "beam off".
  - The wire is only `$J=`, which keeps a modal M3/M4 and its S (gnea `jog.c`: spindle and coolant
    "fully function … during a jog").
  - Related, also inside ADR-373's residual: GRBL `protocol.c` applies a spindle-override change at
    Idle with `spindle_set_state(gc_state.modal.spindle, …)`. So with M3 left modal, an Idle override
    press re-powers the spindle or laser at the new percentage. The Idle override panel
    (`JobControls.tsx:117, 243-249`) makes that press reachable.
- **CNC override wording claims a block that ADR-228 removed** (2026-07-25 CNC full-chain audit, row
  `cnc-accessory-readiness.ts`).
  - `CNC_OVERRIDE_BLOCK_PREFIX` reads "CNC Start blocks increased or invalid controller overrides", and
    the null case reads "CNC Start requires …".
  - Both reach Job Review as demoted warnings (`start-job-readiness-policy.ts:45`;
    `cnc-start-overrides.test.ts` "override state never blocks Start"). A CNC job carrying a 200% feed
    from the previous job starts at 200% under a warning that says it is blocked.
  - `cncOverrideFinalStartIssue` still has no production caller.
- **Quick repeated jog presses** (PR #1305 / ADR-640) and protocol audit P-3. Two jog presses, or a
  held Enter on a focused arrow, that both pass the sync guards before either sets `motionOperation`
  were not re-audited.
- **grblHAL hold-jog envelope** (C3-P2-1, C3-P2-2). P2-2's `$10=0` case adds "no position at all" to
  the same hold.

## Refuted

The refuter refuted none of the five findings (2026-10-22). One claim inside P2-2 was corrected: the
`stream-throughput-warnings.ts` twin only names grblHAL's `$10` buffer-state bit in its text and does
not read `$10` as a bitfield. Candidates the auditor raised and dropped:

- **Override bytes wrong for some dialect.** Dropped. The bytes are identical in gnea `config.h`,
  grblHAL `grbl.h` and FluidNC `RealtimeCmd.h`:
  - `0x90`–`0x94` feed, `0x95`–`0x97` rapid, `0x99`–`0x9D` spindle.
  - Clamps: 10–200% feed and spindle; rapid 25/50/100.
  - FluidNC's `0x98` is "NOT SUPPORTED" and KerfDesk never sends it.
- **The readout shows what was sent, not what the controller holds.** Dropped.
  - `ovCache` is filled only from `Ov:` and is retired on admission.
  - GRBL sets `report_ovr_counter = 0` on a feed/rapid change.
  - FluidNC does the same in `update_velocities` and `gc_ovr_changed`, so the next report carries the
    firmware-clamped value.
- **A Canvas saved position lands elsewhere when the bed mapping is unverified.** Dropped as by
  design. ADR-493 decision 1 sends it where an Absolute job would and warns.
- **Typed or saved moves are not clamped to the envelope; imported saved positions are not capped at
  ±100000 like the typed field.** Dropped. ADR-493 decision 2 and ADR-232 leave limits to the
  controller. An import needs a hand-edited file and a deliberate Go.
- **Duplicate saved-position names in a hand-edited file are deleted together**
  (`savedPositionsAfterDelete` filters by name). Dropped as latent: KerfDesk never writes duplicates.
- **DRO treats inch reports as mm before the first `$$`.** Dropped as transient.
  - The handshake's first `?` precedes `$$`.
  - `refreshedReportUnitsPatch` clears the report and WCO when `$13=1` arrives.
  - Motion is gated by qualification meanwhile.
- **The 0.001 in jog step is sent as `X0.025`** (0.000984 in). Dropped: the error is below a thou per
  press.
- **Override panel at Idle disappears after each press until the next `Ov:` (≤1 s).** Dropped as UX
  only.

## Verified clean

- **Overrides.**
  - Gated by capability in both the UI mount and the store (`override-actions.ts:24`).
  - Refused during Start arming, the start mark, held Fire, probe and MPG.
  - Failures are toasted.
  - Laser Start always re-establishes 100% (ADR-355 Amd 1), and Job Review says so.
  - Jogs and Frame are immune to the feed override (`PL_COND_FLAG_NO_FEED_OVERRIDE`).
  - Labels ("Laser power" vs "Spindle", "Feed also scales plunge" on CNC only) match GRBL's single feed
    override.
  - Byte-exact tests exist (`OverrideControls.test.tsx`).
- **`$13=1` end to end.**
  - Covered paths: DRO position, origin row, feed (`FS` feed is in/min per `interface.md`; RPM is
    untouched), Use current, the From-origin target, `jogToMachinePosition`, the hold-jog position, the
    settled-head estimate, the CNC pause lift.
  - Jogs always carry `G21`.
  - REPRO (temporary `zz-c8-inch-move.test.ts`, deleted): MPos 2 in / 1 in with WCO 1 in / 0.5 in →
    Use current `{25.4, 12.7}` mm; From-origin Go to 0,0 → `jogToMachinePosition(25.4, 12.7, 3000)`.
- **Stock GRBL WPos-only (`$10=0`).** MPos = WPos + WCO, preferring the same frame's WCO
  (`infer-machine-position.ts:15-24`). It stays hidden until the first WCO (≤10 Idle reports, or the
  next report after an offset change, per `interface.md`). Tests cover both orders.
- **Stale position after a disconnect or reset.**
  - Connect, port close and Disconnect clear `statusReport`, `wcoCache` and `ovCache`. The DRO then
    reads "State: —".
  - Alarm and Sleep clear WCO, Ov and accessories, and drop Frame and homing proof.
  - Unlock, Home and Release motors suppress the position (Alarm itself: P3-2).
- **Keyboard jog gates.**
  - Auto-repeat is ignored (`event.repeat`), so there is one step per press.
  - No jog fires in inputs, textareas, selects, contenteditable or `role=textbox`, in modals, in
    scroll regions or the Artwork panel, or for an already-handled key.
  - Disabled exactly when the pad is: not connected, not Idle, busy, job active, except a settled
    tool-change hold.
  - Uninstalled when the rail collapses.
  - XY vectors equal the matching arrow for every origin (tests). Bare arrows never jog.
- **Z jog labels.**
  - Z+ sends `+dz` and Z− sends `−dz` in both modes, at `min(maxFeed, 600)`.
  - Focus steps are labelled mm in every display unit.
  - On a laser it needs the `z-axis` capability plus confirmed travel.
- **Machine mode toggle** is locked while a job is active, and `activeJobMachineKind` keeps the running
  job's labels.
- **Feed and travel advisories** compare emitted layer and object-override feeds with the slower of
  `$110`/`$111`, and stock with `$130`/`$131` (sub-layers: P3-1).

## Not verified

- **No hardware or real keyboard.** The NumLock-off key values come from the W3C specs and synthetic
  events, not a browser capture on Windows or macOS.
- **No real grblHAL board with `$10=0`.**
  - The `$10` behaviour was checked only against grblHAL master source.
  - At `COMPATIBILITY_LEVEL ≥ 2`, `$10` keeps the upper bits, so P2-2 would not occur there.
  - The Falcon A1 Pro's `$10` was not available.
- **FluidNC's `$10` semantics** were not checked: whether it gates WCO or Ov.
- **Overrides pressed during the CNC pause-lift's own override restore** (ADR-411 Amd 1). Not
  re-audited; this is the job-recovery area (rolling-v2 05/18).
- **Marlin `M220`/`M221` and Smoothieware's `F:` override component.** KerfDesk offers no override
  controls there (`overrides: false`). Smoothieware's `M221 S0` after Frame/jog/Home is C6-P2-1.
- **Phone-remote overrides and jog** (rolling-v2 01).

```json
[
  {"id":"C8-P2-1","severity":"P2","area":"ctl-machine-ui","file":"src/ui/laser/use-jog-shortcuts.ts","line":69,"anchor":"Contract: ADR-493 decision 6 (keypad jogs only with Num Lock on; NumLock-off keypad never jogs); Ground truth: W3C UI Events code Values (Numpad9 '9 PgUp', Numpad3 '3 PgDn') and UI Events key location table (PageUp/PageDown at DOM_KEY_LOCATION_NUMPAD)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"With NumLock off keypad 9/3 send PageUp/PageDown, which the jog shortcut reads by event.key as Z focus jogs: Numpad 3 (advertised on the down-right arrow as an XY key) drives a CNC bit dz -1 mm instead of +X -Y"},
  {"id":"C8-P2-2","severity":"P2","area":"ctl-machine-ui","file":"src/core/controllers/grbl/parse-settings.ts","line":182,"anchor":"Ground truth: grblHAL settings.h reportmask_t (bit5 work_coord_offset, bit6 overrides), settings.c set_report_mask (whole mask stored at COMPATIBILITY_LEVEL<=1, default 0), report.c gates WCO/Ov on those bits; LightBurn CNC-laser docs advise $10=0; Twin (weaker than first stated): stream-throughput-warnings.ts:131 names the grblHAL $10 buffer-state bit in its Bf text but does not read $10","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"grblHAL $10 is parsed but unused; a stock-GRBL value ($10=0 or 1) turns off WCO/Ov on grblHAL, so DRO origin, Move to position, Frame and Job Review say 'not reported yet / wait' forever, and with $10=0 there is no machine position at all (Move to position, saved positions, Use current never work)"},
  {"id":"C8-P3-1","severity":"P3","area":"ctl-machine-ui","file":"src/ui/laser/laser-machine-limit-warnings.ts","line":79,"anchor":"Twin: compile-job.ts:98 outputOperationLayers emits enabled sub-layers with their own speed","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Laser feed-vs-$110/$111 advisory reads only parent layer speeds, so an enabled sub-layer at 15000 mm/min above a 10000 mm/min axis limit gives no 'runs slower than planned' warning"},
  {"id":"C8-P3-2","severity":"P3","area":"ctl-machine-ui","file":"src/ui/laser/StatusDisplay.tsx","line":49,"anchor":"Twin: laser-console-completion.ts:108,113-121 Unlock clears the same position as stale; Ground truth: GRBL ALARM:1-3 position likely lost (alarm-codes.ts:77)","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"During Alarm the DRO shows the alarm reports' MPos unqualified and Use current/Save capture it, while Unlock discards the same number as stale; origin row says 'not reported yet' while KerfDesk discards WCO"},
  {"id":"C8-P3-3","severity":"P3","area":"ctl-machine-ui","file":"src/ui/laser/MoveToPositionSection.tsx","line":230,"anchor":"Contract: ADR-629 decision 3 (unmigrated surfaces keep mm and say so with their own mm label); PROJECT.md non-negotiable 6","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Saved-position rows, their tooltips and the finish/failed-move toasts print bare mm numbers with no unit beside an inch DRO"}
]
```
