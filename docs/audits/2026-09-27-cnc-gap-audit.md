# CNC gap audit: KerfDesk against VCarve, Carbide Create, Easel and Fusion (2026-09-27)

**Status:** audit only. Nothing is built yet; Johann picks the batches.
**Checked:** `main` at `8e037c2f` (27 Sep 2026). Scope is everyday 2D/2.5D router work: profiles,
pockets, V-carving, tabs, drilling, bits, feeds, job setup and output. 3D relief is covered by the
3D carving thread's own comparison (https://claude.ai/artifact/TMY34Xq88ncqKLxZeqjzYm), CNC pause
and resume by the pause audit thread, and the 3D viewer by the viewer thread.

## Verdict

KerfDesk already covers the everyday set: outside/inside/on-path profiles with leads, climb or
conventional, finish allowance, tabs you can drag, offset/raster/adaptive pockets, rest machining
with a bigger roughing bit, helical entry, V-carving with a floor-clearing bit, straight inlays,
drilling, tiling with registration holes, probing, a removal preview and a time estimate that knows
acceleration. Several of those are paid extras elsewhere (rest machining and tiling are Carbide
Create Pro and Easel Pro features, and VCarve has no adaptive clearing *(known)*).

Where it falls behind is in three places:

1. **How the bit moves between cuts.** Every pocket ring, every raster row and every depth pass
   lifts to safe Z and plunges back down from 3.8 mm above the stock at plunge speed. On the sample
   jobs below that is 10 to 30% of the whole run time. VCarve, Fusion, Carbide Create and Easel all
   keep the bit down inside a pocket.
2. **A few things built worse than the others:** adaptive clearing refuses every rectangle I tried,
   drilling ignores the hole size and pecks at plunge speed through air, and automatic tabs sit on
   corners.
3. **Missing features hobby users reach for often:** V-carve inlays, a start depth (carving inside
   an earlier pocket), a chamfer toolpath, a proper bit library you can edit, import and export, and
   a tool-length setter so a bit change doesn't need a re-zero on the stock.

## How this was checked

- KerfDesk: two independent read-throughs of what a user can actually reach (a control, menu or
  panel field, not core code alone), then real G-code. I compiled sample jobs through the same
  `compileCncJob` and `cncGrblStrategy` path the app uses and read the output line by line. Time
  shares use a feed-limited estimate with assumed 3000 mm/min XY and 1000 mm/min Z rapids; they
  compare motion types and are not a replacement for the app's own estimate.
- Others: pages read today are linked. Rows marked *(known)* come from product behaviour I know
  but did not re-read today; treat them as weaker until checked. Vectric's help pages refuse
  automated reads, so VCarve rows lean on its official "What's new" page.
  - Vectric VCarve "What's new": https://www.vectric.com/upgrade/vcarve/
  - Fusion 2D Contour reference: https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-2D-CONTOUR-CMD
  - Easel plans and features: https://easel.com/pages/easel-pro-feature-detail
  - Easel V-Carve Inlays: https://support.easel.com/hc/en-us/articles/53711982141075-V-Carve-Inlays
  - Carbide Create Pro: https://carbide3d.com/carbidecreate/pro/
  - Carbide Create toolpaths overview: https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/toolpath-basics
- Sizes: **S** a day or less with tests, **M** a few days, **L** a new subsystem.

## Built wrong or worse than the others (checked in the G-code)

### CW-01: Pockets lift and re-plunge for every ring and every raster row

**What happens.** An offset pocket cuts one ring, lifts to safe Z (3.81 mm), rapids 1.27 mm over,
and plunges straight down at plunge feed for the next ring. Raster rows do the same for every row.
Code: `src/core/output/cnc-grbl-strategy.ts` `appendContourPass` retracts whenever a pass starts at
a new XY; `src/core/cnc/pocket-paths.ts` emits each ring and row as its own pass.

| Sample job (1/4" bit unless noted) | Lifts and plunges | Share of run time |
|---|---|---|
| 150 × 100 mm pocket, 6 mm deep, offset | 57 | 10% |
| same pocket, raster | 114 | 18% |
| 40 × 30 mm pocket, 6 mm deep, 1/8" bit, offset | 33 | 30% |

Each of those plunges is also a straight plunge into partly uncut wood, which is harder on the bit
than a stepover at depth.

**The others.** Fusion: Linking tab "Keep Tool Down" and "Maximum Stay-Down Distance" (Fusion
reference above). VCarve 12.5: "Optimized Pocketing for Fewer Retracts"; VCarve 10.5: "Stopped
Repeated Retracts/Plunges in Profile Toolpaths" (Vectric page above). Carbide Create and Easel
pockets step over at depth *(known)*.

**Better than them.** Stay down when the link move stays inside stock that is already cleared, and
lift only when it would cross uncut stock or an island. KerfDesk already has a removal grid and the
adaptive verifier, so it can *prove* each stay-down link is clear before emitting it, which none of
the hobby tools do. Raster rows become a zig-zag along the wall. Size **M**.

### CW-02: Every plunge starts from safe Z at plunge speed, and "Retract between passes" does nothing with leads on

**What happens.** A 12 mm outside profile at 3 mm per pass plunges from Z 3.81 to −3, −6, −9, −10
and −12, each time from the top at 300 mm/min: 59 mm of plunging per part, 43 mm of it through air
already cut. With leads on (the default), the lead-out ends somewhere other than the next lead-in,
so every depth pass lifts regardless of the checkbox. Turning "Retract between passes" off gave
byte-identical G-code for a sheet of 12 parts.

| Sample job | Lifts and plunges | Share of run time |
|---|---|---|
| 12 parts, 40 × 40 mm, outside profile through 12 mm, 1/8" bit | 108 plunges | 23% |

**The others.** Fusion Heights tab: separate Clearance, Retract and **Feed height** (rapid down to
just above the cut, then feed), and "Leads on all Finishing Passes" as an option (Fusion reference
above). VCarve: a plunge gap above the material before feeding *(known)*.

**Better than them.** Rapid down to 1 mm above the last cut floor, then feed. Give the rough passes
a short ramp down inside the slot instead of a lead, and keep the lead for the last pass where it
matters for the wall. On the 12-part sheet, the feed-height change alone saves about 11% (1.7 min
of 14.9), before any stay-down linking. Make the checkbox honest: either it works with leads, or the
panel says leads force a lift. Size **S** for feed height, **M** with the linking.

### CW-03: Adaptive clearing refuses every rectangle I tried

**What happens.** A 150 × 100, 60 × 40 and 30 × 20 mm pocket with the 1/8" and 1/4" bits all failed
with "Adaptive verification simulated radial engagement above the configured limit", and the pocket
was left out of the job. Only a 40 mm radius circle compiled. This is AC-2 from the 24 Sep CNC audit,
still open. Code: `src/core/cnc/adaptive-pocket*.ts`.

**The others.** Fusion 2D Adaptive handles corners with trochoidal loops *(known)*; Estlcam
trochoidal pockets *(known)*. Standard Carbide Create has no adaptive (toolpaths overview above)
and VCarve has none either *(known)*, so this is where KerfDesk can lead once it works.

**Better than them.** Keep the verifier (it is the reason KerfDesk's adaptive is trustworthy), and
teach the planner to take corners with small loops or a slower corner feed so rectangles pass it.
Size **M-L**.

### CW-04: Drilling ignores the hole size and pecks through air at plunge speed

**What happens.** Every closed shape becomes one hole at its bounding-box centre
(`src/core/cnc/drill-peck.ts`). A 1 mm, 3 mm and 8 mm circle all got the same 3.175 mm peck with the
1/8" bit: the 1 mm hole comes out three times too big, the 8 mm hole is a small hole in the middle.
Each peck feeds back up to Z0 and back down from Z0 at 300 mm/min. A 10 mm hole at 3 mm pecks feeds
46 mm (9 s); a G83-style cycle (rapid out, rapid back to 0.5 mm above the last floor, then feed)
feeds about 12 mm (2.5 s). AC-8 from the 24 Sep audit, still open.

**The others.** Fusion: Drill with chip-breaking and deep-drilling cycles, plus Bore and Circular
for holes larger than the bit *(known)*. VCarve and Carbide Create: drilling with peck and retract
gap (Carbide Create page above; VCarve *(known)*). Estlcam: helical hole milling *(known)*.

**Better than them.** Drill only circles, and choose per hole: a plain peck when the hole matches
the bit, a helical bore when it is bigger (KerfDesk already emits verified G2/G3 helices for
helical entry), and a Job Review warning when it is smaller. Rapid the peck retracts. Size **S-M**.

### CW-05: Automatic tabs land on corners

**What happens.** Tabs are spaced evenly from the entry point with no regard for corners
(`src/core/geometry/tabs-bridges.ts` `automaticTabAnchorPoints`). On a 60 × 40 mm part all four tabs
ended within 0.4 mm of a corner and none sat on the short edges. Corner tabs are the hardest to
sand off. TP-5 from the 24 Sep audit, still open.

**The others.** VCarve 10.5: "Toolpath Tab Auto Placement - Avoid corners/curves automatically"
(Vectric page above).

**Better than them.** Place tabs on straight runs, away from corners and tight curves, spread by
length rather than by count, and warn when a small part cannot fit them. Size **S**.

### CW-06: Circles and arcs are cut as many short lines

**What happens.** Artwork curves are flattened to G1 lines for every CNC contour. KerfDesk already has
arc fitting for laser output (`src/core/geometry/arc-fit/`, `src/core/output/grbl-laser-arc-moves.ts`)
but the CNC emitter does not use it; only helical entry, adaptive and tile registration holes emit
G2/G3. Files are larger and GRBL's planner sees many tiny segments on round parts.

**The others.** VCarve, Carbide Create and Fusion posts all output G2/G3 *(known)*; Fusion also has
"Smoothing" on 2D Contour (Fusion reference above).

**Better than them.** Reuse the laser arc fitter on CNC contours, with the same tolerance checks.
The 3D carving thread has arc fitting on its list for relief; share one fitter. Size **M**.

### CW-07: The job ends only 3.8 mm above the stock

**What happens.** The program ends with `G0 Z3.810`, `M5`, then a rapid to the park XY at that
height. The tool-change park does the same. A clamp taller than 3.8 mm in the way gets hit.

**The others.** VCarve has a separate home/start position height *(known)*; Carbide Motion and
Fusion's GRBL post lift high in machine coordinates at the end *(known)*.

**Better than them.** Lift to a park height (or machine Z top on a homed machine) before the park and
tool-change moves. Size **S**.

## Gaps: what the others have that KerfDesk doesn't

Value is for a hobby router like the 4040: **High** means people ask for it all the time.

### Toolpaths

| ID | Gap | Who has it | KerfDesk today | Better-than-them angle | Size | Value |
|---|---|---|---|---|---|---|
| CNG-T01 | **V-carve inlays** (pocket and plug from one design, V-bit, glue gap) | Easel Pro, VCarve Pro (Inlay toolpath, V12), Carbide Create *(known)* | Straight (end-mill) inlays only | Show the plug seated in the pocket in the 3D preview before cutting, and compute plug depth and glue gap from the bit; Easel says its generated parts cannot be changed | L | High |
| CNG-T02 | **Start depth** (a cut that begins below the surface, e.g. V-carve text on a pocket floor, stepped pockets) | VCarve, Fusion ("Top Height"), Carbide Create *(known)* | Every cut starts at the stock top; carving inside an earlier pocket is not possible | Detect when a shape sits inside a deeper pocket and offer the start depth | S-M | High |
| CNG-T03 | **Chamfer / edge-break toolpath** with a V-bit along edges | VCarve (Chamfer toolpath, 10.5 and 11), Fusion (2D Chamfer, and a Chamfer option on 2D Contour) | A V-bit On-path cut at a hand-worked depth; chamfer bits are listed as reference only | Enter the chamfer width, KerfDesk works out depth and offset from the bit | S-M | High |
| CNG-T04 | Hole milling (helical bore) for holes bigger than the bit | Fusion (Bore, Circular), Estlcam *(known)* | None as an operation (tile registration uses one internally) | See CW-04 | S-M | High |
| CNG-T05 | Pocket allowance, spring pass, several finishing passes | Fusion (Stock to Leave, Multiple Finishing Passes, Repeat Finishing Pass) | Allowance on Outside/Inside profiles only; pocket walls get one ring | Same "Wall finish" section for pockets | S | Medium |
| CNG-T06 | Choose the start point per shape | VCarve, Fusion *(known)* | Always the middle of the longest edge; the node tool's start point is ignored for CNC | Honour the drawn start point; default stays smart | S | Medium |
| CNG-T07 | Tabs: triangular (ramped), add or delete single tabs, tabs by distance, skip holes | VCarve (3D tabs *(known)*), Fusion (tab Shape, "By distance") | Rectangular only; drag but not add or delete; count per operation; tabs on holes too | See CW-05 | S-M | Medium |
| CNG-T08 | Ramp types: zig-zag and spiral for profiles; ramp and lead together | VCarve ramps *(known)*, Fusion Linking ramp | One straight ramp, and it switches leads off | Short zig-zag ramp in the slot, lead on the final pass | S | Medium |
| CNG-T09 | Raster pocket at any angle | VCarve *(known)* | X or Y only | Also pick the angle that gives the fewest rows | S | Low |
| CNG-T10 | Fluting toolpath (ramped start and end) | VCarve *(known)* | None | | S-M | Low |
| CNG-T11 | Texture toolpath | VCarve *(known)*, Carbide Create *(known)* | None | | M | Low |
| CNG-T12 | Prism carving | VCarve *(known)* | None | | M | Low |
| CNG-T13 | Thread milling | VCarve (10.5), Fusion *(known)* | None; thread mills reference only | | M | Low on a wood router |
| CNG-T14 | Dogbones: T-bones, per-corner choice, as a toolpath option instead of editing the shape | VCarve fillet tool *(known)*, Fusion add-ins *(known)* | "Relieve corners" edits the shape, outer boundary corners only, hole rings left alone (`src/core/geometry/dogbone.ts`) | Offer it per operation on Inside/Pocket cuts, keep artwork untouched | S-M | Medium |

### Bits and feeds

| ID | Gap | Who has it | KerfDesk today | Better-than-them angle | Size | Value |
|---|---|---|---|---|---|---|
| CNG-F01 | **Edit a bit after adding it** (diameter, angle, name), plus tool number, flute length, shank and stick-out | All four | Only the flute count can be changed, or the bit deleted (`src/ui/machine/CncLibraryPanels.tsx`); no tool number, flute length or stick-out in the model | Flute length feeds a "pass deeper than the flutes" warning (JR-5 from 24 Sep) | S | High |
| CNG-F02 | **Import and export the bit library** (Vectric .vtdb, Fusion tool library JSON, CSV, vendor libraries) | VCarve (Tool Database, remote database), Fusion (vendor libraries) *(known)* | Browser storage plus a copy in each project; no import or export | One library shared by all projects with feeds per machine and material | M | High |
| CNG-F03 | **Tool-length setter** (measure each bit on a fixed sensor; no re-zero on the stock after a change) | Carbide Motion BitSetter, gSender and UGS tool-length probe *(known)* | Every bit change re-zeros on the stock top, which may already be cut away | Measure once per bit, keep Z zero through the whole job, check the new bit's length against the old | M | High for multi-bit jobs |
| CNG-F04 | Chip thinning and machine rigidity in the feeds | Fusion (feed per tooth with compensation) *(known)* | Chip-load table only (FS-6 from 24 Sep) | | S-M | Medium |
| CNG-F05 | More materials (HDPE, PVC foam, polycarbonate, brass) and your own materials | Easel and Carbide Create material lists *(known)* | 16 woods, MDF/plywood, acrylic, aluminium | | S | Medium |

### Job setup and output

| ID | Gap | Who has it | KerfDesk today | Better-than-them angle | Size | Value |
|---|---|---|---|---|---|---|
| CNG-J01 | Z zero on the machine bed (spoilboard) | VCarve, Carbide Create, Fusion *(known)* | Stock top only | Probe the stock thickness at the start and warn when it differs from the job | M | Medium |
| CNG-J02 | Two-sided (flip) jobs with dowel pins | VCarve two-sided, Fusion setups *(known)* | None | Pin holes placed and cut automatically, flip axis shown on the canvas | M-L | Medium |
| CNG-J03 | Nest on the stock sheet, part-in-part, grain direction | VCarve Pro nesting (filler parts, part-in-part) | Quick Nest, but the CNC stock is not offered as the sheet; no part-in-part | Stock as the default sheet is S; true part-in-part is L | S-L | Medium |
| CNG-J04 | Separate retract and feed heights, per operation | Fusion Heights tab | One safe Z for the machine | Pairs with CW-02 | S | Medium |
| CNG-J05 | Printable setup sheet (bits in order, zero, stock, time) | VCarve toolpath summary, Fusion setup sheet *(known)* | Job Review on screen only | | S | Low |
| CNG-J06 | Rotary (4th axis) for the router | VCarve wrapped rotary *(known)* | Laser only | | L | Low unless the 4040 has one |
| CNG-J07 | Centre and bore probing | gSender, UGS *(known)* | Z and XYZ corner only | The laser side's 4-point Center Finder can be reused | S-M | Low-Medium |

## Needs your decision (a recorded rule or a deliberate difference)

These exist elsewhere but a project rule or an earlier choice stands in the way. I would not build
them without your word.

- **Post-processors, T/M6 tool numbers and one file per bit.** KerfDesk writes one GRBL dialect with
  an M0 pause per bit. VCarve and Fusion ship hundreds of posts. Only matters for non-GRBL
  controllers or grblHAL tool changers.
- **Inch entry.** Everything is millimetres; US tools accept both. Left alone on the laser side too.
- **Custom start and end G-code** (dust collector or vacuum relays beyond M7/M8). Hard-coded on
  purpose, same as the laser side.
- **Running the surfacing program, or any outside G-code, from the app.** Surfacing only saves a
  file today; Easel, Carbide Motion and gSender run it directly. The project rule is that only
  reviewed KerfDesk jobs run.
- **G55 to G59 work offsets.** The program always selects G54, by design.

## Already at parity or ahead

Not repeated above. Ahead of the hobby tools: Job Review before every Start, frame-first, pass
recovery after an interruption, Pause and lift, adaptive clearing with a removal verifier (VCarve
and Carbide Create have none), rest machining and tiling without a paid tier, helical entry with
fit checks, V-carving that checks the bit tip can reach, a floor-clearing bit for V-carves, straight
inlay pairs with fit clearance, no-go zones for clamps, stage cutting values, process recipes that
carry a whole operation sequence to another job, the G-code Inspector, and an acceleration-aware time
estimate (VCarve only added that in 12.5).

## Suggested build order

1. **Motion batch** (built wrong, biggest time win): CW-01 stay-down linking, CW-02 feed height and
   honest retract, CW-07 park height, CNG-J04 heights. Every job gets faster; no new UI to learn.
2. **Holes and tabs:** CW-04 drilling and CNG-T04 helical bore, CW-05 tab placement, CNG-T07 tab
   options.
3. **Adaptive fix:** CW-03, so adaptive works on rectangles.
4. **Everyday toolpaths:** CNG-T02 start depth, CNG-T03 chamfer, CNG-T05 pocket finish, CNG-T06
   start point, CNG-T08 ramps.
5. **Bits:** CNG-F01 edit bits, CNG-F02 import/export, CNG-F03 tool-length setter.
6. **V-carve inlays:** CNG-T01 (large, on its own).
7. **Setup:** CW-06 arcs, CNG-J01 bed zero, CNG-J02 two-sided, CNG-J03 nest on stock.

Anything that changes emitted motion (batches 1 to 3) needs an air cut on the 4040 before it is
called done; green CI is not enough (the 27 Sep gouge showed that).
