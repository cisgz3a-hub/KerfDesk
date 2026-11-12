# KerfDesk

**Laser and CNC software in one app.** Import or draw artwork, give it named cut, fill, image or
CNC operations, preview the toolpath, and send the job to your machine — from a Chromium browser
tab at <https://kerfdesk.com> or from the desktop app for Windows, macOS and Linux. Both are built
from this one codebase.

KerfDesk follows LightBurn's workflow for lasers and Easel/Carbide conventions for routers, so
people coming from those tools find things where they expect them.

> **Naming.** The product is **KerfDesk**. The npm package (`laserforge`), the Electron app id
> (`dev.laserforge.app`) and some internal documents still say *LaserForge 2.0*. Those identifiers
> stay as they are on purpose: changing them would break upgrades and move saved user data. See
> [`src/core/app-branding.ts`](src/core/app-branding.ts).

---

## Status — read this before you cut anything

KerfDesk is in active development. **No machine or controller is qualified.** The automated tests
prove that output is structurally correct and repeatable — the same project always produces the
same G-code, the laser is off on every travel move, paths stay inside the bed. They do not prove
that a burn or a cut *looks* right on real material.

| Area | Where it stands |
|---|---|
| GRBL and grblHAL lasers and routers | Used informally on a Creality Falcon A1 Pro and a Neotronics 4040. Not qualified. |
| FluidNC, Marlin, Smoothieware | Tested against simulators only |
| Ruida (`.rd` export, desktop UDP link) | Simulator and round-trip tests only; never run on a real controller |
| Stock K40 (Lihuiyu) `.egv` export and USB link, Moshiboard over USB | Experimental; simulator only |
| JCZ LMC galvo (EZCad2: fiber, MOPA, UV) over USB | Experimental; simulator only |
| Rotary (Y, A or Z axis) | Code and tests; not qualified on hardware |
| Desktop installers | Published for Windows; macOS and Linux builds pass CI |

**Check every program in an independent G-code viewer before you run it, keep the work area
clear, and stay at the machine.** The in-app Abort is a software stop, not a safety-rated E-stop.
Use the machine's physical E-stop or power switch when anything goes wrong.

---

## What it does

### Design and import

- **Import** SVG, DXF, PDF and Illustrator, EPS/PostScript, HP-GL/PLT, PNG, JPEG, BMP, GIF, TIFF,
  PSD, STL, LightBurn projects (`.lbrn`, `.lbrn2`) and cut libraries (`.clb`), fonts and CSV data.
  All imports share one picker, `Ctrl/Cmd+I` and drag-and-drop.
- **Draw** rectangles, ellipses, polygons, stars and pen paths; edit nodes; weld, subtract,
  intersect and offset shapes.
- **Text** with bundled outline and single-line fonts, your own `.ttf`/`.otf` files, and variable
  text from CSV, serial numbers and dates. QR codes and barcodes.
- **Trace** images into vectors, and edit photos and vectors in **Design Studio**.
- **Arrange** with alignment, grid and circular arrays, and nesting.

### Laser

- **Line**, **Fill** and **Image** operations, with sub-layers to stack fill then line.
- Fill styles include hatch, cross-hatch, follow-shape and island fill, plus a **Ramp** for
  rubber stamps.
- Image engraving with many dither modes, including **3D Sliced** for depth maps.
- Tabs, lead-in/lead-out, overcut, perforation, kerf compensation, bidirectional scanning with
  timing compensation, and material test grids.
- **Rotary** jobs on a Y-port roller or a dedicated A or Z axis, including tapered glasses.
- **Camera** alignment with USB, network and RTSP cameras.

### CNC / router

- Profile, pocket, engrave, drill, **V-carve** and inlay pairs.
- Pocket clearing by offset rings, raster, or **adaptive clearing**, with rest machining.
- Depth passes, ramp and helical entry, holding tabs, multi-tool jobs with manual tool change.
- **3D relief** roughing and finishing from STL models and height maps.
- Tiling for jobs bigger than the bed, touch-plate probing, a tool library, a feeds and speeds
  calculator, and spoilboard surfacing.

Cut order is a safety rule: pockets and engraving run first and outside profiles run last, so a
part is finished before the cut that frees it.

### Running a job

- Connect over USB (WebSerial), jog, home, set the origin, **Frame**, then **Start**. A
  **G-code Inspector** opens any `.nc`, `.gcode` or `.tap` file, or the job you are about to run,
  in a 3D viewer with playback.
- **Recovery** after a lost connection shows where the job stopped and lets you continue.
- A **guided first job** and a **Simple view** help new users.
- **Phone and MCP access** (desktop, off by default): pair a phone or an MCP client to view and
  edit the open project and, only if you separately approve it, to jog, frame and start jobs.
  See [`docs/mcp/remote-control.md`](docs/mcp/remote-control.md).

### Free and Pro

KerfDesk is free to use. A few tools are **Pro** and need a trial or a paid licence: V-carve, 3D
relief, adaptive clearing, advanced tracing, camera alignment, the registration jig, Place Board,
the box generator and Design Studio (the list lives in
[`src/ui/licensing/pro-features.ts`](src/ui/licensing/pro-features.ts)). A licence never blocks
Frame, Start, saving G-code or a running job, and a project that already holds Pro work still
runs after a trial ends.

---

## Starting a job — Frame first

KerfDesk has one Start gate, and it is physical: **a completed Frame of the current job**, with
the same outline and origin. You watch the head trace the job over the real material, and that
trace is what allows Start, on lasers and routers alike.

Everything else is advice. Bed overhang, no-go zones and controller-setting concerns appear as
warnings in **Job Review** when you press Start; you read them and decide. KerfDesk refuses only
when something factually cannot work: the controller cannot take the stream, the program cannot
be produced, or the reviewed program is not the one about to be sent. See
[`docs/architecture/07-frame-permit-model.md`](docs/architecture/07-frame-permit-model.md).

---

## Controllers and file formats

| Controller | Connection |
|---|---|
| GRBL 1.1, Marlin, Smoothieware | USB (WebSerial) |
| grblHAL, FluidNC | USB (WebSerial); network (raw TCP / Telnet) on the desktop |
| Ruida | `.rd` file export; experimental UDP link on the desktop |
| Stock K40 (Lihuiyu M2/M3 Nano) | `.egv` file export; experimental USB link (WebUSB) |
| Moshiboard | Experimental USB link (WebUSB) |
| JCZ LMC galvo (EZCad2: fiber, MOPA, UV) | Experimental USB link (WebUSB) and red-light Frame; no job file |

**Writes** G-code (`.gcode`, `.nc`, including per-tile files), Ruida `.rd`, K40 `.egv`, KerfDesk projects
(`.lf2`), SVG and PNG exports, traced vectors (SVG, DXF, PDF, EPS, GeoJSON), material libraries
and machine profiles.
LightBurn interoperability is one-way: KerfDesk reads LightBurn files and writes none.

KerfDesk projects are versioned JSON. Older projects are migrated forward automatically when they
open.

---

## Privacy

There are no accounts, analytics, advertising or automatic crash reports, and projects stay on
your computer. The network connections KerfDesk does make are listed in the
[privacy notice draft](docs/legal/kerfdesk-privacy-notice.md): update checks, the licence check
for a Pro trial or licence, cameras and machines you add yourself, and phone/MCP access if you
turn it on.

Report security problems privately as described in [`SECURITY.md`](SECURITY.md). Please do not
test suspected machine-control issues on a powered laser or spindle.

---

## Development

### Requirements

- **Node.js 22** (`>=22.13.0`) and **pnpm 11.3.0** (pinned in `package.json`).
- **A Chromium browser** — Chrome, Edge, Brave or Arc — for WebSerial and the File System Access
  API. Firefox and Safari can open a dropped file but save by downloading, and cannot connect to
  a machine.

### Run the web app

```bash
pnpm install
```

```bash
pnpm dev:web
```

The dev server runs at <http://localhost:5173>.

### Build

```bash
pnpm build:web
```

Builds the offline-capable web app into `dist/web`.

```bash
pnpm dev:desktop
```

Builds the Electron main process and the desktop bundle, then launches Electron.

```bash
pnpm build:desktop
```

Packages the Windows x64 installer. The release workflows also build macOS DMGs and Linux
AppImage and `.deb` packages.

### Command-line tracer

```bash
pnpm trace --preset "Line Art" --format svg -o art.svg art.png
```

Traces an image to SVG, DXF, PDF, EPS or GeoJSON with the app's own tracer. `pnpm trace --help`
lists every option.

### Tests and checks

```bash
pnpm test
```

```bash
pnpm release:check
```

`pnpm release:check` is the full gate CI runs: type checks, lint, formatting, ADR numbering,
licence and privacy checks, every test suite, the web and Electron builds, and size checks. Run
`pnpm typecheck`, `pnpm lint` or `pnpm format:check` on their own for a quicker loop.

### Architecture

The core is a pure, deterministic pipeline: the project's scene compiles to a job, the job emits
G-code for the chosen controller, and an invariant scan reads the final G-code before anything is
saved or streamed. Toolpaths and G-code are never saved in a project; they are rebuilt every
time it opens.

```text
src/core/       pure logic: no I/O, no clock, no randomness
src/io/         file parsers and writers
src/platform/   browser and desktop adapters (files, WebSerial, WebUSB)
src/ui/         React + Zustand interface
electron/       desktop main process
```

Module boundaries and a 400-line file limit are enforced by ESLint in CI.
[`docs/architecture/`](docs/architecture/) is the guided tour of the code.

---

## Documentation

| Document | What it covers |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Repository rules for contributors and coding agents |
| [`PROJECT.md`](PROJECT.md) | Scope, delivery targets and non-negotiables |
| [`WORKFLOW.md`](WORKFLOW.md) | User flows, including error and edge cases |
| [`DECISIONS.md`](DECISIONS.md) and [`docs/decisions/`](docs/decisions/) | Architecture decisions (ADRs) |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each desktop release |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How changes are proposed and reviewed |
| [`website/`](website/README.md) | The product website at kerfdesk.com |

Where a document and the code disagree, the code is the authority.

---

## Licence

© 2026 Johann Stolk. All rights reserved; see [`LICENSE`](LICENSE). KerfDesk is free to use under
its [License & Safety Notice](public/eula.txt), except features marked Pro, which need a trial or
a paid licence. Versions up to and including the `mit-final` tag keep the licence they were
released under, as [`LICENSE`](LICENSE) explains.

Bundled dependencies, fonts and assets keep their own licences; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
