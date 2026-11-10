## ADR-663 Amendment 5 - The camera-moved check measures turns and tips, and its warning stays (2026-11-10)

**Status:** Accepted (rolling audit v13 finding Y1-P2-2, rated P1 by its independent refuter and
confirmed by the audit coordinator on main `4c4b98fd0`; Y1-P3-2 is fixed with it; the maintainer's
standing instruction to fix confirmed audit findings). Amends Amendment 3's "The check" and "When it
speaks". It still only advises: nothing blocks Frame, Start, output or any camera tool (ADR-228). |
**Date:** 2026-11-10

### Context

Amendment 3 promised: "A knocked camera or a lid that closes differently is noticed at the next
refresh, before a job burns in the wrong place." The audit and its refuter rendered moved cameras
through the real check. Each used its own truth camera and scene.

- **A single shift cannot follow a turn.**
  - The check matched one translation for the whole surround.
  - When the camera rolls, the left and right of the view move in opposite directions, so the best
    single shift scored under 0.6 and the check said nothing. The refuter's rolls of 0.5–2° moved
    the bed corners by 2.7–10.6 mm.
  - It was also silent for a 3° tip (30 mm at the bed centre, 50 mm at the edge), a 20 mm slide,
    combined knocks, and 1–2 % focus breathing.
- **A later weak match withdrew a warning that was showing.** `publish` replaced `moved` with
  `unknown`. The notice renders only `moved`, so after a second bump the warning disappeared while
  the camera was further out than before. The refuter reproduced this on the real store and notice.
- **Nothing at Start read the warning.** Only the Camera panel and a toast showed it.
- **Y1-P3-2: a slide was understated.**
  - The shift was measured in pixels at the surround and turned into millimetres at the bed centre.
  - In a wide lens a millimetre spans more pixels at the centre than at the edge, so 2 mm read as
    1.4 mm, 5 mm as 2.8 mm, and moves up to about 1.4 mm stayed silent.

### Decision

1. **Patches, fitted on the bed.**
   - The surround is cut into 32-pixel patches of the 384-pixel thumbnail. A patch is matched when:
     - at least half of it is surround;
     - its edge map varies enough (standard deviation 4 or more);
     - its edges run more than one way (the smaller structure-tensor eigenvalue is at least 5 % of
       the larger).
   - Each such patch is matched on its own, over shifts of up to 24 thumbnail pixels: half size
     first, then full size, then a gradient step to a fraction of a pixel.
   - A patch whose match scores 0.6 or more is mapped through the camera model onto the bed plane,
     in millimetres.
   - The patches' moves are fitted:
     - **a homography** when there are at least 6 patches and they spread at least 15 % of the bed
       both ways, because a camera that moves sees its plane through one (a weighted least-squares
       fit on Hartley-normalised points);
     - **a turn and scale** when they spread at least 20 mm one way only;
     - **a slide** otherwise.
   - Patches more than three times the median residual (and more than 1.5 mm) from the first fit,
     such as a gantry crossing them, are left out of a second fit.
2. **The worst point of the bed.**
   - The fit moves the bed's centre and four corners. The largest of those five moves is the
     number reported. Measuring on the bed plane also removes Y1-P3-2's understatement.
   - A surround with fewer than 4 matchable patches falls back to Amendment 3's whole-surround
     shift. That shift is now turned into millimetres where the surround is (the median over its
     pixels), not at the bed centre.
3. **A view that no longer matches.**
   - A check is weak when the surround has 4 or more matchable patches and fewer than half of them
     (or fewer than 3) match, or when the fit finds no agreeing set.
   - One weak check may be a hand or a clamp in the way, and says nothing new. Two in a row say
     **The camera may have moved: what it sees around the bed no longer matches its calibration**,
     with Check camera and Dismiss, and one toast when the panel is closed.
   - A measured move already showing is kept instead.
4. **A warning stays.**
   - A `moved` or `changed` warning is replaced only by:
     - a confident steady result: enough patches matched and every bed point under 1 mm. That is
       positive evidence the camera is back where it was calibrated, such as a lid closed the same
       way again;
     - a new measurement;
     - a calibration saved, a check kept or a nudge applied (`markCameraSteady`);
     - the operator's Dismiss.
   - A weak match, a check that cannot compare, or an unknown result never withdraws it.
   - The notice and Job Review show a warning only for the calibration it was measured against.
5. **What it says.**
   - Panel: **The camera may have moved: the picture may be up to about N mm off.**
   - When the corners moved differently from the centre by 1 mm or more (a turn or tip), it says
     that **Fix a small offset** cannot put that right, and offers Check camera instead.
   - Dismiss compares the five bed points, so a further move of 1 mm or more at any of them warns
     again.
6. **Job Review.**
   - The Start snapshot carries the showing, undismissed warning for the running camera
     (`cameraMovedWarning`).
   - While camera placement is on, Job Review says that artwork placed on the camera picture may
     burn up to N mm off, or that the view no longer matches, with the same fix advice.
   - The phone and MCP Starts read the same snapshot.

### Consequences

- In the test render, every move the audit listed is measured, to within 15 % of the true worst
  bed error or half a millimetre: slides of 1.5–40 mm, rolls of 0.5–2°, tips of 1–6°, a 1° pan,
  and a 6 mm slide with a 1° roll. The test render is the fixture lens, the overhead pose and a
  textured surround with a moving gantry.
- A camera that stayed put reads under 0.5 mm whatever is on the bed, wherever the gantry is, and in
  a brighter room. A tip of 14° or a 150 mm slide reads as a weak match.
- A check takes about 90 ms on the thumbnail.
- A camera that sees only the bed, or a surround with nothing on it, still cannot be checked.
- Thresholds are KerfDesk's own. They are checked on rendered views only, not on any real camera.

### Verification

- `src/core/camera/model/view-motion.test.ts` renders the bed plane and surround through the
  fixture lens and compares each measured move with the true overlay error
  (`view-motion-testing.ts`).
- `src/ui/camera/helpers/moved-check-sticky.test.tsx` covers:
  - the withdrawal: a moved warning survives a weak match, and the notice keeps showing;
  - two weak checks becoming `changed`, with one toast;
  - clearing on a confident match or a recalibration;
  - a dismissed `changed`;
  - another calibration's state not being shown;
  - Job Review's warning through the real `machineSnapshot` and `demotedPolicyWarnings`.
- `moved-check.test.tsx` keeps the toast and dismissal cases, now on per-point displacements.
