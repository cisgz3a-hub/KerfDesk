## ADR-630 Amendment 5 - An opened program drops the WCS and Work-Z records it may change (2026-10-23)

**Status:** Accepted. Amends ADR-630 "Review and Start". Keeps PROJECT.md non-negotiable 21 and
ADR-565: nothing new refuses, and the completed Frame stays the only ordinary Start gate. Fixes
controller audit v4 findings E4-P1-1 (rated P2 after review) and E4-P2-1. | **Date:** 2026-10-23

### Context

The store records two facts about the controller that later Frames and Starts rely on: the active
work coordinate system (`activeWcs`) and whether work Z was set for the loaded bit
(`workZZeroEvidence`, bound to `workZReferenceEpoch`). KerfDesk's own programs pin `G54` and write
no offset and no tool, so a project run leaves both true. An opened program can change both, and
after a run the store still held what it knew before.

1. **The WCS (E4-P1-1).** A program that selects `G55`-`G59` and has no `M2`/`M30` after it leaves
   the controller in that system. Only a program end selects `G54` again (gnea/grbl `gcode.c`
   L1091-1101; FluidNC v4.0.3 does the same), and Smoothieware outside grbl mode keeps the system
   even through `M30`. The store still said `G54`, so the next project Frame's WCS step
   (`normalizeFrameWorkCoordinateSystem`) returned early. The Frame traced in `G55` while the job's
   own `G54` cut at the `G54` origin.
2. **Work Z (E4-P2-1).** `G92 Z`, `G10 L2`/`L20 Z`, `G43.1`, `G49`, `M6` and `T` in an opened
   program left the probed Work Z current. The next CNC project Frame and Start skipped their Zero Z
   check and cut at the shifted depth. GRBL keeps `G92` and the tool length offset through `M30`,
   and `G10` stores its offset in EEPROM. The Console already drops this evidence for the same
   words.

A Stop or an error resets the controller, and the reset banner already makes the WCS unknown. A
`G10` the controller stored before the Stop still stands.

### Decision

1. **The records go as the stream is installed.** `startJob` takes `externalProgram`, which only
   `startExternalProgram` sets. In the same store update that installs the stream, before any
   line is sent, the store reads the exact program and drops what its words may change. A
   completed run, a Stop and a lost link are all covered by this one rule. Re-reading `$G` after
   the run was considered. It would need a hook on every way a run ends, and the Frame already
   reads a WCS it does not know.
2. **The WCS becomes unknown.** This happens when a `G54`-`G59` word, the extended `G59.1`-`G59.3`
   included, selects a system other than the one the store knows. The next Frame reads `$G` before
   it selects `G54` (audit CG-2, `frame-wcs-selection.ts`). It selects `G54` when another system is
   active and keeps the existing "Controller was using G55" warning. When a program end restored
   `G54`, it finds `G54` and writes nothing. A WCS that was already unknown stays unknown.
   - `M2`/`M30` alone is no change. The external Frame selected `G54` on every controller that can
     report its system, so a program end cannot leave another one.
3. **Work Z follows the Console's rule.** Each line is read with `commonConsoleStateEffect`. A line
   it classes as `coordinates-z`, `coordinates-all` or `tool` clears `workZZeroEvidence` and bumps
   `workZReferenceEpoch`, which is the Console's patch for those effects.
   - A word that selects the system the store knows is active changes no offset, so it is left
     out. A CAM header's `G54` therefore keeps both records.
   - A word that selects another system does void Work Z, because each system has its own Z
     offset.
   - XY-only offsets (`G92 X Y`, `G10 L2 X Y`) leave Work Z, as they do in the Console.
4. **Nothing else changes.** `wcoCache` and `trustedPositionEpoch` stay. GRBL-family firmware
   reports the new offset after any change of system, `G92`, `G10` or `G43.1` (it flags a WCO
   refresh in `gcode.c`). When the next Frame finds another system, its own `G54` selection bumps
   the position epoch (`frameWcsSelectionPatch`). The log names what was dropped and why.
5. **Cost.** Each line is word-scanned once. The Console's classification runs only on lines with a
   `G` word other than `G0`-`G3`, or with an `M` or `T` word.

### Not in this decision

- The XY origin record (`workOriginActive`, `workOriginSource`) after a program's `G92 X Y` or
  `G10 L2/L20 X Y`. The Run review already warns that later jobs start from the changed origin.
- Project programs, which pin `G54` and write no offset or tool.

### Consequences

- After an opened program that leaves `G55`, the next project Frame finds `G55`, selects `G54` and
  says so. A program that selects `G55` and then ends with `M30` costs one `$G` read.
- After an opened program with a Z offset or tool word, the next CNC Frame asks for Zero Z again,
  and the CNC Start check applies, as after the same command typed in the Console.
- A program whose only system word is the `G54` already active changes neither record.

### Verification

- `external-program-controller-state.test.ts` checks the classification: `G55`, `G59`, `G059`,
  `G0G56X1` and `G59.1` against `G54`; a `G54` CAM header; each Z-offset and tool word, including
  `G54G10L20P0Z0`; the XY-only offsets and plain motion; a `G54` read against an unknown system; and
  the patch, which keeps an unknown WCS unknown.
- `external-run-controller-state.simulator.test.ts` drives the real store, the real external Frame
  and Start, and the GRBL simulator. The simulator now tracks the selected system: `G54`-`G59`
  select one, and `M2`/`M30` and a soft reset select `G54` again. `$G` reports that system, and
  only `G54`'s offset is modelled. The test covers:
  - a `G55` program, which leaves the simulator in `G55` and the store unknown from Start onward,
    after which the Frame's WCS step selects `G54`;
  - a `G55` program ending in `M30`, which is read back as `G54` with nothing written;
  - a `G54`-only program, which keeps `G54`;
  - CNC programs with `G92 Z0`, `G10 L20 P0 Z0`, `G43.1 Z2` and `T2`, which leave Work Z stale,
    while one without them keeps it.
  With `externalProgram` off, all six store cases that expect a change fail.
- No hardware was run.
