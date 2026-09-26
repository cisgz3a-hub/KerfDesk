## ADR-416 - Laser and CNC keep their own settings on one shared machine (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

Amends ADR-098 (one shared hybrid machine) and ADR-101 (gate-and-hide). The machine is still one
physical machine: bed, origin, homing, controller and connection stay shared. What changes is
which settings belong to one head.

### Context

The laser/CNC separation audit of 2026-09-26 asked whether a laser setting can change a CNC job or the other way round. The
G-code is separate: byte comparisons showed no laser layer setting reaches CNC output and no CNC
setting reaches laser output. The leaks were in shared state and run-time controls:

- Print and Cut registration applied to a CNC job.
- Make Default, a laser Cut Settings button, saved the operation's CNC block too, and a saved
  block made every new CNC operation skip the Startup Setup bit and material feeds.
- The jog pad's Air button sent the laser's M7/M8 in CNC mode, where it drives the coolant.
- The Laser/CNC toggle stayed live during a job, so a CNC tool-change jog lost its safe-Z lift.
- Saving in Laser mode lost the CNC stock, bits, params and tiling (they lived only in memory).
- A recovery Frame followed the current mode instead of the job's.
- The registration jig's laser kerf offset moved CNC job placement.
- The Box Generator kept one draft for both modes.
- CNC Job Review showed laser rows (G-code dialect, scan offsets), CNC preflight ran the laser
  feed checks, a laser rotary setting limited CNC jogs, and the Machine Setup nudge did not tell
  the modes apart.

By design the two modes also shared one Max feed, one Frame speed, one job placement, one set of
Make Default slots and one Output switch per operation. Johann chose "Split per head": fix the
leaks and give each head its own copy of those, with bed, origin, homing and controller shared.

### Decision

1. **The leaks are closed** (commit e6d515b3). Print and Cut never applies to a CNC job; Manual
   Air is hidden and refused in CNC mode (M9 still works); the mode toggle is locked while a job
   runs; Frame follows the job's own mode; the jig's CNC placement is measured from the CNC
   compile; the Box Generator keeps a draft per mode; CNC Job Review and CNC preflight drop the
   laser rows and checks; rotary does not limit CNC jogs; the Machine Setup nudge is per mode.
2. **Make Default is laser only.** It never stores a CNC block, and a block saved before this
   change is dropped when the defaults are restored. Its Output value is the laser's Output
   switch, so in CNC mode it goes to the parked laser switch (item 5). New CNC operations take
   their bit, feeds and depth from the CNC setup: Startup Setup, the stock material and the
   machine starter. CNC has no Make Default button, so those are CNC's defaults.
3. **Laser mode parks the CNC setup on the project** (`Project.parkedCncMachine`). Every save
   path writes it and opening the file hands it back for the next switch to CNC. A CNC project
   never carries a parked copy.
4. **CNC has its own Max feed and Frame speed** (`CncMachineParams.maxFeedMmPerMin`,
   `framingFeedMmPerMin`, mirrored in `DeviceProfile.cncSubProfile`). The device profile's Max
   feed and Frame speed are the laser's. CNC compile, preflight, the feed calculators, machine
   starters, surfacing, Frame, the jog pad, Go to work zero, board capture jogs, the live
   countdown and Job Review read CNC's own values through `core/cnc/cnc-head-feeds.ts`.
   Controller values applied outside Machine Setup follow the head in use: in CNC mode the
   reported max rate is CNC's Max feed, and the laser's Max feed, S range and laser mode stay.
   One Undo reverts it with the live placement (`active-head-max-feed.test.tsx`).
   A CNC setup saved before this change has none, so the device values apply until the setup is
   first made or opened, when they are copied onto it. Machine Setup edits them in the CNC step;
   the laser's stay in the Work area step, shown only when the setup includes a laser.
5. **Job placement and the Output switch are per mode.** `jobSetup.placement` and `layer.output`
   still hold the active mode's value, so every reader is unchanged. The other mode's value waits
   in `jobSetup.parkedPlacement` and `layer.parkedOutput`, and the two change places on every
   mode switch (toggle, Machine Setup or keeping the current machine for an opened file). The
   first switch has nothing parked, so the new mode starts from the current values; after that
   each mode keeps its own. A parked Absolute placement comes back as the machine default when
   homing has been turned off since.

### Consequences

- Changing a laser setting no longer changes a CNC job, and the reverse, apart from the machine
  itself: bed, origin, homing, controller and the scene are shared on purpose.
- Files gain three optional fields. Older builds ignore them: they open the project in its saved
  mode with that mode's values, which is what they showed before.
- The first switch into a mode copies the current placement and Output switches. That is the
  one moment the modes still touch, and it matches what the operator saw before this change.
- Regression tests: `print-cut-output.test.ts`, `laser-store-air-assist-safety.test.ts`,
  `MachineModeToggle.hybrid.test.tsx`, `laser-store-frame-job-mode.test.ts`,
  `prepare-output-registration-jig-machine.test.ts`, `BoxGeneratorDialog.persistence.test.tsx`,
  `layer-default-actions.test.ts`, `cnc-machine-starter-seeding.test.ts`,
  `import-actions.defaults.test.ts`, `parked-cnc-machine.test.ts`, `cnc-head-feeds.test.ts`,
  `cnc-own-feeds.test.ts`, `DeviceSetupCncMachineStep.speeds.test.tsx`,
  `save-tiled-gcode.test.ts`, `mode-switch-settings.test.ts`.
