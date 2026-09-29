## ADR-388 - LightBurn projects open where, and as, LightBurn showed them (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

Applies ADR-027 (LightBurn is the source of truth) to opening `.lbrn2` and legacy `.lbrn`
projects (`src/io/lightburn/lbrn-*.ts`). Laser only.

### Context

The 2026-09-28 weakness audit of main `2f6f84dec` opened real LightBurn 2.0.05 projects (the
`src/__fixtures__/lightburn/external/lbrn` corpus) and found the geometry wrong. Circles came in as
pinched stars, fillets as chamfers, and every project upside down. The format is not published, so
each rule below was settled from the fixtures themselves: the circles and fillets they contain,
and the thumbnail LightBurn embeds in each file, which is its own drawing of the project.

### Decision

1. **Bezier handles.** In a `<VertList>`, `c0x`/`c0y` is the handle a curve leaves the vertex
   along and `c1x`/`c1y` the handle it arrives along, so `B i j` is the cubic V[i], V[i].c0, V[j].c1,
   V[j]. LightBurn leaves out a handle coordinate that is zero (`c0x-2.2385712` alone is the handle
   (-2.2385712, 0)), and writes a bare `x1` (`c0x1`, `c1x1`) where a vertex has no handle. Read this
   way, every circle and fillet in the corpus is a true arc to within 0.003 mm along its whole
   length. A number may carry an exponent (`-1.1368684e-13`); before, such a vertex was skipped
   and every later primitive joined the wrong vertices.
2. **Where a project lands.** LightBurn saves coordinates in the saving machine's own frame:
   millimetres from its origin corner, +X along the width away from that corner, +Y along the depth
   away from it. The root's `MirrorX` puts that origin on the right and `MirrorY` at the rear; no
   flags is a front-left origin with Y pointing to the rear. LightBurn draws its workspace from
   above with the rear at the top, as KerfDesk does, so the importer maps a project point to the
   scene as `x = MirrorX ? bedWidth - X : X` and `y = MirrorY ? Y : bedHeight - Y`, using the bed of
   the machine the project opens on, after every group and shape `<XForm>`. The project keeps its
   distance from that corner, and text and asymmetric parts read the same way round as in
   LightBurn. The corpus files (`MirrorX="True" MirrorY="True"`) come out matching their embedded
   thumbnails: the backplane's notch along the top edge, its tall slot on the right.
3. **Run order.** LightBurn's default Cut Planner runs a project layer by layer in its Cuts /
   Layers list order, which each `<CutSetting>` records as `priority`. The importer lists the
   operations in that order (priority, then index; a layer written without a priority keeps its
   index's place) and sets `Scene.artworkOrder` so each layer's artwork follows the one before
   (ADR-211: artwork order decides which operation runs first). Drawing order is kept inside a
   layer and for canvas stacking. A part is no longer cut free before it is engraved because its
   outline was drawn first.
4. **The machine it opens on.** A LightBurn project names no KerfDesk machine, so it opens on the
   machine already open in KerfDesk, as imported artwork does, and that machine's bed places it
   (decision 2). File > Open, `Ctrl+O`, Recent Projects and the operating system all pass it,
   on the main thread and in the import worker. No machine-change banner appears, and the bed,
   S range, homing and start placement stay the machine's own. Opening still replaces the job, so
   a Frame completed before it does not carry over: the opened project is framed afresh.
5. **Other ways LightBurn writes a shape.** A `Rect`'s `Cr` is its corner radius: each corner
   opens as a quarter circle, drawn as KerfDesk's own Rectangle draws one, and a radius past half
   the shorter side is drawn as half that side. A `<PrimList>` of `LineClosed` joins every vertex
   in order with lines and closes the path; `LineOpen` joins them without closing. A legacy
   `.lbrn` path writes each vertex as `<V vx vy c0x c0y c1x c1y/>` and each primitive as
   `<P T="L|B" p0 p1/>`; its handles mean what they do in a `<VertList>` (decision 1), and a
   handle coordinate left out reads as zero.
6. **Kerf offset.** LightBurn's Kerf Offset moves a Cut layer's closed shapes out by the offset
   and the holes inside them in, which is what KerfDesk's Kerf Offset does (ADR-486). A Cut
   layer's `kerf` therefore opens as the layer's `kerfOffsetMm`, value for value. A kerf the
   field cannot hold (outside -10 to 10 mm, or not a number) is not applied, and the import report
   names the layer and the value. A Scan layer's kerf is named as a field not imported, because
   KerfDesk offsets only Line cuts. Nothing is dropped without a line in the report.
7. **Layer modes by name.** A `<CutSetting>`'s `type` is read as a whole name, not searched for
   "scan" or "fill": `Cut` is a Line operation, `Scan` a Fill operation, and `Scan+Cut`
   (LightBurn's Fill+Line) a Fill operation followed by a Line operation named "<layer> (Line)"
   on the same artwork, with the layer's speed, power and passes, and its kerf on the Line.
   Listed right after the fill, the Line runs second and finishes the edge. A setting with no
   type is LightBurn's default, Line. Any other type is named in the report and opens as a Line
   operation to be reviewed. A Scan layer's `priority` is not reported as a field left behind,
   since decision 3 reads it.
8. **Air assist.** LightBurn writes a cut setting's Air Assist as `runBlower` (`1` on, `0` off),
   in projects and in `.clb` libraries alike. It opens as the operation's Air Assist, on both
   operations of a Fill+Line layer, and as a library preset's air assist. The `.clb` names the
   importer read before (`AirAssist`, `AirAssistEnable`) are kept; no LightBurn file shows them.
9. **Output.** `doOutput` is the layer's Output switch in LightBurn's Cuts / Layers list; `0`
   keeps the layer out of the job. It opens as the operation's Output, on both operations of a
   Fill+Line layer, so a layer LightBurn would not run does not run here either. A setting without
   it keeps the default, on.
10. **Every setting left behind is named.** The import report has a line for each `<CutSetting>`
    setting a layer opens without whenever it changes what LightBurn would cut: Perforation Mode,
    Tabs, Overcut, Ramp, Dot Mode, Cut Through, Z Offset, Z Step Per Pass, start and end delays,
    PPI, Frequency, Laser 2 (and Laser 1 switched off), the air assist speed and automatic air
    assist, Constant Power Mode, a Min Power other than 0 or the Max Power, Hide, and on a Fill its
    Kerf Offset, Flood Fill and a Fill Grouping other than all shapes at once. Each line names the
    layer and the fields as LightBurn wrote them. A setting is left out only while LightBurn itself
    does not use it: its switch is off (a tab size with tabs off), it is a Fill setting on a Line
    layer, or an Image setting on a vector layer. A field this list does not know is named whenever
    it holds anything but 0, off or nothing, and a nested block of settings (a sub-layer, say) is
    named as a whole. The same rules hold for every layer mode, so a Fill no longer lists fields
    LightBurn writes at rest: a Fill with the fields of the corpus layers reported six before.
11. **Every shape left out is named.** The report has a line for each kind of shape a project
    opens without, with how many: a type KerfDesk does not open (a `Bitmap`, say), a `Text` saved
    without its outline (`BackupPath`), with the advice to convert it to paths in LightBurn, and a
    shape with no geometry to read (a `Rect` of zero width, an empty `Path`). Before, a left-out
    type was listed apart from the warnings, and opening the project counted it without naming
    it. The open toast now counts each line once and shows the first three.
12. **The notes and the report stay with the project.** LightBurn's project notes
    (`<Notes Notes="…">`) open as the project's notes (Window > Project Notes). When the import
    report has lines, they follow the notes under "LightBurn import report for <file>:", one per
    line, so the whole report is saved with the project and can be read after the toasts have
    gone; the review toast says where the rest of a long report is. A project whose notes
    LightBurn shows on opening (`ShowOnLoad="1"`) adds a report line saying where to read them.
    Before, the notes were dropped and the toast sent the rest of a long report to an "import
    report" nothing showed.
13. **Tool layers.** LightBurn's tool layers T1 and T2 (`CutIndex` 30 and 31, cut settings of
    type `Tool`) hold guides and registration shapes that LightBurn never cuts. Their shapes open
    on an operation with Output off, named "LightBurn T1" / "LightBurn T2" unless the file names
    them, and the report says why, so they show for alignment and are not cut. Before, they opened
    as ordinary operations ("LightBurn C30") and were cut.

### Limits

- The saving machine's bed size is not in the file. A project saved on a larger bed can land
  partly off a smaller one, as it would on that machine in LightBurn. It is not moved or scaled.
- Only the layer order is mapped. A project whose Cut Planner (`UIPrefs`) does not rank layer
  ordering first (`Optimize_ByLayer` other than 0) still runs layer by layer here, and the import
  report says so. The rest of `UIPrefs` (inner shapes first, travel, direction) is not read;
  the project takes KerfDesk's optimization defaults.
- The machine is read when the file starts to open. If it is changed while a large file is still
  being read, the project arrives on the earlier machine and the usual machine-change banner
  offers the choice.
- Code and test evidence only. The corpus is five LightBurn 2.0.05 projects from one machine
  (rear-right origin); the front-left rule is the same mapping with no flags set.
- Decision 6 rests on LightBurn's own description of Kerf Offset (a path offset, outward on outer
  shapes and inward on holes), which could not be rechecked here: no corpus file carries a kerf,
  and no LightBurn cut was compared.
- The corpus has only `Cut` layers. `Scan` and `Scan+Cut` as Fill and Fill+Line follow the Fill
  mapping already shipped and a third-party generator's table of LightBurn's mode names; LightBurn's
  names for its other modes (such as Offset Fill) are not known here, so they are reported.
  LightBurn's own order inside a Fill+Line layer was not observed.
- `runBlower` comes from LightBurn 0.9 projects published with third-party tools; the repo's
  `.clb` fixtures leave it out, as current LightBurn leaves out values at their default. A setting
  without it keeps KerfDesk's default, off; LightBurn's own default is not known here.
- `doOutput` is written as `0` or `1` in the same LightBurn 0.9 projects, and a third-party
  converter's notes call it LightBurn's output toggle, separate from the layer's `hide`. The
  corpus leaves it out, at its default.
- Decision 10 reads which settings are in use from the fields and values LightBurn 0.9 and 2.0.05
  projects write (third-party projects and the corpus); LightBurn's own documentation could not
  be read here. A switch LightBurn did not write is taken as off, its default. Perforation,
  overcut and tabs have KerfDesk equivalents (ADR-415, ADR-494) but are named rather than mapped:
  their LightBurn behaviour was not compared here, and KerfDesk's perforation deliberately differs
  at a closed shape's seam.
- Tool layers rest on two third-party converters: one gives their indexes, 30 and 31, and says
  they never output; the other reads their type, `Tool`. The corpus has none.
- No corpus file has a rounded `Rect`, a `LineClosed` or `LineOpen` list, or a legacy `.lbrn`
  path. Decision 5 follows the audit's repro files and LightBurn files published with
  third-party converters (a LightBurn 1.7 text outline written as `LineClosed`, `Cr` written on
  every `Rect`); `LineOpen` is named only by a converter's notes. Nothing of theirs is copied.

### Consequences

- LightBurn projects open right way up, at LightBurn's position, with curves intact, and run
  layer by layer in LightBurn's order. The Run order view shows one run per layer.
- Existing `.lf2` files are unaffected; only opening a LightBurn file changes. A `.lf2` still
  brings its own machine and the banner that goes with it.
- An opened project whose report has lines carries them in its notes; deleting them there
  changes nothing else.

### Tests

`lbrn-vertex-list.test.ts` (handle forms and exponent numbers; the keypad fixture's circles and
eight fillets are arcs along their whole length); `lbrn-frame.test.ts` (each MirrorX/MirrorY corner, rotated groups
and text through the same frame, the backplane fixture laid out as its thumbnail shows);
`lbrn-run-order.test.ts` (engrave before cut whatever the drawing order, interleaved shapes run
once per layer, priority over index, the Cut Planner warning); `lbrn-open-machine.test.ts`,
`shortcuts-open-lightburn.test.ts`, `open-project-command.test.ts` and
`document-import-lightburn-stream.test.ts` (the open machine is kept, and places the project,
through every open route); `lbrn-shapes.test.ts` (rounded and over-rounded Rects are true arcs,
`LineClosed` / `LineOpen` lists, shared by `PrimID` too, and legacy `<V>` / `<P>` circles and
lines); `lbrn-kerf.test.ts` (a Cut layer's kerf grows the plate and shrinks its hole in the
compiled job; out-of-range, unreadable and Scan kerfs are named); `lbrn-layer-modes.test.ts`
(each type name, Fill+Line as a fill then a line on the same artwork, an unknown mode named, a
Scan priority not reported, `runBlower` on every operation, `doOutput` 0 keeps every operation of
the layer out of the job); `lbrn-setting-report.test.ts` (each setting a Cut layer uses is named,
none for a LightBurn 0.9 Cut layer at rest or a Fill with the corpus layers' fields, Fill settings
on a Fill only, one line for a Fill+Line layer, unknown fields and nested blocks); `clb-import.test.ts` (`runBlower` in a
library); `lbrn-shape-report.test.ts` (each kind of shape left out is named with how many,
shapes with no geometry are counted); `project-open-completion-lightburn.test.ts` (a left-out
shape is named when the project opens and counted once, and the toast says where the rest of a
long report is); `lbrn-notes.test.ts` (LightBurn's notes, the report beneath them, and the line for
notes LightBurn shows on opening); `lbrn-tool-layers.test.ts` (T1 and T2, by index and by type,
open with Output off and stay out of the job).
