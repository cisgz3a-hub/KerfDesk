# CNC market-gap audit — KerfDesk vs the market leaders (2026-07-03)

Maintainer directive (session goal): "build a full working CNC app with
everything the best CNC app on the market has." This audit grounds that
directive: what the market leaders actually ship, what we already have,
and what is missing — so the build-out is scoped in canon docs (ADR-102)
instead of adopted silently.

Method: the market checklist was web-researched against official
product/doc pages for **Vectric VCarve Pro 12**, **Inventables Easel /
Easel Pro**, **Carbide Create 7/8 + Carbide Motion**, **gSender 1.5/1.6**,
and (secondary) **Kiri:Moto / OpenBuilds CONTROL+CAM**. Our side of the
matrix is code-verified in this worktree (grep/read, plus a live
end-to-end run in the isolated preview at commit `49faf7b`). Tier
definitions: **T1** = table stakes (nearly every leader has it), **T2** =
differentiators (2+ leaders), **T3** = premium/niche (Aspire-tier or
single-app).

## Verdict in one paragraph

After Phase H (H.0–H.10, ADR-100/101) KerfDesk's CAM core is genuinely
competitive: profile in/on/out with tabs, offset pockets, true v-carve
with flat-bottom + two-stage clearing, drill/peck, STL relief
rough+finish, ramp entry + climb/conventional, multi-tool M0 jobs,
tiling, a persistent tool library, and a G-code re-import simulator —
that set matches or beats Easel Pro and free Carbide Create on paper
(hardware-verification still CLAIMED, ADR-094 §3). The losable gaps
cluster in three places: **(1) sender workflows** — no touch-plate
probing, no feed/spindle overrides, no start-from-line; **(2) vector
editing** — no boolean/weld/offset (the deferred "geometry kernel");
**(3) visualization** — no 3D cut preview for ordinary (non-relief)
jobs. Those are exactly the T1/T2 items ADR-102 scopes for immediate
build. The T3 tier (nesting, rotary, two-sided, photo-carve…) is
documented as explicit roadmap, not silently skipped.

## Gap matrix

Status: HAVE = shipped + test-pinned; PARTIAL = a real subset exists;
MISSING = absent. "Ref" names the market anchor.

### A. Design / CAD

| Tier | Feature (market anchor) | Ours | Notes |
|---|---|---|---|
| T1 | Shape tools + polyline/pen (all) | HAVE | rect/ellipse/polygon/star/pen (ADR-051) |
| T1 | Node editing (VCarve/Carbide) | HAVE | Edit-nodes tool |
| T1 | Align/distribute/flip (all) | HAVE | 12 arrange commands |
| T1 | Boolean union/subtract/intersect (VCarve weld, Easel Combine, CC booleans) | PARTIAL→HAVE | Union shipped earlier as `tools.weld` (this audit initially missed it — the grep covered only `arrange.*`); subtract/intersect/exclude added by ADR-102 G1 |
| T1 | Vector offset in/out (VCarve, CC, Easel Offsetter) | **MISSING**→HAVE | ADR-102 G1 Offset row (round joins, new object) |
| T1 | Text (system/bundled fonts) | PARTIAL | 4 bundled fonts; no system-font import |
| T1 | SVG + DXF import, image trace | HAVE | H.6a DXF clean-room |
| T2 | Arc/curved text (VCarve, CC) | MISSING | roadmap |
| T2 | Dogbone/T-bone fillets (VCarve tool+gadget) | MISSING | → ADR-102 G6 (stretch) |
| T2 | Array/paste-along-path (VCarve) | PARTIAL | duplicate exists; no grid/circular array |
| T3 | True-shape nesting, dimensioning, vector validator (VCarve Pro) | MISSING | roadmap |

### B. CAM / toolpaths

| Tier | Feature | Ours | Notes |
|---|---|---|---|
| T1 | Profile in/on/out + kerf/tool-diameter compensation (all) | HAVE | incl. on-path |
| T1 | Tabs (all) | PARTIAL | count/size per layer; not drag-placeable |
| T1 | Pocket (all) | HAVE | offset rings; no raster strategy option |
| T1 | V-carve (all) | HAVE | + flat-bottom + clearing bit (CC "Advanced V-carve" parity) |
| T1 | Drill (VCarve/Kiri) | HAVE | peck cycle |
| T2 | STL → 3D rough + finish (VCarve, Easel Pro, CC Pro) | HAVE | H.4/H.5/H.8 |
| T2 | Ramp entry, climb/conventional, leads (VCarve; CC Pro ramping) | PARTIAL | ramp + direction + entry rotation shipped; arc leads + helical deferred (DECISIONS.md) |
| T2 | Rest machining (VCarve, CC Pro) | PARTIAL | v-carve clearance yes; pocket rest-machining no |
| T2 | Toolpath tiling (VCarve, CC Pro, Easel Pro) | HAVE | H.10 |
| T2 | Multi-tool jobs / tool change (gSender M6 wizards, CC BitSetter, Easel two-stage) | HAVE | M0 strategy + park + re-zero guidance |
| T2 | V-carve inlay automation (VCarve 12, CC free) | MISSING | roadmap |
| T3 | Rotary/4-axis, two-sided, thread milling, photo/sketch carve, keep-out zones, adaptive clearing, G2/G3 arc output | MISSING | roadmap; each needs its own phase + ADR |

### C. Simulation / preview

| Tier | Feature | Ours | Notes |
|---|---|---|---|
| T1 | Toolpath preview, rapids vs cuts, time estimate (all) | HAVE | + scrubber + distance stats |
| T1 | Material-removal simulation (all) | PARTIAL | 2D depth-shaded grid for any job; **3D only for reliefs** → ADR-102 G4 |
| T2 | G-code file preview/insight on load (gSender, CM) | HAVE | H.6b .nc re-import simulator |

### D. Tools / materials / feeds

| Tier | Feature | Ours | Notes |
|---|---|---|---|
| T1 | Tool library w/ geometry + feeds (all) | HAVE | H.7, app-level persistence |
| T2 | Recommended cut settings per material×bit (Easel signature; CC library) | **MISSING** | → ADR-102 G5 (chipload calculator + starter chart) |
| T2 | Machine profiles (Easel 150+, gSender) | HAVE | H.7 snapshots |

### E. Machine control / sender

| Tier | Feature | Ours | Notes |
|---|---|---|---|
| T1 | Connect/jog/home/zero per axis (all) | HAVE | incl. zeroZHere, G54 persistent origin |
| T1 | **Z touch-plate probe wizard** (Easel Z-probe, gSender, CM BitZero, OpenBuilds) | **MISSING** | → ADR-102 G2 — the single biggest sender gap |
| T1 | **Feed override** (gSender sliders, Easel) | **MISSING** | → ADR-102 G3 |
| T1 | Console + $$ settings editor + alarm explanations (gSender, Easel Machine Inspector) | HAVE | ConsolePanel, FirmwareWritesPanel, alarm decode |
| T1 | Start/pause/resume/stop + progress (all) | HAVE | char-counted streaming |
| T2 | XYZ **corner** probing w/ bit diameter (gSender, BitZero) | MISSING | → ADR-102 G2 |
| T2 | Spindle override (gSender) | MISSING | → ADR-102 G3 |
| T2 | Start-from-line recovery (gSender) | MISSING | → ADR-102 G7 (stretch) |
| T2 | Outline/frame job perimeter (gSender) | HAVE | Frame + CNC safe-Z retract |
| T2 | Macros/quick actions (gSender, CM, OpenBuilds) | MISSING | roadmap |
| T2 | Surfacing-wizard generator + squaring/steps calibration (gSender, OpenBuilds) | MISSING | → ADR-102 G8 (stretch: surfacing only) |
| T2 | Keymap editor / gamepad; remote mode; diagnostics+maintenance (gSender) | MISSING | roadmap |
| T3 | Firmware flashing (gSender/OpenBuilds) | MISSING | out of scope (web serial) |

## Defects noticed during the live E2E run (not features)

1. **CNC G-code banner carries laser wording** — exported router files
   say `assumes: GRBL $30=1000 (max S), $32=1 (laser mode)` in the
   header comment. Motion is correct; the comment is wrong for CNC and
   actively misleading next to ADR-100's $32 gating. Fix = machine-aware
   banner (touches the CNC snapshot corpus → needs the explicit
   acknowledgment line).
2. Synthetic-pointer drawing doesn't commit shapes (setPointerCapture on
   a synthetic pointerId) — irrelevant to users (real pointers work),
   noted for future automated UI testing only. Not scheduled.

## What this audit does NOT claim

- No hardware verification happened; every CNC row in AUDIT.md stays
  CLAIMED per ADR-094 §3.
- Easel/Kiri/OpenBuilds research lists are partial (support-site 403 /
  moved docs) — marked in the research notes; absence in the matrix was
  only asserted where an official page grounds it.
- LightBurn remains the reference for the *laser* surface; this audit is
  CNC-only and does not relitigate laser behavior.
