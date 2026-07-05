# ARCHITECTURE.md — Repository architecture (audit map)

> Phase 1 deliverable. Evidence-based map of the whole repo, built to orient the
> sector audit. Facts are tagged **[verified]** (I opened the file / ran the
> command this session) or **[per-doc]** (asserted by `PROJECT.md`/`DECISIONS.md`,
> to be confirmed in the owning sector pass). Nothing here is a finding; findings
> live in `FINDINGS.md`.

Audit worktree: `C:\Users\Asus\LaserForge-2.0\.claude\worktrees\gifted-goldstine-28dc0b`
Branch: `claude/gifted-goldstine-28dc0b`. Date: 2026-07-05.

---

## 1. What the app is

**KerfDesk** (user-facing product) / **LaserForge 2.0** (repo + package internal
name) — a focused, LightBurn-style CAM application for **GRBL laser cutters/engravers**,
extended into a **CNC/router mode** and **multi-controller** support. Ships as **one
codebase → web app + Windows desktop (Electron)**. [verified: `index.html:8` title
"KerfDesk"; `package.json:2` name "laserforge"; `PROJECT.md` Product goal]

Pipeline shape: import/draw vectors, text, traced art, raster images, or generated
shapes → assign cut/fill/image operation per color layer → preview toolpath →
generate G-code → save or stream to the machine over serial. [per-doc: `PROJECT.md` Primary flow]

**Reference standard:** LightBurn is the behavioral reference for every UX/default/
mode/G-code decision (`CLAUDE.md` rule 3). **Hard problem:** output *fidelity* vs
LightBurn, which the automated suite does **not** measure (`CLAUDE.md` rule 2).

---

## 2. Tech stack [verified: `package.json`]

- **Language:** TypeScript (strict; `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` per `PROJECT.md`).
- **UI:** React 18 + Vite 6, CSS Modules (no Tailwind/UI framework).
- **State:** Zustand 4 (strict slices, discriminated-union actions).
- **Canvas:** Canvas2D.
- **3D (CNC relief viewer):** three.js ^0.180 (UI-only, gated by ADR-102).
- **Desktop:** Electron ^42, electron-builder ^26 (`--win --x64`).
- **Runtime deps (9):** `clipper2-ts` 2.0.1-17 (geometry/boolean/offset), `dompurify` ^3.4.11 (SVG sanitize), `imagetracerjs` ^1.2.6 (raster→vector), `opentype.js` ^2 (text→path), `three` ^0.180, `react`/`react-dom` ^18.3, `zustand` ^4.5, `lucide-static` ^1.23 (icons).
- **Test:** Vitest ^3.2, `fast-check` ^3.22 (property), `jsdom` ^25. Playwright is **named in `PROJECT.md` but NOT in `package.json` devDeps** [verified — flag in S02/S09; matches a prior memory note of "absent Playwright"].
- **Lint:** ESLint 9 flat config + `eslint-plugin-boundaries`, `eslint-plugin-import`, `eslint-plugin-react(-hooks)`, `typescript-eslint`; Prettier.
- **Deploy:** `wrangler` → Cloudflare Pages (project `laserforge`).

**License posture:** proprietary / All Rights Reserved (ADR-018); deps must be
MIT-compatible (ADR-017), enforced by `scripts/check-licenses.mjs`. [verified: `package.json:6,24`]

---

## 3. Build / test / lint commands [verified: `package.json:14-39`]

| Purpose | Command |
|---|---|
| Dev (web) | `pnpm dev:web` (Vite) |
| Dev (desktop) | `pnpm dev:desktop` |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) |
| Lint (app) | `pnpm lint` / (electron) `pnpm lint:electron` |
| Format check | `pnpm format:check` |
| Unit/property/snapshot | `pnpm test` (`vitest run`) |
| Coverage | `pnpm test:coverage` |
| License gate | `pnpm license-check` |
| Dep CVE audit | `pnpm audit:deps` (`--audit-level=low`) |
| File-size policy | `pnpm check:file-size` |
| Repo-identity guard | `pnpm guard:repo` (`scripts/assert-correct-repo.mjs`) |
| **Full release gate** | `pnpm release:check` = guard → typecheck → lint → lint:electron → format:check → license-check → audit:deps → test → build:web → build:electron-main → check:file-size |
| Deploy | `pnpm deploy:web` (release:check → `wrangler pages deploy dist/web --branch=master`) |

Package manager: **pnpm 11.3.0** (`packageManager` pinned); Node ≥ 22.13. `type: module`.

> Baseline health (test/lint/typecheck/file-size/license) is **not yet run this
> session** — it will be executed and recorded at the start of the sector loop
> (S02 owns CI; a repo-wide baseline is run before S01). Prior evidence exists in
> `audit/evidence/code-quality-*-2026-06-12.txt` but is a month old and must be re-run.

---

## 4. Entry points [verified]

- **Web / renderer UI:** `index.html:22` → `src/ui/app/main.tsx`.
- **Electron main process:** `electron/main.ts` (`package.json:13` `main: dist-electron/main.js`).
- **Electron preload / policy:** `electron/trusted-renderer-policy.ts`, `electron/csp-policy.test.ts`, `electron/serial-port-choice.ts`.
- **RTSP camera bridge CLI:** `electron/rtsp-camera-bridge-cli.ts` (`pnpm camera:bridge`).
- **Vite HTML entry:** `index.html` (CSP intentionally set via HTTP headers / Electron session, not meta — comment `index.html:9-18`).

---

## 5. Module layout & boundary rules

Enforced by `eslint-plugin-boundaries` (CI-fail on violation, per `CLAUDE.md`):

```
core/      imports: core/ only                    (pure, no I/O, no platform, no clock/rng)
io/        imports: core/, io/
platform/  imports: core/, platform/types         (never ui/ or io/)
ui/        imports: core/, io/, platform/types     (never platform/web|electron directly)
electron/  desktop shell + trust policy + serial bridge (separate lint config)
```

**`src/core/` purity rules** [per-doc `CLAUDE.md`, enforced by `no-restricted-globals`/`imports`]: no disk/net/`process`/`navigator`/`window`/`document`, no `Date.now()`, no RNG, no `console.*`, no throw-for-control-flow (return `Result<T,E>`).

### src/core (299 src / 212 test files [verified count])
`box/` (finger-joint box gen) · `camera/` (calibration/registration math) · `cnc/`
(CNC job compile, V-carve, tabs, pockets) · `controllers/` (grbl, grblhal, fluidnc,
marlin, ruida, smoothieware driver seam) · `devices/` (DeviceProfile + catalog) ·
`geometry/` (transforms, clipping, kerf-offset, tabs-bridges) · `invariants/`
(property predicates) · `job/` (compile scene→cut/fill/raster groups, fill-hatching,
offset-fill) · `material-library/` · `output/` (grbl-strategy, emit-raster, emitters) ·
`preflight/` (bounds/power/laser-off/safety) · `raster/` (luma, budgets, rasterize-vector) ·
`relief/` (STL heightmap, roughing/finishing) · `scene/` (Scene, Layer, SceneObject union) ·
`shapes/` (rect/ellipse/polygon/polyline) · `sim/` (toolpath simulation) · `text/`
(opentype parse, text→path) · `trace/` (image→luma→vector, `centerline/` sub-pipeline) ·
`util/`. Plus top-level `app-branding.ts`, `grbl-streaming.ts`.

### src/io (50 src / 45 test [verified])
`dxf/` · `gcode/` (parse-gcode-program, file helpers) · `lightburn/` (import/export
helpers) · `machine-profile/` · `material-library/` (`.lfml.json`) · `project/` (`.lf2`
serializer + migrations + shape validator) · `rd/` (Ruida `.rd` experimental) · `stl/` ·
`svg/` (DOMParser + DOMPurify sanitize).

### src/platform (6 src / 9 test [verified])
`types.ts` (PlatformAdapter interface) · `web/` (web-adapter, web-serial, web-camera,
camera-bridge, pwa-precache, cloudflare-pages-routing, deploy-workflow-gate, repo-policy,
favicon). **No `platform/electron/` dir** — Electron adapter behavior lives in top-level
`electron/`. (`PROJECT.md` Stack line references `platform/electron/`; actual tree differs —
S01/S07 drift check.)

### src/ui (435 src / 285 test [verified] — largest sector)
`app/` (shell, `main.tsx`, wiring) · `state/` (Zustand: store, laser-store,
scene-mutations, layer-actions, import-actions) · `commands/` (command routing,
families, CommandShell) · `workspace/` (Canvas2D viewport, draw-scene, overlays,
preview) · `laser/` (Laser window, JobControls, StatusDisplay, console, machine setup) ·
`layers/` (Cuts/Layers panel, operation settings) · `trace/` · `raster/` · `text/` ·
`box/` · `camera/` (+ `wizard/`) · `calibration/` · `machine/` · `material-library/`
(+ `wizard/`) · `library/` · `relief-viewer/` (three.js) · `help/` · `commands/` ·
`kit/` + `common/` (primitives, NumberField) · `a11y/` · `theme/`.

### electron (6 src / 6 test [verified])
`main.ts` · `serial-port-choice.ts` · `trusted-renderer-policy.ts` ·
`rtsp-camera-bridge.ts` + `-policy.ts` + `-cli.ts` · policy tests (csp, source-map).

### src/__fixtures__ (77 files [per-doc S09])
`controllers/` (firmware simulators driving the real store) · `perceptual/` (IoU
fidelity harness + `assets/`) · `property/` · `svg/malicious/` (sanitizer corpus).

---

## 6. Data flow & data model

**Runtime flow:** file/user input → `src/ui` workflow → `src/ui/state` (Zustand) +
`src/ui/commands` → pure transforms in `src/core` → format/persistence in `src/io` →
`src/platform` (web) or `electron/` (desktop) → preview / `.lf2` project / G-code file /
serial stream. [per-doc, confirmed by boundary rules]

**Model (`PROJECT.md` Data model):** `Project { schemaVersion, device: DeviceProfile,
workspace{width,height,units:'mm'}, scene{ objects: SceneObject[], layers: Layer[] },
material libraries }`.
- `SceneObject` = extensible discriminated union (ADR-014): imported-svg, text,
  traced-image, raster-image, shape, (CNC) relief.
- `Layer` keyed by color; `mode: 'line' | 'fill' | 'image'`; power/speed/passes/visible/
  output + fill/image/cut settings.
- `Job`/`Plan`/`Output`/G-code are **pure derivations** from `Project`, never persisted.
  `Job.groups` = CutGroup | RasterGroup discriminated union; grbl-strategy dispatches per kind.

**State management:** Zustand slices only; Immer/`produce` for updates; no module-level
mutable state; no `let` outside functions (`CLAUDE.md`). Key slices: `store.ts` (427 raw),
`laser-store.ts` (403 raw), `scene-mutations.ts` (491 raw). [verified sizes]

---

## 7. Storage, external services, hardware

- **Storage:** local only. Projects `.lf2` (`src/io/project`), materials `.lfml.json`,
  machine profiles, autosave/recovery (Phase C). File System Access API (web) /
  native FS (Electron).
- **External services:** **NONE** by contract (`PROJECT.md` non-negotiable #8: no
  telemetry, no network). Deploy target is Cloudflare Pages (static hosting only).
- **Hardware / device integration:**
  - **Serial:** WebSerial (`src/platform/web/web-serial.ts`) in browser; Electron
    `serial-port-choice.ts` + `setPermissionRequestHandler` for desktop.
  - **Controller drivers** (`src/core/controllers/`, ADR-094): GRBL (hardware-verified),
    grblHAL (hardware-verified on Falcon A1 Pro per `PROJECT.md`), FluidNC/Marlin/
    Smoothieware/Ruida (**simulator-verified only** — `PROJECT.md` truth table).
  - **Camera:** overhead camera mode (ADR-107), web-camera + RTSP bridge (Electron).
  - **Streaming:** `src/core/grbl-streaming.ts` + `laser-store` (character-counted GRBL 1.1 protocol).

---

## 8. Highest-risk areas (pre-audit hypotheses — to confirm/refute per sector)

Ranked by potential blast radius (physical machine + data). These set attention for
the passes; they are **not** findings yet.

1. **Output correctness (`src/core/output`, `src/core/job`, `src/core/cnc`)** — G-code
   emitters, the 9 safety invariants, laser-off/bounds/power. A defect here burns wrong
   or starts fires. *S05/S04.*
2. **Geometry / clipper2 NaN exposure** — prior memory flags an "unguarded clipper NaN"
   in the laser kerf path and CNC pipeline. NaN reaching an emitter is High/Critical. *S04/S05.*
3. **Trace fidelity (`src/core/trace`, `centerline/`)** — the known outline-vs-centerline
   gap; largest file in repo (`trace-image.ts`, 498 raw). Not caught by the IoU harness.
   Fidelity, not crash. *S05.*
4. **Untrusted input parsers (`src/io/svg`, `dxf`, `stl`, `gcode`, `rd`)** — SVG sanitize
   (DOMPurify), clean-room DXF/STL/`.nc` parsers on hostile files. *S06.*
5. **Electron trust boundary (`electron/`)** — contextIsolation/sandbox/nodeIntegration,
   serial permission scope, RTSP bridge input. *S03.*
6. **E-stop reachability + serial lifecycle (`src/ui/laser`, `web-serial`, `laser-store`)** —
   non-negotiable #9; disconnect/cleanup races (prior "disconnect burn 20s" report). *S07/S08.*
7. **Persistence/migration (`src/io/project` `.lf2`)** — silent data loss on load/migrate. *S06.*
8. **Claim honesty** — many Phase H/I/K features are "Built" but hardware/fidelity
   **CLAIMED/unverified** (`PROJECT.md` status columns; `AUDIT.md`). Release-readiness risk. *S01.*

---

## 9. God-file / near-limit candidates [verified raw line counts; code-line count NOT yet checked]

Limit is **400 counted code lines** (blank/comment excluded) with a **600 raw**
backstop (`CLAUDE.md`). Raw counts below cannot alone prove a violation — they flag
files to run `check:file-size` against in S02/S08. **No violation is claimed here.**
Largest 12 non-test files (raw lines): `core/trace/trace-image.ts` 498 ·
`ui/state/scene-mutations.ts` 491 · `core/raster/emit-raster.ts` 451 ·
`ui/state/store.ts` 427 · `io/svg/parse-svg.ts` 421 · `io/project/project-shape-validator.ts` 417 ·
`core/trace/centerline/stroke-chains.ts` 417 · `ui/state/laser-store.ts` 403 ·
`core/job/compile-job.ts` 399 · `core/devices/profile-catalog.ts` 397 ·
`core/cnc/compile-cnc-job.ts` 395 · `ui/laser/MachineSetupCamera.tsx` 394.

---

## 10. Test coverage & ownership signals [verified counts]

- `src/` totals: **824 source / 584 test** files — **not** 1:1. `PROJECT.md`
  non-negotiable #16 ("every source file has a `.test.ts` sibling") is an aspiration,
  **not** CI-enforced (`CLAUDE.md`: "CI does not enforce a direct sibling-test rule").
  Gap magnitude: core 299/212, io 50/45, ui 435/285, platform 6/9 (more test than src —
  test-only helpers). Which specific high-risk files lack tests → per-sector.
- **Doc corpus is very large:** ~130+ markdown reports/audits under root + `audit/`
  (S01 = 231 files). Doc-drift and contradiction risk is itself an audit target.
- Prior audit artifacts (`audit/REPOSITORY-SECTOR-*-2026-07-03.md`, 322 KB audit file)
  are recent evidence to build on and re-verify, not to trust blindly.

---

## 11. Frontend / backend boundary

No traditional backend. "Backend" = (a) the pure `src/core` pipeline, (b) `src/io`
persistence, (c) the platform layer: web adapters (`src/platform/web`) and the Electron
main process (`electron/`) which owns native FS, serial, and camera bridge. All compute
is client-side/local. Network surface is limited to static asset hosting + PWA
service worker (`vite-plugin-pwa`, workbox) — no API calls by contract.
