# KerfDesk

> Free, open-source CAM for GRBL **laser cutters, engravers, and CNC routers**. One app for both kinds of machine. Design, trace, preview, generate G-code, and stream it straight to your machine. It runs entirely in your browser, works offline after the first load, and is MIT licensed.

**Try it now: <https://kerfdesk.com>**. No install, no account, no sign-up. (Cloudflare fallback: <https://laserforge-2fj.pages.dev>.)

> ⚠️ **KerfDesk is young and under active development.** It already does a lot, but I am building it in the open, and I want your help to make it genuinely good. If you own a laser or a CNC router, **testers and honest feedback are the most useful thing you can give me**. See [Help build it](#help-build-it).

---

## A CAM tool that lives in your browser

As far as I know, KerfDesk is the first tool that does the *whole* CAM job in the browser: import or draw your artwork, trace it to vectors, assign cut / fill / engrave operations per layer, preview the toolpath, generate correct G-code, and **stream it to the machine over Web Serial**, with nothing to install.

You load the page once. It caches itself, so from then on it runs **fully offline**, on a workshop PC with no internet, installed as an app from the browser menu. No account, no telemetry, no cloud round-trips. Your designs and material libraries stay on your machine.

- **Zero-install and offline-first.** The full app runs in any Chromium browser (Chrome, Edge, Brave) on Windows, macOS, and Linux. Install it as a PWA and it keeps working with the network unplugged. A native **Windows desktop app** ships from the same codebase.
- **One app, two machines.** Laser cutting and engraving *and* CNC routing, from the same design, with the workflow switching cleanly between them. See [Laser and CNC in one app](#laser-and-cnc-in-one-app).
- **The workflow you already know.** Colour-as-layer design, a Cuts/Layers panel with per-layer mode / power / speed / passes, and a Laser panel for jogging, framing, and streaming.
- **Deterministic, safety-checked G-code.** The same input produces byte-identical output (snapshot-tested in CI), with property-tested safety invariants such as *laser off on every travel move* and *never exceed the machine's power scale*.

---

## Placement without a camera

The hardest everyday problem on a hobby laser or router is simple to state: *"I want the design to land exactly here on this piece of material."* Commercial tools solve it with an overhead camera. But a lot of machines have **no camera and no homing switches**, so the software cannot see where the material is and has no fixed reference to measure from. Lining things up becomes guesswork: pencil a mark, jog, test-burn, find it off, jog again, waste material.

KerfDesk gives you **two camera-free ways** to solve this, for the two situations you actually face. They are the same idea from opposite directions. Both rest on one foundation, so start here.

### The foundation: Set Origin and the Verified Frame (no-homing machines)

If your machine has no homing switches, it has no fixed reference point, so KerfDesk cannot know *where* on the bed your job will land. You tell it, by hand, once per setup. This is what makes accurate placement possible without a camera, and it is why hand-positioned machines get the frustrating "design overhangs the bed" error in other software.

1. **Position the head** where you want the design's origin (its zero point) to be. Jog it there with the jog buttons, or use **Release motors** to push the gantry by hand and then wake it.
2. **Click "Set origin here."** That exact spot becomes the job's zero point (it sends a `G92` work origin). From now on the design is placed relative to this point.
3. **Switch the start mode to Verified Origin.** In this mode KerfDesk trusts the origin you set and only checks that the job *fits* the bed (its size), instead of guessing *where* it is on the bed, which it cannot know without homing. The false "overhangs the bed" block does not fire here.
4. **Click Frame to run a Verified Frame.** The head traces the outline of your job so you can watch it and confirm it lands on your material. This frame is **required**: Start stays disabled until a clean Verified Frame has run. If a limit switch trips while framing, KerfDesk names the edge it hit so you can move the origin or shrink the job.
5. **Press Start.** If you later move the origin or change the job, the frame check clears and you simply frame again.

> One caveat if you push the gantry by hand: set the origin **last**. Waking the motors can reset a `G92` origin, and after a hand-move the reported position is meaningless until you set the origin, because GRBL machines have no position feedback.

The **Registration Jig** below uses this directly (you set the origin, then burn). The **Place Board** tool does step 2 for you: capturing the first corner sets the origin automatically.

### 🎯 Registration Jig: burn a reference, then drop your blank into it

**Use it when** you have a small blank (a keychain, a coaster, a tumbler face) and you want a design centred on it, but you have no camera to see it and, often, no homing to re-establish an origin.

**Why it exists.** On a no-homing, no-camera machine there is no way to see the workpiece or return to a known origin, so centring a burn on an object is trial and error. The Registration Jig gives you a *real, burnable* reference: you burn an outline first, drop the object into it, and burn the art into the object. Because both burns are anchored to the **same origin** (the outline's bounds, not each run's own bounds), the artwork lands exactly where it sits relative to the outline instead of jumping to a bed corner. That alignment is property-tested.

**How to use it:**

1. **Open the panel.** Click **Registration Jig** in the toolbar. A small panel opens beside the canvas and stays open while you work.
2. **Set your anchor (no-homing machines).** Do the Set Origin and Verified Frame steps above, so both runs share one trusted origin. A homed machine can skip this.
3. **Create the outline.** Pick **Rectangle** or **Circle**, type the size in mm (rectangle = width and height; circle = diameter), and click **Create**. The outline appears on a reserved *registration* layer, centred on the bed. Optionally drag it onto your material and tick **Lock outline** so it cannot drift between the two burns.
4. **Burn run 1, the outline.** Set the run toggle to **Outline only** (the banner reads *"Next Start burns: JIG outline"*) and press **Start**. Only the outline burns, onto a scrap sheet or masking tape.
5. **Place the workpiece** inside the burned outline. It is now in a known position.
6. **Add and centre your artwork.** Import or draw your design, select it, and click **Center artwork in outline** (or position it by hand relative to the outline).
7. **Burn run 2, the artwork.** Set the toggle to **Artwork only** (*"Next Start burns: your ARTWORK"*) and press **Start**. Only the artwork burns, landing on the object exactly where it sits on screen.
8. **Remove the outline** when you are done.

### 📐 Place Board: your material is already down? Capture where it is

**Use it when** you have already laid a board, offcut, or blank on the bed and you want the design placed on it (usually centred), on a machine with no camera and no homing.

**Why it exists.** The Registration Jig burns the reference first and you drop material into it. Place Board is the inverse: the material is **already there**, so instead of burning a reference, you *measure* where the material is by jogging the head to its corners and capturing each position. It is the answer to *"I put a board on the bed, now put the artwork on it."*

**How to use it:**

1. **Connect** the machine and wait for it to report **Idle**. Click **Place Board** in the toolbar (next to Registration Jig). A panel opens beside the canvas.
2. **Capture the bottom-left corner.** Using the Laser panel's jog buttons, jog the head to the **bottom-left** corner of your board, then click **Capture corner**. This one must be first: it sets the work origin (G92) at that physical point.
3. **Capture the other three corners** in any order, jogging to each and clicking **Capture corner**. KerfDesk measures the board from the four points. *(Shortcut: after the first corner you can instead type the board's width and height, if you already know them.)*
4. **Create the outline.** The panel shows the measured **Width x Height**. Check it against a ruler, then click **Create board outline**. A dashed rectangle of that exact size appears on the canvas, and placement switches to your captured origin.
5. **Place your artwork.** Select your design and click **Center** (or a corner button) to snap it onto the board outline.
6. **Test, then burn.** Optionally use **Jog head to** to send the head to that spot on the real board and eyeball it, run a low-power frame, then press **Start**. The artwork burns onto the physical board where it sits.

> **One rule for both tools:** always position with the **jog buttons**, never by pushing the head by hand. GRBL machines are open-loop (no position feedback), so a hand-moved head reports the wrong location. Place Board works for **both laser material and CNC stock**.

---

## ✒️ Image tracing: five tuned modes, all clean-room code

Turn a bitmap (PNG or JPG) into vector paths you can cut or engrave. Import an image, select it, open **Trace Image**, and a live preview re-traces as you change settings so you can compare the result against the source before committing.

The whole tracer is **KerfDesk's own from-scratch code**. There is no potrace and no GPL-licensed tracing engine anywhere in it.

Five presets, each for a different kind of input and producing a different kind of geometry:

| Preset | Best for | What it produces |
|---|---|---|
| **Line Art** *(default)* | Clean black-on-white logos and line drawings | Filled silhouette contours (holes in letters stay hollow) |
| **Smooth** | Slightly noisy or hand-drawn line art with curves | Filled contours, with noise smoothed out |
| **Sharp** | Pixel art, blueprints, technical drawings | Filled contours with every notch and corner kept, no blur |
| **Centerline** | A pen or marker stroke that should engrave once | A single path down the *middle* of each stroke, not a doubled outline |
| **Edge Detection** | Full-colour art that should become a line drawing | Single-stroke lines that follow the brightness edges |

Beyond the presets you get direct control: a **Cutoff / Threshold** brightness band, **Ignore Less Than** (drops speckle), **Smoothness**, **Optimize**, and a transparency-aware alpha mask. A **region box** lets you either crop the trace to one area or **enhance** a small feature by re-tracing just that region at higher resolution and patching it back in, which is useful for a bit of small text that a full-image trace softened. The traced vectors overlay the source pixel-for-pixel so you can check the fit.

**When not to trace:** photographs and shaded, continuous-tone images should be engraved directly as a **raster Image layer** (dithered or grayscale), not traced.

Trace fidelity is guarded by a perceptual test harness that renders the trace back to pixels and diffs it against ground-truth masks, so a quality regression trips a test rather than shipping silently.

---

## 📦 Box generator: parametric finger-jointed boxes

Generate cut-ready flat-pack boxes from inner or outer dimensions and material thickness:

- **Styles:** closed 6-panel, open-top, and slide-lid (slotted walls plus a thumb-notch lid).
- **Dividers:** X/Y grids with egg-crate cross-laps and through-slot tabs.
- **Panel cutouts** (windows, holes) carried onto their own layers.
- **Fit compensation:** joint clearance for lasers, corner-overcut relief for CNC, baked into the generated geometry as a single source of truth.
- **Proven joinery:** every finger and slot pair is verified complementary by a property-tested "assembly referee" across a 1,100+ case seeded benchmark. No loose corners, no guessing.

Panels drop into the scene as named, editable shapes, laid out on the sheet with spacing. Preview, tweak layers, and cut.

---

## Laser and CNC in one app

KerfDesk is not a laser tool with a bolted-on router mode. It runs **both machine types from the same design and the same G-code core**, and the interface adapts to whichever you have connected:

- **Laser:** Line (vector cut), Fill (hatch with angle, interval, cross-hatch, overscan, and scanning-offset compensation), and Image (raster engrave with threshold, Floyd-Steinberg, or grayscale dithering). Per-layer power, speed, passes, kerf offset, and tabs/bridges.
- **CNC router:** profile, pocket, and engrave toolpaths, V-carving, depth passes, a tool library, STL relief roughing and finishing with a 3D preview, tiling with registration holes, Z/XYZ corner probing, and feed/spindle overrides.

The Place Board tool above works for both: laser material or CNC stock.

---

## Everything else

**Design and import:** SVG import (sanitized), DXF import, STL import for CNC relief work, text with bundled fonts, rectangle/ellipse/polygon/pen drawing tools, alignment and distribution, undo/redo, `.lf2` project files, and a built-in design library.

**Preview and estimates:** toolpath preview with travel moves, dithered raster burn simulation, a scrubbable job timeline, and planner-aware time estimates.

**Machine control:** connect over Web Serial (browser) or serial (desktop), then jog, home, frame the job's true footprint, pause/resume/stop with real-time GRBL commands, decode alarms with guided recovery, use a console, back up `$$` settings, and run a guided device-setup wizard. Keep-awake holds the screen lock during long jobs.

**Materials:** material libraries (`.lfml.json`) with a recipe wizard, auto-save, and generated **Material Test** (power by speed grid) and **Interval Test** patterns to dial in new materials.

**Camera mode:** an optional overhead-camera overlay for people who do have a camera, with manual 4-point alignment plus fisheye lens calibration. Handy, but not required, thanks to the two camera-free placement tools above.

**Controllers:** GRBL v1.1 and grblHAL are verified on real hardware; Marlin, Smoothieware, and FluidNC are supported and simulator-verified; Ruida has experimental file-only `.rd` export. Device profiles ship for common diode machines, and `.lbdev` device backups import directly.

---

## Help build it

KerfDesk is an open-source project I am building so that anyone, anywhere, can drive their laser or router for free. It is real and usable today, but it is still early, and the most valuable help right now is **people running it on real machines and telling me what happens.**

A few features are code-complete and pass their automated tests but have **not yet been confirmed on hardware**, especially the Registration Jig and Place Board placement flows, and several of the material and controller paths. Automated tests prove the G-code is structurally correct and deterministic. They cannot prove a burn actually lands centred on your coaster. That is exactly where testers come in.

**How you can help:**

- **Try it on your machine** and tell me what worked and what did not: which controller, which machine, what you were cutting.
- **Report bugs and rough edges** as GitHub issues. Screenshots, the machine you used, and the steps to reproduce are gold.
- **Suggest features and workflows.** If your machine or material needs something KerfDesk does not do yet, say so.
- **Share device profiles** for machines that are not yet covered.
- **Contribute code** if you like. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

If you build things with a laser or a router, your feedback directly shapes where this goes. Thank you for helping.

---

## Getting started

**Just using it?** Open <https://kerfdesk.com>, plug in your laser or router, and click *Connect*. Install it from the browser menu for offline use. A Windows installer is also built from this repo (`pnpm build:desktop`).

**Hacking on it?**

```bash
pnpm install
pnpm dev:web       # Vite dev server (browser)
pnpm dev:desktop   # Vite + Electron (desktop)

pnpm test          # Vitest: unit + property + snapshot
pnpm lint          # ESLint incl. module-boundary and file-size rules
pnpm typecheck     # tsc --noEmit (strict)
pnpm build:web     # static bundle to dist/web
```

Stack: TypeScript (strict), React 18, Zustand, Canvas2D, Vite, Vitest with fast-check, and Electron for the desktop shell. The geometry/G-code core (`src/core/`) is pure functions, with no DOM, no I/O, and no clock, which is what makes the output deterministic and property-testable.

## Project documentation

| Document | What is in it |
|---|---|
| [`PROJECT.md`](./PROJECT.md) | Product scope, non-negotiables, phase plan |
| [`WORKFLOW.md`](./WORKFLOW.md) | Every user flow with success / error / empty / edge states |
| [`DECISIONS.md`](./DECISIONS.md) | The full ADR log: every architectural choice and why |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How changes land: ADR process, tests, Conventional Commits |
| [`RESEARCH_LOG.md`](./RESEARCH_LOG.md) | Every dependency and external claim, with license and provenance |
| [`docs/safety.md`](./docs/safety.md) | Machine safety guide, please read it |

## Safety

KerfDesk drives machines that can cause fire and serious injury. Preview or air-run every job, never leave a running machine unattended, and read [`docs/safety.md`](./docs/safety.md). The software is provided as-is, without warranty of any kind.

## License

**MIT**, see [`LICENSE`](./LICENSE). Bundled third-party libraries and fonts remain under their own permissive licenses; the required notices ship with the app and are listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). Dependency licensing is gated in CI (`pnpm license-check`): MIT-compatible only.

## Acknowledgements

- **CNCjs**, the canonical open-source GRBL streaming reference.
- **grblHAL, FluidNC, µCNC**, for keeping the GRBL 1.1 wire protocol alive and evolving.
- **React, Zustand, three.js, DOMPurify, opentype.js, clipper2-ts, Lucide** and the other open-source libraries KerfDesk stands on. Full notices in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
