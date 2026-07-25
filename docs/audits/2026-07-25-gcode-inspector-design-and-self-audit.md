# G-code Inspector — design proposal and self-audit

**Date:** 2026-07-25 · **Worktree:** `gcode-3d-viewer-b295f0` · **Status:** APPROVED (maintainer, 2026-07-25) — recorded as ADR-255; PROJECT.md Phase M; WORKFLOW.md F-M1. No implementation code yet (Stage 1 next). Every "exists today" claim below was read from the current tree this session (`file:line` cited) or from the committed research doc `docs/audits/2026-07-25-cnc-3d-threejs-research-and-roadmap.md` (commit `077a7e4b`, sibling branch `claude/cnc-3d-threejs-upgrade-0e922c` — reachable from this worktree's shared object store; cited as **[R3D]**). Everything else is labeled as proposal.

---

## 1. Vision

**Open any G-code file — or the G-code KerfDesk just generated — and *see the job run before the machine does*:** a three.js scene of the full motion program in work coordinates, watchable from any angle, scrubbable in time like a video, with every segment traceable back to its source line, and a Program Health report that tells the operator whether the code is sound — **informing, never blocking** (CLAUDE.md rule 7 / PROJECT.md #21).

The maintainer's brief, restated as five product promises:

1. **Read the G-code** — not our compiled Job. The input is the text itself, so it works on files from Fusion, Carbide Create, LightBurn, hand-written programs, and our own output alike.
2. **A three.js visual page from a bunch of angles** — preset views (Top/Front/Right/Iso), free orbit, fit-to-job, a follow-the-tool chase cam, and (v2) a CAD-style quad viewport.
3. **In detail, how the job will complete** — time-true playback using the existing GRBL-style motion planner, a DRO of live modal state, plunge/depth detail ("the dips": every Z stepdown, peck, ramp and retract made legible), and per-segment inspection.
4. **A health check** — "someone can go look at to make sure their code is fine": a structured report built from the invariant scanners the repo already owns, plus new read-only lint. Severities inform; nothing refuses.
5. **State of the art** — measured against what LightBurn, Fusion, CAMotics, ncviewer, Kiri:Moto and OpenBuilds actually do (all source/doc-verified in [R3D] Part 3), and deliberately better on the axes where a viewer can be better: line↔3D cross-linking, honesty of the time model, and file-size headroom.

Working name: **G-code Inspector**. (The UI can call the command `Open G-code…` / `Inspect G-code` — naming is a maintainer call, §9.)

---

## 2. What exists today — verified inventory

The tree is much closer to this feature than a cold read would suggest. Nothing below is speculation.

| Asset | Where | What it gives us |
|---|---|---|
| Clean-room modal G-code parser | `src/io/gcode/parse-gcode-program.ts:56` | GRBL-flavor G0/G1/G2/G3 (I/J + R form, helical Z), G90/91, G20/21, G17, comments, `%`, N words; unsupported words counted, never fatal; produces `Toolpath` steps + summary + notes. Caps at 500 000 lines (`:19`). Consumes but does **not** retain F/S; steps carry no line indices. |
| Line-indexed motion parser | `src/core/job/motion-manifest-parser.ts:41`, types `motion-manifest.ts:11-31` | `MotionBlock`s with 3D points, kind `travel/process/plunge/park`, `rawLineIndex` + `sendableLineIndex` + N number, cumulative route mm, S power + spindle-armed tracking, M0/M1 park boundaries, arc sampling via `sampleMotionArc`. Built for the live-run canvas readouts. |
| Existing "open G-code" flow | `src/ui/app/gcode-open-action.ts:1-56`, WORKFLOW.md F-CNC10 (line 2491) | File → Open G-code (Preview): picks `.nc/.gcode/.tap`, parses, hands the toolpath to the 2D simulator slot. **CNC-only at the command layer (ADR-101).** |
| Planner-grade time estimator | `src/core/job/estimate-duration.ts:1-58` | grbl-style motion planner (per-edge blocks, junction deviation from `$11`, two-pass lookahead, trapezoidal per-block time) — L2 accuracy. Input today is a `Job`, not parsed motion. |
| Material-removal simulation | `src/core/sim/` (`removal-grid.ts`, `stamp-toolpath.ts`, `tool-kernels.ts`) | Heightfield stock sim that already consumes a `Toolpath` — external programs can feed it unchanged. |
| three.js scene + 3D pane | `src/ui/relief-viewer/relief-three-scene.ts`, `src/ui/workspace/Cnc3DPane.tsx:1-170` | The ADR-102 lazy-loaded scene (heightfield only). 16 quality gaps and a 17-stage upgrade plan are documented in [R3D] Part 1. |
| Health-check building blocks | `src/core/invariants/cnc-motion.ts`, `predicates.ts`, `gcode-words.ts:4-50`; `src/core/preflight/` (`no-go-zones.ts`, `relative-motion-envelope.ts`, `laser-off-motion-policy.ts`, `cnc-motion-bounds-preflight.ts`) | Text-level scanners for plunged travel, spindle clearance, out-of-bounds coords, no-go zones, relative-motion envelopes, laser-off policy — plus shared word-parsing helpers designed to scan one pre-split line array (`gcode-words.ts:32-41`). |
| Verified rendering-technique catalog | [R3D] Part 3 | Fat lines (`LineSegments2`), per-kind color batching, `setDrawRange` playback, `LatheGeometry` tool ghost, GPU picking by index-as-color (CAMotics' 3D↔source-line link), ViewHelper gizmo, lighting rigs, palette conventions — all checked against the installed `three@0.180.0`. |
| Palette reference behavior | [R3D] Part 3 (doc line 1596) | CAMotics/LightBurn/Fusion: red = rapid/traversal; OpenBuilds: red = cut. LightBurn is this project's stated reference → red = traversal, with a "show traversal moves" toggle in LightBurn's wording. |

**Dependencies:** `three@^0.180.0` is already in `package.json:57`. **This design requires zero new runtime dependencies** (ADR-017 untouched; the `three/addons` fat-line and ViewHelper modules ship inside the existing package — [R3D] verified them present in `node_modules`).

**Known traps inherited from prior research** (must be honored, not rediscovered):
- ADR-102 §2 permits three.js **only beneath `src/ui/relief-viewer/`** (DECISIONS.md:4576-4582). Any new viewer folder needs an ADR amendment first ([R3D] Risk 1).
- `mapToolpathToScene` (`src/ui/workspace/preview-scene-frame.ts`) emits a **left-handed** mixed frame (scene XY +Y-down, machine Z +Z-up). Drawing 3D polylines in that frame renders mirrored — plausible-looking and wrong ([R3D] Risk 5). §4.3 sidesteps it entirely.
- jsdom forces `getContext('webgl') → null` (`src/__fixtures__/jsdom-canvas-setup.ts:113`), so everything after `new WebGLRenderer` is untestable by construction ([R3D] Risk 4). Verification must be perceptual (§8).
- No COOP/COEP headers → no SharedArrayBuffer; workers use transferable ArrayBuffers ([R3D] Risk 11).
- Arc `step.length` deliberately ≠ chord sum of the sampled polyline ([R3D] Risk 6) — any scrubber that re-derives length from rendered geometry drifts.
- `pnpm format:check` is repo-wide and not part of `lint`; index-export ratchets apply to new barrels (cap 20).

---

## 3. Product design — the experience

### 3.1 Entry points

1. **File → Open G-code…** — upgrade of the existing F-CNC10 command: same picker, same parser family, but landing in the Inspector instead of (only) the 2D simulator slot. **Proposal: available in both laser and CNC modes** — laser operators have `.gcode` files too, and raster jobs are the performance stress case. This widens ADR-101's CNC-only gate → maintainer decision (§9-a).
2. **Inspect from Job Review / after Save G-code** — one click hands the exact emitted program (`EmitGcodeResult.gcode`) to the same Inspector. This is the fidelity dogfood: what we ship is what we watch. The CNC path can also attach `emitPreparedGcodeWithCncPassSpans` spans (`src/io/gcode/emit-gcode.ts:79-84`) for pass-aware coloring for free.
3. **Drag-drop** a `.nc/.gcode/.tap` file onto the workspace (platform adapter already handles drag-drop for other types).

### 3.2 The page (one screen, four regions)

```
┌───────────────────────────────────────────────┬──────────────┐
│  3D VIEWPORT (three.js, work coords, Z-up)    │ PROGRAM      │
│  · toolpath fat-lines colored by lens         │ HEALTH       │
│  · tool ghost at playhead · bed/grid/triad    │ · summary    │
│  · view gizmo · preset cams · chase cam       │ · findings   │
│  ├ hover: segment tooltip (kind/F/S/Z/line)   │   (click →   │
│  └ click: select → source line highlight      │    jump)     │
├───────────────────────────────────────────────┼──────────────┤
│  TIMELINE  ▶ ⏸ speed ▸ chapters ▸ event marks │ DRO / STATS  │
│  scrub by TIME (planner) — not just distance  │ X Y Z F S    │
├───────────────────────────────────────────────┤ mode units   │
│  SOURCE PANE (virtualized G-code text,        │ t elapsed /  │
│  synced both ways with 3D selection)          │ remaining    │
└───────────────────────────────────────────────┴──────────────┘
```

### 3.3 Feature set, tiered

**v1 — the credible core (each its own reviewable diff, §7):**
- Parse → render model → 3D polyline scene in work coordinates, orbit + zoom + fit, bed/grid/origin triad, preset cameras.
- Move-kind lens with LightBurn palette (red traversal, recessive: thinner/dimmer; solid cuts; distinct plunge/retract hue) + "show traversal moves" toggle.
- Playback: play/pause, 0.25×–100× speed, scrub, step-by-segment; `setDrawRange` reveal in program order; tool-position marker (cone/laser dot).
- DRO: modal X/Y/Z, feed, S, units, motion mode, active line at the playhead.
- Stats: bounds box (w×h×d), cut/travel/plunge distances (parser summary already computes these), segment count, per-kind totals, Z-level ladder, min/max F and S.
- Program Health report (§5) — informational.
- Source pane with two-way sync: click a 3D segment → highlight + scroll the line; click a line → flash the segment and jump the playhead.
- Screenshot export (render-on-demand `toDataURL` — [R3D] technique).

**v2 — the "state of the art" layer:**
- **Time-true playback**: adapt the existing planner to parsed motion (§4.4) → the timeline is seconds, ETA and % remaining are honest, and the tool visibly *slows into corners*. No surveyed open-source viewer does planner-accurate time ([R3D] Part 3).
- Data lenses: color by power S (laser heat lens), by feed, by Z depth, by time gradient — Kiri-style ramps with a legend ([R3D] doc line 1588).
- GPU picking (index-as-color) for exact hover on million-segment scenes ([R3D] doc lines 1698-1704).
- Chapters: auto-segment by Z-level changes, spindle state, M0/M1 pauses, tool comments — a chapter strip on the timeline; click to isolate.
- Chase cam (follow the tool head), quad viewport (Top/Front/Right/Iso simultaneously — four cameras, scissor viewports, one scene).
- Worker-based parsing with progress for big files; raise the 500 K-line cap for the Inspector path (§4.5).
- Section/clipping plane for reading internal Z passes ("the dips") — reuses the depth-range machinery ([R3D] feature 12).

**v3 — differentiators no competitor in the survey has:**
- **Diff mode**: open two programs, overlay ghosted vs solid, changed-extent report. ("Did regenerating change my cut?")
- **Ghost overlay vs project** (in-app only): current project's compiled toolpath rendered ghosted under the external file — instant "does this G-code match my design" fidelity check, which is this project's core mission (CLAUDE.md rule 2).
- **Stock-removal tie-in**: feed the parsed `Toolpath` to the existing `computeRemovalGrid` and show the carved heightfield beside the motion view (CNC) — `stamp-toolpath.ts` already accepts it.
- **Laser burn-plane sim**: accumulate S-weighted exposure into a plane texture (2D energy-density heat map = scorch prediction). Pure derivation from the render model; informational.
- Shareable HTML report export (static snapshot + stats + findings; fully offline, no network).

---

## 4. Architecture

### 4.1 Module layout (respects `core → io → ui` boundaries)

```
src/core/gcode-view/            NEW pure module — the render model
  gcode-render-model.ts         buildGcodeRenderModel(text, opts): Result<GcodeRenderModel>
  render-model-types.ts         typed-array segment soup + events + stats types
  program-events.ts             modal timeline: units/WCS/spindle/dwell/pause/tool marks
  program-stats.ts              bounds, per-kind totals, Z ladder, F/S ranges
  program-health.ts             findings catalog (composes core/invariants + core/preflight)
  time-model.ts                 planner adapter → per-segment t0/t1 (v2)
  index.ts                      ≤ 20 exports (new-barrel cap)

src/ui/viewer3d/                NEW — three.js home after the ADR-102 §2 amendment
  (shared with the CNC-pane upgrade track: scene shell, disposal, DPR, theme)
src/ui/gcode-inspector/         NEW — React surface
  GcodeInspector.tsx            layout shell (≤250-line components, split per panel)
  panels/…                      Timeline, HealthPanel, DroPanel, SourcePane, StatsPanel
  use-inspector-playback.ts     playhead state (reuses the 2D preview's rAF pattern)
```

Rules honored: pure core (no DOM/clock/random — time comes in as parameters; the worker lives at the UI/platform edge and *calls* core functions); discriminated unions for parse/health results (`Result<T,E>` per ADR-131); files ≤400 / functions ≤80; three.js never in `core/` or `io/` — the render model returns plain `Float32Array`s exactly like the ADR-102 §2 heightmap→mesh seam.

### 4.2 The render model — one parse, typed arrays, line-mapped

`GcodeRenderModel` (proposal):

- `positions: Float32Array` — xyz per segment endpoint pair, **work coordinates, mm**.
- `segKind: Uint8Array` — `rapid | cut | arcCut | plunge | retract | dwellMark` (+ room for `lead/ramp` tags when span data is attached).
- `segLine: Uint32Array` — raw source line index per segment (the cross-link backbone).
- `segFeed: Float32Array`, `segPower: Float32Array` — modal F and S at emission (the two things `parseGcodeProgram` currently drops).
- `segRouteMm: Float32Array` — cumulative route (arc-true lengths, **not** chord sums — honoring [R3D] Risk 6).
- `events: ProgramEvent[]` — `{ line, kind: 'units'|'spindleOn'|'spindleOff'|'pause'|'dwell'|'programEnd'|'toolWord'|…, detail }`.
- `lineToSegRange` — source line → segment span (both directions O(1)).
- `stats`, `zLevels`, `bounds` — precomputed once.

**Why not a third parser from scratch:** the repo already has two modal interpreters plus several partial scanners ([R3D] §2.2) — CLAUDE.md's copy-paste-duplication rule forbids a third copy. Stage 1 is therefore **tidy-first**: extract the shared modal engine (word regex, comment stripping, modal state fold, arc sampling) into one core module, with the existing outputs of `parseGcodeProgram` and `buildMotionManifest` pinned identical by tests before and after. The render model then composes that engine. The known arc-sampling divergence (`sampleArcPoints` vs `sampleMotionArc` tolerances — flagged unverified in [R3D] §2.2) gets settled by this unification instead of shipping a third variant.

### 4.3 Coordinate frame — the trap, sidestepped

The Inspector renders **the program's own frame**: right-handed, Z-up, X right, Y away — exactly what every G-code tool the operator knows uses (ncviewer exposes Z-up/Y-up as a toggle; [R3D] doc line 1668). No `mapToolpathToScene`, no scene-frame mixing, so the left-handed trap ([R3D] Risk 5) never applies. The optional bed outline / origin marker overlay derives from `DeviceProfile` origin data in machine frame directly. The one three.js detail: three is Y-up by default — we mount the toolpath group with Z-up axes explicitly (the same handedness fix gcode-preview applies to its `AxesHelper`; [R3D] doc line 1668) and pin the pure orientation math with fixture tests.

### 4.4 Time model

- **v1:** distance-parameterized playback (scrub by route mm — the 2D preview's existing model, `use-preview-playback.ts`).
- **v2:** `time-model.ts` feeds parsed segments through the **existing planner** (`estimateWithPlanner` — junction deviation, lookahead, trapezoids; `estimate-duration.ts:1-23`) to get per-segment `t0/t1`. The timeline becomes seconds; the DRO shows elapsed/remaining; playback speed is real-time-relative (1× ≈ wall clock). Requires an adapter from render-model segments to planner blocks — a pure function with property tests (monotonic time, total = Σ blocks, parity with `estimateJobDuration` on natively-compiled fixtures).

### 4.5 Performance budget (the raster reality)

A 300×300 mm raster engrave at 10 lines/mm is on the order of millions of motion lines — the true stress case, and why laser-mode availability matters. Proposal targets (to be **measured, not asserted**, at each stage):

| Scenario | Target |
|---|---|
| 100 K-line CNC program | < 1.5 s open → first frame; main thread never blocked > 100 ms |
| 1–2 M-line raster program | worker parse with progress; < 8 s to interactive; bounded memory via typed arrays |
| Orbit on 5 000-segment scene | 60 fps (PROJECT.md's existing metric) |
| Playback on 500 K+ segments | `setDrawRange` reveal (no reallocation — [R3D] doc line 1622); render-on-demand when paused |

Mechanics: single-pass parse into preallocated typed arrays (grow-by-doubling), transferable ArrayBuffer hand-off from the worker, one `LineSegments2` batch per kind for cuts + one thin `LineSegments` for rapids ([R3D] fat-lines findings), vertex-color lens swaps without geometry rebuilds, GPU picking instead of CPU raycasts at scale. The 500 K-line cap in `parse-gcode-program.ts:19` stays for the 2D simulator path; the Inspector's worker path gets its own higher, memory-derived cap (maintainer sets the number, §9-g).

### 4.6 Bundle

three is already lazy-chunked (~704 KB minified per the vite.config comment quoted in [R3D] Risk 2). The Inspector adds `three/addons` lines + ViewHelper to that same lazy chunk and defers ALL postprocessing (GTAO etc.) exactly as [R3D] recommends. Rule: measure the chunk before/after at every stage; regression against the <1 MB budget is a stop-and-report, not a shrug.

---

## 5. Program Health — the audit the operator sees

**Hard framing (rule 7 / ADR-228):** the Health report is a *lens*, not a gate. It never disables Start, never refuses parse/render/stream, never adds confirmation. Anything worth knowing goes in this list (and, when the program is streamed, the same findings surface as ordinary Job Review warnings). Malformed input still renders whatever motion could be read, with findings explaining the rest. The only hard failures are compile-integrity facts inherited from the parser (not-G-code, non-finite targets) — category (b) refusals that already exist.

Findings catalog (v1; each: severity `info | notice | warning`, count, first line, one-line fix hint, click-to-jump):

- **Structure** — junk/unparsed lines; unsupported words (already counted by the parser); no `M2/M30` program end; motion before any units word; mid-program unit switches; `G91` relative spans (notice — envelope shown); N-word sequence gaps.
- **Laser** — S > 0 while never armed (M3/M4 missing); left armed at end (no M5); powered rapids (reuses `laser-off-motion-policy`); S exceeding profile `$30` (when a device profile is attached); M3-constant vs M4-dynamic mode note.
- **CNC** — travel below safe Z (reuses `findPlungedTravelIssues`, `cnc-motion.ts:20`); spindle-start clearance (`findSpindleStartClearanceIssues`); plunge feed ≥ cut feed anomaly; deepest Z vs stated stock thickness (when attached); first move not a retract.
- **Bounds** — extents vs bed (`findOutOfBoundsCoords`, `predicates.ts:104`); no-go-zone crossings (`no-go-zones.ts`) — informational here, exactly as Frame-first doctrine requires.
- **Feed/power sanity** — G1/G2/G3 before any F (GRBL rejects this with error 22 — surface it *before* the machine does); F0; arc radius mismatches near the 0.127 mm tolerance (`parse-gcode-program.ts:23`); dwell total; lines longer than a typical RX buffer.
- **Efficiency (info)** — rapid:cut ratio, air-travel %, duplicate consecutive coordinates, redundant modal repeats, planner time vs naive time.

Severity is presentation only. The panel header states it plainly: *"Findings inform. Nothing here blocks Frame, Start, or export."*

---

## 6. Self-audit — protocol, then executed

The brief asked for the audit to be *designed*, not just run once. Protocol (reusable at every stage gate):

> **For each lens: (1) Brainstorm ≥ 8 ideas without filtering. (2) Verify each against the tree or a primary source — kill or cite. (3) Score the surviving design 1–5. (4) Name the top gap. (5) Feed the gap into the next stage's scope.**
> Lenses: **Capability · Fidelity · Performance · Beauty · UX · Compliance · Product.**
> Standing rules: Karpathy's law (a green suite proves structure, never looks — every visual claim needs a rendered artifact); no idea graduates from Brainstorm to Plan without a named data source in the current tree; every "looks amazing" claim must name the exact technique and its verified cost.

Executed against this design:

- **Capability (4/5).** Brainstormed 14; survivors are §3.3. Kill list with reasons: A-axis/rotary rendering (no 4-axis data model in either parser today); canned-cycle G81 expansion (our dialect never emits them; firmware support varies — v1 counts them as unsupported words with a finding); live "shadow mode" replaying controller status onto the Inspector during a real job (genuinely great, but belongs to the live-run track that already owns `liveCanvasRun` — [R3D] gap 9 — noted as a v3 bridge). **Top gap:** G54–G59 WCS words are counted-unsupported by both existing parsers — v2 should track them modally (they shift the whole frame; a wrong-WCS file is a classic crash cause and deserves a finding, not silence).
- **Fidelity (4/5).** Work-frame rendering kills the handedness trap; arc-true lengths honored; time model is planner-grade where competitors guess kinematically. **Top gap:** planner output for *parsed* motion can drift from `estimateJobDuration` on native jobs (different block decomposition) — the §8 corpus pins them against each other with a tolerance, and the Inspector labels estimates "±" until calibrated.
- **Performance (3/5 until measured).** Typed arrays + worker + `setDrawRange` are the right shapes ([R3D]-verified), but no number in §4.5 is real until profiled — scored deliberately low; stage gates carry the measurements.
- **Beauty (4/5).** LightBurn palette with recessive rapids; Kiri-style ramps with legends; OpenBuilds-style lighting rig later ([R3D] doc lines 1658-1668); theme-synced colors through a shared `viewer3d` theme module (closing [R3D] gap 14 for both consumers); DPR fix inherited from the shared scene work. Deferred: GTAO/postprocessing (bundle risk). **Top gap:** dark/light legibility of the power-lens ramp needs a real contrast check on both themes.
- **UX (4/5).** Two-way source↔3D linking is the hero interaction ("a genuine differentiator LightBurn does not have" — [R3D] doc line 223); chapters make million-line rasters navigable; the DRO speaks machine language. **Top gap:** the keyboard map (space/J/K/[/]/F/1-4) must not collide with the existing command registry — audit `src/ui/commands/` before pinning.
- **Compliance (5/5, by construction).** Health = informational only (rule 7); pure core; zero new deps; ADR-102 amendment named as the blocking decision; tidy-first parser unification instead of a third copy; every stage an individually-reviewable diff; G-code snapshots untouched (the Inspector emits nothing).
- **Product (4/5).** Who: (a) our operators pre-flighting third-party or hand-edited files; (b) us, dogfooding emitted output — the ghost overlay turns the Inspector into a fidelity instrument for the project's own hard problem; (c) LightBurn/Easel users with no good free 3D G-code reader — every surveyed free tool lacks either 3D quality (ncviewer's thin `LineSegments` — [R3D] doc line 1556), health checks, or line-linking. A public standalone "paste G-code" page built from the same modules is a real acquisition idea but touches scope/deploy posture — flagged, not planned (§9-e). **Top gap:** discoverability — the Job Review "Inspect" button is the highest-value entry point and ships in v1.

---

## 7. Staged build plan (tight leash — every stage lands green, reviewed, shippable)

| Stage | Diff | Proof |
|---|---|---|
| 0 | ADR: amend ADR-102 §2 → `src/ui/viewer3d/`; Inspector scope + laser-mode availability + F-CNC10 revision. Coordinates with the sibling CNC-pane track's viewer-home ADR draft (that number since taken on main) so both features share one three.js home — one amendment, two consumers. | Maintainer approval; docs only |
| 1 | Tidy-first: shared modal G-code engine extracted; `parseGcodeProgram` + `buildMotionManifest` outputs pinned identical before/after; arc-sampling tolerance unified or explicitly parameterized | Existing tests + new equivalence fixtures |
| 2 | `core/gcode-view` render model (typed arrays, F/S retention, line map, events, stats) | Unit + property tests (pure, jsdom-free) |
| 3 | Scene shell in `ui/viewer3d` (extraction of the relief scene per [R3D] stage 3) + Inspector dialog rendering thin-line segments, orbit, grid, triad, work-frame | Dev-browser perceptual check on corpus (§8); orientation math unit-tested |
| 4 | Move-kind palette + traversal toggle + fat-line cuts; DRO + stats panels | Corpus screenshots vs 2D preview |
| 5 | Playback v1 (distance scrub, speed, tool marker, `setDrawRange`) | Corpus + scrubber-parity test vs 2D preview totals |
| 6 | Program Health panel (existing scanners + new lint) | Unit tests per finding; fixture programs per category |
| 7 | Source pane + two-way 3D↔line sync (CPU pick v1) | Corpus interaction check |
| 8 | Time-true playback (planner adapter) | Parity property vs `estimateJobDuration` on native fixtures |
| 9 | Lenses (power/feed/depth/time) + legend | Corpus screenshots, both themes |
| 10 | Cameras (presets, fit, chase), screenshot export | Corpus |
| 11 | Worker parse + big-file path + progress + cap raise | Profiled numbers vs §4.5 targets |
| 12+ | Quad view · section plane · chapters · GPU picking · diff mode · ghost overlay · removal-grid tie-in · burn-plane sim | Each its own ADR-checked increment |

Stages 3–5 deliberately overlap the sibling CNC-pane roadmap's shared stages ([R3D] stages 3, 8, 11) — build once, consumed by both the Inspector and the pane.

## 8. Verification plan (Karpathy's law, applied)

- **Pure tier (CI):** render-model unit/property tests — modal equivalence with `parseGcodeProgram` endpoints on the fixture corpus; arc-length trueness; line-map bijectivity; planner-time monotonicity; health findings per crafted fixture.
- **Perceptual tier (manual, honest):** a committed **golden corpus** of 6 programs — (1) square+circle+R-arc sampler, (2) depth-pass profile with tabs (the G0-Z/G0-XY/G1-Z tab signature), (3) v-carve `path3d`, (4) helical entry + peck drill, (5) laser raster snake with overscan, (6) our own emitted output for a known scene. Each stage gate: render in the dev browser (fresh `vite --port 5174 --strictPort` recipe), screenshot from Top and Iso, compare against the 2D preview and the corpus notes, and record what was and was NOT verified. jsdom cannot see any of this ([R3D] Risk 4) — no green suite will ever be claimed as visual proof.
- **Cross-tool spot check:** corpus item 1 opened in an external viewer (e.g. ncviewer/CAMotics) once per major stage to confirm geometric agreement against ground truth outside our own code.

## 9. Open maintainer decisions

a. **Laser-mode availability** of Open G-code (widens ADR-101's CNC-only gate). *Recommended: yes, both modes.*
b. **Three.js home**: amend ADR-102 §2 to `src/ui/viewer3d/` shared with the pane track. *Recommended: yes — one amendment, two consumers.*
c. **Dialect breadth v1**: stay GRBL-flavor with never-fatal notes (current parser model). *Recommended: yes; G54–G59 modal tracking in v2.*
d. **Phase/ADR placement**: new PROJECT.md entry — required by PROJECT.md's "anything past Phase F" rule.
e. **Public standalone page** (marketing/acquisition): out of scope until explicitly decided. *Flag only.*
f. **Palette confirmation**: red = traversal (LightBurn convention). *Recommended: confirm now, pin in theme.*
g. **Big-file cap** for the Inspector worker path (memory-derived; the 2D path keeps 500 K).
h. **Relationship to F-CNC10's 2D simulator**: Inspector complements (2D preview stays) or replaces? *Recommended: complement in v1; revisit after v2.*

## 10. Draft ADR skeleton (for DECISIONS.md once approved — number assigned at landing to avoid the ADR-number race)

> **ADR-XXX — G-code Inspector: read-side 3D program viewer and informational health report**
> Context: F-CNC10 opens external programs into a 2D simulator; the tree owns two modal parsers, a planner-grade estimator, invariant scanners, and an ADR-102 three.js scene. Operators need to *see* a program run and assess its health before streaming.
> Decision: (1) amend ADR-102 §2 — three.js may live beneath `src/ui/viewer3d/` (shared scene home) in addition to `src/ui/relief-viewer/`; (2) new pure `src/core/gcode-view/` render model built on the unified modal engine (tidy-first, no third parser); (3) Inspector UI in `src/ui/gcode-inspector/`, lazy-loaded with the three chunk; (4) Program Health is informational only — findings feed Job Review's warning list and never gate any action (rule 7 / ADR-228 compliance is part of this ADR's acceptance); (5) zero new runtime dependencies; (6) staged per §7 with per-stage perceptual verification.
> Consequences: one more three.js consumer on the lazy chunk (measured per stage); the modal-engine unification touches two existing parsers (pinned outputs); WCS/4-axis support explicitly deferred.

---

## 11. Rendering specification — "state of the art" made concrete (2026-07-25 addendum, maintainer directive)

The maintainer's bar: *"three.js should be state of the art and well planned so that a job can be inspected in detail until the smallest detail with a full gcode reader visualized."* Adjectives don't survive review; this section pins every rendering claim to a named technique with a verified source and a build stage. Items marked **[verify@N]** are believed-correct-but-unconfirmed against three@0.180 and get proven (or replaced) at that stage — never silently assumed.

**R1 — Canvas & context discipline (Stage 3, shared with the pane track).** `setPixelRatio(min(devicePixelRatio, 2))` — the missing-DPR defect is the single most visible quality gap in the current scene ([R3D] gap 3); `outputColorSpace` set explicitly; `antialias: true` MSAA (kept — postprocessing is deferred, so we never trade MSAA away); render-on-demand (rAF only while playing or damping — the existing scene's discipline, kept per [R3D] Risk 8); **complete disposal** — materials, EdgesGeometry, and every buffer, closing the audited leak list ([R3D] gap 4).

**R2 — Toolpath geometry.** Chunked, preallocated typed-array buffers (~250 K segments per chunk → bounded allocation, per-chunk frustum culling via bounding spheres, and partial reveal). Rapids: thin `LineSegments`, recessive (opacity/renderOrder below cuts — Kiri's convention, [R3D] doc line 1598). Cuts: `LineSegments2` fat lines, one batch per chunk ([R3D] doc line 1556 — the exact reason ncviewer "looks thin and dated"). All lenses write one reusable per-vertex color attribute — lens switches recolor, never rebuild geometry. Reveal: `setDrawRange` on thin geometry ([R3D] doc line 1622); on instanced fat lines the equivalent is instance-count control — **RESOLVED 2026-07-25 (stage 5): `LineSegmentsGeometry.instanceCount` reveal works on the installed three r180, confirmed by WebGL pixel readback (cut pixels 1886 → 600 when the playhead moves back). No fallback needed.**

**R3 — Scene furniture (Stage 3).** Two-tier grid (minor/major), labeled origin triad, bed outline from the device profile, stock ghost box (CNC); platform/grid materials use `depthWrite: false` so below-Z0 motion stays visible through the bed — the Kiri detail that matters for reading plunges ([R3D] doc line 1668). `ViewHelper` orientation gizmo (~10 lines, covers 90% of a ViewCube's value — [R3D] doc line 1680). Theme-aware background gradient + grid colors through a shared `viewer3d` theme module (closes [R3D] gap 14 for both consumers; contrast-checked on both themes).

**R4 — The tool at the playhead (Stage 5).** CNC: `LatheGeometry` solid-of-revolution derived from the same `CncTool` record that drives `kernelForTool` — flat/ball/V/engraving profiles, semi-transparent flute + duller shank, "so the drawn tool cannot lie about the cutting tool" ([R3D] doc lines 1626-1630). Laser: emissive head dot + faint vertical beam line (proposal — no survey precedent, trivially cheap). Placement interpolates *within* the active segment, never snapping to segment boundaries (CAMotics `getPtAtTime` pattern, [R3D] doc line 1622).

**R5 — Cameras (Stage 10; quad in 12+).** Perspective orbit with damping; **orthographic** Top/Front/Right presets (true drawing views — what CAD operators expect for measuring) + perspective Iso; fit-to-job; chase cam following the playhead tangent with a trailing offset; smooth tweened preset transitions; quad viewport = four cameras, scissor rects, one scene, one render loop.

**R6 — Picking & selection.** v1 (Stage 7): CPU raycast (both thin and fat lines are raycastable) — acceptable to ~100 K segments. At scale (Stage 12+): GPU picking — segment index encoded as a second color attribute, 1-px scissor offscreen readback, decode → segment → source line; the exact CAMotics mechanism behind its 3D↔editor link ([R3D] doc lines 1698-1704), with the documented tone-mapping/colorspace trap called out there. Selection presentation: selected segment forced to full brightness, non-selected dimmed ×0.3 (CAMotics convention, [R3D] doc line 1596), plus the source-line highlight.

**R7 — Explicitly deferred (bundle honesty).** GTAO/postprocessing, IBL/PMREM environment, shadows: all named in [R3D] with real costs; none ships until the lazy-chunk size is measured at each stage and the maintainer accepts the number (§9 and [R3D] open question 4). Dev-only instrumentation (fps/heap HUD) may use stats.js per the ecosystem verdict (dev-only OK); nothing dev-only ships in the bundle.

**R8 — Measurement protocol.** Every rendering stage lands with: lazy-chunk size before/after, fps on the 5 000-segment PROJECT.md scene, time-to-first-frame and peak heap on the 1 M-segment corpus raster, screenshot pair (both themes) in the PR. Numbers, not adjectives.

## 12. The detail ladder — "smallest detail" defined and guaranteed

Six inspection levels, each with its surface and its data source. "State of the art" here means: **no level is a dead end — every level links one deeper.**

| Level | What the operator sees | Surface / source |
|---|---|---|
| L0 Job | bounds box, per-kind totals, planner ETA, Z ladder, F/S ranges | Stats panel (render-model `stats`) |
| L1 Chapter | Z-level / spindle / pause / tool boundaries as timeline strips; click isolates | `events` + `zLevels` |
| L2 Pass | one Z-level or pass span in isolation; depth lens; (CNC from-our-emitter: exact pass spans via the `CncPassSpan` sidecar) | lens + chapter filter |
| L3 Segment | hover/click any move: kind, length, F, S, Z span, time-at, source line — tooltip + selection | picking (R6) + `segLine` map |
| L4 Sub-segment | playhead interpolated inside the move; vertex dots at high zoom ("show toolpath points" — ncviewer parity, [R3D] doc line 1668); direction glyphs (arrowheads) for climb/conventional reading | playback + zoom-gated point sprites |
| L5 Word | the source line tokenized word-by-word with plain-language meaning (`G1` = linear feed move; `F` = mm/min…), and a **modal delta view**: what changed on this line vs before it (proposal — cheap output of the modal fold) | Source pane detail row |

Two guarantees turn "full gcode reader" from a slogan into tests:

1. **Total line accountability (property test, CI).** Every raw line of the input classifies into exactly one of: motion (≥1 segments) · modal-only change · event · comment/blank · unsupported-word finding · junk finding. Nothing is silently skipped; the source pane badges every line with its category. No surveyed viewer offers this.
2. **Own-output-clean acceptance (snapshot-corpus test, CI).** Every program emitted by our own strategies parses with **zero** unsupported-word notes and zero junk lines. This is *not true today*: the CNC emitter writes `G54`, `G94`, `G4 P`, `M0`, `M3 S`, `M5`, `M7`–`M9` ([R3D] §2.2, cnc-grbl-strategy evidence), while the F-CNC10 parser's documented dialect (`parse-gcode-program.ts:7-10`) lists none of the M-words and neither `G54`/`G94` — whether each is currently noted or quietly dropped needs a read of `executeLine` at Stage 1, and either way the render model must handle the full emitted set of every built-in strategy (laser GRBL, CNC GRBL, Marlin, Smoothieware dialects) before v1 is called a reader.

Detail features graduating from this ladder into the plan: **modal delta view** (L5, Stage 7's source pane), **direction glyphs** (Stage 4 palette work), **vertex dots at zoom** (Stage 5), **"explode passes" slider** — vertically separates coincident multi-pass geometry (laser passes share one Z; CNC tab re-cuts overlap) so pass N is individually readable (proposal, Stage 12+), and the **planner lens** — color segments by whether they reached programmed feed or were acceleration/junction-capped, straight from the Stage-8 planner adapter's per-block peak velocities ("why is my job slow", proposal — no surveyed tool has it).

*Self-audit delta (§6 protocol re-run on this addendum): Capability 4→5 (L5 + accountability close the "full reader" gap); Fidelity unchanged pending the Stage-1 `executeLine` read; Performance still 3 until R8 numbers exist. New top gap: the fat-line instance-count reveal `[verify@5]` is the only rendering-critical unknown left.*

---

*Prepared by Claude (Fable) on 2026-07-25; §11–§12 added same day on the maintainer's "state of the art, smallest detail, full reader" directive. Nothing in this document has been implemented; no file outside `docs/audits/` was touched. The sibling research doc [R3D] remains unpushed on `claude/cnc-3d-threejs-upgrade-0e922c` — landing it on main alongside this proposal would let both tracks cite one committed evidence base.*
