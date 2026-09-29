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
   length.
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

### Consequences

- LightBurn projects open right way up, at LightBurn's position, with curves intact, and run
  layer by layer in LightBurn's order. The Run order view shows one run per layer.
- Existing `.lf2` files are unaffected; only opening a LightBurn file changes. A `.lf2` still
  brings its own machine and the banner that goes with it.

### Tests

`lbrn-vertex-list.test.ts` (handle forms; the keypad fixture's circles and eight fillets are
arcs along their whole length); `lbrn-frame.test.ts` (each MirrorX/MirrorY corner, rotated groups
and text through the same frame, the backplane fixture laid out as its thumbnail shows);
`lbrn-run-order.test.ts` (engrave before cut whatever the drawing order, interleaved shapes run
once per layer, priority over index, the Cut Planner warning); `lbrn-open-machine.test.ts`,
`open-project-command.test.ts`, `shortcuts.test.ts` and `document-import-lightburn-stream.test.ts`
(the open machine is kept, and places the project, through every open route).
