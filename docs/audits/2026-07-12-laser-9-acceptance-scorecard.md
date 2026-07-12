# KerfDesk Laser 9.0 acceptance scorecard

Date: 2026-07-12  
Branch: `codex/laser-9-production`  
Status: software candidate complete; hardware acceptance incomplete

## Verdict

KerfDesk has moved materially beyond the earlier 7.4 laser feature/workflow baseline. The current software candidate earns **8.6/10** from observed automated workflows and deterministic output evidence. It does **not** yet earn 9.0 because the required multi-device, rotary, camera, Fire, and absolute-position measurement matrix has not been run on physical hardware.

Merged code alone was not counted. Credit below requires a passing unit, property, snapshot, browser, build, migration, or performance check. Hardware-only rows remain uncredited.

## Sector ratings

| Sector | Weight | Earlier | Candidate | Evidence | Remaining gate |
| --- | ---: | ---: | ---: | --- | --- |
| Core laser output and safety | 20% | 8.3 | 9.2 | Shared prepared-output path; hard-off Fire exits; rotary-disabled parity; preflight and G-code suites | Second physical GRBL family and Fire meter test |
| Setup and device workflow | 10% | 7.5 | 8.8 | Exact profile roundtrip; profile-aware capabilities; deterministic fake serial browser flow | Falcon plus second machine setup observation |
| Production automation | 15% | 6.2 | 8.8 | Variable text/CSV/serial workflow; arrays; deterministic Quick Nest; one-step undo | Long variable stream and export measurement run |
| Rotary | 10% | 4.0 | 8.2 | Roller/chuck model, wrap bounds, raster guards, setup and calibration browser flow | Roller and chuck dimensional coupons |
| Print and Cut / camera | 10% | 6.0 | 8.1 | Similarity-transform properties; epoch invalidation; two-point browser workflow; USB fake camera | Absolute-position coupons, USB and RTSP measurement |
| Materials and migration | 10% | 7.2 | 8.7 | Five-shape CLB corpus; linked snapshots; CLB browser workflow; read-only LBRN import reports | Five legally shareable external CLB files and broader LBRN corpus |
| Curve-native design and text | 15% | 7.0 | 8.8 | Schema v2; SVG/DXF/trace/text curves; node controls; embedded fonts; bend/path text; deviation/topology tests | Large real-world glyph and trace review corpus |
| Browser, regression, and performance proof | 10% | 6.8 | 8.5 | Eight Playwright workflows; split suites; web/Electron builds; seven-phase small/medium/large budgets | Browser trace/start/pause/recovery and RTSP workflows |
| **Weighted result** | **100%** | **7.4** | **8.6** | | |

## Automated evidence completed

- Core and I/O partition: 338 files, 2,255 tests passed during the Release 3 gate.
- Platform and Electron partition: 25 files, 135 tests passed.
- UI partition: complete partition passed after resolving the hover-help contract failure.
- Playwright: eight Chromium workflows pass for project files, fake GRBL, USB camera, SVG import, arrays, nesting, preview, rotary calibration, print-and-cut, CLB linking, and variable CSV text.
- Curve acceptance: measured cubic deviation, closed topology, exact 10,000-segment budget, multi-path v1 migration, and byte-identical line-only G-code.
- Performance: import, trace, nesting/editing, preview, save, compile, and streaming stay inside explicit small/medium/large budgets.
- Builds and static gates: typecheck, lint, formatting, web build, and Electron-main build passed during the release gates.

## Hardware matrix still required

| Matrix item | Required observation | Status |
| --- | --- | --- |
| Creality Falcon | Setup, frame speed, vector, raster, pause/recovery, Fire hard-off | Pending |
| Second GRBL-family machine | Setup, frame, stream completion, alarm/disconnect recovery | Pending |
| Roller rotary | Calibration coupon, circumference, seam, reverse direction, raster wrap | Pending |
| Chuck rotary | Degrees/mm-per-turn coupon, seam, reverse direction, raster wrap | Pending |
| USB camera | Calibration, alignment, resolution change, overlay measurement | Pending |
| RTSP camera | Bridge connection, frame freshness, alignment, disconnect recovery | Pending |
| Print and Cut | At least five absolute-position two-point measurement coupons | Pending |

## Score-to-9.0 rule

The candidate reaches 9.0 only when:

1. Every hardware row above has named device/firmware evidence and measured tolerances.
2. Browser workflows cover trace plus Start, pause, recovery, and RTSP failure paths.
3. The external CLB/LBRN compatibility corpus is legally shareable and passes with explicit unsupported-field reports.
4. No Labs gate is removed until its own matrix row passes; unrelated passing features do not unlock it.

