## ADR-127 Amendment 8 - Ruida rotary pieces sweep one way, and every burn starts the way the rotary turns (2026-11-12)

**Status:** Accepted. | **Date:** 2026-11-12

Amends ADR-127 Amendment 7, Decision 1. Code quality audit C2 verify E3 raised this as E3-P2-2 (P2), a
residual of E1-P2-2.

### Context

Amendment 7 burned each speed class's pieces nearest first, each from its nearer end. Laser-off travel
fell by 45–58 %, but the rotary turned back more often. Counted as sign changes of Y over every move
in the encoder's motion plan (chuck 40 mm/turn, Ø80):

| Shape        | Before Amd 7 | Amd 7 |
| ------------ | ------------ | ----- |
| Ø30 circle   | 60           | 66    |
| 8 rings Ø5   | 192          | 374   |

The refuter decoded the `.rd` bytes and found what matters for a seam: a burn that starts against the
way the rotary last turned takes up the backlash inside the burn. Amendment 7 improved that for single
outlines, but made it worse for clusters of small shapes such as text: 108 → 134 pieces on a chuck, and
96 → 175 of 184 on a roller.

Two pieces of one class that overlap in Y, such as the two sides of a circle, cannot both burn in one
one-way pass. So each class needs about two passes, and old path order was close to the fewest turns
possible. It made those turns on lit moves, though.

### Decision

1. **Sweep.** While any piece is left ahead of the head in the way the rotary turns, and can burn that
   way from one of its ends, the next piece is one of those. KerfDesk takes the nearest, counting how
   far ahead it starts as travel too, so a piece passed over now does not cost a pass back later.
2. **Turn once.** When nothing is left ahead, the rotary turns and sweeps back by the same rule.
3. **Turn with the laser off.** A piece that would start against the way the rotary last turned is
   reached by a laser-off move 1 mm past its start along Y, then back to the start. The rotary turns
   before the burn, and every burn starts the way it goes on. The approach point stays inside the
   part's own Y range, so the file's bounds do not grow.
4. **Classes follow the sweep.** A layer's next speed class is the one holding the piece the sweep
   would take next, not the next in speed order. The state (head and last direction) carries across
   classes and layers.
5. A piece that neither sweep can take (one that turns back inside itself), and the first piece of a
   job, are chosen by laser-off travel plus a cost for each turn and a larger one for a burn that
   starts against the rotary.

### Consequences

Measured from the encoder's moves (Before Amd 7 → Amd 7 → now):

| Rotary, shape     | Turns              | Burns started against | Laser-off travel (mm) |
| ----------------- | ------------------ | --------------------- | --------------------- |
| chuck, Ø30 circle | 60 → 65 → **58**   | 57 → 32 → **0**       | 1,526 → 837 → 866     |
| chuck, 8 rings    | 192 → 375 → **190**| 175 → 204 → **0**     | 1,723 → 732 → 779     |
| chuck, text-like  | 291 → 272 → **134**| 124 → 109 → **0**     | 1,868 → 833 → 889     |
| roller, circle    | 54 → 78 → **53**   | 52 → 51 → **0**       | 6,475 → 3,660 → 6,100 |
| roller, 8 rings   | 176 → 324 → **175**| 160 → 299 → **0**     | 3,579 → 1,198 → 3,224 |
| roller, text-like | 242 → 238 → **98** | 115 → 93 → **0**      | 3,978 → 2,549 → 4,075 |

- No burn starts against the rotary.
- Total turns are at or below the old path order in every case, and within the auditor's bound (the
  flat-bed count times the number of parts).
- Turns on lit moves are no more than on the flat bed.
- On a chuck, laser-off travel stays near Amendment 7's.
- On a k > 1 roller the machine Y range is k times taller, and fewer turns mean sweeping it on each
  pass. Travel returns close to the old level there: up to 2 % above it for text-like shapes. The ETA
  times this route (Amendment 7).
- Seams and backlash are not checked on a Ruida machine. Rotary Setup already says to run a test
  pattern first.
