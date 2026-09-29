## ADR-443 Amendment 1 - A registration that looks like a capture mistake is shown, never silent (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

The two-point solve infers the scale and the turn from the two captured points. Decision 2 bounds
camera captures to a 2 % spacing window, and Decision 4 has the dialog report their scale and turn.
Head captures had neither. An audit (I-4, 2026-09-29) found three silent failures:

- The same printed mark captured twice passed as two targets 0.4 mm apart and shrank the job to
  0.25 %.
- Marks 20 mm apart, each jog 0.3 mm off, gave a 3 % scale: 4.5 mm off at 150 mm.
- The targets captured in the swapped order turned the job 180°.

### Decision

1. **The dialog shows what the captures measure.** Once both points are captured, head or camera,
   the dialog states the captured spacing, the designed spacing, the print scale and the turn.
2. **What counts as unusual** (`core/registration/registration-check.ts`):
   - the targets or the captures are closer than 10 mm;
   - the print scale is more than 2 % off (the camera path's window);
   - the turn is 135° or more, nearer the 180° that swapped targets give than a quarter turn.

   Jogging onto a mark by eye lands about 0.1 mm off. Over 10 mm that alone fills the 2 % window
   and turns the job by more than half a degree.
3. **The dialog asks before applying one.** It names the reason and enables Apply registration
   only once the operator ticks "Use this registration anyway". A new capture or a target edit
   asks again.
4. **Job Review repeats it at Start and never refuses.** While an unusual registration is in use,
   Job Review lists its figures and reason. It informs and never refuses Frame or Start (PROJECT.md
   non-negotiable 21, ADR-228): a print scaled on purpose or a sheet laid upside down is
   possible. Only targets or captures that coincide remain a refusal, because no transform exists.

### Consequences

- A mistaken capture is visible in the dialog and in Job Review before anything is cut.
- Output is unchanged: an unusual registration is used as solved. Captures made in the dialog
  still apply after Cancel, as before; Job Review now names their figures.
- Verified with unit tests of the check, the dialog and the Start warning, not on hardware.
