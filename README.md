# KerfDesk

**Laser and CNC CAM in one application.** Import or draw artwork, assign named cut / fill /
engrave operations to it, preview the toolpath, generate G-code, and stream it to a GRBL-family
controller over USB — from a browser tab or a Windows desktop app, built from one codebase.

KerfDesk deliberately copies LightBurn's UX shape and workflow for lasers, and Easel/Carbide's
conventions for routers. It deliberately does **not** copy their feature breadth.

> **A note on naming.** The product is **KerfDesk**. The repository, the npm package name
> (`laserforge`) and the Electron application id (`dev.laserforge.app`) still say *LaserForge 2.0* —
> that is historical, and those identifiers are deliberately frozen because changing them would
> break release identity and the on-disk location of saved user data.
> See [`src/core/app-branding.ts`](src/core/app-branding.ts) and [`PROJECT.md`](PROJECT.md).

---

## Status — please read before you cut anything

KerfDesk is under active development and has **never been proven on hardware for output
fidelity**. Be specific about what that means:

| Area | Status |
|---|---|
| GRBL v1.1 / grblHAL streaming | **Hardware-verified** — Creality Falcon A1 Pro (GrblHAL 1.1f), 2026-07-02 |
| FluidNC · Marlin · Smoothieware | Simulator-verified only |
| Ruida `.rd` export | Encode→decode round-trip proven; **never accepted by a real controller** |
| Laser raster/image engrave | Code + tests only; never burned on a machine |
| **The entire CNC / router surface** | Code + tests only; **never cut on a machine** |
| Box generator physical fit | Never cut and assembled |
| Desktop launch / install | Packaging builds pass; real-OS qualification pending |

The automated suite proves **structure and determinism** — byte-identical G-code across fuzz
seeds, path counts, invariant predicates. It does not prove **fidelity**: that a fill, an engrave
or a V-carve actually *looks* like the source. Output can be geometrically wrong and still pass
everything. There is currently no machine available to this project for verification, so treat
every unproven row above as unproven rather than pending.

**Check your output in an independent G-code viewer before running it, keep the work area clear,
and stay at the machine.** The in-app Abort is a software stop, not a safety-rated E-stop —
dangerous conditions need the machine's physical E-stop or power isolation
([`PROJECT.md`](PROJECT.md) non-negotiable #9).

---

## Who it's for

A single role: the **operator**. No accounts, no auth, no cloud, no telemetry, no subscription —
the app trusts whoever launches it and runs fully offline.

You'll feel at home if you own a GRBL-based diode or CO₂ laser (xTool, Sculpfun, Ortur,
Atomstack, NEJE, FluidNC retrofits) or a GRBL router (Genmitsu, Shapeoko, X-Carve, Onefinity,
LongMill), design in Inkscape / Illustrator / Affinity, and expect a LightBurn-shaped workflow.

---

## What it does

### Shared

- **Scene model** — imported SVG/DXF, editable text, traced artwork, raster images, generated
  shapes and STL reliefs, all in one extensible discriminated union.
- **Named operations** bound to artwork by explicit operation IDs (not by colour), with an
  independent machine run order.
- **Toolpath preview**, job-time estimation from a real GRBL-style trapezoidal motion planner
  with lookahead and junction-deviation cornering, and a **G-code Inspector**: open any `.nc` /
  `.gcode` / `.tap` — or the exact program you're about to run — in a 3D viewer with playback,
  per-segment source links and an informational program-health report.
- **Drawing tools** — rectangle, ellipse, polygon, star and pen/polyline, plus Bézier node
  editing and boolean operations (weld, subtract, intersect, exclude, offset) via `clipper2`.
- **Text** — 4 bundled outline fonts and 4 single-line/stroke faces for engraving, plus imported
  `.ttf`/`.otf` embedded into the project. Variable text from CSV, serial numbers and dates.
- **Parametric box generator** — finger-jointed closed, open-top and slide-lid boxes with
  dividers, panel cutouts, baked joint clearance and CNC corner-overcut relief. (Kerf itself is
  handled by the normal per-operation cut settings, not by the generator.)
- **Auto-layout / nesting**, material libraries, and Material/Interval test-grid generators.
- **Image Studio** — a full in-app raster editor (brush/eraser/line, marquee/lasso/wand
  selections, levels, curves, blur/median/unsharp, halftone, layers with blend modes, clone
  stamp, gradient and spot-heal) so you can repair an engrave source and re-trace without
  leaving the app.
- **Camera alignment** — checkerboard intrinsic calibration, lens rectification and marker-based
  bed alignment, with USB and network camera sources.

### Laser

- Three operation modes: **Line** (vector outline cut), **Fill/Scan** (hatch the interior) and
  **Image** (dithered raster engrave). Sub-layers let one operation stack fill *then* line.
- Fill: scanline hatch with configurable angle and spacing, bidirectional/snake, cross-hatch,
  plus **Follow Shape** (concentric offset) and **Island Fill** styles.
- Image: 11 dither/conversion modes (threshold, Floyd–Steinberg, Jarvis, Stucki, Atkinson,
  Burkes, three Sierra variants, ordered Bayer, grayscale), 5–25 lines/mm, dot-width correction,
  negative and pass-through.
- Image trace with five presets across three in-house engines: filled-contour (Line Art, Smooth,
  Sharp), **centerline/medial-axis**, and Canny **edge detection**.
- Kerf compensation, automatic holding tabs, set-work-origin (`G92`), framing, and
  **Convert to Bitmap** for vector→raster engraving.

### CNC / router

- Eight selectable cut types: profile outside/inside/on-path, pocket, engrave, **V-carve**,
  inlay pair and drill (explicit peck cycles — GRBL has no `G81`/`G83`).
- Pocket clearing by contour-parallel rings, raster X/Y, or **constant-load adaptive clearing**
  (island-free pockets only), with two-tool **rest machining** and finish allowance.
- Depth passes, ramp entry, native `G2`/`G3` **helical entry**, arc/line lead-in-out, climb vs
  conventional with hole mirroring, and **holding tabs as a Z-rise** inside one continuous
  toolpath (draggable per contour).
- **3D relief from STL** — clean-room parser → max-Z heightmap → waterline roughing → ball-nose
  scallop finishing.
- Tiling for jobs larger than the bed, with registration holes and per-tile export.
- Touch-plate **probing** (Z and XYZ corner, two-stage `G38.2`), a tool library with 18 built-in
  bits plus your own, a chipload-based feeds & speeds calculator, multi-tool jobs with `M0`
  manual tool change, a spoilboard surfacing wizard, and a live 3D material-removal simulation.

Cut ordering is a safety design, not a convenience: pockets and engraves run first, profiles
last, inner contours before outer — a part is machined completely before the cut that could free it.

---

## File formats

### Read

| Format | Notes |
|---|---|
| `.svg` | DOMParser + DOMPurify sanitisation. **Convert text to paths first** — `<text>` and `<image>` are counted and skipped. |
| `.dxf` | Clean-room ASCII parser: LINE, CIRCLE, ARC, LWPOLYLINE (with bulges), POLYLINE, ELLIPSE, SPLINE, INSERT/MINSERT. Binary DXF is rejected with a message. |
| `.lbrn` / `.lbrn2` | LightBurn projects → a new KerfDesk project, carrying speed, power, passes and Line/Fill mode. Group/Rect/Ellipse/Path shapes; bitmaps and BackupPath-less text are dropped. Proven against five real public `.lbrn2` files; **`.lbrn` v1 has no test fixture**. |
| `.clb` | LightBurn cut libraries → material presets. Proven against four real public libraries. Replaces the active library. |
| `.lbdev` | LightBurn device profiles, with an Applied / Needs Review / Ignored card before anything is applied. GRBL-flavoured devices only. **Experimental — written against an inferred schema and never tested against a real LightBurn export.** |
| `.png` `.jpg` | Engrave/trace sources. |
| `.stl` | CNC relief. **Drag-and-drop only, CNC mode only** — there is no menu item. |
| `.nc` `.gcode` `.tap` | **View only**, in the G-code Inspector. Does not become editable geometry. (An older 2D simulator is reachable from inside the Inspector, in CNC mode only.) |
| `.ttf` `.otf` | Embedded into the project (≤10 MB each, ≤32 per project). |
| `.csv` | Variable-text datasets. |
| `.lf2` | KerfDesk's own project format (JSON, schema v3, auto-migrating from v1/v2). |

Also: `.lfml.json` material libraries, `.lfmachine.json` machine profiles, `.lfsettings.json`
controller snapshots. Drag-and-drop accepts SVG, DXF, PNG/JPG and STL; everything else needs its
own dialog.

Not supported: `.ai`, PDF, EPS, `.cdr`, Gerber, OBJ/3MF, and LightBurn `.lbzip` bundles.

### Write

`.gcode` / `.nc` (including per-tile export), `.rd` (Ruida, **experimental**), `.lf2` projects,
`.lfml.json` libraries, `.lfmachine.json` profiles, `.svg` and `.png` exports.

**LightBurn interoperability is one-way.** KerfDesk reads LightBurn files and writes none of them.

---

## Controllers

Six firmware families drive the whole app through one `ControllerDriver` seam — connect,
identify, jog, frame, run/pause/resume/abort, recover — with output, streaming, console and UI
capability-gated per firmware.

| Family | Transport | Verification |
|---|---|---|
| GRBL v1.1 | WebSerial | **Hardware-verified** |
| grblHAL | WebSerial | **Hardware-verified** (Falcon A1 Pro, GrblHAL 1.1f) |
| FluidNC | WebSerial | Simulator only (settings read-only) |
| Marlin | WebSerial | Simulator only |
| Smoothieware | WebSerial | Simulator only |
| Ruida | File export only | `.rd` round-trip proven; never accepted by hardware |

Output dialects: `grbl-compatible`, `grbl-dynamic`, `grbl-raster`, `neotronics-4040-safe`, plus
`marlin-inline` (LASER_FEATURE) and `marlin-fan` (fan-mosfet). Twelve laser device profiles and
eight CNC machine presets ship in the catalog.

Streaming is exercised end-to-end against scripted firmware simulators
([`src/__fixtures__/controllers/`](src/__fixtures__/controllers/) — GRBL, Marlin, Smoothieware and
a Ruida decoder, over a fake serial port) driving the real application store rather than a mock.
grblHAL and FluidNC ride the GRBL driver with capability deltas rather than having simulators of
their own.

---

## Starting a job — the Frame-first model

KerfDesk has exactly one Start gate, and it is a physical one. **A completed Frame for the exact
current job** — matching bounds signature and origin identity — is what authorises Start, on both
laser and CNC. You watch the head trace the real job outline over the real material, and that
completed trace is the permit.

Everything else **informs**. Calculated bed overhang, no-go zones and controller-setting policy
surface as warnings in a single **Job Review** dialog that opens at Start; the operator reads them
and decides. They never refuse the job.

The only refusals that exist are factual, not policy: the serial channel cannot accept a stream
(disconnected, alarm, not idle, busy), the program cannot be produced (compile failure, NaN
coordinates, empty output), or the reviewed program is not the one about to be streamed.

This is a hard architectural rule, not a preference — see
[`docs/architecture/07-frame-permit-model.md`](docs/architecture/07-frame-permit-model.md) and
[`CONTRIBUTING.md`](CONTRIBUTING.md) before proposing anything that blocks an operator action.

---

## Getting started

### Requirements

- **Node.js 22 LTS.** `package.json` requires `>=22.13.0`; CI builds and tests only on 22.
- **pnpm 11.3.0** (pinned via `packageManager`; the repo is pnpm-only).
- **A Chromium-family browser** — Chrome, Edge, Brave or Arc. KerfDesk uses the File System
  Access API for projects and WebSerial for machine control; **Firefox and Safari cannot open or
  save files**. Brave may need WebSerial enabled under Shields/flags.

### Install and run

```bash
pnpm install
```

```bash
pnpm dev:web
```

The dev server listens on **http://localhost:5173** (`strictPort` — it fails rather than hopping
to another port if 5173 is busy).

### Build

```bash
pnpm build:web
```

Outputs the PWA-installable, fully offline web bundle to `dist/web`. Note this script also
regenerates the tracked file `public/third-party-notices.txt` before building — the output is
deterministic, so a clean tree normally stays clean.

```bash
pnpm preview:web
```

Serves the built bundle on **http://localhost:4173**.

### Desktop (Electron)

```bash
pnpm dev:desktop
```

Compiles the Electron main process, builds the web bundle, and launches Electron against it.
This is *not* a hot-reload loop — the renderer loads the built bundle over a custom `app://`
scheme, exactly as the packaged app does.

```bash
pnpm build:desktop
```

Packages a **Windows x64 NSIS installer** (the local script hard-codes `--win --x64`). A separate
preview release workflow also builds unsigned, un-notarized macOS x64 and arm64 DMGs. Linux is
web/PWA only.

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no
preload and no IPC handlers.

### Deployed web app

CI publishes the web build to Cloudflare Pages on every green `main` run; the canonical URL is
<https://kerfdesk.com> (see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

---

## Tests and quality gates

```bash
pnpm test
```

Vitest, jsdom, ~1,280 test files across `src/` and `electron/`. This is a large suite — expect it
to take a while.

```bash
pnpm release:check
```

The single gate CI runs. Thirteen sequential steps: `typecheck`, `lint`, `lint:electron`,
`format:check`, ADR numbering, license compliance, `test`, release-integrity, web build, Electron
main compile, and three file-size/export checks.

Individually:

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm format:check
```

Two traps worth knowing: **`prettier --check .` is repo-wide and is *not* part of `pnpm lint`**, so
a Prettier-dirty file passes lint locally and fails the release gate. And the dependency
vulnerability audit is **not** in the merge gate — it runs nightly and files a tracking issue
instead of blocking PRs.

A Playwright browser smoke (`pnpm test:e2e`) runs as a separate, observability-only workflow; it
does not gate merges or deploys.

### What is actually proven

The safety and correctness non-negotiables are enforced at different strengths — worth knowing
which is which:

| Invariant | Enforced by |
|---|---|
| Paths fit inside the configured bed | **Property test**, generated inputs |
| **Laser off on every travel move** — every `G0` carries inline `S0`, follows `M5`/`M107`, or runs under a sticky `S0` | **Property test**, generated inputs |
| Deterministic G-code — same input and parameters produce byte-identical output | **Property test** (fuzz seeds) + snapshots |
| `S` values match the device profile's `$30` max-power scale | **Property test** across `$30 ∈ {100, 255, 1000}` |
| Output coordinates match the device profile's origin | Unit tests + review |
| No partial output — a pipeline failure writes no file and sends no stream | Unit tests |
| Millimetres internally; inches converted only at the import boundary | Review |

CNC adds a Z-up-on-travel invariant and a spindle-start clearance check.

The invariant predicates read the *final emitted G-code text* rather than intermediate
structures. That is deliberate: a regression introduced anywhere upstream is caught because the
check reads what will actually be sent, and the same predicates can validate G-code produced by
external tools.

### The perceptual harness

Because green structural tests are not evidence that output *looks* right, the repo carries a
test-only measuring instrument at
[`src/__fixtures__/perceptual/`](src/__fixtures__/perceptual/). It rasterises pipeline output into
binary ink masks and scores them against ground truth using IoU, precision, recall and F1. Ground
truth for the synthetic fixtures is **analytic** — the same closed-form predicate generates both
the source bitmap and the truth mask, so there are no golden images to re-bless. Supporting
metrics cover what IoU cannot see: chamfer distance, centerline deviation/gap/fragment counts, and
chord sagitta for faceting. The instruments are themselves unit-tested before being trusted.

It runs as part of `pnpm test`, and it covers the trace engine, SVG import, scanline fill, the box
generator and CNC V-carve. For laser fill it closes the loop all the way to the controller text:
the emitted GRBL output is **re-parsed back into an ink mask** and scored against the source
geometry.

Be precise about its limits, because they matter:

- The G-code re-rasterisation path is exercised on **synthetic rectangles only** — a solid square,
  an annulus and a cross-hatched square. No traced or imported artwork is ever scored through
  emitted G-code.
- The trace tests score trace **geometry**, not G-code.
- **Raster/image engrave has no perceptual coverage at all.**
- The rasteriser is power-blind (any `G1` with `S>0` inks at full strength) and understands only
  `G0`/`G1` — no arcs, no Z. It measures geometric coverage, nothing else.
- IoU is blind to waviness and to the outline-vs-centerline gap.

A green perceptual suite rules out gross coverage regressions. It is not parity with LightBurn.

---

## Architecture

A pure-function pipeline core with strict module boundaries, built as a deliberate answer to the
1.0 codebase's shotgun-surgery problem.

```
import / draw / type / trace
            ↓
        Scene              SceneObject[] + Layer[] + run order   (the only persisted truth)
            ↓
   ┌────────┴────────┐     ← fork on machine kind
   ↓                 ↓
compileJob      compileCncJob                                    (pure, deterministic)
   ↓                 ↓
      Job = groups                cut | fill | raster | cnc
   ↓                 ↓
grblStrategy    cncGrblStrategy                                  (emit → G-code text)
marlinStrategy
smoothiewareStrategy
            ↓
   pre-emit invariant scan                                       (refuse before write/stream)
            ↓
   ┌────────┴────────┐
   ↓                 ↓
save to disk    stream to controller
```

`Job`, `Plan`, `Output` and emitted G-code are pure derivations from the project and are never
persisted — a reopened project always recompiles and cannot inherit a stale toolpath.

```
src/core/       pure: no I/O, no platform, no clock, no randomness
src/io/         parsers and serializers (svg, dxf, stl, lightburn, gcode, rd, project)
src/platform/   PlatformAdapter — File System Access API, WebSerial, drag-drop
src/ui/         React 18 + Zustand + Canvas2D, imports core and platform via DI
electron/       main process, CSP and renderer trust policy
```

Boundaries are enforced by `eslint-plugin-boundaries` in CI, not by convention: nothing in
`core/` may import from `io/`, `platform/` or `ui/`. State is modelled as discriminated unions
with exhaustive `assertNever` matching. Files are capped at 400 counted lines by ESLint with a 600
raw-line CI backstop.

Ten runtime dependencies, total: `clipper2-ts`, `dompurify`, `electron-updater`, `imagetracerjs`,
`lucide-static`, `opentype.js`, `react`, `react-dom`, `three`, `zustand`.

---

## Documentation

| Document | What it covers |
|---|---|
| [`PROJECT.md`](PROJECT.md) | Scope, phase plan, the non-negotiables |
| [`WORKFLOW.md`](WORKFLOW.md) | User flows, with success / error / empty / edge states |
| [`DECISIONS.md`](DECISIONS.md) | Every architectural decision and its rationale (ADRs) |
| [`CLAUDE.md`](CLAUDE.md) | The engineering operating manual — size limits, naming, checklists |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Process gates and what needs an ADR |
| [`SECURITY.md`](SECURITY.md) | Reporting vulnerabilities; security boundaries |
| [`RESEARCH_LOG.md`](RESEARCH_LOG.md) | Every external claim and library adoption, with sources |
| [`LIGHTBURN-STUDY.md`](LIGHTBURN-STUDY.md) · [`EASEL-STUDY.md`](EASEL-STUDY.md) | Reference-behaviour ledgers and known divergences |

[`docs/architecture/`](docs/architecture/) is the code-grounded tour, in reading order: the stack
and why, the pipeline spine, coordinates and origin, the laser chain, the CNC chain, controllers
and transport, the Frame permit model, invariants and verification, and an honest
[weakness register](docs/architecture/09-weakness-register.md).

Documentation density lags the code in places — several shipped features are ahead of their
entries in `PROJECT.md`. Where a document and the code disagree, **the code is authoritative**.

---

## Security posture

Imported SVG, DXF, image, font, project and material-library files are all treated as untrusted
input: sanitised, depth-capped and size-checked before parsing — hard caps on project, library,
STL and G-code reads, and a confirmation prompt on unusually large SVG, DXF and image files. The
web build ships a strict CSP
with no inline scripts and no third-party CDNs. There is **no telemetry** — no analytics, error
reporting, cloud sync or account data; nothing about your projects, machine or jobs leaves your
computer. The only permitted network call is a desktop-only, anonymous, metadata-only release
check on launch in packaged preview builds.

Report vulnerabilities privately via [`SECURITY.md`](SECURITY.md) — please don't test suspected
machine-control issues on an energized laser or spindle.

---

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first, then [`CLAUDE.md`](CLAUDE.md). Two rules catch
most newcomers:

1. **Never add a guard.** Anything that blocks, refuses, caps, hides or adds a confirmation before
   an otherwise-available operator action will be rejected on sight. Findings belong in the Job
   Review warnings list, which informs and never refuses.
2. **Verify, don't guess.** Every factual claim in a PR — an API signature, a version range, a
   `$` setting, a G-code behaviour, a LightBurn behaviour — must be backed by something you
   actually read or ran, and cited so a reviewer can check it.

PR titles follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`,
`ci:`).

---

## License

[MIT](LICENSE) © 2026 Johann Stolk.

Bundled dependencies, fonts and assets remain under their own licenses — see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the readable summary and
`public/third-party-notices.txt` for the generated, complete notice file.
