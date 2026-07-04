# PROJECT.md — LaserForge 2.0

> **Status:** v3.2 — Proprietary license, private repo (ADR-018 supersedes ADR-008); MIT-compatible dependency policy preserved (ADR-017); DOMPurify pinned for Phase A SVG sanitization. Changes from here require a `DECISIONS.md` entry.
>
> **Read also:** `WORKFLOW.md` for user flows. `DECISIONS.md` for architecture rationale. `CLAUDE.md` for the operating manual Claude Code reads each session.

---

## Product goal

LaserForge 2.0 is a focused, LightBurn-style CAM application for **GRBL** laser cutters and engravers, delivered as **both a web app and a Windows desktop app from a single codebase**. It takes a 2D vector design (or, post-MVP, text and traced images), assigns cut/engrave operations per color layer, previews the toolpath, generates correct G-code, and streams it to the connected machine.

It deliberately copies LightBurn's UX shape and workflow. It deliberately does not copy LightBurn's feature breadth or controller fan-out.

The 1.0 codebase shipped a working app but had a coupling problem: fixes in one module broke others. **2.0 is a clean rewrite designed against shotgun-surgery from day one — pure-function pipeline core, strict module boundaries, enforced file-size limits, snapshot tests on G-code, property tests on invariants.** See ADR-010 and ADR-015.

**The project source code is proprietary (All Rights Reserved — ADR-018).** The dependency policy is unchanged: third-party libraries must be MIT-compatible (MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD) per ADR-017. GPL-family licenses are rejected for dependencies. The license posture is reversible — promotion to a permissive license (MIT, Apache-2.0) or source-available (BSL) requires a new ADR superseding ADR-018; the criteria are listed there.

---

## Users and roles

Single role: **operator**. No accounts, no auth, no multi-tenancy. The app trusts whoever launches it with full control of their local machine.

User profile:
- Owns a GRBL-based diode or CO₂ laser (xTool, Sculpfun, Ortur, Atomstack, NEJE, OpenBuilds, FluidNC retrofits).
- Comes from LightBurn or LaserGRBL and expects that workflow.
- Designs in Inkscape / Illustrator / Affinity and exports SVG, or wants to type text directly, or wants to trace a logo from a PNG.
- Cares about: correct power/speed per layer, accurate preview, not starting fires.

---

## Delivery targets

- **Web app:** Chromium browsers (Chrome, Edge, Brave, Arc) on any OS. WebSerial for machine connection. File System Access API for projects. PWA-installable, fully offline (ADR-060).
  - *Brave note:* WebSerial is shipped but Brave may gate it behind a Shields/flags toggle in some versions (upstream issue brave-browser#24404, status last re-verified 2026-05-28 — still open). Surface a one-line "Enable WebSerial in Brave settings" hint in the F-B1 connect error path.
- **Windows desktop app:** Electron. Same UI, same core, native menus and file system, robust offline.
- **macOS / Linux desktop:** out of scope for MVP. Those users get the web app.

Both targets ship from one codebase, sharing every line of pipeline and UI code, separated only by a thin **platform adapter** for file I/O, serial port, and drag-and-drop. See ADR-011.

---

## Primary flow (top level)

See `WORKFLOW.md` for granular flows including success, error, empty, and edge states for each step.

1. Open app → workspace at machine bed dimensions.
2. Add content (Phase A: import SVG. Phase D: type text. Phase E: vectorize image).
3. Position objects (move, scale, rotate, mirror, align).
4. Configure Cuts/Layers (per-color: power, speed, passes, visible, output).
5. Preview toolpath.
6. Generate G-code; save to disk or stream to laser.

---

## Phase plan

### Phase A — v0.1 "File generator" [MVP]

Prove import → layers → preview → G-code end-to-end. Both web and Windows desktop builds shipping. SVG import via native DOMParser, sanitization via **DOMPurify ≥ 3.3.2** (ADR-017), layer assignment, transform, preview, G-code file output. **No streaming.**

Acceptance: see `WORKFLOW.md` Phase A flows + `DECISIONS.md` Phase A acceptance criteria.

### Phase B — v0.2 "Real MVP — streams to laser" [MVP]

Match LightBurn's core loop. Adds WebSerial-based GRBL controller, Laser window, Device Profile UI, Home/Frame/Jog/Start/Pause/Stop, alarm handling, job progress.

Open library evaluation at Phase B kickoff per ADR-017: study CNCjs source (MIT) as protocol reference for GRBL streaming and alarm-code mapping. **Not adopted as a dependency** — too large for our needs; just a reference.

### Phase C — v0.3 "Polish" [MVP completes here]

Job time estimates, settings panel, SVG re-import with diff, path optimization (2-opt), keyboard shortcuts pass, autosave + recovery, local-only crash reporter.

Open library evaluation at Phase C kickoff: `simplify-js` (BSD-2-Clause) or `flatten-svg` (ISC) for path simplification.

**MVP is complete at end of Phase C.**

### Phase D — v0.4 "Text + fonts" [Shipped]

Type text on canvas in selectable bundled fonts; result flows through the existing Line pipeline. See ADR-012.

- Bundled MIT-licensed fonts only.
- Text-to-path via `opentype.js` (MIT).
- Live editing UI: content, font picker with preview, size, alignment, character spacing, line height. (Glyph weld is **not** implemented — it depends on the geometry kernel, anticipated post-Phase-F; do not describe it as shipped.)

### Phase E — v0.5 "Image vectorize" [Shipped]

Import a raster (JPG/PNG), trace to vectors via `imagetracerjs` (Unlicense — MIT-compatible; `potrace-wasm` rejected on GPL grounds). Traced paths become Scene objects that flow through the existing Line pipeline. See ADR-013.

**Trace pipeline hardening (2026-05-29).** Fixed transparent-PNG decode (composite onto white — it was producing all-black traces); added a perceptual-fidelity test harness that renders trace output and diffs it against analytic ground-truth masks via IoU (ADR-025, `src/__fixtures__/perceptual/`); and made a committed trace keep its source bitmap as a coexisting `RasterImage` for LightBurn-style overlay (ADR-026, new `src/ui/state/import-actions.ts`). **Known open gap — the next frontier:** imagetracerjs is outline-only, so a single pen stroke becomes two parallel contours; closing this outline-vs-centerline gap (a centerline/skeleton trace mode + metric) is the core remaining "faulty vs LightBurn" issue and is *not* caught by the IoU harness. Also open: `DEFAULT_TRACE_OPTIONS` degenerates on already-binary input (the `Line Art` preset sidesteps it), and the ADR-026 follow-ups (re-trace-from-source, source dimming/opacity, grouping the trace+source pair). See ADR-025 'Scope'/'Consequences' and ADR-026 'Consequences'.

### Phase F — v0.6 "Raster engrave" [In progress]

Activates the dormant `LayerMode = 'line' | 'fill' | 'image'` arms from ADR-005. See ADR-019 (Fill) + ADR-020 (Image).

- **F.1 — Fill** [Shipped]. Scanline polygon fill: a closed Polyline (from any SceneObject) on a layer with `mode='fill'` is replaced at compile time with parallel hatch lines (angle + spacing configurable per layer). Output flows through the existing `grbl-strategy` emit path — no new G-code shape. Even-odd fill rule handles holes (letter "O"). Snake fill alternates row direction.
- **F.2 — Image** [F.2.a-e shipped; F.2.f hardware burn pending]. True raster engrave: new `RasterImage` SceneObject variant (PNG data URL + base64 luma); `dither.ts` runs threshold/Floyd-Steinberg/grayscale; `emit-raster.ts` emits M4-mode per-pixel S-modulation G1 sweeps with overscan. Job.groups is now a CutGroup-or-RasterGroup discriminated union; grbl-strategy dispatches per kind. Toolbar `Engrave Image…` opens a file picker; Layer dropdown enables `Image` mode and surfaces Dither + lines/mm fields. ADR-020. Hardware verification checklist in WORKFLOW.md F-F2; not yet burned on Falcon.
- **F.3 — Set work origin** [Code shipped; hardware verification pending]. Operator jogs the laser head to a workpiece corner and presses *Set origin here* to declare that physical point as work-coord (0, 0). New `OriginRow` in `JobControls.tsx` (Set / Reset buttons), origin readout in `StatusDisplay.tsx`, GRBL command constants (`G92 X0 Y0` / `G92.1`), WCO parsing + caching across status frames in `laser-store`. Pipeline change is zero: GRBL applies the WCS offset to absolute-G90 G-code at run time. ADR-021; WORKFLOW.md F-F3. G92 only — persistent G10 L20 P1 deferred. Bed-bounds preflight remains machine-relative; operator framing after Set Origin is the documented safety check (future ADR-022).
- **F.4 — Convert to Bitmap** [A1–A2 shipped (Fill All); A3 Outlines / A4 Use Cut Settings / A5 polish pending]. Vector→raster: rasterize selected vector objects into a `RasterImage` engrave source, matching LightBurn (Outlines / Fill All / Use Cut Settings render types, DPI control, 50% gray pixels, **source vector deleted**). New pure-core `src/core/raster/rasterize-vector.ts`; additive (no `SceneObject`/schema change). ADR-029; WORKFLOW.md F-F4. Staged: **A1** ✓ pure-core Fill-All luma rasterizer; **A2** ✓ Toolbar `Convert to Bitmap` button → PNG encode + `RasterImage` in-place swap (Fill All only — the render-type picker + DPI control arrive with A3/A4); A3 = Outlines; A4 = Use Cut Settings; A5 = placement/brightness polish. A2 fill+encode fidelity verified in-browser side-effect-free (real PNG round-trips to 200×200 at 254 DPI; ink 50% gray, even-odd hole preserved); live in-app render/placement and a LightBurn side-by-side not yet done.

- **F.5 - Material calibration workflow** [Approved; staged]. Minimal LightBurn-style Material Test and Interval Test generators are now in scope so operators can calibrate speed, power, passes, and image line interval on scrap before burning final work. Start with pure Scene generators that flow through the existing preview/save/start pipeline; UI and hardware verification follow. The native Material Library recipe foundation and deterministic `.lfml.json` IO are now scoped as support infrastructure for those calibrated settings; the in-app multi-library UI — create/edit wizard, Saved Libraries browser, and auto-save persistence — is scoped by ADR-093, while LightBurn `.clb` compatibility, manufacturer profiles, and linked presets ("Link") remain deferred. ADR-044, ADR-045, ADR-093.

### Phase G — v0.7 "Drawing tools" [In progress]

On-canvas parametric shape creation — the first geometry that does NOT enter via import. Closes the largest LightBurn-parity gap (J1 "draw a sign from nothing" was impossible; J3 batch effectively impossible). See ADR-051.

- New pure `src/core/shapes/` (shape→polylines) + a `kind:'shape'` SceneObject variant (Rectangle / Ellipse / Polygon / Polyline parametric blocks + materialized `paths`, the ADR-014 / TextObject precedent) so compile/preview/emit/save are untouched.
- A tool-mode discriminated union + vertical tool strip (Esc returns to Select); `Workspace` mousedown draws on the current drawing layer color with a live mm readout.
- Staged B1→B7: core/shapes geometry → 'shape' variant → ellipse/polygon → tool-mode + tool strip → draw-on-drag → pen → LightBurn-compatible tool hotkeys (`Ctrl+R` Rectangle, `Ctrl+E` Ellipse, `Ctrl+L` Line/Pen) with Save G-code moved to `Ctrl+Shift+E`. Interactive parametric handles + Convert-to-Path are P2 follow-ups.
- OUT of this phase (still out of scope; a future phase + ADR + an ADR-017 polygon-clipping library evaluation): the geometry KERNEL — weld, boolean ops, offset, node editing.

### Phase H — v0.8 "Router" [Built (G1–G8); hardware passes CLAIMED]

Full professional CNC/router mode — LaserForge's own feature surface, not an Easel clone. Builds on the CNC MVP from commit `032d476` (mode toggle, profile/pocket/engrave CAM, depth passes, tabs, spindle/Z-aware GRBL, preflight). Scope-gated by ADR-098: all parsers clean-room, clipper2-ts the only geometry dependency, hardware verification on the 4040 via the standing air-cut protocol. UI separation between laser and CNC modes is governed by ADR-101 (gate-and-hide); the 3D relief viewer's three.js dependency by ADR-102 (UI-only override of ADR-098 §2). Sub-phases (each = individually reviewed diffs; branch shippable after every one). Status column: Built = code + tests landed, hardware pass still CLAIMED per AUDIT.md inventory:

| Sub-phase | Delivers | Status |
|---|---|---|
| H.0 | Governance: ADR-098, this table, F-CNC flows, AUDIT checklist | Done |
| H.1 | `CncPass` contour/path3d union (tidy-first) + overdeep-cut invariant | Built |
| H.2 | Toolpath simulation: stock XY model, Z-aware steps, material-removal grid, depth-shaded preview | Built |
| H.3 | True V-carving: clipper2 inward offset ladder, `tipAngleDeg` depth law, flat-bottom fallback | Built |
| H.4 | Clean-room STL import → deterministic max-Z heightmap, `relief` SceneObject, canvas preview | Built |
| H.5 | Relief roughing: heightmap dilation + marching squares → existing pocket engine | Built |
| H.6 | Clean-room DXF import; clean-room `.nc` parser → simulator; CNC text defaults | Built |
| H.7 | Tool + feeds/speeds libraries (material-library pattern), multi-CNC-machine profiles; then multi-tool jobs (M0 tool change, Z-zeroing flow, drill/peck, two-stage V-carve) | Built |
| H.8 | Relief finishing: ball-nose max-plus tip surface, scallop-driven stepover | Built |
| H.9 | Motion polish: ramp entry, climb/conventional, entry-point rotation, parking parity (helical entry + arc leads deferred — DECISIONS.md) | Built |
| H.10 | Tiling: indexed tile grid, registration holes, per-tile export | Built |
| H.11 | Market-parity build-out (ADR-103): vector booleans + offset (clipper2), probing wizard (Z + XYZ corner, G38.2), real-time feed/spindle/rapid overrides, general 3D cut preview, feeds & speeds calculator, machine-aware G-code banner | Built (G1–G8) |
| H.12 | Easel-parity pack (ADR-105): persistent live 3D pane, pocket raster fill (offset/raster-X/raster-Y), bundled local design library | Built |
| H.13 | Beginner-mode UX pack (ADR-106): layer material picker (auto-fills feeds), Basic/Advanced disclosure + through-cut, machine auto-fill from detected `$$`, stock/feed limit advisories | Built |


### Phase I — v0.9 "Multi-controller" [Merged to main; awaiting remaining hardware passes]

(Integrated as Phase I: the CNC router track holds Phase H — ADR-104 records the numbering resolution.)

Every controller family drives the whole app through the ControllerDriver seam
(ADR-094): connect → identify → jog/frame → run/pause/resume/stop → recover, with
output, streaming, console, settings, and UI capability-gated per firmware.
Verified end-to-end against scripted firmware simulators
(`src/__fixtures__/controllers/`) driving the REAL laser-store.

- **I.1 — Driver seam** (ADR-094): `src/core/controllers/` ControllerDriver +
  ControllerEvent + ControllerCapabilities; GRBL byte-identical (snapshots + sim
  transcripts); per-profile `baudRate`; controller detection from welcome banners
  (advisory).
- **I.2 — grblHAL + FluidNC**: capability deltas on the GRBL driver (FluidNC:
  settings read-only); extended grblHAL alarm codes 11–13. **grblHAL confirmed
  working on the Falcon A1 Pro (GrblHAL 1.1f) by the maintainer, 2026-07-02.**
  FluidNC still simulator-only.
- **I.3 — Marlin** (ADR-095): queued M114 status, stream-side pause, G28 X Y,
  M400 settle, marlin-inline / marlin-fan dialects (M106/M107 transform).
  Simulator-verified only.
- **I.4 — Smoothieware** (ADR-096): realtime ?/!/~ kept, M999 halt recovery,
  fractional S power (S0.500 at the 0–1.0 default scale). Simulator-verified only.
- **I.5 — Ruida** (ADR-097): EXPERIMENTAL `.rd` export (encode→decode round-trip
  proven; NOT accepted by real hardware yet); `transport: 'file-only'` — no live
  link; pure UDP session state machine as groundwork.

**Hardware truth table:** GRBL v1.1 + grblHAL = **hardware-verified on the Falcon
A1 Pro (GrblHAL 1.1f), maintainer, 2026-07-02** — this also proves the S1/H.1
driver refactor is byte-identical on real hardware, since the Falcon's normal
`grbl-v1.1` profile drives it through the rewritten path unchanged. FluidNC /
Marlin / Smoothieware / Ruida = simulator-verified only, labeled `unverified` in
catalog evidence and (for .rd) warned on every export.

### Anything past Phase F

Requires a new `PROJECT.md` revision and a `DECISIONS.md` entry. Anticipated, not committed:

- ~~Additional `OutputStrategy` implementations (Marlin et al).~~ **Built —
  see Phase I above (ADR-094..097).** Remaining follow-ups: hardware passes (Falcon
  grblHAL burn; community Marlin/Smoothie/FluidNC verification), Ruida
  real-controller validation then the Electron UDP transport, wizard
  controller-family step polish. Trocen/TopWisdom/galvo stay out of scope.
- Phase J: macOS/Linux desktop builds. Free with electron-builder — but ADR-007 still says Windows-only for MVP. (Renumbered from Phase I — the multi-controller track took that slot at integration; ADR-104.)

**MIT-availability does not collapse the phase plan.** ADR-005, ADR-006, ADR-007 are discipline choices, not technical-impossibility choices. See ADR-017 for the policy.

### Future feature notes (uncommitted; capture-only)

These are user-requested or product-research items. Not yet scoped into a
phase; tracked here so they don't get lost.

- *(Convert to Bitmap promoted to Phase F.4 above on 2026-05-29 with ADR-029;
  build started at increment A1.)*
- *(Material/Interval Test promoted to Phase F.5 above on 2026-06-09 with
  ADR-044; Material Library native recipe + `.lfml.json` IO foundation added
  under ADR-045 before any full library UI, hidden persistence, or Link
  behavior.)*
- **Trace control realignment to LightBurn** (Cutoff/Threshold band, Ignore Less
  Than, Smoothness, Optimize, Sketch Trace, Trace Transparency) — designed in
  **ADR-030**; replaces our preset/`numberOfColors` model. Redesign of the
  shipped Phase E Trace (higher scrutiny). Separable from §8.6 #1 (eliminate
  `TracedImage`). Staged B1→B4. *Phase assignment + build order pending
  maintainer decision (2026-05-29).*

---

## Non-negotiables

### Safety + correctness

1. **Bounds check** — generated paths must fit inside the configured bed.
2. **Origin honesty** — output coordinates match the device profile's origin.
3. **Laser-off on travel** — every `G0` move ends with `S0` or precedes an `M5`. Property-tested.
4. **No partial output** — pipeline failure writes no file and sends no stream.
5. **Deterministic G-code** — same input + same parameters → byte-identical output. Snapshot-tested.
6. **Units honest** — internal model is mm. Inches accepted only at import boundary via explicit conversion.
7. **Power scale honest** — `S` values match the device profile's max-power scale (`$30`). Property-tested.
8. **No telemetry, no network calls** — local-first. Ever.
9. **E-stop reachable always** — Stop button reachable from any window state during a job. No modal can block it.

### Architectural (anti-shotgun-surgery)

10. **Pure-function pipeline core** (ADR-010).
11. **Platform-agnostic core** (ADR-010, ADR-011).
12. **Module boundaries are public APIs** (ADR-010).
13. **All invariants property-tested** (ADR-010).
14. **G-code snapshot-tested** (ADR-010).
15. **File-size limits enforced** (ADR-015): files ≤ 400 lines hard, ≤ 250 soft; components ≤ 250 hard; functions ≤ 80 hard.
16. **Co-located tests** (ADR-015): every source file has a `.test.ts` sibling.
17. **Single responsibility per file** (CLAUDE.md). One-sentence description without "and."
18. **Discriminated unions for state** (ADR-010, ADR-014).
19. **`SceneObject` extensible from day one** (ADR-014).
20. **Third-party libraries pass evaluation policy** (ADR-017): license, maintenance, fit, size, CVE status.

---

## Success metrics

- Fresh-install user → physical cut piece in < 10 minutes, no docs.
- Zero "laser stayed on during travel" reports across MVP.
- Determinism + invariant tests pass on every CI run.
- Web cold-start < 2 s, desktop cold-start < 3 s.
- 60 fps pan/zoom on a 5,000-segment scene.
- A fix that changes G-code output produces a visible snapshot diff in CI.
- **No file in the repo exceeds 400 lines.** Enforced by ESLint.
- **Every third-party dependency has an entry in `RESEARCH_LOG.md`** with license, version, maintenance status at adoption.

---

## Stack

- **Language:** TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **UI:** React 18 + Vite. CSS Modules. No Tailwind, no UI framework in MVP.
- **State:** Zustand with strict slices. Discriminated-union actions.
- **Canvas:** Canvas2D.
- **Desktop shell:** Electron LTS. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Platform adapter:** `platform/web/` and `platform/electron/` implement the same `PlatformAdapter` interface.
- **SVG parse:** native `DOMParser` (browser and jsdom in Node tests).
- **SVG sanitize:** **DOMPurify ≥ 3.3.2** (MPL-2.0/Apache-2.0 dual; MIT-compatible). Pinned per ADR-017.
- **Text (Phase D):** `opentype.js` (MIT). Bundled MIT fonts.
- **Vectorize (Phase E):** `imagetracerjs` (Unlicense — MIT-compatible).
- **Testing:** Vitest (unit + pipeline + snapshot), `fast-check` (property), Playwright (E2E smoke per platform).
- **Build:** Vite → web bundle; Vite + electron-builder → signed Windows `.exe`.
- **Lint/format:**
  - ESLint with `eslint-plugin-boundaries` (module isolation).
  - `eslint max-lines`, `max-lines-per-function`, `complexity` (file-size enforcement).
  - `license-checker` in CI (license-compliance enforcement).
  - Prettier.
- **CI:** GitHub Actions. Lint, typecheck, license-check, unit, property, snapshot, build, E2E. PR blocked on red.
- **Repo:** Single Git repo, proprietary license, private from first commit (ADR-018; reversible — see ADR-018 reversal triggers).

---

## External services

**None.** The app must work fully offline. No analytics, no error reporting service, no cloud sync.

---

## Data model (MVP)

```
Project
 ├─ schemaVersion: 1
 ├─ device: DeviceProfile
 │   ├─ name
 │   ├─ bedWidth, bedHeight (mm)
 │   ├─ maxFeed (mm/min)
 │   ├─ maxPowerS ($30 value, e.g. 1000)
 │   ├─ origin: 'front-left' | 'front-right' | 'rear-left' | 'rear-right' | 'center'
 │   └─ homing: { enabled, direction }
 ├─ workspace: { width, height, units: 'mm' }
 └─ scene
     ├─ objects: SceneObject[]      // discriminated union — see ADR-014
     └─ layers: Layer[]             // one per unique color
         ├─ id, color
         ├─ mode: 'line'            // only mode in MVP
         ├─ power: 0..100
         ├─ speed: number            // mm/min
         ├─ passes: integer ≥ 1
         ├─ visible: boolean
         └─ output: boolean
```

`SceneObject` is a discriminated union. MVP has one variant (`ImportedSvg`). Phase D adds `TextObject`. Phase E adds `TracedImage`. Verified by Phase A acceptance test.

`Job`, `Plan`, `Output` are pure derivations from `Project`. Never persisted.

---

## Module layout

```
src/
  core/                          ← pure, no I/O, no platform imports
    scene/                       Scene, Layer, transforms, SceneObject union
    job/                         JobCompiler (Scene → Job)
    plan/                        PlanOptimizer (Job → Plan)
    output/                      OutputStrategy interface + GrblStrategy
    preflight/                   Bounds, laser-off, power-scale checks
    devices/                     DeviceProfile types + defaults
    invariants/                  Property test predicates
  platform/                      ← only place I/O lives
    types.ts                     PlatformAdapter interface
    web/                         File System Access API, WebSerial, drag-drop
    electron/                    fs, serialport, dialog, ipc
  ui/                            ← React, imports core + platform via DI
    app/
    workspace/                   Canvas2D viewport
    layers/                      Cuts/Layers window
    laser/                       Laser window (Phase B+)
    text/                        Text tool (Phase D)
    trace/                       Image trace UI (Phase E)
    preview/
    common/
  io/
    svg/                         DOMParser + DOMPurify sanitization
    project/                     .lf2 serializer
    gcode/                       G-code file write
    text/                        Text-to-path (Phase D)
    image/                       Raster decode + trace (Phase E)
  fonts/                         ← bundled MIT fonts (Phase D)
  __fixtures__/                  ← shared test resources (folder name chosen to
    svg/                         not collide with co-located *.test.ts files)
    gcode-snapshots/             G-code snapshots
    property/                    fast-check predicates
```

Each subfolder has its own `index.ts` defining the module's public API. ESLint forbids cross-module imports outside `index.ts`.

---

## Security posture

- **Imported SVG is untrusted.** Parsed via native `DOMParser`, sanitized via **DOMPurify** with `USE_PROFILES: { svg: true, svgFilters: true }` and a custom hook removing external `xlink:href` and non-image data URIs.
- **Imported raster images (Phase E)** decoded inside a sandbox. Memory-bounded.
- **Bundled fonts (Phase D)** parsed with `opentype.js` only. Never passed to native font APIs.
- **Electron hardening:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. No IPC handlers (no `ipcMain` surface). `setPermissionRequestHandler` returns `false` except for `serial` and any `fileSystem*` permission (needed for the File System Access API in Electron 33+ — see commit `2965bd0`). CSP via `session.webRequest.onHeadersReceived` (F-9 audit fix).
- **Web hardening:** strict CSP, no inline scripts, no third-party CDNs.
- **G-code preamble/postamble hard-coded.** `G21`, `G90`, `M3 S0` start (arm at zero power — laser-off in laser mode; primes $32=0 controllers, see grbl-strategy.ts); `M5`, park at end.
- **No auto-update from arbitrary URLs.**
- **Dependency CVE monitoring:** GitHub Dependabot enabled on first push. CVE in a direct dependency blocks releases until patched.

---

## Accessibility / performance

- WCAG 2.2 AA on all UI controls.
- Canvas viewport exempt from full a11y; must have keyboard equivalents and a non-visual status line.
- 60 fps pan/zoom @ 5,000 segments.
- G-code generation < 2 s @ 5,000 segments.
- Web cold-start < 2 s, desktop cold-start < 3 s.
- Web bundle target: < 1 MB compressed. Each adopted dependency adds to this budget — see ADR-017.

---

## Out of scope (no phase assigned)

Reject any of these mid-development without a `PROJECT.md` revision and a `DECISIONS.md` entry. **MIT availability does not change this list.**

- ~~Raster engrave (Fill, Image modes).~~ **Shipped in Phase F** (F.1 Fill, F.2 Image) — no longer out of scope.
- Non-GRBL controllers (Marlin, Smoothie, Ruida, Trocen, TopWisdom).
- macOS / Linux desktop builds.
- Node editing of imported paths.
- Boolean ops.
- Camera alignment, overhead camera.
- Rotary attachment.
- Auto-focus, Z-axis control beyond initial homing — **laser mode only**.
  Phase H CNC router mode is inherently Z-aware (plunges, depth passes,
  safe-Z retracts) — ADR-098.
- Manufacturer setting profiles, LightBurn `.clb` compatibility, and linked
  material presets ("Link"). Minimal Material Test / Interval Test generators
  are scoped by Phase F.5 and ADR-044; the native Material Library recipe +
  `.lfml.json` IO foundation by ADR-045; and the in-app multi-library UI
  (create/edit wizard, Saved Libraries browser, auto-save persistence) by
  ADR-093.
- Multi-machine, networked control.
- Cloud, accounts, sharing, sync.
- ~~DXF~~, AI, PDF import. **DXF moved in-scope by Phase H.6 (clean-room
  parser, ADR-098)**; AI and PDF import remain out of scope.
- Manual tabs / bridges, lead-in / lead-out, advanced fill patterns. Narrow
  Line-mode kerf compensation is scoped by ADR-052, automatic Line-mode
  hard-skip tabs are scoped by ADR-053, and simple Cross-Hatch fill is scoped by
  ADR-054. Simple Offset Fill output is scoped by ADR-055; broader
  boolean/node editing and advanced fill-pattern systems remain out of scope.
  A narrow ordered sub-layer operation stack for same-color "fill then line"
  workflows is scoped by ADR-056; Rayforge-style workflow graphs and plugin
  operation pipelines remain out of scope.
- Macros, scripting, command palette, plugins, extensions.
- Variable text (CSV / counter / date).
- System fonts.

---

## Source of truth

| Document | Purpose |
|---|---|
| `PROJECT.md` | Scope, non-negotiables, phase plan. (This file.) |
| `WORKFLOW.md` | Detailed user flows for the current phase. |
| `DECISIONS.md` | Architecturally significant decisions with rationale. |
| `CLAUDE.md` | Operating manual for Claude Code: file-size limits, naming, anti-patterns, checklists. |
| `RESEARCH_LOG.md` | External claims and library adoptions, with source, version, license, date. |
| `LICENSE` | Proprietary — All Rights Reserved (ADR-018). |

External authorities:
- **GRBL v1.1h wire protocol** — defined in the `gnea/grbl` wiki, which has been archived since Aug 2019. The 1.1h streaming protocol (simple send-response, character-counted buffer) remains the de-facto wire authority; actively maintained protocol-compatible forks are **grblHAL**, **FluidNC**, and **µCNC**.
- **W3C SVG 1.1 / 2** — geometry parsing authority.
- **LightBurn** — UX and workflow reference *only*. We copy its model, not its code.
- **CNCjs source** (MIT, github.com/cncjs/cncjs) — Phase B protocol reference *only*. Not a dependency.

---

## Vertical slice — Phase A acceptance

Phase A merges only when **all** of these are true. Phase B starts only after Phase A is green.

1. Web build deployed to a static URL; opens and runs in Chrome and Edge.
2. Windows desktop build packaged as `.exe` from `electron-builder`; opens and runs on Windows 10 and 11.
3. All flows in `WORKFLOW.md` F-A1 through F-A16 implemented and demonstrable.
4. Tests pass in CI:
   - **Snapshot:** five fixture SVGs produce byte-identical G-code to recorded snapshots.
   - **Determinism property:** same input + same params → identical output over 100 random fuzz seeds.
   - **Laser-off invariant property:** every `G0` line has `S0` or precedes an `M5` block, across 100 generated inputs.
   - **Bounds invariant property:** output coordinates fall within configured bed, across 100 generated inputs.
   - **Power-scale invariant property:** 50% slider produces correct `S` value across `$30 ∈ {100, 255, 1000}`.
   - **SVG sanitizer (via DOMPurify):** strips `<script>`, external `xlink:href`, foreign objects, non-image data URIs on a corpus of crafted-malicious SVGs.
   - **Module boundary:** ESLint passes; no `core` file imports from `platform`, `ui`, or `io`.
   - **File-size discipline:** ESLint passes; no file > 400 lines; no component > 250 lines; no function > 80 lines.
   - **License compliance:** `license-checker` finds zero GPL-family transitive dependencies.
   - **SceneObject extensibility:** a stub `TextObject` variant added to the union compiles through `JobCompiler` without modifying existing tests.
5. No file in the repo over 400 lines. No untested source file. CI green.
6. `RESEARCH_LOG.md` contains an entry for every adopted runtime dependency (license, version, justification, evaluation date).

Anything outside this list is Phase B or later.
