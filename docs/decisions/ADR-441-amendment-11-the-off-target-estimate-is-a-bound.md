## ADR-441 Amendment 11 - The off-target estimate is a bound past the rings, and a whole-bed sheet is believed (2026-11-14)

**Status:** Accepted (camera audit v2 findings K1-P1-1, K1-P2-1 and K1-P3-1, raised to P2, confirmed by the area's
independent refuter and the audit coordinator on main `ba08a81af`; the maintainer's standing
instruction to fix confirmed audit findings). Amends Amendment 9's estimate (Decision 1), its
promised range, and the larger-sheet advice. | **Date:** 2026-11-14

### Context

- **The estimate under-read ordinary webcams (K1-P1-1).** Amendment 9 refits the rings with other
  term counts and with each half of them, and scales the fits' spread by 1.5.
  - On centred 1280 × 960 webcams over the back rail, seven calibrations were graded "Accurate
    enough for placing artwork by eye." with an estimate of 1.14–1.45 mm. The bed's near corners
    were 2.7–4.5 mm off (5.1 mm on 40 mm material), and every point over 1.5 mm was unwarned by the
    grade, the canvas tint and Job Review. That is 0.30–0.48 times the truth, against the promised
    0.66.
  - The estimate peaked at the far corners, while the truth peaks at the near ones, which lie at the
    largest image radius.
  - **Cause.** The other term counts were refitted through `fitDeterminedLens`, which drops a term
    under two sigmas and refits a lens that folds. With 35 rings the two-term alternative came back
    as the saved one-term fit. The half refits measure the rings' noise, not the bias that every
    low-order fit of the same rings shares past them.
- **It over-read accurate set-ups (K1-P2-1).** Full-bed sheets graded fair at 1.8–5.3 mm while
  0.3–0.5 mm off, and advised "a larger sheet". On a full-bed sheet the half refits extrapolate
  across the missing half, right next to rings that hold the saved model; and a one-term fit of
  100 rings disagrees with a good four-term one.

### Decision

1. **The other term counts are real fits** (`fitCameraModel` with that many terms), not fits that
   drop the extra term again. A fit is left out when its lens folds inside the picture, or when it
   fits all the rings clearly worse than the saved model (over 1.25 times its rms, plus
   0.03 px): its disagreement says nothing about this calibration.
2. **Every refit keeps the saved camera height** as a prior with a tape height's sigma (15 mm), so a
   typed height is not undone by the alternatives.
3. **A half refit has no more terms than the calibration fits from that many rings** (four from 60,
   two from 40, else one).
4. **The halves' spread counts only away from the rings.** It ramps in from half a ring spacing to
   one and a half spacings from the nearest ring. Within that, the saved model is held by the ring,
   and the halves' disagreement is their own extrapolation.
5. **A floor that does not depend on the lens model.** Past the rings' image radius, the error may
   grow by 0.025 pixels per pixel further out. The floor is that pixel shift, put on the bed through
   the saved model, so it accounts for each point's distance and slant. The estimate at each point
   is the larger of the scaled spread and the floor.
   - On 28 independent truth cameras the true error at the worst point grew by 0.002–0.028 px per
     pixel past the rings. They were the audit's: centred, off-centre and rolled webcams, 4:3 and
     16:9, noise and JPEG, fisheyes, a division lens, a 600 × 400 bed, full-bed sheets, and a
     phone straight down with and without a typed height.
6. **The larger-sheet advice is not given when the target already reaches within 15 mm of every bed
   edge.**
7. **A head camera is estimated over the band its stitch uses** (the middle 80 % of the picture),
   with the same alternatives and floor (`head-camera-estimate.ts`). Over 1.5 mm it grades fair:
   "Accurate on the target; elsewhere in the picture the stitch uses, up to about N mm off", and the
   advice gives the figure. Its ring figures read 0.00–0.01 mm on 20 small rings in the middle,
   while the band was up to 3.4 mm off on a tilted barrel lens.

### Consequences

- The estimate is now a bound, not a spread. On the 28 truth cameras it was at least 0.81 times the
  truth wherever the truth was over 1.5 mm, and no such point was left unwarned at the sheet's
  height. Before this amendment, 17 of them left points unwarned, and the least ratio was 0.28.
- **The default part sheet now grades fair on a 400 × 400 bed**, "up to about 3–4 mm" near the
  corners, for every lens. The rings cannot vouch for the near corners, and a floor cannot tell a
  mild lens from a strong one. For a mild lens this over-reads up to about three times (a division
  lens: 3.6 mm said, 0.4 true; a 40° side mount: 13.5 said, 1.4 true). Amendment 9's "0.66–2.1×"
  range is replaced by "at least about 0.8×, at most about 3× on ordinary webcams".
- **A whole-bed sheet is graded good**: 0.72–0.87 mm estimated, 0.30–0.50 true, centred and up to
  100 mm off-centre. The advice to engrave a larger sheet is therefore the real fix it claims to
  be.
- Material height is not part of this estimate; Amendment 7's height caveat is shown where the
  height changes (ADR-663 Amendment 7 covers the nudge; the height notice is in a separate change).
- Code and synthetic truth cameras only. No real camera was used.

### Verification

- `src/core/camera/model/extrapolation-estimate-centred.test.ts`: three centred 1280 × 960 Brown
  webcams on the default sheet (standard, strong, a little higher), calibrated through the real
  chain. At every 10 mm grid point the truth puts over 1.5 mm off, the estimate is over the good
  limit and at least 0.66 times the truth. A full-bed sheet 80 mm off-centre stays under the
  limit.
- `src/core/camera/model/extrapolation-estimate.test.ts`: the earlier 1280 × 720 cameras, now within
  a factor of three.
- `src/core/camera/model/head-camera-estimate.test.ts`: the refuter's head camera (8.5° tilt, Brown
  k1 −0.30, 70 mm up) on the 40 mm head target. The band is over 1.5 mm off in truth; the estimate
  is over the limit and at least 0.66 times the truth. Over four head cameras in the audit's
  harness the estimate was 0.77 to 7 times the truth, and graded fair only the one over 1.5 mm.
- The audit's own harness (scratchpad `zz-k1`), repointed at this change: 28 cases, the scores
  above.
