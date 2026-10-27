## ADR-416 Amendment 3 - CNC recovery needs a CNC project open, and a running job's hold follows the job's machine (2026-10-27)

**Status:** Accepted (rolling audit v3 finding G2-P1-1, P1. An independent refuter confirmed it
end to end through the real recovery card on main 9a2bf6b13, and the audit coordinator re-checked
it in code. Fixed under the maintainer's standing instruction to fix confirmed audit findings.)
Amends ADR-416 Amendment 2, and the pass recovery (ADR-215) and supervised recovery flows that
stream through `cnc-supervised-recovery-stream.ts`. | **Date:** 2026-10-27

### Context

Amendment 2 keeps a running job's machine by refusing any store change that differs from the
*open* project's machine. That is the job's machine on the ordinary Start path, where Start
compiles the open project. CNC pass recovery and supervised recovery do not compile the open
project. They replay the saved CNC job from its sealed artifact, by design, whatever project is
open. Nothing compared the two.

The refuter's repro:

1. A two-bit CNC job is interrupted.
2. The toolbar is switched to Laser, which leaves the recovery card in place.
3. The operator reviews the recovery, ticks the checklist and clicks **Start pass recovery**.
4. The CNC job streams to its bit-change hold while the open project is Laser.

In that hold:

- The lock froze the Laser project, so switching back to CNC was refused.
- Every hold-time control read the open project:
  - the point move sent `$J=G91 G21 X50.000 Y50.000 F1000`, with no safe-Z lift and no Work-Z
    check (in CNC mode the same move is refused: "set or probe Work Z before moving");
  - Zero Z and the probe were hidden;
  - a Laser-mode Z jog went out on a combo profile with powered, confirmed Z travel.
- Continue asked for a bit the Laser project could not select. Only Abort ended the run.
- No dialog mentioned the open project. The card said the run "is isolated from the current
  canvas, project…".

The twins already guard this:

- the fingerprint-only CNC recovery needs a CNC project open;
- the external G-code run re-checks the mode at its final assertion;
- Run again binds to the live project;
- Pause and lift reads the job's own machine kind.

### Decision

1. **CNC pass and supervised recovery start only with a CNC project open.** The check runs
   before the first dialog of both flows. It runs again inside the final Start assertion, the
   synchronous check `startJob` makes just before it creates the stream, because the Laser/CNC
   switch stays usable while the confirmations are open. This mirrors the external run. The
   refusal says to open the job's CNC project or switch the toolbar to CNC. It keeps the saved
   recovery: no claim is taken before the first check, and a final-assertion refusal releases
   the claim through the existing cleanup, with no job line sent. The pass wizard shows the same
   reason and keeps Start off while a Laser project is open. The recovery card adds that a router
   recovery still starts only with a CNC project open.

   Only the Laser/CNC kind is compared, not the whole machine (`sameJobMachine`). The archived
   project is the job's machine, and decision 2 makes the hold read it. Comparing CNC values or
   device fields would refuse a recovery because the operator later changed Max feed. That would
   strand a part-cut workpiece over a value the hold no longer reads, which Rule 7 (ADR-228)
   forbids. The kind check is not a policy judgement either. With the other kind open, the hold
   factually cannot be worked: the Active bit that Zero Z and the probe bind to is chosen in a
   CNC project, and Continue needs it.

2. **A running job's hold follows the job's machine, not the open project's.** `startJob`
   records the job's safe Z (`activeJobSafeZMm`), next to the existing `activeJobMachineKind`.
   It comes from the new `jobMachine` start option, which recovery sets to the saved project's
   machine. Without that option, it comes from the open project at Start. While a job is active
   (`isActiveJob`):
   - A point move (canvas Position, Move to, saved positions, the recovery move) is checked and
     lifted as the job's kind. A CNC job needs current Work Z, and lifts to the job's own safe Z
     before any X/Y motion, whatever project is open. A CNC job whose safe Z is known from
     neither the job nor the open project refuses the move.
   - The jog pad's Z jog and Zero Z, the phone's Z jog, the machine rail's CNC notices and the
     probe panel follow the job's kind. With a non-CNC project open, the probe panel says to
     switch the toolbar to CNC to select the loaded bit.
   - The Active bit stays the open project's choice. Zero Z and the probe still bind Work Z to
     it, because selecting it is the operator's statement of which bit is loaded.

   A job whose kind was not recorded keeps Amendment 2's behaviour.

3. **The lock pins the job's Laser/CNC kind.** The laser store now also reports the running job's
   kind to the project store. A change that brings a project of the other kind onto the job's
   kind is allowed: the toolbar, Undo, Redo, Open, or any setter. Every other machine change is
   still refused as in Amendment 2. The toolbar keeps only the job's own mode selectable. Once
   the project is on the job's kind, it is pinned there.

### Consequences

- The G2-P1-1 path is closed at both ends. Recovery no longer reaches a hold with a Laser project
  open. If any other path ever leaves one open, the hold still lifts, checks Work Z and offers
  Z jog and Zero Z. The operator can switch to CNC to select the bit and probe, instead of
  having only Abort.
- A recovery started with another CNC project open lifts its hold point moves to the saved
  job's safe Z, the height its own G-code retracts to, not the open project's.
- The point-move bed mapping, jog feeds and the bit library still come from the open project.
  Opening the job's own CNC project remains the intended state. A CNC project for another machine
  is not refused, only reminded about by the card.
- A laser job running with a CNC project open no longer gets the CNC safe-Z lift before a point
  move. This matches the existing Frame rule: the framed job decides laser or CNC motion.
- The pass and supervised flow tests, and the pass wizard's tests, opened an unrelated Laser
  project to prove isolation. They now open an unrelated CNC project, and still prove the open
  project is neither read nor changed.

### Verification

- `cnc-recovery-open-project.test.ts`: the real pass and supervised flows and the real `startJob`
  on a fake GRBL 1.1, for a two-bit CNC job (the runway case uses one bit):
  - With Laser open, both flows refuse before any dialog. No job line is sent, and the recovery
    stays on its card with no claim.
  - With Laser chosen while the CNC setup attestation is open, both refuse at the final Start
    assertion, again with no job line sent and the recovery kept.
  - With another CNC project open (safe Z 3.81 mm), the pass recovery's bit-change hold sends
    `$J=G90 G21 Z6.000 F1000`, the saved job's safe Z, before any X/Y.
  - In the hold, the toolbar cannot turn the project to Laser. Should a Laser project be forced
    open, a point move without Work Z is refused with nothing sent. With Work Z it lifts to the
    job's safe Z first. The toolbar can switch back to CNC, and is pinned there again.
  - With both fixes switched off, all 7 tests fail.
- `CncPassRecoveryWizard.test.tsx`: with a Laser project open, the refusal shows and Start stays
  off with a complete checklist. Switching to CNC clears both.
- `MachineModeToggle.hybrid.test.tsx`: with a CNC job held and a Laser project open, CNC is
  selectable and Laser stays locked.
- `cnc-pass-recovery-flow.test.ts`, `cnc-supervised-recovery-flow.test.ts`,
  `job-machine-lock.test.ts` and `laser-tool-change-jog.test.ts` still pass.
- No hardware was operated.
