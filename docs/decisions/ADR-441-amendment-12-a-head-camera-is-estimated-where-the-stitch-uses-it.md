## ADR-441 Amendment 12 - A head camera is estimated over the band its stitch uses, and a refused large sheet names Ring size (2026-11-14)

**Status:** Accepted (camera audit v2 findings K1-P3-1, raised to P2 by its refuter, and K1r-P3-1,
confirmed by the audit coordinator on main `ba08a81af`; the maintainer's standing instruction to
fix confirmed audit findings). Extends Amendment 11's estimate to head cameras, which Amendment 9
left out, and amends the `anchors-unclear` message. | **Date:** 2026-11-14

### Context

- **Head cameras (K1-P3-1).** A head camera is calibrated on the 40 mm head target, 20 small rings
  in the middle of its picture. Its figures read "Average error 0.00 mm, Worst ring 0.01 mm" and
  it graded good. The stitch uses the middle 80 % of each picture (`HEAD_CAMERA_USABLE_FRACTION`).
  On a head camera tilted 8.5° with a barrel lens, that band was up to 3.4–3.8 mm off.
- **The larger sheet (K1r-P3-1).** The advice to engrave on a larger sheet led a back-rail 4:3
  webcam to a full-bed sheet whose far rings' holes filled in at mild softness and read as anchors.
  The `anchors-unclear` refusal named lighting, picture size and power, but not Ring size, the
  setting that fixes it.

### Decision

1. **A head camera is estimated over its used band** (`head-camera-estimate.ts`): the middle 80 % of
   the picture, with Amendment 11's alternatives and floor, at the target height.
   - Over 1.5 mm it grades fair: "Accurate on the target; elsewhere in the picture the stitch uses,
     up to about N mm off."
   - The advice gives the same figure.
2. **`anchors-unclear` also suggests larger rings** ("Engrave settings, Ring size"), since on a large
   sheet the far rings look smallest.

### Consequences

- In the audit's harness the estimate was 0.77–7 times the true band error over four head cameras.
  Only the tilted barrel lens, 3.4 mm off, now grades fair.
- Code and synthetic truth cameras only. No real camera was used.

### Verification

- `src/core/camera/model/head-camera-estimate.test.ts`: the refuter's head camera (8.5° tilt, Brown
  k1 −0.30, 70 mm up) on the 40 mm head target. The band is over 1.5 mm off in truth; the estimate
  is over the limit and at least 0.66 times the truth.
- `src/ui/camera/calibrate/calibration-result.test.ts`: the `anchors-unclear` message names Ring
  size.
