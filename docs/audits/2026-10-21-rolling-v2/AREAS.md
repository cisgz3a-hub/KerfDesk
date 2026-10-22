# Rolling audit v2 — area map and batch plan

Priority = risk class × change since 2026-09-25 × staleness. Risk classes: **S** physical
safety (laser, motion, G-code), **X** security / licence, **D** user data, **C** correctness,
**R** release / supply chain. Churn = non-merge commits and changed lines on `origin/main`
from 2026-09-25 to 2026-10-21. "Last audit" is the most recent report in `docs/audits/` that
covered the area.

Controllers were audited four times between 2026-10-16 and 2026-10-20, so they come late and
cover only what changed since then.

## Batch 1 — security and physical output

| # | Area id | Scope | Risk | Churn | Last audit | Lenses to stress |
|---|---|---|---|---|---|---|
| 01 | `remote-control` | `services/remote-control/**`, `electron/remote-access/**`, `src/ui/remote-control/**`, `src/ui/remote-access/**` | X+S | 50 c / 82k l | 2026-10-02 phone pairing | L5, L1, L4, L3 |
| 02 | `licensing` | `services/desktop-licensing/**`, `electron/desktop-licensing*.ts`, `src/ui/licensing/**` | X | 51 c / 17k l (+services) | 2026-09-30 | L5, L1, L3, L2 |
| 03 | `laser-output` | `src/core/output`, `src/core/job`, `src/core/gcode`, `src/core/raster-output`, `src/core/execution-plan`, `src/core/effective-output`, `src/core/laser-second-pass` | S | 88 c / 30k l | 2026-10-13 machining path | L2, L3, L4, L1 |
| 04 | `electron-main` | `electron/**` (except remote-access and licensing), `src/platform/electron/**` | X | 42 c / 10k l | 2026-09-28 | L5, L2, L6 |

## Batch 2 — job lifecycle and the busiest UI

| # | Area id | Scope | Risk | Churn | Last audit |
|---|---|---|---|---|---|
| 05 | `job-lifecycle` | `src/ui/state/**` slices for connect, Frame, Job Review, Start, stream, pause, abort, recovery | S | 323 c / 94k l (whole store) | 2026-10-16 controller pipeline |
| 06 | `laser-ui-settings` | `src/ui/laser/**`, `src/ui/layers/**` — edited value → emitted value, Job Review UI | S+C | 327 c / 95k l | 2026-10-18 artwork panel (UX only) |
| 07 | `trace` | `src/core/trace/**`, `src/ui/trace/**` | C | 115 c / 70k l | 2026-10-16 large trace |
| 08 | `canvas-commands` | `src/ui/workspace/**`, `src/ui/commands/**` — transforms, selection, Undo/Redo | C+D | 222 c / 66k l | 2026-10-15 tools |

## Batch 3 — CNC, geometry, release, camera

| # | Area id | Scope | Risk | Churn | Last audit |
|---|---|---|---|---|---|
| 09 | `cnc-core` | `src/core/cnc`, `src/core/toolpath`, `src/core/toolpath3d`, `src/io/cnc` | S | 71 c / 24k l | 2026-10-09 released CNC output |
| 10 | `geometry` | `src/core/geometry`, `shapes`, `nesting`, `parts`, `min-feature`, `sketch-constraints` | C | 69 c / 26k l | 2026-10-15 tools |
| 11 | `ci-release` | `.github/**`, `scripts/**`, `electron-builder*.yml` | R | 155 c / 58k l | 2026-09-06 pipelines |
| 12 | `camera` | `src/core/camera`, `src/ui/camera`, `electron/camera-*` | C+X | 26 c / 34k l | 2026-10-16 tools |

## Batch 4 — data in and out

| # | Area id | Scope | Risk | Churn | Last audit |
|---|---|---|---|---|---|
| 13 | `project-io` | `src/io/project`, `src/io/json`, autosave and recovery | D | 57 c / 8k l | 2026-07-17 rolling |
| 14 | `vector-importers` | `src/io/svg`, `dxf`, `vector-formats`, `hpgl`, `pdf`, `xml`, `stl` | C+X | 41 c / 20k l | 2026-07-17 rolling |
| 15 | `scene-text` | `src/core/scene`, `src/core/text`, `src/ui/text` | C | 117 c / 17k l | 2026-09-05 |
| 16 | `relief` | `src/core/relief`, `src/core/heightfield`, `src/ui/relief-viewer`, `src/ui/viewer3d` | S+C | 33 c / 23k l | 2026-08-30 |

## Batch 5 — machine edges

| # | Area id | Scope | Risk | Churn | Last audit |
|---|---|---|---|---|---|
| 17 | `controllers-delta` | `src/core/controllers`, `src/core/devices`, `src/ui/machine` — changes since 2026-10-20 only | S | 97 c / 12k l | 2026-10-20 (x2) |
| 18 | `preflight-recovery` | `src/core/preflight`, `recovery`, `sim`, `gcode-time`, `motion-planner`, `gcode-view` | S | 38 c / 3k l | 2026-09-22 |
| 19 | `platform-web` | `src/platform/web/**` (Web Serial, files, camera, storage) | D+S | 74 c / 7k l | 2026-07-17 rolling |
| 20 | `raster` | `src/core/raster`, `image-adjust`, `image-resample`, `src/ui/raster` | S+C | 19 c / 6k l | 2026-07-17 perceptual |

## Batch 6 — formats, website, images, docs

| # | Area id | Scope | Risk | Churn | Last audit |
|---|---|---|---|---|---|
| 21 | `lb-material-importers` | `src/io/lightburn`, `src/io/rd`, `src/io/material-library`, `src/core/material-library`, `src/io/machine-profile` | C | 37 c / 4k l | 2026-07-17 rolling |
| 22 | `website` | `website/**` — claims vs licence and ADRs, links, no-JS promise | X+R | 25 c / 10k l | 2026-09-05 |
| 23 | `image-editor` | `src/ui/image-editor`, `src/core/image-edit`, `image-layers`, `image-select`, `image-retouch`, `image-composite` | C | 10 c / 2k l | 2026-09-05 |
| 24 | `docs-drift` | `PROJECT.md` non-negotiables, ADR enforcement claims vs code (cross-cutting) | C | — | 2026-07-17 rolling |

## Batch 7 — long tail

| # | Area id | Scope | Risk | Last audit |
|---|---|---|---|---|
| 25 | `design-generators` | `src/ui/design-studio`, `src/core/design`, `design-carve`, `box`, `barcode`, `variables` | C | 2026-10-16 tools |
| 26 | `gcode-viewers` | `src/ui/gcode-inspector`, `src/ui/cnc-viewer3d`, `src/core/gcode-view` (UI side) | C | — |
| 27 | `app-shell` | `src/ui/app`, `settings`, `help`, `tutorials`, `common`, `kit`, `theme`, `a11y`, `support` | C | 2026-10-04 usability |
| 28 | `ai-features` | `src/core/ai`, `src/ui/ai`, `electron/ai`, `electron/artcraft-*`, `src/ui/artcraft-studio` | X | 2026-10-16 image AI |

Re-rank before each batch: an area that a large PR has just changed moves up.
