## ADR-127 Amendment 7 - Ruida rotary pieces burn nearest first, the ETA times the .rd route, and the old-project notice reads every object's paths (2026-11-12)

**Status:** Accepted. | **Date:** 2026-11-12

Amends ADR-127 Amendment 5 (Ruida speed classes) and Amendment 4, Decision 2 (old-project notice
angles). Code quality audit C2 verify E1 raised three findings: E1-P2-2, E1-P2-3 and E1-P3-2.

### Context

1. **E1-P2-2.** Amendment 5 splits each rotary layer of a `.rd` file into parts, one per speed class.
   The split lost path order. A Ø30 circle on a 40 mm-per-turn chuck round an Ø80 glass burned in
   30 parts:

   | Measure          | Speed classes | Flat bed |
   | ---------------- | ------------- | -------- |
   | Laser-off travel | 1,526 mm      | —        |
   | Reversals        | 60            | 2        |

   The ETA timed the G-code emission (`selectOutputStrategy` returns the GRBL strategy for a Ruida).
   The G-code has none of the split's travel, so the ETA said 11.0 s for a job that takes 43.6 s.

2. **E1-P2-3.** The old-project notice read stroke angles only from an imported outline. For any other
   object it assumed every stroke runs round the part, the worst case (6.28× on that chuck).

   | Pen-tool line       | Compiled change | Notice said |
   | ------------------- | --------------- | ----------- |
   | Horizontal          | 1.00×           | 6.28×       |
   | 45°                 | 1.40×           | 6.28×       |

3. **E1-P3-2.** The `.rd` advisory folded the Max-feed hold into the class spread. A pen roller at
   k = 4.58 with Max feed 1500 read "between 98 % and 367 %". That put the over-burn on the speed
   classes, when it is the Max feed holding the stroke back.

### Decision

1. **Pieces burn nearest first.** A piece is a run of consecutive cuts in one speed class, kept in
   path order.
   - Within a class, KerfDesk burns the nearest remaining piece next. It starts from where the last
     piece (or class) ended.
   - Each piece burns from its nearer end; a vector stroke marks the same either way.
   - Classes still run in speed order, and still use no mid-layer speed command.

   On the circle above, laser-off travel falls to 558 mm. Some reversals are left: a circle has two
   pieces of each class at every height, one on each side.

2. **The ETA times the `.rd` route.** On a Ruida with a scaled rotary, the Time tile and Job Review
   time the `.rd` file's own moves:
   - laser-off steps as G0;
   - cuts as G1 at their part's speed.

   They use the same motion clock as before (`ruidaRotaryTimingProgram`, `withRuidaRotaryRoute`). A
   G-code program or timeline prepared for Start gives way to this route, and the preview does not
   reuse it.

3. **Rotary Setup says so.** The Ruida note says a curved stroke burns in pieces, a few speeds at a
   time, with short moves between them, and takes longer than on a flat bed.

4. **The notice reads every object's paths.** Line and offset-Fill angles come from the object's own
   paths, flattened as the compiler flattens them. This covers shapes, pen lines, text and traces.
   Only an object with no paths is assumed to run round the part.

5. **A Max-feed hold is named as one.** The split records, per layer, the largest rise the Max feed
   causes, apart from the class rounding. A held layer gets the hold wording: its strokes need more
   feed than the Max feed, they burn up to N % of the set energy, and it names the speed to set for an
   even burn. The class-spread advisory appears only when the classes alone leave the dose outside
   95–105 %.

### Consequences

- A Ruida rotary circle burns the same strokes with about half the laser-off travel.
- Its ETA counts that travel.
- A pen-tool line no longer raises a notice for a change it did not make.
- A held layer is told what speed to set.
- No `.rd` byte for a flat or k = 1 job changes.
- The ordering and the route ETA are not checked on a Ruida machine. Rotary Setup already says to run
  a test pattern first.
