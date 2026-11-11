## ADR-416 Amendment 4 - The bit in the spindle is session state, and a bit-change hold declares it (2026-11-11)

**Status:** Accepted (annoyance audit A2 finding B4-P1-1, P1, marked "runtime check owed" by the
audit. Reproduced on the GRBL simulator through the rendered Machine rail on main 06d947672
before any change. Fixed under the maintainer's standing instruction to fix confirmed audit
findings.) Amends ADR-416 Amendment 3 decision 2 ("The Active bit stays the open project's
choice") and ADR-171. Leaves Amendments 1 and 2 and ADR-306 as they are. Moves one more native
confirm, Zero Z's overwrite question, to ADR-707's in-app form. | **Date:** 2026-11-11

### Context

At a bit-change hold, Continue stays off until Work Z was set for the bit the program is about to
cut with: `workZZeroEvidence.toolId` must equal `pendingToolId`. That check is right, and stays.

What the record was tagged with did not work:

- Zero Z, the touch-plate probe and the controller read-back tagged it with the open project's
  `machine.toolId`. The hold already knew the bit it wanted, and did not use it.
- ADR-306 (#663, 2026-08-26) took the Machine rail's Active bit selector away, so the only control
  that writes `machine.toolId` is **Default bit** in Machine Setup.
- Amendment 1 (2026-10-23) refuses Machine Setup's Save for the whole of a job, the hold included.

So the hold said "Load {bit}, select it as the Active bit" when no control with that name existed,
and the one control that changed the bit could not be saved. Reproduction, on the simulator:

1. A two-bit project: operations on the 3.175 mm and 6.35 mm end mills, Default bit 3.175 mm.
2. Zero Z, Frame, Job Review, Start. The job streams to its hold: "Load 6.35 mm (1/4") end mill".
3. The rail's Zero Z records `toolId: em-3175`. Continue: "Work Z belongs to a different bit."
4. The rendered Z probe records `em-3175` too. The rail has no bit selector. Only Abort is left.

A two-bit job reached its end only if Default bit had been set to the second bit before Start. A
job with three different bits could not get past its second hold at all. The store tests set the
record directly, and no test changed bits through the interface, so nothing caught it.

Saving a new Default bit mid-job would also have been the wrong fix. Default bit is a design
value: an operation with no bit of its own compiles with it, and changing it recalculates
material-recipe feeds. A bit change at the machine would have edited the project, and the next
Start of the same file would have cut those operations with the last bit of the previous run.

### Decision

1. **Which bit is in the spindle is session state** (`spindleBit` in the laser store,
   `spindle-bit.ts`). It is a fact about the machine, not about the design. Zero Z, the probe and
   the controller read-back record Work Z for it. It is kept for the app session: a reconnect does
   not change the bit in the collet. Forget device clears it.
2. **Until a bit is declared, the project's Default bit stands in.** A single-bit job behaves as
   before: no new step, and Machine Setup's Default bit is still what Zero Z records.
3. **A bit-change hold declares the bit it asked for.** Entering the hold sets `spindleBit` to the
   pending bit in the same store update that voids the previous bit's Work Z. The touch-off the
   hold asks for is therefore recorded for that bit. The operator's statement is the touch-off
   itself, made under a line that names the bit: "This job is waiting for {bit}. Zero Z and the
   probe now record Work Z for it." A hold whose program names no bit (an imported file, a resume
   tail) declares nothing, as its Continue compares no bit.
4. **The Machine rail shows it and can change it.** **Bit in the spindle**, beside Zero Z, lists
   the open project's bits, plus the pending and declared bits when that list lacks them. Choosing
   another bit at a hold is the operator saying a different bit is loaded: a Work Z taken then is
   for that bit, and Continue stays off. Choosing a bit never changes a Work Z already recorded,
   so choosing the right bit afterwards does not unlock Continue either; zeroing again does. The
   selector is off while the job is cutting.
5. **The Continue check is unchanged.** Fresh Idle, no owed acknowledgement, current-epoch Work Z,
   plate removal, and `toolId === pendingToolId`, in `toolChangeContinueBlockMessage`.
6. **The same selector serves the paths outside a hold.** Start's first-bit advisory and the pass
   recovery of a later operation (`cnc-recovery-start-bit.ts`) say to choose the bit under Bit in
   the spindle, then zero. Neither needs Machine Setup or a project edit any more. Per-bit files
   were checked and are not affected: they carry a bit name, no id, and compare none.
7. **The probe measures the bit in the spindle.** The XYZ corner cycle takes its diameter and
   shape from that bit's entry in the open project. A declared bit the project does not list has
   neither, so only the Z cycle is offered for it, with the reason on the button.
8. **One name per thing.** "Active bit" is gone from what the operator reads. The project's value
   is **Default bit** everywhere (Machine Setup, Job Review's machine facts, the missing-bit
   warning, the surfacing panel). The machine's is **Bit in the spindle** (the hold, Continue's
   reason, Start's advisory, the read-back). Continue's plate reason names the button that clears
   it, **Dismiss reminder**; it used to name "Confirm plate removed", which no control is called.
9. **A second Zero Z at a hold can be answered.** Zero Z asks before it replaces a current zero
   with the bit more than 0.5 mm away from it (`zero-z-guard.ts`). That was a native confirm,
   which `job-aware-dialogs.ts` refuses for the whole of a job: at a hold, a Zero Z taken too
   early, or with another bit declared, could not be corrected, and the toast said "A job is
   running — stop it before discarding or replacing work." The question is now asked in the app
   (ADR-707), with the button **Zero Z here** and focus on the dialog, not the button. It is not
   refused during a job: the store's own gate decides when Zero Z may be sent, and allows it only
   in a settled hold. A yes counts only if the question would still read the same (ADR-707
   decision 6); otherwise nothing is sent and a toast says to press Zero Z again. The phone still
   refuses a Zero Z wherever the PC would ask (`REMOTE_ZERO_Z_REFUSAL`).

### What this does not change

- Amendment 1: Machine Setup's Save still waits for the job. Nothing has to be saved mid-job now.
- Amendment 2: `machine.toolId` is still outside the job-machine lock, and still not written by a
  hold. The project, its undo history and its dirty flag are untouched by a bit change.
- Amendment 3 decision 1: a CNC recovery still starts only with a CNC project open. The probe's
  geometry, the bit list, the point-move bed mapping and the jog feeds still come from that
  project. Only its stated reason about the Active bit no longer applies: Zero Z at the hold now
  works whatever is open.
- ADR-171: the record "still does not prove active tool identity". The software cannot sense the
  cutter. It now records the bit the job asked for, or the one the operator chose, instead of a
  value the operator could not change.
- G-code: no emitter, compiler or streamer change. Output is byte-identical.

### Considered

- **Exempt a Default-bit-only change from the Save lock** (the narrowest change to Amendment 1).
  Rejected: it edits the project at the machine (see Context), and the operator would still have
  to find a control with a different name from the one the hold named.
- **Keep the selection a separate step** (the hold declares nothing; the operator must choose the
  bit in the rail, then zero). Rejected for now: it adds a step to every bit change and proves
  nothing more, since choosing from a list is no more a measurement than touching off under the
  bit's name. The selector is there for the operator who loaded something else. If the maintainer
  prefers the explicit step, it is one line: drop `holdEntrySpindleBitPatch` from the hold entry.

### Consequences

- A multi-bit project Start completes on any number of bits without Abort.
- After a multi-bit job the rail shows the last bit. Starting the same job again without choosing
  the first bit and zeroing gets Start's advisory, which now names the control.
- A declared bit outlives the project that was open. Opening a project with another Default bit
  does not silently re-declare the bit in the spindle; with nothing declared it still does, as
  before (decision 2).

### Verification

- `cnc-bit-change-continue.simulator.test.tsx`, on the GRBL simulator through the real Frame,
  Job Review and Start flows and the rendered Machine rail and Live Motion bar:
  - a two-bit job: the hold's words, the declared bit, Zero Z, Continue, and a clean end;
  - a three-bit job: Zero Z at the first change, the rendered touch-plate probe and **Dismiss
    reminder** at the second, and a clean end;
  - Continue stays off, and a press sends nothing, while Work Z was zeroed with another bit
    declared; choosing the right bit alone does not unlock it; zeroing again does, after the
    overwrite question of decision 9;
  - outside a job, choosing a bit and zeroing clears the first-bit advisory.
  In every case the project, its Default bit, its undo stack and its dirty flag are unchanged.
  With decision 3 switched off (`holdEntrySpindleBitPatch` returning nothing), the two- and
  three-bit jobs fail, 2 of the 4 tests: the rail still shows the Default bit at the hold, and
  Zero Z then records it, which is the finding.
- `use-zero-z-action.test.tsx`: at a held job the overwrite question is asked in the app and a
  yes zeroes; Cancel sends nothing; a yes after the bit moved sends nothing and says so; no
  question with the bit at the existing zero.
- `spindle-bit.test.ts`: the stand-in, the declaration, a bit the project does not list, the hold
  entry, and the Continue check against a record taken with another bit.
- `laser-store-tool-change-continue.test.ts`, `laser-store-zero-z-ownership.test.ts`,
  `probe-start-gate-repro.test.ts`, `cnc-recovery-open-project.test.ts`,
  `JobRunControls.tool-change.test.tsx` and `WorkZRecoveryControl.test.tsx` still pass.
- No hardware was operated. Nothing here was checked on a real controller or with a real cutter.
