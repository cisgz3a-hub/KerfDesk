## ADR-443 Amendment 3 - The camera tells which way round the printed sheet lies (2026-11-10)

**Status:** Accepted (rolling audit v13 finding Y3-P2-1, re-rated P1 by its independent refuter
and confirmed by the audit coordinator on main `82a9713a4`; Y3-P3-1 is fixed with it; the
maintainer's standing instruction to fix confirmed audit findings). Amends ADR-443 Decision 2
(the nearest pair picks target 1) and extends Amendment 1's "shown, never silent" to the camera
route. Nothing is refused (ADR-228). | **Date:** 2026-11-10

### Context

Two marks fit the targets' spacing equally well either way round, half a turn apart.
`matchMarkPair` took the order whose marks lie nearer the design's targets, which is right only
while the sheet lies within a quarter turn of the design.

- **With diagonal marks**, sheets turned 92°, 120°, −100°, 270° or 180° (upside down) were paired
  the wrong way round. The dialog reported −88°, −60°, 80°, 90° and "turned 0.0°", and the cut
  missed the print by 136 mm on average (186 mm worst).
- **With both marks on one edge**, the same happened from 88° (225 mm average, 296 mm worst).
- **Amendment 1's check never fired.** A swapped camera pair registers under 90°, never near 180°.
  The head-capture route flags the same upside-down sheet, so the camera route lost a protection
  the head route has.
- **Y3-P3-1.** The Job Review line for Print and Cut with another Start from said only "confirm the
  traced position". It didn't say that the marks are places on the machine, so any Start from but
  Absolute moves the cut off the print.

### Decision

1. **The print decides the order** (`core/camera/marks/pair-orientation.ts`).
   - The camera picture flattened onto the bed carries the printed sheet. For each order of the two
     found marks, the design's artwork is carried onto the bed by that order's registration. The
     artwork is the box of every design object other than the two marks (`designArtworkBoxes`).
   - The score is how much darker the artwork boxes are than a ring of paper just round them.
     Printed artwork stands out from its paper. Boxes carried half a turn off land on blank paper
     or on the bed, as even as their surroundings.
   - When the better order stands out by at least 15 grey levels, and leads the other by as much,
     it is used, even when it is not the nearer one.
   - The dialog says the print confirmed the orientation, or that it turned the nearer pairing
     round.
2. **When the print cannot tell, the operator confirms a far turn.**
   - The print may be unable to tell: no artwork beside the marks, artwork as symmetric as the
     marks, or poor contrast.
   - The nearest order is kept. If its turn is more than 45°, where either order is a plausible way
     to lay the sheet, the dialog shows "The camera could not tell which way round the sheet lies:
     it reads as turned X°, but the same two marks also fit a sheet turned X ± 180° … Check that the
     sheet is turned X°".
   - It joins Amendment 1's confirm, and Apply waits for **Use this registration anyway**. Any new
     capture clears it.
3. **The Start-from line says the cause and the fix** (`printCutJobOriginWarning`): "Print-and-Cut
   registration is on, but Start from is User Origin. The registration marks were found at their
   places on the machine, so the cut lines up with the print only from Absolute Coordinates …
   Choose Absolute Coordinates". It covers camera and head captures alike.

### Consequences

- A sheet laid upside down, or turned past a quarter turn, registers onto the print whenever the
  print shows which way round it is. When it can't, the operator is asked before applying.
- An upside-down sheet whose artwork is as symmetric as its marks, and so reads a turn under 45°,
  still takes the nearer order without asking. Nothing in the picture separates the two then.
  A third or asymmetric mark would; that is not added here.
- Code and synthetic-image test evidence only. No camera, printer or machine was used.

### Verification

- `src/core/camera/marks/pair-orientation.test.ts` renders a printed sheet with an L of artwork,
  laid on the bed:
  - diagonal marks at 0°, 30°, 88°, 92°, 120°, 180°, 270° and −100°, and one-edge marks at 0°,
    75°, 88°, 120° and 180°, are all paired by the print;
  - each registered cut lands within 0.1 mm of the print, and the reported turn is the sheet's;
  - an upside-down sheet turns the nearer pairing round;
  - symmetric artwork at 120°, or no artwork at 88°, asks for confirmation, and at 10° it keeps
    the nearer pairing.
- `src/ui/laser/print-cut-camera-orientation.test.ts` checks the dialog messages, the confirmation
  note and its clearing on capture, the artwork boxes (marks left out), and the reworded Start-from
  line.
- `PrintAndCutDialog.test.tsx`: Apply waits for the confirmation when the camera could not tell.
