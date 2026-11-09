## ADR-637 Amendment 10 - Only an answer ends the converted-laser question, and recoveries ask it too

**Status:** Accepted (rolling audit v12, findings X2-P1-2 (P1) and X2-P2-1 (P2), each confirmed by
an independent refuter and by the coordinator on main `be671b158`). It amends Amendment 8's
Decision 1 (which machines are asked) and extends Decision 2 (where they are asked). It changes no
G-code, no stored machine and no project format. | **Date:** 2026-11-09

### Context

Amendment 8 asked whether a CNC that KerfDesk 1.0.29 may have made from a laser is a laser. It
promised that "no job starts on that CNC until they answer". Two gaps broke that promise.

- **X2-P1-2: the check gave up too early.** Amendment 8 asked only while the profile was the
  starter with KerfDesk's spindle defaults, and stopped once the controller reported a `$30` above
  1000.
  - 1.0.29's own `$30` advisory told the owner of such a machine: "Set $30=12000 (or update the
    machine profile) so S values map to real RPM" (`df2279e26:controller-readiness-messages.ts:129`).
    Its Firmware step offered the `$30` 1000 → 12000 write, and its setup offered "Use configured S
    maximum 1000 as spindle RPM".
  - An owner who followed that advice was never asked. With the spindle max RPM set to 1000, no
    advisory fired either, and Start sent `M3 S1000` (full scale at `$30=1000`), `G4 P3.000` and
    rapids with no `S0`. Setting the spin-up to 0 s or the coolant to mist also ended the question.
  - 1.0.29's fill converted **any** unlisted laser draft at `$32=0`, not only the starter
    (`df2279e26:device-setup-auto-fill.ts:139,185-196`). A LightBurn `.lbdev` import
    (`lightburn-<name>`) and a profile with no id were never asked.
- **X2-P2-1: recoveries never asked.** CNC pass recovery and supervised recovery stream a sealed
  CNC program through their own confirms, not Job Review. The refuter's Vitest streamed
  `M3 S12000`, a lit dwell and about 510 mm of lit rapids with the question open. The canvas card's
  **Not now** also promised "Job Review asks again before Start", which recovery did not honour.

### Decision

1. **Which machines are asked** (`src/core/preflight/converted-laser-profile.ts`). A CNC is asked
   when CNC is its only declared output and its profile is one that 1.0.29's fill could have made
   from a laser:
   - KerfDesk's laser starter (`generic-grbl-400x400`);
   - a LightBurn device import (`profileId` `lightburn-…` or `profileSource: 'lightburn'`);
   - a profile with no `profileId`.

   A listed machine kept its type in 1.0.29, so catalog routers and lasers are not asked. The plain
   starter declares no output kind, so the toolbar's Laser/CNC switch on it is not asked either. A
   profile that declares a laser head as well is a two-tool machine, which is not asked.

2. **Only an answer ends the question.** Spindle max RPM, spin-up, coolant and the controller's
   `$30` no longer matter. They are the edits 1.0.29 told a laser owner to make, so they are not
   evidence of a router. The question ends only with one of these answers:
   - **This is a CNC router** (kept, as before);
   - Machine Setup saved as a CNC that the operator chose there (Amendment 8 Decision 3);
   - **It's a laser** followed by Save.

   The controller hints still name `$32` and GRBL 1.1. They name `$30` only at 1000 or under, the
   scale lasers use.

3. **CNC recoveries ask too.** `cncRecoveryOpenProjectIssue`, the check both recovery flows run
   before their first dialog, and which the supervised stream runs again at its final assertion,
   refuses while the question is open:
   > Cannot start CNC recovery: Is this machine a laser? KerfDesk 1.0.29 could set a laser up as a
   > CNC when its controller had laser mode off ($32=0). Set up as a CNC, a job turns the laser on
   > at full power, holds it still for 3 seconds, and keeps it on over every travel move. Answer it
   > first: on the canvas card or in Machine Setup, choose "It's a laser" or "This is a CNC router",
   > then start the recovery again. The saved recovery stays on its card, and no controller command
   > was sent.

   The canvas card's **Not now** now reads: "Hide this until KerfDesk next starts. KerfDesk asks
   again before any job or recovery starts."

### Consequences

- Every converted laser named by the audit is asked at startup, in Machine Setup, in Job Review and
  before a CNC recovery. That covers the starter as 1.0.29 left it, the same machine after any
  spindle or `$30` edit, a LightBurn import, and a profile with no id. Start and recovery wait for
  the answer.
- A router owner whose router was set up on 1.0.29 from the starter or a LightBurn import is asked
  once, whatever its spindle settings. A router set up on this build is not asked (Amendment 8
  Decision 3).
- **Still not covered.**
  - A 1.0.29 CNC project opened on another computer whose last machine is the plain starter is not
    asked (Amendment 8). The laser-worded `$30` advisory still warns at a laser-scale `$30`.
  - An external G-code run (the G-code Inspector's Run) streams the operator's own file, not a CNC job
    KerfDesk compiled for this machine, so it is not asked. **Replaced by Amendment 11
    (2026-11-09):** on a CNC-typed machine the Run review also drops its lit-rapid warning and
    laser-mode check, so the Run now asks too (rolling audit v12 X7-P3-3).
- G-code is unchanged.
- **1.0.30 update notes.** Amendment 8's line still holds, and is now true for every converted
  machine: "If KerfDesk 1.0.29 set your laser up as a CNC when you first connected it, KerfDesk now
  asks whether the machine is a laser before any job or recovery starts. Choose It's a laser and
  save Machine Setup to put it back."

### Verification

- `converted-laser-profile.test.ts`:
  - The starter is still asked after the spindle max RPM is set to 1000 or 24000, the spin-up to
    0 s or the coolant to mist.
  - It is still asked at a controller `$30` of 12000, naming no laser scale.
  - A LightBurn import and a profile with no id are asked.
  - A listed machine, a two-tool profile and the toolbar's CNC on the plain starter are not.
- `converted-laser-question.test.ts`: the real 1.0.29 document is still asked after either
  1.0.29-advised edit (spindle max RPM 1000, or `$30` written to 12000).
- `job-review-converted-laser.test.ts`: on the real 1.0.29 machine with its spindle max RPM set to
  1000, the reviewed program is `M3 S1000`, the question is open, and the store refuses a confirm.
- `cnc-recovery-converted-laser.test.ts`: pass recovery and supervised recovery on the restored
  1.0.29 machine both refuse before any dialog, with the question, and start nothing. Both keep the
  recovery on its card. Pass recovery starts once the owner answers "This is a CNC router".
- `cnc-recovery-open-project.test.ts`, `cnc-pass-recovery-flow.test.ts` and
  `cnc-supervised-recovery-flow.test.ts`: recoveries on other CNC projects are unchanged.
