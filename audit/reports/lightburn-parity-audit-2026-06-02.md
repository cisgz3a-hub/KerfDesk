# LightBurn Parity Audit Matrix - 2026-06-02

Status: audit-only. No production code was changed for this pass.

## Scope

This pass cross-references LaserForge 2.0 operator-facing behavior against LightBurn documentation where the repo says LightBurn is the behavioral reference. It is not a full feature-breadth demand: `PROJECT.md` says LaserForge deliberately copies LightBurn's workflow shape, not all of LightBurn's features.

Repository verified:

- Worktree: `C:\Users\Asus\LaserForge-2.0`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`
- Branch: `codex/main-working`

Local contract used:

- `CLAUDE.md`: LightBurn is the reference for behavior, UX, defaults, layer/cut semantics, modes, and G-code decisions unless the maintainer says otherwise.
- `PROJECT.md`: LightBurn-style core loop; feature breadth intentionally narrower.
- `WORKFLOW.md`: current shipped flows for SVG import, layers, preview, G-code, serial control, Fill, Image, Set Origin, Convert to Bitmap.
- `DECISIONS.md`: ADRs for Fill, Image, Trace source retention, Convert to Bitmap, Set Origin, origin-aware preflight, fill overscan, and bidirectional raster rows.
- `AUDIT.md`: prior repo audit baseline.

LightBurn docs used:

- Line Mode: `https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/`
- Fill Mode: `https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/`
- Image Mode: `https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/`
- Trace Image: `https://docs.lightburnsoftware.com/latest/Reference/TraceImage/`
- Coordinates and Job Origin: `https://docs.lightburnsoftware.com/2.1/Reference/CoordinatesOrigin/`
- Job Control: `https://docs.lightburnsoftware.com/2.0/GetStarted/JobControl/`
- Framing: `https://docs.lightburnsoftware.com/latest/GetStarted/FramingBeginner/`
- Convert to Bitmap: `https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/`

## Verdict Summary

LaserForge matches the LightBurn core loop in the broad operator shape: import artwork, assign color layers, select Line/Fill/Image modes, preview/frame/start, stream GRBL, and use Start/Pause/Stop controls.

The strongest parity risk found in this pass is new:

- **LBP-001:** Fill hatching is not layer-wide for separate same-color objects. LightBurn's same-layer fill interaction treats overlapping or nested same-layer shapes as one fill field; LaserForge currently hatches each vector object/path group separately, so same-layer overlaps from separate objects can double-burn.

Other mismatches are already covered by existing findings or explicitly documented scope gaps:

- Existing findings: KF-001, KF-014, KF-017, KF-018, KF-019, KF-023, KF-024, KF-025, KF-035, KF-036, KF-037.
- Planned/accepted gaps: Offset Fill, sub-layers, many Image modes, Trace dialog control realignment, Convert to Bitmap render type picker, Rubber Band frame.

## Parity Matrix

| Area | LightBurn behavior | LaserForge behavior | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| Layer modes | LightBurn exposes Line, Fill, Offset Fill, Image, plus additional options like sub-layers. | `LayerMode = 'line' | 'fill' | 'image'`; no Offset Fill or sub-layers. | Intentional scope gap | `src/core/scene/layer.ts:7`, `PROJECT.md:95-100`; LightBurn Fill page lists Offset Fill, Image, Sub-Layers in additional options. No bug unless product scope expands. |
| Line mode core | Line mode traces around vector contours; power/speed distinguish marking vs cutting. | Line layers compile vector polylines to `cut` groups; G-code rapids carry `S0`, first burn move carries feed and power. | Match for core behavior | `src/core/job/compile-job.ts:197-203`, `src/core/output/grbl-strategy.ts:31-60`; LightBurn Line Mode docs describe contour tracing. |
| Line advanced options | LightBurn supports kerf offset, perforation, tabs/bridges, lead-in/out, overcut, Z settings, PPI, etc. | LaserForge line mode has speed/power/passes only. | Intentional scope gap | `src/core/scene/layer.ts:19-24`; no action unless these features become required. |
| Color/layer assignment | LightBurn maps artwork colors to layers/cut settings. | SVG import groups by stroke color and layer auto-creation is per unique color. | Match with caveats | `WORKFLOW.md:80`, `src/io/svg/parse-svg.ts:155-161`, `src/ui/state/scene-mutations.ts:120-136`. Caveats are SVG presentation gaps KF-017/KF-036. |
| Layer visibility vs output | LightBurn distinguishes display visibility from whether a layer outputs. | LaserForge has separate `visible` and `output`; compile skips `output=false`. | Match | `src/core/scene/layer.ts:23-24`, `src/core/job/compile-job.ts:35-36`, `WORKFLOW.md:239-246`. |
| Fill closed-shape requirement | LightBurn Fill works only on closed shapes. | `fillHatching` emits nothing for open polylines; compile drops empty fill groups. | Match | `src/core/job/fill-hatching.test.ts:132-155`, `src/core/job/compile-job.test.ts:204-222`; LightBurn Fill Mode docs state closed shapes only. |
| Fill line interval | LightBurn line interval controls physical distance between scan lines. | LaserForge exposes `hatchSpacingMm`, but hatches before applying object scale, so physical spacing scales with object transform. | Mismatch, existing finding | KF-035; `src/core/job/compile-job.ts:230-243`, `src/core/scene/transform.ts:11-12`; fix by hatching in transformed scene space or compensating by effective normal-direction scale. |
| Fill same-layer interaction | LightBurn same-layer nested/overlapping fill shapes interact as one field: holes/overlaps are not double-engraved; different layers double-engrave. | LaserForge hatches each object's matching `ColoredPath` separately. Same-color shapes inside one imported SVG path can interact, but separate same-layer objects do not. | Mismatch, new finding | LBP-001; `src/core/job/compile-job.ts:183-203` loops objects; `src/core/job/compile-job.ts:230-243` runs hatching per `path`. Fix with layer-wide fill aggregation in transformed scene space. |
| Fill grouping order | LightBurn default is "Fill All Shapes at Once"; other grouping modes exist. | LaserForge has no grouping control and effectively fills per object/path group. | Partial / covered by LBP-001 | The missing control is a scope gap; the default behavior mismatch is LBP-001. |
| Fill bidirectional | LightBurn has a Bi-directional Fill toggle. | `fillHatching` alternates row direction by scan index; no toggle. | Partial | `src/core/job/fill-hatching.ts:227`; acceptable for current scope but no unidirectional option. |
| Fill cross-hatch | LightBurn can run a second pass 90 degrees rotated. | LaserForge has no cross-hatch option. | Intentional scope gap | `src/core/scene/layer.ts:25-31`; no action unless requested. |
| Fill overscan | LightBurn uses laser-off extra travel before/after scan lines; insufficient overscan causes burned edges and can create out-of-bounds errors. | Fill groups carry overscan; output expands each hatch to `S0` lead-in/out and preflight checks emitted G-code including overscan. | Match for current GRBL lane | `src/core/output/grbl-strategy.ts:88-98`, `src/core/job/fill-overscan.ts:12-30`, `src/core/preflight/preflight.ts`; still M3 for Fill by ADR-031, not LightBurn's full M4 default. |
| Image import as bitmap | LightBurn works with imported images as bitmap objects and Image Mode engraves pixels. | Toolbar imports PNG/JPG as `raster-image` on image-mode layer; trace is a separate selected-image tool. | Match | `src/ui/common/Toolbar.tsx:227-277`, `src/ui/state/scene-mutations.ts:229-235`, `WORKFLOW.md:718-753`. |
| Image mode scan controls | LightBurn Image Mode has bi-directional scanning, negative image, overscan, line interval/DPI, dot correction, scan angle, pass-through, many dither modes, etc. | LaserForge supports threshold/Floyd-Steinberg/grayscale, lines/mm, power/speed/passes, overscan, M4 dynamic power, serpentine rows. | Partial | `src/core/scene/layer.ts:32-37`, `src/core/raster/emit-raster.ts:5-23`, `src/ui/layers/LayerRow.tsx:266-297`. Missing options are scope gaps unless requested. |
| Image overscan | LightBurn Image overscan is laser-off runway and can cause out-of-bounds if there is not enough space. | Raster rows rapid to overscan zone with `S0`, burn active span, exit with `S0`; preflight includes emitted overscan. | Match | `src/core/raster/emit-raster.ts:74-121`, `src/core/raster/emit-raster.ts:168-184`, tests in `src/core/raster/emit-raster.test.ts:99-153`. |
| Image line interval/DPI | LightBurn presents line interval and DPI as equivalent density controls. | LaserForge exposes lines/mm and derives pixel extents from physical bounds. | Partial match | `src/core/job/compile-job.ts:89-90`, `src/ui/layers/LayerRow.tsx:266-297`; no DPI label or dot-width correction. |
| Trace entry point | LightBurn Trace Image runs on a selected imported image. | Toolbar Trace button is disabled until a `raster-image` is selected. | Match | `src/ui/common/Toolbar.tsx:155-180`; LightBurn Trace docs say select an image then open Trace Image. |
| Trace preview | LightBurn Trace preview updates vectors as settings change and offers fade/boundary/show-points. | LaserForge has live trace preview but lacks Fade Image, Boundary, Show Points; stale async result risk exists. | Partial, existing finding | KF-014 plus ADR-030 staged backlog; `src/ui/trace/use-trace-preview.ts`, `DECISIONS.md:1221-1231`. |
| Trace controls | LightBurn uses Cutoff/Threshold, Ignore Less Than, Optimize, Smoothness, Trace Transparency, Sketch Trace, Delete Image After Trace. | LaserForge has presets, number of colors, brightness/contrast/gamma/invert, threshold band work in core, but not full LightBurn UI vocabulary. | Planned mismatch | `PROJECT.md:118-122`, `DECISIONS.md:1195-1231`; ADR-030 already owns this. |
| Trace source retention | LightBurn keeps the original image unless Delete Image After Trace is enabled. | LaserForge keeps the source raster as `trace-source`; no delete-after toggle. | Match default / missing option | `src/ui/state/scene-mutations.ts:273-309`; missing toggle is ADR-030 backlog. |
| Trace vector output shape | LightBurn trace creates editable vector graphics; fine detail may not convert well. | LaserForge creates `TracedImage` vectors; known outline-vs-centerline gap remains for pen strokes. | Partial | `PROJECT.md:91`, `DECISIONS.md:986-1059`; existing KF-023 concerns provenance comments, not this behavior itself. |
| SVG presentation import | LightBurn generally imports artwork as rendered/visible artwork. | LaserForge ignores SVG transforms, inherited/style stroke, hidden/transparent presentation state. | Mismatch, existing findings | KF-017 and KF-036; `src/io/svg/parse-svg.ts:117-129`, `src/io/svg/shape-to-polylines.ts:16-31`. |
| Fill-only SVG geometry | LightBurn can handle filled vector artwork according to layer mode. | LaserForge currently imports only stroked geometry; fill-only geometry becomes black stroke geometry or is skipped depending on path. | Mismatch, existing finding | KF-016; `src/io/svg/parse-svg.ts:82-90`, `src/io/svg/parse-svg.ts:129`. |
| Coordinates / Start From | LightBurn supports Absolute Coordinates, Current Position, User Origin, plus 9-dot Job Origin. | LaserForge has absolute default and Set Origin here via G92; active custom origin uses lower-left/front-left placement; no full dropdown or 9-dot selector. | Partial | `src/core/job/job-origin.ts:6-31`, `src/ui/laser/JobControls.tsx:44-92`, `src/ui/laser/start-job-readiness.ts:80-105`; full selector remains future scope. |
| User Origin safety | LightBurn tells users to set a User Origin, then output relative to it; overscan can be out-of-bounds near edges. | LaserForge blocks custom-origin Start/Frame when WCO is unknown and checks physical bounds with WCO when known. | Match after current fix | `src/ui/laser/start-job-readiness.ts:80-105`, `src/ui/laser/start-job-readiness.test.ts:252-306`, `src/ui/laser/JobControls.tsx:231-260`. |
| Frame | LightBurn has bounding-box and rubber-band framing; frame location follows Start From / Job Origin. | LaserForge Frame traces adjusted job bounds only; no rubber-band/hull option. | Partial, conservative | `src/core/job/job-bounds.ts:59-61`, `src/ui/laser/JobControls.tsx:228-260`; bounding-box frame is safe but less precise than LightBurn. |
| Start | LightBurn Start sends the project and may warn for risky settings/positioning; safety docs warn never run unattended. | LaserForge Start runs project/device/machine readiness, warning and blocker paths, then emits/streams G-code. | Match for core GRBL lane | `src/ui/laser/LaserWindow.tsx:27-54`, `src/ui/laser/start-job-readiness.ts:40-68`; remaining disconnect safety is KF-001/KF-033. |
| Pause / Resume | LightBurn Pause temporarily halts and can resume. | LaserForge Pause writes `!`, Resume writes `~`; streamer status switches paused/resumed. | Match with GRBL caveat | `src/ui/laser/JobControls.tsx:189-207`, `src/core/controllers/grbl/streamer.ts:157-166`. Feed hold does not prove laser-off; Stop path matters. |
| Stop / physical emergency | LightBurn warns Stop must not be the only stop method. | LaserForge has Stop, but explicit Disconnect and cable-yank risks remain open in KF-001/KF-033. | Mismatch / safety finding already open | `src/ui/state/laser-store.ts:303-313`, prior audit KF-001/KF-033. |
| Convert to Bitmap | LightBurn converts selected vector graphics to bitmap, has Render Type options, DPI, preview, 50% gray pixels, and deletes the source vector. | LaserForge has Convert to Bitmap Fill All only, no dialog/preview/DPI picker yet; it replaces the selected vector with a `RasterImage`. | Partial, staged | `src/ui/common/Toolbar.tsx:185-222`, `src/ui/raster/vector-to-bitmap.ts:1-84`, `src/core/raster/rasterize-vector.ts:1-57`, `DECISIONS.md:1145-1189`. |
| Preview vs output | LightBurn preview is a required operator verification step. | LaserForge has preview and raster/fill previews tied to compile paths, but preview/output performance and estimate gaps remain. | Partial, existing findings | KF-018, KF-024, KF-025; `src/ui/workspace/draw-preview.ts`, `src/ui/workspace/draw-raster-preview.ts`, `src/core/job/estimate-duration.ts`. |
| Autosave/recovery | Not a LightBurn parity behavior for laser output, but important operator reliability. | LaserForge autosave is localStorage-only and can silently fail for image-heavy projects. | Not LightBurn parity; existing finding | KF-037. Keep in general audit, not parity-driven. |

## New Parity Finding

### LBP-001 - Fill hatching is per object/path group, not LightBurn layer-wide

- Severity: Medium
- Confidence: High
- File: `src/core/job/compile-job.ts`, `src/core/job/fill-hatching.ts`
- Function/module: `compileJob`, `appendSegmentsFromObject`, `appendPathSegments`, `memoizedFillHatching`
- LightBurn reference: Fill Mode same-layer interaction. Same-layer nested/overlapping shapes are treated together; different layers engrave separately/double.
- Trigger path: Import two separate SVGs or duplicate/import two same-color vector objects, place one inside the other or partially overlap them, set that color layer to Fill, then Preview/Start/Save G-code.
- Failure mode: LaserForge loops per object, then calls `fillHatching(path.polylines, layer)` per matching `ColoredPath`. The hatcher sees only that object's/path group's contours. It does not receive all same-layer polylines in scene space, so it cannot subtract overlap/hole areas across separate same-layer objects.
- Consequence: Same-layer overlaps can be engraved twice, and nested same-layer separate objects can fill the inner object instead of creating the expected unfilled/hole interaction. That changes darkness, runtime, heat, and material result versus LightBurn.
- Concrete fix:
  - Add failing compile/output tests for two separate same-layer objects that overlap and for nested same-layer separate objects.
  - Change Fill compilation to aggregate all vector polylines for the layer after applying object transforms into scene/machine coordinates, then run fill hatching once per layer over the aggregate.
  - Preserve explicit different-layer double-engrave behavior by aggregating only within the same layer.
  - Pair this with the KF-035 fix so hatch spacing is physical after transforms.

## Prioritized Fix / Parity Order

1. LBP-001 plus KF-035 together: move Fill hatching to transformed, layer-wide geometry.
2. KF-036 plus KF-017: implement an SVG presentation-state walker for visibility, opacity, style, inheritance, and transforms.
3. KF-001 / KF-033: align Stop/disconnect recovery wording and behavior with LightBurn's honest safety model.
4. ADR-030 Trace controls: move the UI toward Cutoff/Threshold, Ignore Less Than, Optimize, Smoothness, Trace Transparency, Sketch Trace, Delete Image After Trace.
5. Image/Convert gaps by product priority: more image modes, negative/pass-through/dot correction/scan angle, Convert to Bitmap render type + DPI + preview, Rubber Band Frame.
