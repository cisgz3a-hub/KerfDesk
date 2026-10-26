# CNC audit v1 — area map

Started 2026-10-23, when the user asked to "continue looping. loop for cnc too".

Method: the rolling audit v2 method ([../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md)). Every finding needs an anchor. An independent refuter checks each finding, and the coordinator re-checks every P1/P2 in code.

## Why these areas

CNC has been audited several times before:
- the 2026-07-25 full chain;
- 2026-09-24, 09-27 and 09-29;
- the 2026-10-09 released-output audit;
- rolling-v2 area 09.

The controller rounds (v2–v4) covered CNC only where it meets the machine: probing, spindle, tool change, routines and opened programs.

This round audits the **CAM geometry itself**: is the material that each operation removes the material the design asked for? The areas are ordered by change since 2026-10-09 and by how directly a defect becomes a ruined part or a broken bit.

Each auditor should verify geometry independently, not only by reading the code. Examples:
- a gouge check of the emitted path against the design;
- a depth audit of every Z against the layer's depth and stepdown;
- a check that the offset side matches the cut side;
- a check of climb versus conventional direction.

Two auditors run at a time.

| # | Area id | Risk | Why now |
|---|---|---|---|
| F1 | `cnc-vcarve` | C+S | Most churn since 10-09 (medial axis, detail, rest finishing, tip reach). Depth versus angle, flat-bottom, and text unions decide every sign |
| F2 | `cnc-pocket-adaptive` | S | Clearing: stepover and engagement (bit load), islands, rest stock, finish allowance. A gouge into an island or a wall ruins the part |
| F3 | `cnc-profile-entry` | S | Profile side and direction, tabs, ramps, helical entry (changed since 10-09). Lead-ins are KNOWN (09-P1-1, #1343) |
| F4 | `cnc-depth-feeds` | S | Depth passes, feeds calculator, chipload, plunge, drill pecks, cutting presets versus the tool library and material catalog. A wrong feed breaks bits |
| F5 | `cnc-inlay` | C | Inlay pairs and tapered inlays: male/female fit, gap, flat-bottom depth. A mismatch wastes two parts |
| F6 | `cnc-relief-3d` | C+S | Relief projection, finishing, rest and the two-sided split (changed since 10-09). The 3D toolpath stays within the heightfield and the stock |
| F7 | `cnc-preflight-reach` | S | CNC preflight, tool reach and holder clearance, radial envelope, motion bounds, open-contour issues. These checks are the only ones that stop a crash |
| F8 | `cnc-output-viewer` | C | Output precision, coordinate representation, arcs, and the CNC 3D viewer and simulation compared with the emitted program |

## Scope

| # | Files |
|---|---|
| F1 | `src/core/cnc/vcarve-*.ts`, `vcarve*.ts`, the V-carve UI fields |
| F2 | `src/core/cnc/adaptive-*.ts`, `pocket-*.ts`, `cnc-pocket-*.ts`, `rest-pocket.ts`, `cnc-rest-*.ts`, `finish-allowance*.ts`, `cleared-capsule-interval.ts` |
| F3 | `src/core/cnc/profile-paths.ts`, `profile-ordering.ts`, `profile-finishing-stage.ts`, `closed-contour-cut-types.ts`, `cnc-tab*.ts`, `compiled-tab-rises.ts`, `tabbed-ramp-entry.ts`, `contour-ramp-*.ts`, `helical-entry.ts`, `cnc-helical-*.ts` |
| F4 | `src/core/cnc/depth-passes.ts`, `feeds-calculator.ts`, `nominal-chipload.ts`, `drill-peck.ts`, `cutting-preset*.ts`, `cnc-head-feeds.ts`, `cnc-material-catalog.ts`, `cnc-machine-catalog.ts`, the CNC bit catalog (`src/ui/machine/cnc-bit-*.ts`) |
| F5 | `src/core/cnc/inlay-pair*.ts`, `tapered-inlay*.ts`, `cnc-inlay-issues.ts` |
| F6 | `src/core/cnc/compile-cnc-relief*.ts`, `relief-*.ts`, `cnc-relief-group.ts`, `src/core/relief/**`, `src/core/heightfield/**` (toolpath side) |
| F7 | `src/core/preflight/cnc-*.ts`, `standalone-cnc-preflight.ts`, `src/core/cnc/cnc-tool-reach.ts`, `cnc-reach-geometry.ts`, `radial-envelope.ts`, `cnc-open-contour-omissions.ts`, `cnc-air-floor.ts`, `cnc-pass-air-floors.ts` |
| F8 | `src/core/cnc/cnc-output-precision.ts`, `coordinate-representation.ts`, `output-representation.ts`, `cnc-contour-emission.ts`, `cnc-pass-emission.ts`, `motion-polish.ts`, `src/io/cnc/**`, `src/ui/cnc-viewer3d/**`, `src/core/toolpath3d/**` |
