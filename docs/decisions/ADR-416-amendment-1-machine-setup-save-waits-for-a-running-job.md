## ADR-416 Amendment 1 - Machine Setup's Save waits for a running or held job (2026-10-23)

**Status:** Accepted (controller audit v4 E2 finding P2-2, confirmed by an independent refuter and
the audit coordinator; the maintainer's standing instruction to fix confirmed audit findings).
Amends ADR-416 decisions 1 and 5. | **Date:** 2026-10-23

### Context

ADR-416 decision 1 locks the toolbar's Laser / CNC switch while a job runs, because the context of
that decision found that "the Laser/CNC toggle stayed live during a job, so a CNC tool-change jog
lost its safe-Z lift". Decision 5 says a Machine Setup save that changes the mode swaps placement
and the Output switches "as the Laser/CNC toggle does".

Machine Setup's **Save** had no job check. During a CNC job held at a tool change, choosing a laser
machine from the list (or the Laser toolhead of a Laser + CNC machine) and saving switched the
project to Laser while the job was still active. **Jog to point** then sent only the XY move: the
safe-Z lift and the Work-Z readiness check both follow the live project mode, so the bit could drag
across the stock or the clamps.

### Decision

1. **Save waits for the job.** While a job is active, Save is refused. Active means the same
   `isActiveJob` test the toolbar switch uses: streaming, paused, held at a tool change, done until
   the controller is Idle, or errored.
2. **The whole Save is refused, not only a type change.** A Save replaces the machine type, work
   area, origin, homing, controller contract and CNC values in one step. Jog, Zero Z, probing and
   the safe-Z lift read these live during a bit change, so no part of the save is held back for
   later. A Save that changed only the name is rare and can wait for the job to end.
3. **The draft stays.** On Review, Save is disabled and the footer says "Finish or stop the running
   job before saving Machine Setup. Nothing was saved; your changes stay in this draft." A press
   that reaches the save anyway shows the same message as a warning toast and changes nothing:
   the project, undo history and controller are untouched. When the job ends, Save is enabled again.
4. **Opening setup stays allowed.** The Machine Setup button is not disabled during a job. Reading
   the setup, and editing the draft, change nothing until Save.

The guard is in the save hook (`use-machine-setup-save.ts`), the one caller of the store's
`replaceMachineSetup` and `replaceCncStartupSetup`. The project store cannot read the laser store
(the import graph forbids the cycle), which is also why the toolbar's lock lives in its control.

### Consequences

- A held CNC job keeps its mode, its safe-Z lift and its Work-Z check through a bit change, whatever
  is done in Machine Setup.
- Firmware writes queued in the same Save were already refused by the write gate during a job; they
  now wait with the rest of the Save.

### Verification

- `DeviceSetupWizard.job-lock.test.tsx`: with a CNC job held at a tool change, the save hook keeps
  the project in CNC with an S30 draft, leaves the undo stack and the dialog as they were, and shows
  the message; once the job ends the same Save applies. The rendered wizard disables **Save machine
  setup** with the reason in its title and footer, and enables it when the job ends.
- No hardware was operated.
