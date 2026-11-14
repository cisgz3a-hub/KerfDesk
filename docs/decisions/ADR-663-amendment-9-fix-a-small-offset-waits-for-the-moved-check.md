## ADR-663 Amendment 9 - Fix a small offset waits for the moved check before it renews the view (2026-11-15)

**Status:** Accepted. Fixes camera audit v2 K6-P2-2 (P2, a residual of K1-P1-2). Amends Amendment 7,
under which a Fix renews the moved check's view and marks the camera steady unless a turn or a
changed view was already measured. Code and synthetic evidence only. | **Date:** 2026-11-15

### Context

The moved check compares a held picture with the view kept for the calibration. In the desktop app
it does this in the camera picture worker. Take a knock just before Fix a small offset: the check
had not measured it yet, so the Fix renewed the view from the tilted picture and marked the camera
steady. The worker's verdict, compared against the old view, landed just after and warned. The next
picture was compared with the tilted view and withdrew that warning. A 0.6° tip left the bed 2.3 mm
off, and a 1° tip 6.5-6.8 mm. From then on the moved check guarded the tilted view.

### Decision

1. **The moved check counts the comparisons still out.** Fix a small offset waits for them, after
   its refreshed picture, before it renews the view.
2. **Fix renews the view and marks the camera steady only when the settled verdict allows it.** A
   slide the fix put right does. A turn, or a view that no longer matches, keeps the old view and
   the warning, so Job Review and the panel still say it.
3. The picture compared and the picture kept are the same one; a newer picture, another camera or
   another project ends it.

### Consequences

- A knock pressed Fix on is measured against the old view first; a turn found then is never saved
  as the new view.
- The view is renewed a moment later than before, once the comparison is back.

### Verification

`src/ui/camera/calibrate/NudgeTurned.test.tsx`, with a comparison held in a stand-in worker:
- while it is out, nothing is renewed;
- when it finds a turn, the old view and the warning stay;
- when it finds a slide the fix put right, the view is renewed and the camera is steady.
