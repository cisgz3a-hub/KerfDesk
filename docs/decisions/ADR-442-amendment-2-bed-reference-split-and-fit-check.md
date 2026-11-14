## ADR-442 Amendment 2 - Pieces split against the bed, neck cuts, doubts and a fit check (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14

### Context

Camera audit v2 (area K3, `docs/audits/2026-11-14-camera-v2/K3-target-trace-and-pieces.md`) put
Find pieces through synthetic scenes and found the fill burning off the material without a word:

- **K3-P1-1:** blanks closer than about 3.5–5 mm merged into one piece. The two 2.5 mm blur passes
  carried the piece colour across the gap, and the 1 mm close bridged what was left. A packed tray
  of coasters read "Found 1 piece", and each copy was cut across two blanks.
- **K3-P1-2 and K3-P2-2:** a centred copy went to the centre of the piece's rectangle. For an L,
  ring or frame offcut that point lies in the notch or the hole, so the copy burned wholly off the
  wood, 30–43 mm away. Nothing checked that the copy fitted its piece either (36 × 24 on a 25 mm
  disc burned 9 mm onto the bed).
- **K3-P1-3:** a broad reflection on the honeycomb passed the only guard, the 100 mm² floor. It was
  ticked, and a copy burned on the bare bed.
- **K3-P2-1 and K3r-P1-1:** one Otsu split of one feature into two classes. Long shadows on grey
  or MDF beds moved pieces 4–6 mm. On a scorched spoilboard the third class (burn marks, far darker
  than both bed and blanks) took the "pieces" side, and every copy burned on an old scorch mark,
  up to 158 mm from any blank.
- **K3-P3-1 and K3-P3-2:** a piece within 2 mm of the bed's edge read "partly out of view", and an
  L offcut was listed as "⌀ 120.5 mm".

### Decision

1. **The split is against the bed, not between two classes** (`piece-mask.ts`).
   - The bed's colour is the median, after the coarse 2.5 mm blur, of the band 4 mm wide along the
     picture's edge. The bed surrounds the pieces, so a piece cut by the edge is a minority there.
   - The pieces' colour is the reference's when it stands out from the bed, i.e. when the design
     sits on a piece. Otherwise it is the median of the pixels that stand out most among those
     standing out from the bed. Darker-than-bed pixels are used only when they outnumber the
     brighter ones twice over, because scorch marks and shadows are darker than most beds.
   - Each **unblurred** pixel is placed on the line from the bed's colour to the pieces' and clamped
     to [0, 1]. A shadow, a scorch mark or an old cut lies past the bed's end of that line, so it
     counts exactly as bed. It can neither grow a piece nor become one.
   - That value is then blurred by the least of 0.5, 1, 1.5 and 2.5 mm that keeps the bed's own
     texture (its 99.5th percentile in the edge band) a tenth of the bed-to-piece step below the
     split. A flat spoilboard keeps 0.5 mm; a coarse honeycomb may need the old 2.5 mm.
   - The split is halfway between the bed's and the pieces' blurred levels, so a blurred straight
     edge stays where it is, as before.
   - When nothing stands out from the bed by at least 12 (and four times the bed's own spread),
     no piece is found.
2. **Cleaning and neck cuts** (`piece-components.ts`, `piece-split.ts`).
   - The mask is opened by 1 mm, as before, but closed by only 0.5 mm, so a gap of 1 mm or more is
     no longer bridged.
   - Pieces that meet at a narrow neck, such as coasters laid touching, are then cut apart:
     - every piece pixel's exact distance to the bed is measured (Felzenszwalb–Huttenlocher);
     - the pixels are flooded from the deepest down;
     - two regions that meet stay apart when each rises at least 3 mm above where they meet and
       reaches 5 mm from the bed. The meeting line is cleared from the mask.
   - Two equal straight-sided blanks pushed flush together have no neck. They are not cut; point 3
     flags them.
3. **Doubts** (`piece-doubts.ts`). A found piece gets a doubt, and starts left out with the reason
   shown, when:
   - **colour:** its mean colour lies further than half the bed-to-piece step from the pieces'
     colour, or its hue is nearer the bed's hue than the pieces'. Glare is the bed's own hue, only
     brighter;
   - **smaller / larger:** most whole pieces (and at least three) share one area within 25 %, and
     this one is under 0.3 or over 1.8 times that area. A deliberate mix of sizes is never judged.

   Nothing is dropped. The operator can tick a doubtful piece. This keeps "nothing guesses what a
   piece is" from the original decision: the app only says what looks unlike the rest.
4. **Placement on the material** (`find-pieces.ts`, `piece-placements.ts`).
   - Each piece records its holes, its mean colour, and `onMaterial`. That is the rectangle's
     centre when it lies within 1 mm of the material's deepest point; otherwise it is the deepest
     point nearest to that centre.
   - A centred design goes to `onMaterial`, and turns about it. The sample path is unchanged.
   - A piece is called round only when its outer outline's area is within 6 % of the disc its
     rectangle holds, so an L offcut is listed by its sides. A ring stays round, judged by its
     outer outline.
5. **Fit check** (`piece-fit.ts`, `PiecesControl`).
   - The design's box, moved and turned exactly as `placedObject` will move it, is sampled about
     every millimetre against the piece's outline and holes.
   - A copy that runs more than 1 mm off its piece is left out of Place, and the message names the
     pieces left out. Each row says how far the design runs off. When nothing fits, nothing is
     placed and the panel says why.
   - The sample piece (the design itself) is never left out.
6. **Fixture templates** saved before this amendment have no holes, colour or `onMaterial`. They
   fall back to the outline and the rectangle's centre, as before. All new fields are optional.

### Measured (synthetic top-down scenes, the auditor's and refuter's renderers, no camera)

| Case | Before | After |
|---|---|---|
| 50 × 50 pairs on hex honeycomb | gaps up to 3.5 mm merged | 2 mm and more apart separate; ≤ 1 mm merge and are doubted "larger", no copy straddles |
| 12 coasters ⌀90, 1.5 mm gaps; 15 tiles, 1 mm gaps | 1 piece each | 12 and 15 pieces |
| L / ring / frame offcuts, 36 × 24 design | copy 100 % off the wood | L placed on its leg; ring and frame refused by the fit check |
| Glare sweep (10 spots) on honeycomb | 5 found, ticked | 1 found, doubted; no copy on the bed |
| Long shadows on grey / MDF / honeycomb | centre 4–6 mm off | ≤ 0.09 mm |
| Scorched MDF, 900–2700 mm² of marks, every mode | blanks lost at 1350 mm² and up | the 4 blanks found every time |
| Piece 2 mm from the bed's edge | "partly out of view" | whole (≤ 1 mm still partial) |
| Turned blanks (accuracy) | centre 0.01–0.12 mm | 0.02–0.11 mm, axis ≤ 0.09° |

A find takes about 1.5 times as long as before (the extra blurs and two distance transforms),
about 2–3 s for a 400 × 300 mm bed on a busy desktop.

### Consequences

- **Mixed colours, centred mode:** with the design off the pieces, only pieces of the most common
  standing-out colour are found. A blue acrylic blank among plywood ones needs the design put on
  one of them. A missing outline is visible; nothing burns off the material.
- **Doubtful pieces start unticked**, including a large offcut among a batch of small blanks. The
  operator ticks it back in.
- **Remaining gaps:** two straight-sided blanks pushed flush together, or less than about 1 mm
  apart, are found as one piece. It is doubted "larger" only when it sits among a batch of single
  blanks.
- **Validation:** real glare, shadows and spoilboards remain to be photographed. These figures
  come from synthetic scenes (ADR-442 Consequences already owe a photographed corpus).
