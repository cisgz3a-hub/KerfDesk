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

- **Web app:** Chromium browsers (Chrome, Edge, Brave, Arc) on any OS. WebSerial for machine connection. File System Access API for projects. PWA-installable.
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

### Phase D — v0.4 "Text + fonts" [Planned, post-MVP]

Type text on canvas in selectable bundled fonts; result flows through the existing Line pipeline. See ADR-012.

- Bundled MIT-licensed fonts only.
- Text-to-path via `opentype.js` (MIT).
- Live editing UI: content, font picker with preview, size, alignment, character spacing, line height, weld toggle.

### Phase E — v0.5 "Image vectorize" [Planned, post-MVP]

Import a raster (JPG/PNG), trace to vectors via `imagetracerjs` (Unlicense — MIT-compatible; `potrace-wasm` rejected on GPL grounds). Traced paths become Scene objects that flow through the existing Line pipeline. See ADR-013.

### Phase F — v0.6 "Raster engrave" [In progress]

Activates the dormant `LayerMode = 'line' | 'fill' | 'image'` arms from ADR-005. See ADR-019 (Fill) + ADR-020 (Image).

- **F.1 — Fill** [Shipped]. Scanline polygon fill: a closed Polyline (from any SceneObject) on a layer with `mode='fill'` is replaced at compile time with parallel hatch lines (angle + spacing configurable per layer). Output flows through the existing `grbl-strategy` emit path — no new G-code shape. Even-odd fill rule handles holes (letter "O"). Snake fill alternates row direction.
- **F.2 — Image** [F.2.a-e shipped; F.2.f hardware burn pending]. True raster engrave: new `RasterImage` SceneObject variant (PNG data URL + base64 luma); `dither.ts` runs threshold/Floyd-Steinberg/grayscale; `emit-raster.ts` emits M4-mode per-pixel S-modulation G1 sweeps with overscan. Job.groups is now a CutGroup-or-RasterGroup discriminated union; grbl-strategy dispatches per kind. Toolbar `Engrave Image…` opens a file picker; Layer dropdown enables `Image` mode and surfaces Dither + lines/mm fields. ADR-020. Hardware verification checklist in WORKFLOW.md F-F2; not yet burned on Falcon.
- **F.3 — Set work origin** [Code shipped; hardware verification pending]. Operator jogs the laser head to a workpiece corner and presses *Set origin here* to declare that physical point as work-coord (0, 0). New `OriginRow` in `JobControls.tsx` (Set / Reset buttons), origin readout in `StatusDisplay.tsx`, GRBL command constants (`G92 X0 Y0` / `G92.1`), WCO parsing + caching across status frames in `laser-store`. Pipeline change is zero: GRBL applies the WCS offset to absolute-G90 G-code at run time. ADR-021; WORKFLOW.md F-F3. G92 only — persistent G10 L20 P1 deferred. Bed-bounds preflight remains machine-relative; operator framing after Set Origin is the documented safety check (future ADR-022).

### Anything past Phase F

Requires a new `PROJECT.md` revision and a `DECISIONS.md` entry. Anticipated, not committed:

- Phase G: additional `OutputStrategy` implementations (Marlin et al). MIT references available (CNCjs has working Marlin/Smoothie code) — but ADR-006 still says one strategy ships per phase.
- Phase H: macOS/Linux desktop builds. Free with electron-builder — but ADR-007 still says Windows-only for MVP.

**MIT-availability does not collapse the phase plan.** ADR-005, ADR-006, ADR-007 are discipline choices, not technical-impossibility choices. See ADR-017 for the policy.

### Future feature notes (uncommitted; capture-only)

These are user-requested or product-research items. Not yet scoped into a
phase; tracked here so they don't get lost.

- *(none currently parked — the Phase F.3 set-work-origin note that
  used to live here was promoted to a Phase F line above on 2026-05-28
  with ADR-021 and WORKFLOW.md F-F3.)*

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
- **G-code preamble/postamble hard-coded.** `G21`, `G90`, `M5` start; `M5`, park at end.
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

- Raster engrave (Fill, Image modes).
- Non-GRBL controllers (Marlin, Smoothie, Ruida, Trocen, TopWisdom).
- macOS / Linux desktop builds.
- Node editing of imported paths.
- Boolean ops.
- Camera alignment, overhead camera.
- Rotary attachment.
- Auto-focus, Z-axis control beyond initial homing.
- Material library, cut tests, power/speed wizards.
- Multi-machine, networked control.
- Cloud, accounts, sharing, sync.
- DXF, AI, PDF import.
- Tabs / bridges, kerf compensation, lead-in / lead-out, fill patterns.
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
