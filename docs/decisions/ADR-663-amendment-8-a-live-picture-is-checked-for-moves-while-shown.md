## ADR-663 Amendment 8 - A live picture is checked for a moved camera while it is shown, and a mirrored view is no move (2026-11-14)

**Status:** Accepted (camera audit v2 findings K2-P1-1, K2-P3-1 and K2r-P3-1, confirmed by the
area's independent refuter and the audit coordinator on main `ba08a81af`; the maintainer's
standing instruction to fix confirmed audit findings). Amends Amendment 3's triggers and
Amendment 5's comparison. | **Date:** 2026-11-14

### Context

- **A live picture was checked once (K2-P1-1).** Amendment 3 checks each new held picture, and a
  live picture once, three seconds after the camera starts. Amendment 1 says "A live picture needs
  nothing". The auto-started camera puts the live picture on the canvas with placement latched
  (Amendment 4).
  - A camera tipped 0.8° after its start check stayed "steady" through 24 s of use and a finished
    job, while artwork burned 7–10 mm from where it showed. 1–3° gave 13.5–38.6 mm, unwarned.
  - A zoom changed between sessions read as one weak match: "unknown", silent, while the picture
    was about 100 mm off. Two weak matches say "changed", but a live picture only ever had one per
    start.
  - Amendment 3's Consequences promise "noticed at the next refresh, before a job burns in the
    wrong place"; a live picture has no refresh.
- **The displacements' sign (K2-P3-1).** The comparison's per-point displacements were documented
  as "where each point now shows, less where the calibration puts it". They are the opposite: where
  the bed point the calibration now draws there truly is, less that point. Only sizes and
  differences are used today.
- **A mirrored picture (K2r-P3-1).** With a flip setting changed after calibration, the patches
  could still fit a motion and be measured as a move, 24 mm stated against 437 mm true.

### Decision

1. **A live picture on the canvas is checked again every 15 seconds** (`live-moved-check.ts`), with
   the same worker check as at its start (Amendment 6). No check runs:
   - while a held picture is shown (it is checked when taken);
   - while the overlay is hidden;
   - while a job streams (it cannot move that job; the next check after it runs);
   - while another check is still running.

   Weak matches add up across these checks, so a view that stays unrecognisable says "changed" on
   the next one, within about 15 seconds.
2. **The displacements are documented as they are**, with a signed test. No value changes.
3. **A fit that mirrors the bed is no move.** When the fitted motion reverses the bed's
   orientation, the comparison is weak, and twice in a row it says the view no longer matches.

### Consequences

- A knocked camera, a changed lid or a changed camera setting is noticed within about 15 seconds of
  live use, and Job Review says so before a job burns, as Amendment 3 promises.
- The check costs one frame capture and about 90 ms in the camera picture worker every 15 seconds
  while the live picture is shown, none on the UI thread.
- A mirrored picture says "no longer matches its calibration", not a small move.
- Code and synthetic evidence only. No real camera was used.

### Verification

- `src/ui/camera/helpers/live-moved-check.test.ts`: the live picture is checked again and again;
  never with a held picture, a hidden overlay or a running job (and again after the job); and never
  two checks at once.
- `src/core/camera/model/view-motion.test.ts`:
  - a 5 mm slide's reported centre displacement matches the documented sign, against the truth
    camera;
  - patches of a left-right mirrored picture are refused (the test fails without the check), while
    the same patches slid are measured.
