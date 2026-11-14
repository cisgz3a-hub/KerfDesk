## ADR-441 Amendment 13 - Where the project knows the picture's height is wrong, Job Review and the Material height control say so (2026-11-14)

**Status:** Accepted (camera audit v2 findings K2-P1-2, K2-P2-1 and K1-P2-2, confirmed by the
areas' independent refuters and the audit coordinator on main `ba08a81af`; the maintainer's
standing instruction to fix confirmed audit findings). Keeps Amendment 2's Decision 5: the
Material height is not saved or set for the operator. Whether it should follow the job's
material is left to the maintainer, as the coordinator asked; this amendment only warns. |
**Date:** 2026-11-14

### Context

The camera picture is drawn at one height, the overlay's Material height. It starts at 0 mm each
session. Three things the project knows can make it wrong:

- **A rotary part (K2-P1-2, P1).** On an A or Z rotary at Absolute, which Job Review advises
  ("burns it where it sits on the picture", ADR-228 Amendment 3), an 80 mm tumbler drawn at 0
  burned 17–32 mm along its length from where the picture showed the artwork, and Job Review was
  silent. Rotary Setup knows the part's diameter but not its axis height.
- **The job's material (K2-P2-1).** A project names its material's thickness (ADR-496), but the
  overlay never read it. 6 mm stock drawn at 0 was 5.1 mm off at the front corners, and 18 mm stock
  16.5 mm. The auto-started overlay draws without the panel ever opening.
- **A calibration lined up at its target's height only (K1-P2-2).** Amendment 7's caveat lived only
  in the wizard and the settings row. At Material height 20–40 mm such a calibration was 1.1–16.9 mm
  off, with no notice where the height was changed.

### Decision

One height rule (`camera-height-rule.ts`) compares the Material height with:

1. **On a rotary, the part's diameter.** The top of a part turned by a rotary cannot be lower than
   its diameter (the axis height plus half the diameter), so a Material height more than 1 mm below
   that is wrong. It is said from any Start from, since a rotary job is placed on the picture
   either way.
2. **Otherwise, the job material's thickness**, when the project names one: more than 1 mm apart is
   said.
3. **For a calibration that lines up only at its target's height, that height**: more than 1 mm
   apart is said, with the remedy (calibrate again with the camera's height typed in).

These show in **Job Review** for a camera-placed job (the material and target-height lines from
Absolute only, since a relative Start from is placed by its origin), and as a **note under the
Material height control**. Nothing is refused, and the Material height is never changed for the
operator.

### Consequences

- The rotary path Job Review certifies now names the height it needs.
- An operator who never opens the Camera panel still hears, in Job Review, when the job's material is
  thicker than the height the picture is drawn at.
- The overlay's Material height is part of Start's snapshot (`cameraSurfaceHeightMm`).
- Code and synthetic evidence only. No real camera or machine was used.

### Verification

`src/ui/laser/camera-height-warning.test.ts`:
- the 1 mm tolerance;
- a Ø 80 mm rotary part drawn at 0 warns from Absolute and from Current Position, and is quiet at
  85 mm;
- 18 mm material drawn at 0 warns from Absolute, is quiet at 18 mm, and is left to the existing
  warning from a relative Start from;
- a target-height-only calibration drawn at 20 mm warns, and is quiet at its 3 mm target height;
- nothing without camera placement.
