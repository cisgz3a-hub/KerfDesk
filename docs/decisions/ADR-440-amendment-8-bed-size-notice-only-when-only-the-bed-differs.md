## ADR-440 Amendment 8 - The bed-size notice is only for a file whose bed alone differs, and every other notice names what the file's machine brings (2026-10-28)

**Status:** Accepted (rolling audit v5 finding J5-P2-2, raised to P1 by its independent refuter and
re-verified by the audit coordinator on main `09f7c0087`; the maintainer's standing instruction to
fix confirmed audit findings). Amends Amendment 5 Decision 4. | **Date:** 2026-10-28

### Context

Amendment 5 Decision 4 gives the machine notice bed words "when the opened file has the same profile
id and name and only its bed size differs". The code checked only the profile id and name. Any
same-profile file whose bed differed got the bed-only notice, however much else differed.

A bed difference makes the file "another machine" (`deviceIdentity` includes the bed), so it brings
its whole machine behind the notice (ADR-500 Amendment 2 Decision 3). In the refuter's repro, the
machine had been corrected to rear-right, 400 × 410, with a clamp no-go zone, and burned
`G1 X381 Y20` with 1 collision. Opening a file saved earlier at front-left, 400 × 400, with no zones,
showed the bed-only notice and no toast. The same line then burned at `G1 X20 Y380` with 0
collisions, and the notice said only that "The project's 400 × 400 mm bed is in use for now".
**Use project machine** was described as replacing the bed, but it kept the old origin and every
other value, and the next machine edit remembered them.

### Decision

1. **Bed words only when only the bed differs.** The notice is bed-only when the file has the same
   profile id and name and every machine value besides the bed size and the camera calibration
   matches the machine in use. The values are the ones ADR-500 Amendment 2 Decision 2 names for the
   same-machine toast (origin, homing, no-go zones, scan offsets, controller, rotary setup, saved
   positions, max feed, frame speed, S range, air assist, Z setup, CNC settings and "other machine
   settings"), plus the Auto-focus command, which the job lock also counts as the machine (ADR-416
   Amendment 2). One list serves both (`differingSetupLabels`).
2. **The same machine with more than the bed names it all.** For a same-profile file that differs
   in more, the notice gives both bed sizes, then names the other values, origin first: "The file's
   copy also differs in origin and no-go zones. Its bed, origin and no-go zones are in use for now,
   not yours." **Keep current machine** stays first and primary, and says what it keeps: "Keep
   current machine keeps your 400 × 410 mm bed, origin and no-go zones." Camera words are unchanged.
3. **Another machine names what it brings.** A notice for another profile or name adds what that
   machine brings in place of the operator's: its bed size when that differs, then the same names,
   for example "That machine's bed (300 × 300 mm) and origin are in use for now, not yours." Its
   button order is unchanged (Amendment 3).
4. **Advice only.** Nothing is refused. Frame and Start are unchanged (ADR-565).

### Consequences

- A file saved before an origin or zone correction can no longer open behind a notice that names
  only the bed. The operator sees which values moved before choosing.
- The same-machine toast (ADR-500 Amendment 2) is unchanged. A same-machine Open has already kept
  the Auto-focus command, with its own toast, before the list is read, so the new Auto-focus name
  never shows in that toast.
- The notice carries `sameProfile` and `differingSettings` beside `bedSizeOnly`.

### Verification

- `src/ui/app/opened-machine-older-bed-and-origin.test.tsx` reproduces the refuter's case with the
  real store, the persistence hook and the banner mounted, the file round-tripped through
  `serializeProject` and `deserializeProject`, and output from `emitGcode`. The notice names the
  origin and no-go zones and leads with **Keep current machine**, which restores the corrected burn
  and its clamp guard. Nothing is remembered before a choice. A file whose bed alone differs keeps
  the bed-only words, and a notice for another machine names its bed and origin. Three of its five
  cases fail on main's code. The other two are controls that held before.
- `src/ui/state/project-bed-reconciliation.test.ts` checks that each of origin, homing, no-go zones,
  scan offsets, S range (`$30`), Z setup and the Auto-focus command drops the bed-only notice and is
  named.
- This is code and test evidence only. No machine was run.
