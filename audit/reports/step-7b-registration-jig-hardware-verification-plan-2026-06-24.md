# Step 7B - Registration Jig Hardware Verification Plan - 2026-06-24

## Purpose

The registration jig (ADR-057) is code-complete and green in software (unit,
property, snapshot, and browser smoke), but it has NOT burned on real hardware. The
strongest claim software makes is structural: both runs receive an identical
box-anchored offset, and the emitted artwork toolpath falls inside the emitted box
outline (`src/io/gcode/registration-placement.property.test.ts`). Whether the art
actually lands centered on a physical object is unproven. Per CLAUDE.md rule #2,
this is the gating step before the jig can be called "working".

This is a READY-TO-RUN checklist for the operator at the no-homing 4040. Do not skip
the framing / low-power steps.

## Pre-conditions

- 4040 powered, connected over WebSerial, the 4040 machine profile selected.
- A flat scrap board larger than the test box, taped down flat.
- A small object to place inside the box (e.g. a keychain blank ~40 x 20 mm).
- Safety glasses, fire watch, e-stop within reach, ventilation on, air assist if available.

## Procedure

### A. Set up the jig (software)

1. Open the app; click **Registration Jig** in the toolbar.
2. Type the object's footprint as the box size (e.g. 50 x 25 mm) and **Create box**.
3. Drag the box on the canvas toward where the scrap sits, or leave it centered
   (position is cosmetic in an Origin start mode; it matters in Absolute mode).
4. Add your artwork (text / SVG), select it, click **Center artwork in box**.

### B. Anchor the machine (no-homing)

5. Jog the head to the front-left corner of the scrap board.
6. **Set origin here** (Laser panel). Start mode = **User Origin** (or Verified Origin).
7. **Frame** — confirm the traced rectangle stays on the scrap with margin. If it runs
   off the board, move the origin or shrink the box. Do not proceed until the frame is clean.

### C. Run 1 - burn the box

8. In the panel pick **Burn Box Only** (banner reads "BOX outline (run 1)").
9. Set the registration layer to a LIGHT scribe (low power / high speed) — it is a
   reference mark, not a deep cut.
10. **Start**. Confirm only the box outline burns; watch for any laser-on during travel.

### D. Place the object + run 2

11. Place the object inside the burned box outline, snug to the corner.
12. In the panel tick **Lock box** (so it cannot drift), then pick **Burn Artwork Only**
    (banner reads "your ARTWORK (run 2)"). Confirm Start is NOT blocked — if it says the
    box and artwork are both set to burn, the box layer is still on; fix and retry.
13. **Start**. Confirm only the artwork burns, onto the object.

### E. Measure

14. Measure the artwork position relative to the box / object on all four sides.
15. PASS if the art is centered within ~1 mm (or your tolerance) and square; FAIL if it
    is shifted, rotated, or lands outside the box.

## Record

- Photos of: the burned box, the object placed inside it, the final burn.
- The four-sided offset measurements + the tolerance used.
- Start mode used (User Origin / Verified Origin / Absolute).
- Any drift, laser-on-travel, or framing issue.
- Firmware, profile, and the power / speed used for each run.

## Watch-items (from the software audit)

- **Both-output footgun** (now guarded): if the box and artwork are both set to output,
  Start is blocked with a "pick a run" message — that means you forgot to switch runs.
- **Box drift** (now lockable): lock the box after placing the object so an accidental
  drag between runs cannot misalign run 2.
- **Homing machines**: in Absolute Coordinates the two runs burn at their on-canvas
  positions with no origin step; on the no-homing 4040 use an Origin mode + framed origin.

## Result

- [ ] PASS — art centered within tolerance; the jig is hardware-verified.
- [ ] FAIL — record the offset / symptom above and file it as the next jig fix.

Until this box is checked, the registration jig remains software-verified only — the
standing hardware-verification gap (see `step-7a-no-hardware-roadmap-reality-audit-2026-06-23.md`).
