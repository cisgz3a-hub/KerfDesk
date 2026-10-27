## ADR-500 Amendment 2 - Opening a file keeps the machine in use, and the app remembers only a machine the operator chose (2026-10-27)

**Status:** Accepted (rolling audit v4 findings H4-P1-1 and H9-P1-1, each confirmed by an
independent refuter and re-verified by the audit coordinator on main `105d6374c`; the maintainer's
standing instruction to fix confirmed audit findings). Amends Amendment 1 Decision 2, and extends
ADR-440 Amendment 3 and ADR-400 Amendment 1 item 3 from the camera and Auto-focus to the whole
machine. | **Date:** 2026-10-27

### Context

Every project file carries a copy of the machine profile. Amendment 1 Decision 2 had Open use
"that document's machine and settings without silently replacing the independently saved
application machine preference". Two gaps let the file's copy replace the operator's machine.

- **H4-P1-1 (P1).** A file saved earlier for the same machine (same profile id, name and bed size)
  shows no machine notice. Open still installed the file's whole copy: origin, homing, no-go zones,
  scan offsets, controller, rotary, saved positions. Only the camera (ADR-440 Amendment 3) and the
  Auto-focus command (ADR-400 Amendment 1) were kept. In the repro, the origin had been corrected
  from front-left to rear-right since the save. After the Open the same line moved from
  `G1 X280 Y20` to `G1 X30 Y180`, and the no-go warnings went from 2 to 0. The only message was
  "Opened sign.lf2". The next unrelated machine edit then saved the old copy as the app's machine.
  The job lock already counts origin, homing and zones as "the machine" (ADR-416 Amendment 2
  Decision 2), and refused this same file while a job ran.
- **H9-P1-1 (P1), persistence half.** The persistence hook saved any machine change made after
  Open. After **Keep current machine** and one Undo, it saved the rejected machine for the next
  session. While the machine notice was still unanswered, an edit to the file's machine was also
  saved as the app's.

### Decision

1. **A file for the machine in use keeps that machine.** When the opened file's machine has the
   same identity as the current one (profile id, name and bed size, as in ADR-400 Amendment 1), the
   current machine's whole profile is kept. That covers every device field and the CNC head's
   machine values (`machine.params`, or the parked copy in Laser mode). The file keeps its own job:
   artwork, operations, stock, bits, tiling and job placement. Amendment 3 of ADR-440 still decides
   the camera calibration: with none in use, the file's comes in. With no CNC values in use, the
   file's come in the same way. Catalogue bookkeeping (version, evidence, vendor) is kept silently.
2. **It says what the file held.** When the file's copy differed, an info toast names the values:
   `This file's machine settings were not used (origin and no-go zones): your machine keeps its
   current setup from Machine Setup.` The names are origin, homing, no-go zones, scan offsets,
   controller, rotary setup, saved positions, max feed, frame speed, S range, air assist, Z setup,
   CNC settings, and "other machine settings" for the rest. The camera and Auto-focus keep their
   own toasts. A file whose copy matches opens silently.
3. **A file for another machine is unchanged.** It still brings its whole machine behind the
   machine notice, with **Keep current machine** and **Use project machine** (ADR-440 Amendments
   3 and 5).
4. **The app remembers only a machine the operator chose.** While a machine notice for another
   machine is open (`projectBedReconciliation.machineChanged`), the persistence hook saves
   nothing. **Use project machine** answers it, and the next change to the machine saves that
   machine, as the notice already says (ADR-440 Amendment 5 Decision 4). **Keep current machine**
   answers it the other way. Undoing Keep brings the notice back (ADR-440 Amendment 6), so the hook
   saves nothing again until the operator chooses.

### Consequences

- An origin, zone or scan-offset correction survives opening any older file for the same
  machine. A file can no longer bring back an older setup of the operator's own machine. To use
  the file's values, set them in Machine Setup, as for an older camera calibration.
- A file opened for the same machine during a running job no longer changes the job's machine, so
  the job lock no longer refuses it.
- An edit made to another machine's file before the notice is answered stays in the project, but
  is not remembered for the next session.
- **New** with a notice still open keeps the file's machine for the fresh canvas and closes the
  notice (Amendment 1 Decision 3, unchanged). The machine is not remembered on New. A later machine
  edit in that canvas does save it. This is left as it was.

### Verification

- `src/ui/app/opened-machine-kept.test.tsx`: the real store with the persistence hook mounted, and
  output from `emitGcode`. The same-machine Open keeps origin and zones: the burn line and no-go
  warnings are unchanged, the toast names them, and a later edit remembers them. A CNC file keeps
  the head's safe Z and the file's stock. Another case covers the persistence half of H9-P1-1.
  With the change reverted, the four cases for H4-P1-1 and H9-P1-1 fail.
- `src/ui/app/use-machine-profile-persistence.test.tsx`: an edit or mode change made before the
  notice is answered is not saved, nor is anything saved through Keep, Undo and Redo. The two
  earlier "after Open" cases now answer **Use project machine** first.
- `src/ui/state/job-machine-lock.test.ts` still opens a same-machine file during a job.
- This is code and test evidence only. No machine was run.
