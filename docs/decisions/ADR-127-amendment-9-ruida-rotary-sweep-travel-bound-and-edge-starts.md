## ADR-127 Amendment 9 - A Ruida rotary layer's sweep is bounded by path order's travel, and edge starts are named (2026-11-13)

**Status:** Accepted. | **Date:** 2026-11-13

Amends ADR-127 Amendment 8, Decisions 1–3 and its Consequences. Code quality audit C2 verify E4 raised
two P3s: E4-P3-2 and E4-P3-3. It also confirmed E1-P3-2, below.

### Context

1. **E4-P3-3, roller travel.** On a k > 1 roller the sweep crosses the part's whole Y range on every
   pass, and that range is k times the drawing's height. Amendment 8 said laser-off travel there rose "up
   to 2 %" over path order. For two-row clusters the refuter measured +16 % to +42 %, and an ETA 37–58 %
   above Amendment 7's. Example: a 4×2 grid of rings went from 66.9 s to 100.7 s. The ETA times the
   route, so the time is real, not misreported.
2. **E4-P3-2, edge starts.** Amendment 8 keeps the approach inside the part's own Y range. So a piece
   that starts on the part's Y edge and must burn inward cannot be approached from beyond. A
   rectangle's sides and a border round text are such pieces, and they still start against the rotary:
   1–2 per job. That is the same count as before Amendment 8, so it is not a regression. But the claim
   "no burn starts against the rotary" was wrong for these shapes.

### Decision

1. **Travel bound.** For each layer KerfDesk builds two orders from the same head and rotary direction:
   - the Amendment 8 sweep;
   - path order: classes in speed order, each class's pieces in path order, burned forward, each still
     approached past its start when it would start against the rotary.

   It keeps the sweep unless the sweep's laser-off travel is more than 5 % above path order's, and then
   uses path order. A layer's laser-off travel is therefore never more than 5 % above path order with
   approaches.
2. **Edge starts stay as they are.** An approach past the part's Y edge could run past the machine's Y
   travel; an Absolute rotary job is rebased so its lowest Y is work Y 0. So the approach stays inside
   the part's Y extent. A piece that starts on that edge against the rotary is the one exception to
   Amendment 8 Decision 3.
3. **Amendment 8's Consequences are corrected:**
   - "No burn starts against the rotary" now reads "none except a piece that starts on its part's Y
     edge".
   - "Up to 2 % above path order" on a roller now reads "at most 5 % above path order with approaches".

### Consequences

Measured from the encoder's moves, roller 360 mm/turn on Ø25 rollers (k ≈ 4.6), rings Ø5 at 600 mm/min,
Max feed 6000. Travel in mm; ETA from the route clock.

| Shape | Path order | Amd 7 | Amd 8 | Now |
| --- | --- | --- | --- | --- |
| 4×2 grid, 8 mm | 3,863 mm, 121.4 s | 1,681 mm, 89.7 s | 4,639 mm, 137.7 s | **4,049 mm, 135.0 s** |
| 4×2 grid, 12 mm | 4,472 mm, 127.7 s | 2,379 mm, 100.5 s | 6,062 mm, 152.0 s | **4,660 mm, 141.4 s** |
| 3×3 grid | 4,922 mm, 142.4 s | 2,176 mm, 104.9 s | 5,708 mm, 160.3 s | **5,142 mm, 158.1 s** |
| 6×2 grid, 7 mm | 5,539 mm, 179.3 s | 2,056 mm, 127.3 s | 6,451 mm, 200.7 s | **5,809 mm, 199.2 s** |
| rect + 6 rings | 3,754 mm, 114.7 s | 1,987 mm, 91.8 s | 4,654 mm, 130.0 s | **3,882 mm, 125.4 s** |

- Where path order is chosen, its travel is path order's plus the approaches (3–5 %).
- Its turns equal path order's: 196 on the 4×2 grid, against 96 for the sweep. Still no burn starts
  against the rotary away from an edge.
- Single shapes, rows, text-like clusters and every chuck job keep the Amendment 8 sweep, unchanged:
  for example, chuck text 889 mm, 57.7 s.
- **The time cost stays.** A roller job still takes about 37–56 % longer than under Amendment 7, whose
  nearest-first order traveled least. That cost buys burns that start the way the rotary turns, and it is
  stated here rather than bounded. The approach moves add stops, so the ETA gains from path order are
  only 1–7 %. The ETA is right either way.
- **Edge starts.** `rd-rotary-direction.test.ts` pins that a rectangle and rings inside a border start
  against the rotary only on the part's Y edge (at most 2), and that a two-row roller grid stays under
  4,300 mm of travel.
- **E1-P3-2 is confirmed fixed on main.** Since #1833 (Amendment 7), a Max-feed hold is advised in
  words that name the Max feed and the speed to set, not the speed classes
  (`src/io/rd/emit-rd-rotary-hold.test.ts`).
