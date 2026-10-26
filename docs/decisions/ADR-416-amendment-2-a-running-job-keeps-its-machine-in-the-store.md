## ADR-416 Amendment 2 - A running job keeps its machine, whatever writes it (2026-10-23)

**Status:** Accepted (controller meta audit finding M4-P1-1, confirmed on main 87ecb4f24 by an
independent refuter and the audit coordinator; the maintainer's standing instruction to fix
confirmed audit findings). Amends ADR-416 decision 1 and Amendment 1. | **Date:** 2026-10-23

### Context

ADR-416 decision 1 locks the toolbar's Laser / CNC switch while a job runs, and Amendment 1
(#1399, audit v4 E2-P2-2) locked Machine Setup's Save the same way. Both guards sat on their
buttons. Undo reached the same state change with no guard: the undo stack holds whole project
snapshots, and nothing between the shortcut, the menu, the Undo list and the store asked whether a
job was running.

The refuter's repro, on a real streamer: a CNC job is held at a tool change; Undo turns the project
back to Laser; after touch-off, **Jog to point** sends only `$J=G91 … X50 Y50`, where in CNC mode
the same move first lifts to `Z3.810`. The bit drags across the clamps at stock-top height, the
harm E2-P2-2 described. Redo, Open (a file on another machine), a sheet or production row switch
and every CNC-panel or device edit could reach the same fields the same way.

### Decision

1. **The guard is on the state change.** The project store's setter refuses, while a job is active,
   any change whose project differs from the live one in the job's machine. It is the innermost
   of the setters the store hands its action slices, under the Pro and numbering guards (the
   chain now lives in `store-setters.ts`, which keeps `store.ts` within ADR-015's size rule).
   Every action goes through it, so a new entry point cannot skip it. Active is `isActiveJob`, the test the toolbar
   and Amendment 1 use: streaming, paused, held at a tool change, done until the controller is
   Idle, or errored.
2. **The job's machine** is what jog, Zero Z, probing, Frame and the safe-Z lift before a point
   move read live: the Laser / CNC kind; CNC's own values (`machine.params`: safe Z, park, feeds,
   spindle); and the device's controller kind and command set, work area, origin, homing, Max
   feed, Frame speed, CNC sub-profile, rotary, no-go zones, Z travel, Z probe and Auto-focus
   command. Values are compared, not objects, so a field rebuilt with the same values passes.
   Artwork, layers, stock, bits and tiling, the machine's name, camera, saved positions and the
   other device fields are not part of it: editing them, and undoing those edits, still works
   during a job.
3. **A refused change is dropped whole.** Project, undo and redo history and the setup context are
   left as they were, and a warning says why. Nothing is queued to apply later; the operator
   repeats the command once the job ends.
4. **Undo and Redo stop at the step.** They check the step first and show their own message:
   "Undo stops here while a job is running: the next step changes Laser/CNC or the machine setup
   the job uses. Finish or stop the job, then Undo again." (Redo likewise). A jump in the Undo list
   runs Undo step by step and stops at the refused step, so the steps above it are undone and the
   rest wait. Skipping the step and undoing past it is not offered: every older snapshot carries
   the old machine too.
5. **Open waits too.** `setProject` (Open, Recent Projects, templates, autosave restore, sheet and
   production-row switches) refuses a project on another machine before it touches anything and
   returns `job-machine-locked`, which every caller treats as "not opened": no file name, save
   target or autosave cleanup is applied. A project on the same machine still opens.
6. **The button guards stay.** The toolbar switch and Machine Setup's Save keep their own checks
   and messages (decision 1, Amendment 1); the store guard is the backstop behind them.

The project store cannot import the laser store (the laser store imports it), so the laser store
registers how to tell that a job is active (`registerActiveJobProbe` in `job-machine-lock.ts`).
Without the laser store no job can run, and nothing is refused.

### Consequences

- A held CNC job keeps its mode, safe-Z lift and Work-Z check through a bit change, whatever the
  operator presses: Undo, Redo, Open, the toolbar, Machine Setup or a CNC panel value.
- During a job, edits to the fields in decision 2 from anywhere else (Max feed from a layer's feed
  ceiling, no-go zones, rotary, Z probe rows) are refused with a warning instead of applying.
- Amendment 1's note that the store cannot see the job no longer holds: it can, through the probe.

### Verification

- `job-machine-lock.test.ts`: with a CNC job held at a tool change (and streaming, paused, done or
  errored), Undo and Redo across a Laser / CNC switch and Undo of a safe-Z change leave the
  project, both stacks and the setup as they were and show the message; Undo and Redo of a machine
  rename still apply; an Undo list jump of three stops at the switch; the same Undo applies once
  the job ends; the store's `setMachineKind` and `replaceMachineSetup` (Machine Setup's Save) are
  refused; Open of a Laser project returns `job-machine-locked` without replacing the document,
  while a project on the same machine opens. With the guard switched off, 12 of the 15 fail.
- `laser-tool-change-jog.test.ts`: on a simulated GRBL streamer held at a tool change, Undo is
  pressed, Work Z is touched off, and **Jog to point** sends the safe-Z lift
  (`$J=G90 G21 Z3.810 F1000`) before any XY move. With the guard switched off the test fails: Undo
  turns the held project to Laser.
- `DeviceSetupWizard.job-lock.test.tsx` (Amendment 1) still passes.
- No hardware was operated.
