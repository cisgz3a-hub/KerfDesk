# KerfDesk

> Free, open-source CAM for GRBL laser cutters, engravers, and CNC routers. Design, trace, preview, generate G-code, and stream it to your machine — straight from the browser, or from the Windows desktop app. One codebase, MIT licensed.

**Try it now: <https://kerfdesk.com>** — no install, no account. Works in any Chromium browser (Chrome, Edge, Brave) on Windows, macOS, and Linux, talks to your machine over Web Serial, and installs as an offline-capable PWA.

## Why KerfDesk

- **Zero-install.** The full app — canvas, tracing, G-code generation, machine streaming — runs in the browser. Install it as a PWA and it keeps working offline.
- **The workflow you already know.** Color-as-layer design, a Cuts/Layers panel with per-layer mode / power / speed / passes, a Laser panel for jogging, framing, and streaming.
- **Local-first and private.** No accounts, no telemetry, no cloud round-trips. Your designs and material libraries live on your machine.
- **Deterministic, safety-checked G-code.** Same input produces byte-identical output (snapshot-tested in CI), with property-tested invariants like *laser off on every travel move* and *never exceed the machine's power scale*.

## Headline features

### 🎯 Registration Jig — accurate placement without a camera

Most tools solve "put the artwork exactly on this object" with an overhead camera. KerfDesk has a camera mode too — but the **Registration Jig** solves it with nothing but your laser:

1. **Create a jig outline.** Open *Registration Jig* in the toolbar, pick a rectangle or circle, enter the size of your object (coaster, tumbler blank, phone case…), and drag the outline to where the object will sit on the bed.
2. **Run 1 — burn the outline.** The jig lives on its own reserved layer; the panel disables every other layer's output, so *Start* burns only the box onto your spoilboard or masking paper.
3. **Place the object** inside the burned outline. It is now at a known position.
4. **Run 2 — burn the artwork.** Add your design, position it relative to the outline on the canvas (one click centers it), toggle outputs, and start again. Both runs anchor to the same origin, so the artwork lands on the object exactly where it sits on screen.

It works on machines **without homing switches** (paired with hand-set, verified origins) and on homed machines (both runs emit at true absolute positions). The two-run alignment is property-tested, and the jig round-trips through project save/load.

### ✒️ Image tracing — five tuned modes with live preview

Import a PNG/JPG and vectorize it with a live, worker-rendered preview:

| Preset | What it's for |
|---|---|
| **Line Art** | Logos, signs, monochrome drawings — silhouette contours |
| **Centerline** | Pen strokes and script traced as *one* path down the middle, not a doubled outline |
| **Edge Detection** | Full-color art — a clean-room Canny edge detector turns every brightness transition into single-stroke vectors |
| **Smooth** | Hand-drawn or noisy scans (auto median filter + heavier despeckle) |
| **Sharp** | Pixel art, blueprints, technical drawings — corners stay corners |

Plus direct control of cutoff/threshold, smoothness, optimize, and despeckle; **region enhance** to re-trace a small area supersampled and patch it back in; and the source image stays as an overlay so you can compare the trace against it. Trace fidelity is guarded by a perceptual test harness that diffs rendered output against ground-truth masks — not just "the code ran."

### 📦 Box generator — parametric finger-jointed boxes

Generate cut-ready flat-pack boxes from inner or outer dimensions and material thickness:

- **Styles:** closed 6-panel, open-top, and slide-lid (slotted walls + thumb-notch lid).
- **Dividers:** X/Y grids with egg-crate cross-laps and through-slot tabs.
- **Panel cutouts** (windows, holes) carried onto their own layers.
- **Fit compensation:** joint clearance for lasers, corner-overcut relief for CNC — baked into the generated geometry, single source of truth.
- **Proven joinery:** every finger/slot pair is verified complementary by a property-tested "assembly referee" across a 1,100+ case seeded benchmark. No loose corners, no guessing.

Panels drop into the scene as named, editable shapes, laid out on the sheet with spacing — preview, tweak layers, and cut.

## Everything else

**Design & import** — SVG import (sanitized), DXF import, STL import for CNC relief work, text with bundled fonts, rectangle/ellipse/polygon/pen drawing tools, alignment & distribution, undo/redo, `.lf2` project files, a built-in design library.

**Layers & operations** — color-driven layers with **Line** (vector cut), **Fill** (hatch with angle, interval, cross-hatch, overscan, scanning-offset compensation), and **Image** (raster engrave with threshold / Floyd–Steinberg / grayscale dithering) modes; sub-layer operations (fill then line); per-layer power, speed, passes, kerf offset, and tabs/bridges.

**Preview & estimates** — toolpath preview with travel moves, dithered raster burn simulation, a scrubbable job timeline, and planner-aware time estimates.

**Machine control** — connect over Web Serial (browser) or serial (desktop): jog, home, frame the job's true footprint, pause/resume/stop with real-time GRBL commands, alarm decoding with guided recovery, a console, `$$` settings backup, and a guided device-setup wizard. Keep-awake holds the screen lock during long jobs.

**Materials** — material libraries (`.lfml.json`) with a recipe wizard, auto-save, and generated **Material Test** (power × speed grid) and **Interval Test** patterns to dial in new materials.

**Camera mode** — optional overhead-camera workspace overlay: manual 4-point homography alignment plus fisheye lens calibration (guided checkerboard, in-browser Levenberg–Marquardt fit, WebGL undistort). Handy — but not required, thanks to the registration jig.

**CNC router mode** — a gated second product track: profile/pocket/engrave toolpaths, V-carving, depth passes, tool library, STL relief roughing/finishing with a 3D preview, tiling with registration holes, Z/XYZ corner probing, and feed/spindle overrides.

**Controllers** — GRBL v1.1 and grblHAL are verified on real hardware; Marlin, Smoothieware, and FluidNC are supported and simulator-verified; Ruida has experimental file-only `.rd` export. Device profiles ship for common diode machines, and `.lbdev` device backups import directly.

## Getting started

**Just using it?** Open <https://kerfdesk.com>, plug in your laser, click *Connect*. Install it from the browser menu for offline use. A Windows installer is also built from this repo (`pnpm build:desktop`).

**Hacking on it?**

```bash
pnpm install
pnpm dev:web       # Vite dev server (browser)
pnpm dev:desktop   # Vite + Electron (desktop)

pnpm test          # Vitest: unit + property + snapshot (~3,600 tests)
pnpm lint          # ESLint incl. module-boundary and file-size rules
pnpm typecheck     # tsc --noEmit (strict)
pnpm build:web     # static bundle to dist/web
```

Stack: TypeScript (strict), React 18, Zustand, Canvas2D, Vite, Vitest + fast-check, Electron for the desktop shell. The geometry/G-code core (`src/core/`) is pure functions — no DOM, no I/O, no clock — which is what makes the output deterministic and property-testable.

## Project documentation

| Document | What's in it |
|---|---|
| [`PROJECT.md`](./PROJECT.md) | Product scope, non-negotiables, phase plan |
| [`WORKFLOW.md`](./WORKFLOW.md) | Every user flow with success / error / empty / edge states |
| [`DECISIONS.md`](./DECISIONS.md) | The full ADR log — every architectural choice and why |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How changes land: ADR process, tests, Conventional Commits |
| [`RESEARCH_LOG.md`](./RESEARCH_LOG.md) | Every dependency and external claim, with license and provenance |
| [`docs/safety.md`](./docs/safety.md) | Machine safety guide — please read it |

## Safety

KerfDesk drives machines that can cause fire and serious injury. Preview or air-run every job, never leave a running machine unattended, and read [`docs/safety.md`](./docs/safety.md). The software is provided as-is, without warranty of any kind.

## License

**MIT** — see [`LICENSE`](./LICENSE). Bundled third-party libraries and fonts remain under their own permissive licenses; the required notices ship with the app and are listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). Dependency licensing is gated in CI (`pnpm license-check`): MIT-compatible only.

## Acknowledgements

- **CNCjs** — the canonical open-source GRBL streaming reference.
- **grblHAL, FluidNC, µCNC** — for keeping the GRBL 1.1 wire protocol alive and evolving.
- **React, Zustand, three.js, DOMPurify, opentype.js, imagetracerjs, clipper2-ts, Lucide** — the open-source libraries KerfDesk stands on. Full notices in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
