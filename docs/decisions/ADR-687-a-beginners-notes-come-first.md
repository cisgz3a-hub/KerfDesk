## ADR-687 - A beginner's notes come first: Job Review and Save G-code rank their warnings, and starter values say so

**Status:** Accepted. Fixes UX audit findings U3-P3-6 (P3), U4-P2-6 (P2) and U3-P2-1 (P3)
(`docs/audits/2026-11-03-ux-u1/U3-first-design.md`, `U4-first-burn.md`). Builds on ADR-224 v3 (Job
Review lists every warning), ADR-591 Amendment 3 (preflight findings last among Save's toasts) and
ADR-500 Amendment 1 Decision 5 (starter values are named as such). Tested in the toast store, the
Job Review component and the Save notices; not burn-tested. Frame, Start, output policy, G-code and
licences are unchanged. | **Date:** 2026-11-03

### Context

- **U3-P3-6.** Only the newest three toasts render. After Save G-code a beginner on a generic diode
  laser saw a Neotronics 4040 runway paragraph, a scan-offset note and an S1000 power-scale note.
  The one warning written for them ("still using the uncalibrated defaults … Run a material test on
  scrap") and even "Saved G-code to untitled.gcode" appeared only after dismissing those.
- **U4-P2-6.** The same first job's Job Review showed four warnings; only the material-test one was
  actionable. The bed-mapping note ("The controller-to-bed coordinate mapping is unverified…") did
  not say what to check.
- **The 4040 note on a machine that is not one.** "My machine isn't listed" saves its machine on the
  generic starter's profile id (ADR-637), and the advisory treated that id as a possible 4040. The
  4040 is in Machine Setup's list, so choosing "not listed" already says it is not one.
- **U3-P2-1.** New laser operations start at 30 % / 1500 mm/min, and nothing at design time said
  these are starter values. Job Review warns before Start; the Operation panel did not.

### Decision

1. **One ranking, two surfaces** (`review-note-rank.ts`):
   - *beginner*: still on the starter values, a cut before the engraving inside it (ADR-480
     Amendment 2), and where the job sits on the bed;
   - *warning*: everything else, shown as before;
   - *technical*: motion-policy notes a beginner cannot act on: the 4040 runway policy, scan-offset
     coverage, which S value 100 % means, and the informational "4040-safe Island Fill is active".

   Text the ranking does not know is a warning, so a new warning is never hidden.
2. **Job Review** lists beginner warnings, then other warnings, under "N warnings · none block the
   start", and folds technical notes under a closed **Technical notes (n)**. The count names only
   what is shown.
3. **Save G-code** pushes, oldest first: one folded **Technical notes (n) about this G-code** toast
   (with the controller assumption such as "assumes GRBL $30=…", and CNC's notes), each other
   warning, the beginner warnings, the preflight findings (ADR-591 Amendment 3), and **Saved G-code
   to …** last. So the confirmation, the preflight and the beginner's warnings are what the newest
   three show. A single technical note is pushed as itself.
4. **A toast may fold a short list of notes** (`details`) under a "Show all n" summary. Opening it
   stops its auto-dismiss, so it stays until dismissed. Only the summary and × take pointer input;
   the body still lets clicks through to the canvas.
5. **The bed-mapping note is worded for a beginner:** "KerfDesk can't check where this job sits on
   your bed. The controller does not report how its coordinates map to the bed, so the canvas shows
   the artwork, not the bed. The box Frame traces is where it will burn: check that your material is
   under it and that it clears clamps and no-go zones."
6. **The 4040 note shows only where the machine could be one:** a declared Neotronics 4040 profile
   or family whose output dialect has drifted, or the generic starter exactly as it ships (its
   name and 400 × 400 bed unchanged), which nobody has set up yet. A machine named in Machine
   Setup, or given another bed, has been declared not to be a 4040.
7. **Starter values are named where they are set.** While a laser operation holds the starter
   power, speed and passes with no linked material recipe, the Operation panel says "**Starter
   values, not a recipe.** Choose power and speed from your material's settings or your laser's
   manual, or run a **Material Test** on scrap first." The link opens Tools → Material Test, whose
   open state moves to the UI store for that.

### Alternatives

- **Show every warning and raise the toast cap.** Rejected: a fourth toast pushes into the drawing
  (Toasts.tsx), and the list would still lead with notes a beginner cannot act on.
- **Drop the 4040 note for the generic starter too.** Rejected: a 4040 owner who never ran Machine
  Setup is the case the note exists for, and the first-run card already asks them to set up.

### Consequences

- An expert who wants the scan-offset or power-scale note opens Technical notes; nothing is removed.
- The beginner set is short on purpose. A new beginner-facing warning must be added to the ranking
  to lead.
