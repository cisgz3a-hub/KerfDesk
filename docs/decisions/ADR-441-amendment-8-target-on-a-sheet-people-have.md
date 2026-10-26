## ADR-441 Amendment 8 - The target goes on a sheet people have, not the whole bed (2026-10-25)

**Status:** Accepted. | **Date:** 2026-10-25

### Context

The fixed-camera target covered the whole bed inside a 5 mm margin: 390 × 390 mm and 100 rings on a
400 mm bed. Operators reported that nobody has a board that big. An audit rendered smaller sheets in
the middle of the bed for three cameras (overhead, fisheye lid, side-mounted). It then measured the
true error on the sheet and over the rest of the bed.

That audit also exposed a fit fault. With 30–49 rings, four distortion terms passed the two-sigma
test of Amendment 7 on the rings, yet bent the picture by 43–135 mm past them. They were up to 10 mm
out even on the sheet. One or two terms fitted the same photos to within 2 mm. With 30 rings, two
terms still put a 250 × 200 mm sheet 17 mm out.

### Decision

1. **Sheet size.** The target step asks for **Sheet width** and **Sheet height**. The default is
   300 × 200 mm (about A4). The sheet lies in the middle of the bed, and the margin is kept inside
   it. A sheet larger than the bed covers the bed, as before. A head camera keeps its small square.
2. **Fewer terms on fewer rings.** Four distortion terms need at least 60 rings, two terms 40;
   below that, only the first term is fitted. The two-sigma rule still drops what the rings do not
   pin down.
3. **Remembered layout.** A remembered target is assumed while today's settings lay out the same
   area on its bed: margin, sheet size and ring size together. Its sheet size is restored with its
   margin (the area plus the margin on each side). The layout description names the sheet.

### Measured (rendered photos, worst error)

| Sheet | Rings | On the sheet | Rest of a 400 mm bed | Rest of bed, 20 mm material |
|---|---|---|---|---|
| 390 × 390 | 88–100 | 0.11–0.21 mm | 0.12–0.23 mm | 0.16–0.23 mm |
| 300 × 300 | 49 | 0.11–0.18 mm | 0.29–0.71 mm | 0.31–0.87 mm |
| **300 × 200 (default)** | 35 | 0.12–0.19 mm | 0.70–1.30 mm | 0.73–1.49 mm |
| 250 × 200 | 30 | 0.09–0.16 mm | 0.19–1.74 mm | 0.20–1.91 mm |
| 200 × 150 | 30 | 0.19–0.43 mm | 1.26–9.22 mm | 1.46–9.18 mm (side camera worst) |

Before the term limits, the 300 × 200 sheet was 84–87 mm out past the rings for the fisheye and
side cameras.

### Consequences

- A calibration needs only an A4-size scrap sheet. On it the picture is as good as before. Across
  the rest of the bed it is within about 1.3 mm and is reported as estimated there (Amendment 4's
  extrapolation advice).
- Below about 250 × 200 mm, a side-mounted camera becomes unreliable across the bed; a larger sheet
  is the fix.
- Code and rendered-photo evidence only (`bed-calibration.test.ts`); no camera was used.
