## ADR-487 - Carved stock and laser burn preview in the 3D view (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

The last of five batches from the 2026-09-26 audit of the three.js viewers (after ADR-425,
ADR-426, ADR-470 and ADR-485). The first four made the G-code Inspector's 3D view correct,
pleasant to move around, able to answer questions and usable on big programs. It still shows only
lines. VCarve, Carbide Create and Fusion show the material the program leaves; LightBurn shows the
burn a laser job will leave. This batch shows both in the Inspector.

### Context

1. **The Inspector shows where the bit goes, not what it leaves.** The CNC side has a carving
   simulator (the removal grid behind Cut 3D, ADR-098), but it runs on the design's toolpaths
   before they are written, not on a G-code program, and not as playback runs. An opened program,
   or one from another CAM, can only be read as lines: a pocket's floor, a missed island or a
   rapid through the stock are there to be worked out, not seen.

### Decision

1. **Carved stock in the Inspector.** A CNC program that goes below Z0 has a "Stock" section in
   the readouts with "Show carved stock" and "Toolpath over the stock", both off to start with.
   Shown, the 3D view draws a block of material that playback carves as it runs, in both looks.
   - **The stock is a removal grid over the moves below Z0**, the stock top, as Cut 3D assumes,
     with the widest bit's radius and 2 mm of room round them. Its bottom is 1 mm below the
     deepest move: a program does not say how thick the stock is. The grid keeps to about a million
     cells, no finer than 0.05 mm and at most 2,048 a side (the texture size every WebGL 2 takes).
   - **Every move carves, rapids included.** A rapid below the stock top cuts on the machine, or
     breaks the bit, so it shows. Each cell keeps the deepest the bit's cutting surface has been
     over it.
   - **Each move is swept once** (`stock-sweep.ts`), not stamped at every half cell as Cut 3D's
     stamping does: stamping visits each cell once for every sample the bit covers it at, about 50
     times over for a 6 mm bit. A move at one height, and any end-mill move, is swept exactly: a
     cell is cut to the move's height plus the bit's profile at the cell's distance from the move,
     or, for an end mill on a slope, to the lowest height along the stretch of the move the bit
     covers the cell for. A sloped ball or V-bit move, as in a relief or V-carving, is stamped at
     every cell along it with the tip over the nearest cell centre, exact to half a cell. The
     bit's profile is the simulator's own (`kernelForTool`).
   - **The bit comes from the program's own `; cnc tool:` comments** (ADR-426). Moves with no bit
     size carve with a 3.175 mm end mill, and the Stock section says so.
   - **A worker carves it.** The Inspector hands it a copy of the moves; the worker carves to where
     playback has got and sends back only the rows that changed. While one carve is under way only
     the latest target waits, so the view catches up with the playhead without a queue building
     behind it. Going back in the program starts the grid again. With playback at its end the whole
     program is carved; in a live job nothing is carved before the first move.
   - **The view draws the grid without rebuilding anything.** The stock's top is one flat mesh of
     one vertex per cell, raised or lowered in the vertex shader from a float texture of the cells'
     depths, with normals from the neighbouring cells; a carve only rewrites the texture. Cells cut
     below the bottom draw nothing, so a profile cut through leaves a hole. The sides and bottom are
     a plain box without its top.
   - **Both looks.** Classic has no lights, so the stock brings a soft sky and key light of its own
     there; Studio lights it with its own lights and environment. Classic's grid lies at Z0, the
     stock's top, so while the stock shows the grid drops to the stock's bottom and the block sits
     on it; it goes back when the stock is hidden. Classic's lines and colours are unchanged.
   - **The toolpath hides behind the stock** unless "Toolpath over the stock" is on; the tool, the
     playback marker and the rest of the view stay.

### Consequences

- **The carved stock is a picture, not a check.** It assumes Z0 is the stock top and the stock is
  flat; a program zeroed on the bed, or cut from uneven stock, carves in the wrong place. It
  flags nothing, blocks nothing and asks nothing (ADR-228); CAM and G-code are unchanged.
- **Cells are about 0.05 to 0.2 mm.** Detail finer than a cell, such as a V-carve's sharpest
  corners, is rounded to the grid. A sloped ball or V-bit move is exact to half a cell.
- **Going back re-carves from the start.** A 300,000-move relief takes about 1.5 seconds in the
  worker, during which the view shows the stock as it was.
- **Memory:** the worker holds a copy of the moves and the grid (4 bytes a cell, about 4 MB); the
  page holds the grid's depths and the GPU a texture of them and one vertex a cell (about 36 MB
  for a million cells), while the stock is shown.

### Verification

- Unit tests (`stock-sweep.test.ts`): an end mill cuts a flat slot its width with round ends and
  reports the rows it reached; a ramp's flat bottom reaches its lowest point under the bit, less
  far on off to the side; a ball nose cuts its profile on a level move; a V bit down a slope cuts
  its cone and nothing above the top; a sweep stops as far along the move as asked.
- Unit tests (`stock-carving.test.ts`): the stock covers the moves below Z0 with room for the bit
  and its bottom 1 mm below the deepest; a carve reaches as far as playback has got; going back
  starts again and reports every row; a carve that reaches nothing reports nothing; moves without
  a bit carve with a 3.175 mm end mill; big and long stocks keep to about a million cells and
  2,048 a side.
- Unit tests (`stock-worker-client.test.ts`): the worker gets its own copy of the moves,
  transferred; only the latest carve waits while one is under way; a program with nothing to
  carve asks nothing more; a stopped worker is ignored.
- Browser (`e2e/gcode-viewer-stock.e2e.ts`): a 30 mm pocket with a 6 mm end mill shows a whole
  block at the start of the program, a carved pocket at the end, the same whole block going back
  and the same carving going forward again; the toolpath can be drawn over it; Studio shows it
  too; hiding it leaves no stock. A program without its bit says it carves with a 3.175 mm end
  mill.
- Timings (Node, one core): a 150 x 100 mm pocket in three depths with a 6 mm end mill carved
  whole in 39.7 s with Cut 3D's stamping (measured beside a test run) and in 0.16 s swept; a
  300,000-move relief with a 3.175 mm ball nose in 1.4 s; playback's worst carve between frames
  was 9 ms.
