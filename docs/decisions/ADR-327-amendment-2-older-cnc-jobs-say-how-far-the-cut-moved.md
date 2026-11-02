## ADR-327 Amendment 2 - An older CNC job whose Job Origin now counts more contours says how far its cut moved (2026-11-02)

**Status:** Accepted; tested on projects saved by the real 1.0.28 (`33bc394c6`). Not
hardware-tested. | **Date:** 2026-11-02

Follows rolling audit v9 finding R8-P2-1 (P2), confirmed by an independent refuter
(`docs/audits/2026-11-02-rolling-v9/R8-cross-fix-journeys.md`). Builds on ADR-682 Amendment 3,
which announces what an older project burns differently.

### Context

[Amendment 1](ADR-327-amendment-1-cnc-job-origin-anchors-the-artwork.md)'s implementation
correction (after 1.0.28) made the Job Origin anchor count every contour the operation cuts: a
crossing loop (bowtie) whose signed area is zero, and a flat Drill contour. Every release up to
1.0.28 left those out, so a job holding one was placed off its canvas anchor. In the auditor's
repro, a Pocket bowtie beside a square at User Origin cut from X −76 mm on 1.0.28 and from X 3.8 mm
on main: 80 × 40 mm away. The new place is the right one and stays. But an operator who clamped
stock for the old cut would now cut elsewhere, maybe into a clamp, and nothing said so. AREAS L11
requires such a change to be harmless or announced.

### Decision

1. **The load says it.** When a project saved at schema 19 or earlier (1.0.28 and every earlier
   release) is opened, the load works out the Job Origin anchor of its CNC job under both rules
   (`cncAnchorShiftSince1028`, `cnc-anchor-shift-since-1028.ts`). It uses the compiler's own contour
   collection and the job's saved placement. If the anchor moved, a warning names the move: "This
   CNC job now cuts 80.00 mm in X and 40.00 mm in Y away from where KerfDesk 1.0.28 and earlier cut
   it", then why, then "If the stock is clamped for the old cut, move it or the origin, and Frame
   before you run it."
2. **Job Review repeats it** while the project is open, recomputed on the job as it stands, so an
   edit that removes the move also removes the warning.
3. **Absolute stays silent.** It does not anchor, so its cut does not move. A project saved by this
   version is never told.
4. The 1.0.28 rule lives on only as `DesignBoundsRule` `'release-1.0.28'` in
   `cnc-design-bounds.ts`, for this comparison. Output always uses the current rule.

### Consequences

- An operator re-running a part set up for the old cut is told how far it moved before Frame.
- The next desktop release's update notes should carry one line for it; they are written at
  release time.
- **Tests:** `returning-user-cnc-job-origin.test.ts` opens three projects that 1.0.28 saved
  (`src/__fixtures__/returning-user/1.0.28-cnc-*`). It compiles them on this version and checks
  that the notice names the move measured between the two G-code files: a Pocket bowtie at
  front-left and a flat Drill contour at the centre anchor. The Absolute file stays silent and
  unmoved, and a project re-saved here stays silent.
