# KerfDesk vs Easel — 1v1 comparison (2026-07-03)

Maintainer questions this answers: (1) "Did we build the full 3D CNC
software? I only see 2D canvas and no three.js tooling." (2) Easel's
cut-depth slider and full function list. (3) A head-to-head: features +
the start-app-to-job-done journey, Easel vs us.

Sources: Easel support-center articles via search (support.easel.com /
inventables.zendesk.com — the site 403s direct fetch, so bullets marked
[partial] come from article snippets + the earlier market-research
pass), easel.com feature pages, x-carve-instructions.inventables.com.
Our side is code-verified in this worktree at `eafa364`.

## 1. The honest 3D answer

**The main KerfDesk canvas is 2D (Canvas2D), like Easel's LEFT pane.**
three.js IS in the app (ADR-101, lazy-loaded, `src/ui/relief-viewer/`)
but it powers two ON-DEMAND dialogs, not a persistent pane:

| 3D surface | Where it lives | Verified |
|---|---|---|
| Relief 3D viewer | select an imported STL relief → View 3D | real-WebGL pixel-sampled earlier this session |
| Cut 3D preview (any CNC job) | Preview mode → "3D" button in the route controls | dialog reached ready in real WebGL this session |

**What Easel has that we do not: a permanent right-side 3D pane** that
auto-renders an HD preview of the stock + carve result while you design
(complex projects need a "Generate 3D Preview" click). Ours requires
entering Preview and clicking 3D. We also do NOT have 3D *modeling*
(Aspire-class sculpting) — neither does Easel; their "3D carving" [Pro]
is STL import → roughing + detail passes, which we match (H.4/H.5/H.8).

Verdict: we are a 2D-canvas CAM with on-demand 3D visualization —
functionally the same 3D *capabilities* as Easel (STL carving, solid
cut preview), but the ALWAYS-VISIBLE split-view 3D is a real UX gap.
Recommendation (maintainer decision): dock the existing Cut3D scene as
a persistent side pane — the scene module already exists; this is
layout work, not new 3D tooling.

## 2. Easel's cut panel — the depth slider (the detail asked about)

Per-OBJECT "Cut" panel (select any shape):
- **Cut depth slider** 0 → material thickness, with an exact numeric
  field under it; the right-pane 3D view updates live as you drag.
- Dragging to full thickness = through-cut, and Easel **auto-adds tabs**
  (drag to move, toggleable).
- Cut type per object: **outline** (on / outside / inside the path) or
  **fill** (pocket / clear-out).
- Depth-per-pass lives separately under Cut Settings → Manual (or auto
  from the material+bit recommendation).

**Ours:** cut depth is a per-LAYER numeric field (mm) on the CNC layer
card, plus cut type (outline on/outside/inside, pocket, engrave,
v-carve, drill), depth-per-pass, tabs (count/size), feeds. Same
capabilities, different granularity + input style:
- per-layer vs per-object (LightBurn-style — our canon default, ADR-005)
- numeric field vs slider
- tabs are opt-in per layer vs auto-on-through
Gap candidates for the maintainer: per-object depth override, a slider
control, auto-tabs on through-cuts.

## 3. Easel function list (grounded; [partial] where the 403 limited us)

**Workspace**: split 2D canvas (left) / 3D preview (right, HD preview
auto or on click); material dimensions drive the canvas; grid/rulers.
**Design**: shapes, text (300+ fonts [Pro]), icon/design library (3M+
[Pro]), node editing [partial], import SVG / DXF (<5 MB) / G-code /
STL [Pro] / image trace; Combine (union); Offsetter, Replicator and
other first-party **Apps** (JS plugin ecosystem); alignment tools.
**Cut panel (per object)**: depth slider (above), outline in/on/out,
fill, tabs, use-as-guide [partial].
**Materials & bits**: material picker with dimensions; bit picker
(sizes/types); **auto feeds/speeds from material×bit** (their signature
convenience); manual override (feed/plunge/DOC); two-stage carve
(roughing + detail bit as sequential runs).
**Simulation**: Simulate = toolpath lines (rapid vs cut) + **time
estimate**; HD 3D material preview.
**Carve flow (green Carve button)**: guided pre-flight — clamp
material → confirm bit → home machine → work zero (jog + paper method
or **Z-probe puck**, XY at lower-left or center) → spindle-on confirm →
Carve; during: progress %, pause/stop, feed adjust [partial]; after:
re-carve/repeat prompts.
**Machine**: Easel Driver (local agent) for serial; 150+ GRBL machine
profiles; jog pad; homing; Machine Inspector (console, $$ settings,
alarms); machine parking [Pro].
**Projects**: cloud save/autosave, sharing/community, templates;
**tiling** [Pro]; raster carving + ramping plunges [Pro].
**Not in Easel**: booleans beyond union (no subtract/intersect via UI,
app workarounds only), dogbones (app), probing beyond Z puck [partial],
feed/spindle overrides mid-job [partial – feedrate listed with
two-stage], start-from-line recovery, spoilboard surfacing wizard,
G2/G3 arc output [partial], climb/conventional choice, offline design
(cloud app), keyboard-first workflow.

## 4. 1v1 feature matrix

| Area | Easel (free/Pro) | KerfDesk CNC | Edge |
|---|---|---|---|
| Workspace | 2D + permanent 3D pane | 2D + on-demand 3D dialogs | **Easel** (always-visible 3D) |
| Depth control | per-object slider, live 3D | per-layer numeric | **Easel** UX, tie capability |
| Cut types | outline in/on/out, fill | same + engrave, **v-carve, drill/peck** | **KerfDesk** |
| V-carve | Pro, basic | true v-carve + flat-bottom + 2-stage clearing | **KerfDesk** |
| STL / 3D carving | Pro (rough+detail) | rough + ball-nose finishing (scallop law) | tie / **KerfDesk** (scallop control) |
| Tabs | auto on through-cuts, draggable | per-layer count/size | **Easel** (auto+drag) |
| Booleans/offset | union + Offsetter app | weld/subtract/intersect/exclude + offset + **dogbone** | **KerfDesk** |
| Feeds/speeds | auto per material×bit | chipload calculator + presets + library | **Easel** convenience, **KerfDesk** transparency |
| Simulation | toolpath + time + HD 3D | toolpath + time + scrubber + removal grid + 3D dialog | tie |
| Sender | Easel Driver, guided carve flow | WebSerial direct, manual flow | **Easel** guidance, **KerfDesk** no-install |
| Probing | Z puck in carve flow | **Z + XYZ-corner** touch plate wizard | **KerfDesk** |
| Mid-job control | pause/stop, feed adjust [partial] | pause/resume/stop + **feed/spindle/rapid overrides** | **KerfDesk** |
| Recovery | re-carve from start | **start-from-line resume** | **KerfDesk** |
| Tiling | Pro | shipped (registration holes) | tie |
| Multi-bit jobs | two-stage carve | per-layer bits, M0 change, park, re-zero guidance | **KerfDesk** |
| Machine profiles | 150+ built-in | user-saved snapshots | **Easel** breadth |
| Import | SVG/DXF/G-code/STL/trace | same set (DXF clean-room, .nc simulator) | tie |
| Text | 300+ fonts [Pro], effects | 4 bundled fonts | **Easel** |
| Apps/ecosystem | JS apps, cloud sharing | none (local-first by design) | **Easel** |
| Offline | no (cloud) | yes (PWA + desktop) | **KerfDesk** |
| Spoilboard surfacing | no | generator shipped | **KerfDesk** |
| Hardware verification | mature product | **all CNC output CLAIMED (no 4040 run yet)** | **Easel** |

## 5. Start-to-finish journey, side by side

| Step | Easel | KerfDesk CNC |
|---|---|---|
| 1. Open | easel.com login (cloud) | open app/URL, no account, offline OK |
| 2. New job | new project; pick MATERIAL first (type + W×H×T) | Machine toggle → CNC; Material & Bit panel: stock W/H/T, origin |
| 3. Bit | pick bit from list → feeds auto-set | pick bit (8 starters + custom library) → feeds via calculator/preset/manual |
| 4. Design | shapes/text/import on 2D canvas; 3D pane shows result live | same tools (plus booleans/offset/dogbone); result seen in Preview |
| 5. Cut settings | select object → depth slider, outline/fill, tabs auto | select layer → cut type, depth, passes, tabs, entry/ramp, direction |
| 6. Check | Simulate: paths + time; HD 3D | Preview: paths, scrubber, removal shading, stats, time, 3D button |
| 7. Connect | Carve → Easel Driver → machine profile | Connect (WebSerial picker) → $$ handshake |
| 8. Zero | guided: clamp → bit confirm → home → jog/paper or Z-probe puck | manual: Home → jog → Set origin here / Zero Z / **Probe panel (Z or XYZ corner)** |
| 9. Run | green Carve; progress %; pause/stop | Start job (preflight gate); progress, pause/resume/stop, **overrides** |
| 10. Hiccup | re-carve from start | **Start from line…** resume |
| 11. Done | repeat prompts | park at 0,0 (or Park X/Y); toast |

Blunt read: Easel's journey is more GUIDED (steps 7–9 are a wizard;
material×bit auto-feeds removes decisions); ours exposes more control
at every step and beats it on recovery/probing/overrides, but the
operator assembles the flow themselves. The two UX adoptions worth
stealing (maintainer decisions, not silently adopted): the persistent
3D pane and a guided "Carve" checklist that chains
home→zero/probe→confirm→start.

## 6. What this comparison does NOT claim

Easel bullets marked [partial] rest on snippets, not full articles (the
support site blocks fetching); no Easel account was driven live. Our
column is code-verified + isolated-preview-verified, but every
output-affecting feature remains hardware-CLAIMED per ADR-094 §3.
