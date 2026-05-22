# Repo-to-LaserForge Research Map

Before cloning any external repository, this file states exactly which external repositories are being used to study which parts of LaserForge.

| LaserForge Area / Question | Primary External Repos | Secondary External Repos | What To Learn | LaserForge Cross-Reference Target |
|---|---|---|---|---|
| Overall modern laser-app architecture | Rayforge | MeerK40t, LaserWeb4, VisiCut | Document -> operation -> plan -> output pipeline, app/module boundaries, extensibility, job model | `src/app`, `src/core`, compiler/planner/output folders, project/document model |
| GRBL streaming and serial sender behavior | LaserGRBL, Universal G-Code Sender | bCNC, Candle, OpenBuilds CONTROL | Queueing, ok/ack handling, buffer management, retry behavior, disconnect handling, line numbering/checksums if used | `GrblController`, serial adapter, stream queue, sender tests |
| Pause / resume / stop / emergency-off behavior | LaserGRBL, UGS, OpenBuilds CONTROL | bCNC, Candle | Whether pause forces laser-off, resume modal reassertion, stop/abort semantics, disconnect fault behavior | `ExecutionCoordinator`, `MachineService`, `GrblController`, safety tests |
| Laser-on / laser-off command safety | LaserGRBL, Rayforge | K40 Whisperer, MeerK40t | `M3`/`M4`/`M5` handling, dynamic laser mode, power gating, test-fire/deadman patterns | laser command builder, test-fire flow, stream validators, `M5` emergency paths |
| Device/controller abstraction | MeerK40t, LibLaserCut | Rayforge, VisiCut, UGS | Capabilities model, driver interface, plugin model, controller-specific behavior isolation | controller interfaces, device profiles, capability flags, firmware adapters |
| GRBL vs broader controller support | MeerK40t, LibLaserCut, VisiCut | Rayforge | How mature apps avoid hardcoding one firmware model while avoiding premature complexity | controller architecture, future DSP/Ruida/Galvo extension points |
| Raster/image engraving pipeline | LaserGRBL, Rayforge | LaserWeb4, MeerK40t | Dithering, halftone, grayscale mapping, scanline generation, image preprocessing, preview parity | raster pipeline, image processing, scanline planner, raster tests |
| Vector import and CAM pipeline | LaserWeb4, Rayforge, VisiCut | K40 Whisperer, MeerK40t | SVG/DXF import, normalization, path cleanup, operations, cut/engrave separation | SVG/DXF importers, scene graph, operation model, geometry tests |
| Preview / simulation / visualizer | Rayforge, Candle, UGS | LaserGRBL, LaserWeb4 | Plan-based preview, G-code visualizer, time estimation, bounding box verification | preview renderer, simulator, bounds checking, time estimator |
| WCS / origin / homing / coordinates | UGS, bCNC, Candle | LaserGRBL, OpenBuilds CONTROL | Machine vs work coordinates, `G54`/`G92` handling, homing assumptions, soft limits, origin certainty | WCS placement certainty, coordinate transform logic, bounds/preflight tests |
| Material presets and beginner workflow | Rayforge, LaserGRBL | Light workflow ideas from K40 Whisperer | Material library, speed/power/pass presets, beginner-safe guided flow | material preset model, job wizard, preflight warnings, UX state |
| Camera/alignment future architecture | Rayforge | MeerK40t | Camera calibration, bed alignment, image overlay, coordinate mapping | future architecture notes only; do not implement unless explicitly scoped |
| Electron/Node desktop security | OpenBuilds CONTROL | LaserWeb4 | IPC boundaries, local server risk, serial permissions, updater/release flow, CSP lessons | Electron main/preload/renderer boundaries, IPC allowlist, CSP, release scripts |
| Legacy design mistakes to avoid | LaserWeb4, K40 Whisperer, bCNC | Candle | Aging dependencies, monolithic UI/controller coupling, unsafe trust boundaries, weak tests | architectural risk notes, anti-patterns in `LASERFORGE_FIX_PLAN.md` |
| Minimal/simple beginner UX | K40 Whisperer, Candle, LaserGRBL | OpenBuilds CONTROL | What the shortest useful workflow looks like; where LaserForge is overcomplicated | job start wizard, connection panel, settings flow, first-run experience |
| Test strategy and fake controllers | UGS, Rayforge, MeerK40t | LaserGRBL if tests exist | Fake devices, parser fixtures, simulation tests, regression tests, integration boundaries | test harnesses, fake GRBL controller, controller state tests, pipeline fixtures |
| Release/package/distribution workflow | OpenBuilds CONTROL, LaserGRBL | UGS | Installer, updater, platform packaging, release checks, signing lessons | release workflows, package scripts, artifact checks, production hardening |
| Observability and support diagnostics | Rayforge, OpenBuilds CONTROL | UGS, MeerK40t | Logs, diagnostics bundles, crash handling, support evidence | diagnostics, job replay, machine event ledger, support bundle policy |

