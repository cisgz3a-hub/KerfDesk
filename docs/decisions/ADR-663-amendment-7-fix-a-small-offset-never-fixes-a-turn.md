## ADR-663 Amendment 7 - Fix a small offset never fixes a turn, and says it lines up the middle only (2026-11-14)

**Status:** Accepted (camera audit v2 finding K1-P1-2, confirmed by the area's independent refuter
and the audit coordinator on main `ba08a81af`; the maintainer's standing instruction to fix
confirmed audit findings). Amends Amendment 2 (the quick nudge fix) and how it meets Amendments 3
and 5 (the camera-moved check). | **Date:** 2026-11-14

### Context

Fix a small offset burns one ring at the middle of the bed and moves the whole picture by the
offset it shows there. Amendment 2's Consequences say: "A camera that tilted or turned is lined up
at the middle of the bed only. The fix says so". The Fix screen did not say so, and:

- **A tipped camera was fixed as a slide.** A 1° pitch read 8.7–9.2 mm at the middle, under the
  10 mm limit, so Fix was offered. Afterwards the target was still up to 2.7–2.9 mm off and the bed
  6.5–6.8 mm, and the grade stayed "Accurate enough for placing artwork by eye."
- **The Fix silenced the one detector that had seen it.** It renewed the camera-moved check's
  reference and marked the camera steady, which also removed Job Review's "the camera turned,
  which Fix a small offset cannot put right".
- **A rolled camera was told "Nothing to fix".** A 0.5–1° roll moved the middle ring 0.01–0.06 mm,
  so the screen said "The picture already lines up with the ring", while the bed was 3.5–5.7 mm
  off.

### Decision

1. **The camera-moved check decides what one offset may fix.** It measures how far the bed's middle
   and its four corners moved (Amendment 5). Where the corners differ from the middle by a
   millimetre or more, the camera turned or tipped, and one offset cannot fix that.
   - The result screen then says "One offset cannot fix this camera", gives the corners' figure,
     and offers Recalibrate and Try again, but not Fix. This also replaces "Nothing to fix" when the
     middle did not move.
   - `applyNudge` refuses it too, so no other entry can apply it.
2. **A view that no longer matches keeps its warning.** When the moved check says the view around
   the bed no longer matches at all, a Fix is applied but neither renews the reference nor marks
   the camera steady.
3. **The fix says what it can see.** Fix says it "lines up the middle of the bed only", and that one
   ring cannot show a camera that tipped or turned, pointing to Check camera.
4. **"Nothing to fix" speaks of the middle only:** "The middle of the bed already lines up with the
   ring", with the same caveat.
5. Without a moved-check measurement (no view reference kept), a Fix is offered with that caveat.
   One ring cannot test the rest of the bed.

### Consequences

- A camera knocked into a turn, with its reference kept, is sent to a new calibration instead of a
  slide that hides the turn, and the Job Review warning about the turn stays.
- A slide is fixed as before, and its reference is renewed.
- Code and synthetic evidence only. No real camera or machine was used.

### Verification

`src/ui/camera/calibrate/NudgeTurned.test.tsx`:
- the move classification (turn, slide, a view that no longer matches, another calibration);
- a tipped camera (8.7 mm at the middle, corners up to 6.3 mm different) is refused, with no Fix
  button, and `applyNudge` changes nothing;
- a rolled camera whose middle did not move is not told "Nothing to fix";
- the middle-only caveat on Fix and on "Nothing to fix";
- a measured slide is marked steady after the Fix, and a view that no longer matched keeps its
  warning.
