## ADR-440 Amendment 6 - Keep current machine is an Undo step, and undoing it brings the notice back (2026-10-27)

**Status:** Accepted (rolling audit v4 finding H9-P1-1, confirmed by an independent refuter and
re-verified by the audit coordinator on main `105d6374c`; the maintainer's standing instruction to
fix confirmed audit findings). Amends Amendment 5 Decision 4, and applies ADR-416 Decision 5's
Undo rule to every Keep, not only one that switches Laser/CNC. | **Date:** 2026-10-27

### Context

Amendment 5 Decision 4 made **Keep current machine** the safe choice on the opened-machine notice:
it "keeps the current bed and calibration". It was applied with a raw store write. It pushed
nothing onto the Undo list, captured no setup context, and left the Redo list alone.

Undo snapshots hold the whole project, machine included. Every snapshot taken between Open and
Keep held the file's machine. So one Undo of an unrelated edit made before Keep put the file's
machine back with no banner or toast. So did a Redo after Undo, then Keep. In the repro the bed
went from 400 × 410 back to 400 × 400, and the same travel moved from `G0 X50 Y370` to `Y360`. The
persistence hook then saved the rejected machine for the next session (ADR-500 Amendment 2).

### Decision

1. **Keep current machine is its own Undo step,** named "Keep current machine" in the Undo list.
   Like every other machine change, it pushes the opened project, clears the Redo list and captures
   the setup context (live placement and cached CNC setup, which Keep can swap when it switches
   Laser/CNC). No Undo of an older edit, and no Redo, can reach a snapshot with the file's machine
   without first undoing Keep itself.
2. **The notice travels with the machine it asks about.** The opened-machine notice
   (`projectBedReconciliation`) is part of the setup context that Undo and Redo restore. Undoing
   Keep brings back the file's machine together with its notice, so the operator sees the question
   again. Redo removes both. Other machine steps carry the notice the same way, so undoing a
   machine edit made before the notice was answered also asks again.
3. **Use project machine** stays a plain answer, not an Undo step, since it changes nothing in the
   project.

### Consequences

- The file's machine comes back only by undoing Keep, which the Undo list names, and the notice
  comes back with it. While that notice is open, ADR-500 Amendment 2 Decision 4 stops the app from
  remembering the file's machine.
- An operator who undoes a machine edit made before answering the notice sees the notice again,
  even if they answered it since. Answering again is the only cost.

### Verification

- `src/ui/app/opened-machine-kept.test.tsx` uses the real store, the persistence hook and
  `emitGcode`. A file saved for a 400 × 400 bed is opened on the corrected 400 × 410 machine.
  - Keep is one named step. Undoing it shows the notice and the 400 bed.
  - A further Undo keeps the notice.
  - Two Redos bring back 410 with no notice. The line's Y follows the bed throughout.
  - The remembered machine stays 410.
  - Keep clears a pending Redo.
  - All of these fail with the change reverted.
- `src/ui/state/project-current-machine-cnc.test.ts` still passes: Keep with a Laser/CNC switch,
  then a mode toggle, Undo and Redo.
- This is code and test evidence only. No machine or camera was used.
