# miniPaint (MIT) source study — implementation lessons (2026-07-21)

Evidence file for the Image Studio Photoshop-parity plan (ADR-242 follow-up). Source: clone of
github.com/viliusle/miniPaint at commit `a79733eb` (v4.14.3, 2026-04-19). License: MIT
(`MIT-LICENSE.txt`, "Copyright (c) ViliusL") — adapting algorithms with attribution is permitted.
**License caveats:** `src/js/libs/zoomView.js` (zoom/pan matrix) and the brush
`render_stabilized()` routine credit Stack Overflow answers (CC BY-SA — reimplement, never port
verbatim); `src/js/libs/imagefilters.js` (arahaya ImageFilters) carries no license header in the
vendored copy — verify upstream before porting anything from it. `glfx.js` and `color-thief.js`
confirm MIT in their headers. npm deps of note: `pica` (Lanczos resize), `hermite-resize`.

## Architecture (cautionary)

Service-locator singletons + one global mutable `config` object (document state, active layer
alias, tool registry `config.TOOLS` whose per-tool `attributes` double as the live options
model). Tools are auto-discovered classes; every tool registers permanent document-level
mouse/touch listeners and self-gates on the active-tool name. Render loop = permanent rAF
checking a `need_render` dirty flag. Menus are a declarative tree (`config-menu.js`) with string
targets (`image/resize.resize`); dialogs come from ONE params-driven generator
(`libs/popup.js`: `{title, params[], preview, on_change, on_finish}` → form + live layer
preview) serving ~40 dialogs.

## The ten patterns worth adapting

1. **Command-pattern undo** (`core/base-state.js` + `actions/*`): `do()/undo()/free()` action
   objects, `Bundle_action` composites, abort-by-throw, and **`merge_with_history`** — re-wraps
   the previous history entry plus the new action into one bundle so multi-event gestures
   (stroke + bbox fixup) collapse to one undo step. History capped at 50 with per-action byte
   estimates and heap-pressure eviction.
2. **IndexedDB offload of undo pixel snapshots** (`actions/store/image-store.js`): before/after
   images stored out of RAM, per-tab session UUID, heartbeat GC of stale DBs, `free()` deletes
   blobs. The cheap fix for raster-undo memory.
3. **Strokes as re-renderable vector data** (`tools/brush.js`, `pencil.js`): stroke = array of
   `[x, y, size]` points on a vector layer re-rendered per frame; bbox normalization at stroke
   end merges into the same undo entry.
4. **Stabilized stroke rendering** (`brush.js render_stabilized`): three passes of neighbor
   midpoint averaging, then a quadraticCurveTo chain (control = raw point, end = midpoint).
   Plus pressure heuristics (initial exactly-0.5 = fake/mouse; exactly-1.0 = lift-off noise) and
   a mouse-speed-modulated size fallback. Reimplement (SO-credited).
5. **Schema-driven tool options** (`gui-tools.show_action_attributes()`): tool declares typed
   attributes (boolean → toggle, number/{value,min,max,step} → spinner, {value,values[]} →
   select, '#rrggbb' → color); the options bar is inferred. Maps directly to a React
   schema→control mapping with an `on_update` callback.
6. **Transform-box engine** (`core/base-selection.js`): 8 Path2D handles hit-tested with
   `isPointInPath`, drag roles as bitflags (TOP|LEFT…), keep-ratio, negative-size flips,
   zoom-compensated line widths, rotate handle, crop thirds grid, edge-aware handle insets. A
   complete reference for our Ctrl+T + crop gizmo.
7. **Snapping engine** (`base-tools.js get_snap_positions/calc_snap_position`): candidates from
   canvas edges/centers + guides + other layers' bounds/centers, zoom-scaled threshold,
   modifier suppression, snap-line overlay.
8. **Flood-fill mask pattern** (`tools/fill.js fill_general`, ~lines 135–228; duplicated in
   `magic_erase.js`): visited-mask stored in a temp ImageData's alpha channel, explicit-stack
   4-neighbor fill, per-channel box tolerance, build mask → composite once
   (`destination-out` to erase); "anti-alias" is just a 1 px blur of the mask. Port the
   structure; upgrade with scanline spans (ours already does), better tolerance metrics, real
   coverage AA. Note its `contiguous` param is named backwards.
9. **Live-edit temp-canvas commit** (erase/blur/sharpen/clone tools): copy layer to a temp
   canvas on mousedown, render the temp during the drag, commit exactly one image-update action
   on mouseup. Also: soft eraser = radial-gradient alpha falloff; fast-mouse gaps filled by a
   round-cap line between events. **Brush cursor = a positioned DOM div** sized
   `size × zoom` with a circle/rect CSS class — no canvas redraw per mouse move.
10. **CSS-filter non-destructive layer filters** (`effects/abstract/css.js`): per-layer filter
    stack rendered by setting `ctx.filter` strings (brightness/contrast/blur/etc.) — free
    GPU-backed live adjustments. Resize module (`modules/image/resize.js`) splits
    **Lanczos (pica) / Hermite (downscale) / drawImage** — the exact menu our Image Size dialog
    needs.

## Layers model (reference)

Layer = plain object (id, type, x/y/w/h + originals, visible, opacity 0-100, `composition`
blend mode, rotate, data/params for vector types, filters[]). Image layers hold pixels as an
HTMLImageElement with a PNG data URL (slow — do not copy); vector layers re-render via
`render_function`. Compositing = one back-to-front pass setting `globalAlpha` +
`globalCompositeOperation` — all blending native Canvas2D (the standard mode list matches
Photoshop's minus a few). Clip-mask via isolated `source-atop` pairs on a temp canvas. Merge =
render pair to temp canvas → new image layer inside one bundle action.

## Feature checklist (coverage race)

Tools: object select/transform, rect marquee only, brush (pressure), pencil, picker, eraser
(soft/strict, circle/square), magic eraser (tolerance/AA/contiguous), fill, 22-shape tool,
media search, rich text (2.7k lines), gradient (linear/radial), clone stamp, crop, local
blur/sharpen/desaturate brushes, bulge/pinch (WebGL), animation/GIF. Menus: full
file/edit/image/layer/effects suites incl. Lanczos resize, histogram dialog, ~35 effects,
color-to-alpha, replace color, guides/rulers/snapping, command palette (F3 fuzzy search).

**Absent from miniPaint (we can beat it):** marching ants, non-rect selections, selection
add/subtract, per-pixel masks, layer masks/groups, levels, curves, adjustment layers,
dodge/burn, healing, perspective/warp.

## Five things NOT to copy

Global mutable `config` + window singletons; all-tools-always-listening document events;
PNG-data-URL layer pixel format; permanent rAF polling loop; jQuery/innerHTML widgets +
copy-paste algorithm duplication.
