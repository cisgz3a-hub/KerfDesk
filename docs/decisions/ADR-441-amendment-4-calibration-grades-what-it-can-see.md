## ADR-441 Amendment 4 - The calibration grades what it can see (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

An independent audit found three ways a calibration could be graded good while the bed it maps
was far off.

- **Undetermined lens terms.** A 300 mm target on a 400 mm bed found all 64 rings and was graded
  good (0.10 mm average, 0.21 mm worst ring). The fit had kept four distortion terms; the rings
  pinned down only the first two. The other two came out as 0.58 and -1.97, with one-sigma
  uncertainties of 2.7 and 5.2. That polynomial turned back before the picture's corner, so the
  bed corner was 86 mm off and the overlay drew bed content 14 mm from where it is. A camera on the
  head calibrated with a 100 mm target showed its stitched tile edges 2.75 mm off, while every ring
  was within 0.012 mm.
- **An inverse lens without a range.** The inverse of the lens polynomial ran a fixed number of
  Newton steps and returned whatever it reached. Past the polynomial's turning point there is no
  ray, but it still returned one, up to 6600 px from the right place.
- **A target matched to the wrong layout.** "Target already engraved" rebuilt the layout from the
  wizard's settings, which start at the defaults after every restart. A target engraved with a
  wider margin was matched to the default layout. The matcher found 81 of 100 rings, all labelled
  one ring spacing off. The fit graded that good, the camera placed the bed centre 28 mm off, and
  the saved-calibration check advised saving the new calibration.

### Decision

1. **Fit only the lens terms the rings pin down** (`core/camera/model/fit-determined-lens.ts`).
   The fit starts with the terms allowed so far, up to four. It drops the highest free distortion
   term while that term's one-sigma uncertainty from the fit exceeds its size. Bouguet's
   calibration toolbox gives the same advice: disable a term whose uncertainty is much larger than
   the term. k1 always stays free. The camera, pose and principal-point priors are unchanged.
   (Bouguet, Camera Calibration Toolbox, first calibration example:
   https://robots.stanford.edu/cs223b04/JeanYvesCalib/htmls/example.html)
2. **A lens must not fold inside its picture.** A fitted lens whose distorted angle stops rising
   before the farthest picture corner is refitted with fewer terms. When dropping a term makes
   the lens fold, the fit keeps the last result that did not fold. When even k1 alone folds, the
   calibration fails and says, "The rings cover too little of the picture to model the lens out
   to its edges," then asks for a larger target.
3. **The inverse lens has a range** (`core/camera/fisheye.ts`). `undistortPixel` solves within
   the polynomial's first rising stretch, using a Newton step bracketed by bisection that stops
   once a step is smaller than 1e-12 rad. It returns null for a pixel past the turning point or
   for a solve that does not converge within 64 steps. The bed mapper then places no bed point.
   OpenCV's `cv::fisheye::undistortPoints` likewise marks a point invalid when its solve does not
   converge or its angle flips sign
   (https://github.com/opencv/opencv/blob/5.x/modules/geometry/src/fisheye.cpp). Callers already
   handled a missing bed point for rays that miss the bed.
4. **The grade says what it measured.** The accuracy figures remain measured on the rings. When a
   quarter or more of the bed the camera sees lies outside the target, the grade adds that
   share and says the picture outside the target is estimated. For a camera on the head, the
   share is of the whole picture. No figure is invented for the extrapolated part.
5. **The engraved target is remembered.** When a calibration target's job starts, the target
   area, bed size and margin (or head target size) are stored on this computer for the machine
   (profile id, else name) and camera kind. They use the same browser storage as the other
   per-computer camera choices (`kerfdesk.camera.engraved-targets.v1`). The wizard opens with
   that margin or size. While the settings still describe it, "Target already engraved"
   matches against the remembered area instead of a layout rebuilt from the settings. The setup
   and photo steps always name the assumed layout, including its size, margin and bed, and where
   it came from, so a wrong one can be corrected under Change settings.
6. **A missing outer band is treated as a likely mismatch.** When the rings found form a complete
   grid smaller than the assumed one, such as 9 × 9 of 10 × 10, and the camera sees where the
   missing outer rings would be, the grade is rough. It says the rings look like a target engraved
   with other settings and names what to change. The saved-calibration check then says that the
   difference may come from the layout, not the camera, and suggests keeping the saved
   calibration instead of saving over it.
7. **Anchors are recognised under tilt** (`ring-detect.ts`, `target-match.ts`). The same audit found
   that a perfect photo from a tilted camera failed with "anchors not found". An anchor counted
   only rings within 1.6 times its nearest ring, measured in picture pixels, as neighbours. A
   tilt shortens the steps along one axis, and the x-arm anchor's neighbour on one side is the
   origin anchor, not a ring. So from 34° it failed at some margins, and at 41° on every bed
   tried. Neighbours are now looked for in the nearest ring's round frame, the frame in which
   that ring's outline is a circle. There, the grid is square again. The reach is 14 ring radii,
   and the grid step is eight radii (Amendment 3), so the diagonal rings cover the side where
   the other anchor sits. The frame is the nearest ring's, not the disc's, so a stretched blob
   of honeycomb off the sheet is still judged in the sheet's frame and stays out. The matcher
   also accepts an L whose arms look wrong in the picture when the rings its arms predict are
   there: one short arm behind the origin, and halfway along the long arm.
8. **The threshold window follows the marks' size.** When fewer than three anchors are found, the
   detector looks again. The second pass uses a threshold window twice the rings' median
   diameter. A solid disc wider than the default window (1/24 of the picture's short side) is no
   darker in its middle than the local mean there, so in a dim, low-contrast photo its anchors read as
   rings. When the anchors are still not found and the rings seen reach two opposite edges of
   the picture, the failure says the target fills the picture and may be cut off, instead of
   suggesting that something covers the anchors.

### Consequences

- The audit photos: the 300 mm target now fits two terms. Its bed corner is 0.8 mm off, down from
  86 mm, and the grade adds that about 45 % of the bed the camera sees lies outside the target.
  The head camera's 100 mm stitched tile edge is 0.13 mm off, down from 2.75 mm. The 70 mm
  target's edge changes from 0.06 to 0.09 mm, because an undetermined term is no longer fitted.
  The audit's full-bed target gives the same results as before.
- The audit's tilted photos now find all three anchors and match: 30 mm margin on a 400 mm bed,
  the default margin on a 300 mm bed, and a camera tilted 41°. A sweep over three beds, tilts of
  0° to 48° and margins of 0 to 50 mm fails only at 48° on a 400 × 300 mm bed with 30 or 40 mm
  margins. There, the rings beyond the long anchor arm are too small to detect at that distance.
- A camera on the head 50 mm above its 40 mm target now reports that the target fills the
  picture. The failure there was the outer rings touching the picture's edge, not the window.
- A calibration that used to succeed with a folding lens now either fits fewer terms or fails
  with the message above. Saved camera models are not refitted.
- Out of scope for this amendment: clipping or tinting the overlay outside the target, limiting
  the head camera's stitch box to what was measured, and limiting mark search to the calibrated
  area. These belong to the overlay shader, head-camera stitching and job-watch modules. The grade
  advice is the only signal until they change.
- Known gaps: the band check catches a target engraved with a smaller grid than assumed. It does
  not catch the reverse case, in which the assumed layout finds every ring of a larger engraved
  target, labelled wrong. The remembered layout covers that case only for a target engraved from
  this computer. On another computer the wizard still assumes the settings' layout, but now says
  which layout that is.
