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
     with the widest bit's radius and 2 mm of room round them. For the project's own program
     ("Inspect G-code (3D)" and the canvas's G-code view) its bottom is the project's stock
     thickness below Z0, so a cut through the stock leaves a hole. An opened file does not say how
     thick its stock is, so its bottom is 1 mm below the deepest move. The grid keeps to about a
     million cells, no finer than 0.05 mm and at most 2,048 a side (the texture size every WebGL 2
     takes).
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
2. **Materials.** A "Material" choice in the Stock section, remembered per browser, draws the
   stock as wood (the default), MDF, acrylic, aluminium, a two-colour laminate, flat grey or a
   height map. Each is worked out per pixel from where the pixel is in the block, so a cut shows
   what is under the surface:
   - wood is Cut 3D's timber (ADR-284, `WOOD_GRAIN_GLSL`): growth rings round a log along X
     below the board, which a carving cuts across, pores, and cut faces lighter and rougher than
     the top, in the colours and figure of the project's species (walnut dark, pine pale and
     wide-ringed) or Cut 3D's own timber without one;
   - MDF has a darker skin 0.4 mm deep over a paler core;
   - acrylic has a gloss top and frosted, paler cuts;
   - aluminium is rolled plate with faint streaks along X, with brighter, shinier machined faces;
   - the laminate is a black cap 0.2 mm deep over a white core, as engraving plastics are;
   - flat grey shows only the shape;
   - the height map colours each depth from pale at the top through green and blue to dark at the
     stock's bottom.
   The project's own program starts on the project's stock material (softwoods and hardwoods as
   wood, plywood and MDF as MDF, acrylic, aluminium); an opened file starts on the one last
   chosen. One shader serves them all, so a new material changes a uniform and the surface's
   shine, and nothing is rebuilt. Studio's key light and environment are brighter than Classic's rig, so
   colours are drawn a little darker there; Classic has no environment for metal to reflect, so
   aluminium is only part metal there.

3. **Compare with the design.** For the project's own program, when a relief lies on the stock,
   the Stock section has "Compare with the design" and a tolerance of ±0.05, 0.1 (the default),
   0.25 or 0.5 mm. On, the stock's top is coloured by how far each cell's carving is from the
   depth the relief design wants there: green within the tolerance; blue where material is left
   above the design, deeper blue the more is left; red where the carving is below it, darker the
   deeper. Under the colours the section counts the share of the design's cells within, with
   material left and cut too deep, with the most left and the deepest cut, as far as playback has
   got.
   - **The design is the relief as the compiler carves it.** Each relief is read from the same
     heightmap relief CAM reads (`reliefObjectToHeightmap` at the scales relief planning uses),
     placed in the program as the compiler places it: the relief's own placement less the scale
     planning takes out, the machine's origin, then the job's placement from Save's preparation
     (`jobOriginOffset`). Each step is affine, so the page works out one matrix per relief and the
     worker samples the heightmap under every stock cell, between its cells. Where reliefs overlap
     the deeper wins. Only reliefs on operations the program outputs count.
   - **Only the reliefs are compared.** Cells no relief covers, and cells a relief's mask leaves
     out, keep the material's colours: profiles, pockets and V-carves say where they cut, not what
     they should leave, and this batch keeps to the relief (the 3D carving thread keeps
     `core/relief` and `compile-cnc-relief`; this only reads them).
   - **Where it comes from.** Save's emission reports the job placement and the reliefs it
     carves; "Inspect G-code (3D)" and the canvas's G-code view hand them to the Inspector with
     the project's stock. The Inspector keeps them on the page: the parse worker is sent the
     program without them. The carving worker builds the design's depths once and sends a copy
     to the view, which draws it as a second float texture and colours each pixel from its cell.

4. **Save the carved stock as STL.** With the stock shown, "Save as STL…" writes the stock as
   carved so far (as far as playback has got) as a binary STL solid in the program's
   millimetres, Z0 the stock top, for another CAM, a slicer or a model viewer to open.
   - **One closed surface.** The top is the surface the view draws, a vertex at every cell's
     centre, except that the outermost vertices sit on the stock's edges, so the solid is the
     stock's full size. Walls go down to the bottom round the stock and round every hole a cut
     through leaves (a square with any corner cut through is left out, as the view leaves it
     out), and the bottom is flat.
   - **Flat stays small.** Each row of squares is split into runs; a run of level squares, such
     as the uncut top or a pocket's floor, is one strip of triangles between the vertices its
     two edges need, and the bottom needs vertices only where walls stand and runs end. Every
     run's edge keeps each vertex a neighbouring run or wall has on it, so no vertex sits part
     way along another triangle's edge: every edge is walked once each way by the triangles
     either side, and slicers and CAM read the solid as closed.
   - **The file is picked first**, while the click still counts as the operator's (the browser
     refuses a save picker later), and the carving worker, which holds the grid, writes the
     solid and hands the bytes over without copying them.

5. **Laser burn preview.** A laser program, or an opened file that burns and cuts nothing below
   Z0, has a "Burn" section in the readouts with "Show burn preview", "Toolpath over the burn"
   and a material, and "Wrap round the rotary" when the machine has a rotary set up and on.
   Shown, the view draws the sheet the program burns, darkened as playback runs, in both looks.
   - **Power, not speed.** Each move the laser is on for lays its beam's width of burn along it.
     How dark depends on its power alone (S against full power, the controller's `$30`), as
     LightBurn's preview shades by power. A pass at full power leaves 8% of the surface's light
     and one at half power about half; passes over the same place darken it further (their
     optical densities add), and a beam narrower than a cell darkens it by the share of it the
     beam covers, so a fill keeps its tone on a coarser grid. The beam is the laser head's spot
     from the machine profile, or 0.1 mm without one.
   - **A worker burns it**, as the carved stock's worker carves: at most 4 million cells, no
     finer than 0.05 mm and 2,048 a side. It burns on from where it stopped, part way along a
     move included, so nothing burns twice; going back starts again; and it sends back only the
     rows that changed, one byte a cell.
   - **The view** draws the sheet as a plane just under the burned moves, the darkness a texture
     filtered between cells, so a burn rewrites only the texture. The sheet is drawn in the
     carved stock's materials at their top face, and each burns as it does: wood and MDF scorch
     brown, then char black; acrylic frosts pale; aluminium marks dark and loses its shine; the
     two-colour laminate loses its black cap and shows its white core; flat grey darkens; the
     height map (a "Burn map" here) colours the burn itself. Its choice is remembered per
     browser apart from the carved stock's.
   - **Round a rotary.** For the project's own program, or an opened file on a machine with a
     rotary on, the burn wraps round the work: a cylinder along X of the work's diameter with
     its top at the burn's height and closed ends, the grid's rows going once round it (the Y
     that turns the work once, from Rotary Setup). The middle of the program's Y is on top and Y
     runs on over the back, as the surface moves under the laser. A job longer than one turn
     burns over its own start, as it would on the machine. Unwrapped, the same burn lies flat.
   - An opened file is burned with the current machine's full power, beam and rotary, as it is
     already timed for the current machine.

6. **Shadows and occlusion on the carved stock.** "Shadows and occlusion" in the Stock section,
   on by default, lets the key light (Classic's own, Studio's sun) cast soft shadows into the
   carving, and darkens its corners, the bottoms of its grooves and the feet of its walls, where
   less of the room's light reaches.
   - **From the depths, not a shadow map.** The top is a height field, so the shader finds both
     from the texture the carving already fills. A pixel steps up to 40 times across the cells
     towards the light, only as far as a ray could still pass under the stock's top, and its
     light falls off softly the nearer the ray passes under a higher cell. Its ambient light falls
     with how much of the stock stands above it, eight ways at 1 mm and 3 mm. Nothing is built
     as the stock carves, and the uncut top, with nothing above it, skips both.
   - Only the stock's top is shaded. The lines, the burn preview and the view without the stock
     are drawn as before.

### Consequences

- **The carved stock is a picture, not a check.** It assumes Z0 is the stock top and the stock is
  flat; a program zeroed on the bed, or cut from uneven stock, carves in the wrong place. It
  flags nothing, blocks nothing and asks nothing (ADR-228); CAM and G-code are unchanged.
- **Cells are about 0.05 to 0.2 mm.** Detail finer than a cell, such as a V-carve's sharpest
  corners, is rounded to the grid. A sloped ball or V-bit move is exact to half a cell.
- **Going back re-carves from the start.** A 300,000-move relief takes about 1.5 seconds in the
  worker, during which the view shows the stock as it was.
- **Materials are looks, not stock data.** The material changes nothing about the carving: the
  grid, the bit and the depths are the same whatever is chosen. An opened file says nothing
  about what it is cut from.
- **The compare is a picture, not a check.** It flags nothing and blocks nothing (ADR-228). It is
  as exact as the grid: a sloped ball move is carved exact to half a cell, and a finishing
  ball's scallops show as material left at a tolerance tighter than the scallop. It assumes the
  program is run where Save placed it; a job run from another origin carves the same shape
  elsewhere, and the program alone cannot tell. An opened file has no design to compare with.
- **The STL is the grid.** It is as fine as the cells, heights between cell centres are
  straight, and a wall one cell wide leans across that cell. A 30 mm pocket in its 34 mm block
  (462,400 cells) saves as 15,548 triangles (0.8 MB), within 0.5% of the pocket's volume; a
  million-cell relief is about two million triangles, 100 MB, written in about a second (Node,
  one core). Only the top of a carving has detail to save, so the file grows with its
  sloped area, not the stock's.
- **The burn is a picture of power, not a prediction.** How dark a material burns depends on
  the speed, the focus, the air and the material itself; the preview counts only power and
  where the beam went, so a job that shades by speed at one power shows one tone. It flags
  nothing, blocks nothing and asks nothing (ADR-228), and the G-code is unchanged. The burn's
  worker holds a copy of the moves and 4 bytes a cell (16 MB at most); the page and the GPU one
  byte a cell.
- **Shadows are approximate.** The shadow darkens all the direct light, Studio's weak rim light
  too, not only the key's. A ray samples every cell or so near the pixel and farther apart as it
  goes, so a wall thinner than the gap between samples (about half a millimetre for a pocket 18
  mm deep) can let light through at its edge; the ray starts a cell up, so slopes do not shadow
  themselves. Turned off, the stock is lit exactly as before.
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
- Unit tests (`scene-stock-materials.test.ts`, `stock-material-preference.test.ts`): the
  material code lands after three's colour and roughness in both shaders, with a branch for each
  material; a new material or look changes the uniforms and shine, fully metal in Studio and part
  metal in Classic; the choice is remembered, and unknown or unavailable storage gives wood.
- Unit tests (`stock-design-target.test.ts`): each relief lies where it is placed and nothing
  elsewhere; the deeper wins where reliefs overlap; a mask's left-out cells have no design; no
  relief on the stock gives no design; the one matrix places a turned, scaled, mirrored relief as
  the compiler's own steps do on a centre-origin machine with a job offset; the counts split
  cells into left, within and too deep.
- Unit tests (`stock-stl.test.ts`): an uncut block, a pocket, a hole cut through, a surface
  with no two squares alike and one where flat, sloped and cut-through squares meet each save
  as a closed solid (every edge walked once each way) of the right volume, facing out; the flat
  top is a strip a row and the flat bottom needs vertices only at its edges; the header does not
  start "solid"; a stock cut through everywhere saves nothing. (`stock-worker-client.test.ts`):
  the STL waits for the carve asked before it, the view does not hear it, and a stopped worker
  or a program that carves nothing gives none.
- Unit tests (`burn-grid.test.ts`): a full-power beam one cell wide leaves 8% of the light
  along its line and nothing beside it, half power 46%; a second pass darkens as the densities
  add; traversals and S0 burn nothing; 0.1 mm fill lines over 0.4 mm cells keep a full pass's
  tone; a beam wider than a cell spreads across the cells it covers; playback in four steps
  burns the same as in one; going back starts again, and each step reports only its rows; the
  grid covers the burn with room for the beam at the burned surface's height; round a rotary
  the rows go exactly once round, and a move a turn later burns over the first.
  (`burn-worker-client.test.ts`) the worker gets its own copy of the moves and the laser; only
  the latest burn waits. (`scene-burn.test.ts`) the sheet lies under the burned cells and goes
  when hidden; each material burns in the shader after three's colour and shine; the rotary's
  cylinder is closed, faces out everywhere and has the middle row on top.
  (`gcode-inspection-source.test.ts`) a laser project's program burns at its `$30` and its
  head's spot, on its rotary only while the rotary is on; a CNC project has no laser; an
  opened file takes the current machine's laser.
- End to end (`stock-design-compare.test.ts`): a 30 mm dome relief turned 30°, compiled through
  Save's preparation with a front-left user origin, read back from its G-code and carved whole,
  lies on its design: 99.5% of its 360,000 cells within 0.25 mm and none cut too deep. Moved
  2 mm, the same design finds cuts up to 0.6 mm too deep and under three quarters within.
- Browser (`e2e/gcode-viewer-stock.e2e.ts`): a 30 mm pocket with a 6 mm end mill shows a whole
  block at the start of the program, a carved pocket at the end, the same whole block going back
  and the same carving going forward again; the laminate shows no wood colours and wood again
  gives the same picture; the toolpath can be drawn over it; Studio shows it too; hiding it
  leaves no stock. A program without its bit says it carves with a 3.175 mm end
  mill. A CNC project of 9 mm MDF with the dome relief, inspected from the canvas, starts on MDF,
  compares with its design (none too deep, most within 0.1 mm, green in the view, fewer within
  0.05 mm) and stops colouring when compare is off. The carved pocket, saved as STL through the
  save picker, reads back as a closed solid within 2% of the block less the pocket, in under
  40,000 triangles. With shadows and occlusion off the carved pocket is lighter, and on again
  it is the same picture.
- Unit tests (`scene-stock-shade.test.ts`): the shading lands after three sums its light, the
  direct light darkened by the shadow and the ambient by the occlusion; it falls from Classic's
  key or Studio's sun, and turns off; only the stock's top has it, with the depths declared once
  before the functions that read them.
- Browser (`e2e/gcode-viewer-burn.e2e.ts`): a laser program of two filled 20 mm squares, at full
  power and at 30%, has a burn and no stock; the sheet is bare wood at the start and at the end
  the full-power square is charred and the 30% one scorched; the laminate shows its white core
  where it burned; hiding the burn leaves the view as it was. With a chuck rotary on, turning 40
  mm work once in 100 mm, the burn wraps round the work, and unwrapped is a different picture.
- Timings (Node, one core): a 150 x 100 mm pocket in three depths with a 6 mm end mill carved
  whole in 39.7 s with Cut 3D's stamping (measured beside a test run) and in 0.16 s swept; a
  300,000-move relief with a 3.175 mm ball nose in 1.4 s; playback's worst carve between frames
  was 9 ms.
