# Findings ledger

This ledger contains reconciled findings only. Candidate observations that did not survive verification remain in their loop report rather than being counted here. Runtime/product findings and documentation/coverage drift are kept separate.

## Runtime and governance findings

| ID | Severity | State | Root area | Summary | Evidence owner |
|---|---|---|---|---|---|
| L1-01 | P2 | Confirmed | Project IO/governance | Fixed `.lf2` scene ceilings refuse Open and canonical Save | Loop 1 |
| L1-02 | P1 | Confirmed | Motion/governance | Configured no-go zones veto direct jog commands | Loop 1 |
| L1-03 | P2 | Confirmed | Machine UI/governance | Standalone machine commands use confirmations outside Job Review | Loop 1 |
| L1-04 | P1 | Confirmed | Compile/motion governance | Valid feed and RPM requests are silently rewritten | Loop 1 |
| L1-05 | P2 | Confirmed | Raster/export | Predictive raster work budgets refuse conversion and processed-bitmap export | Loop 1 |
| L1-06 | P2 | Confirmed | CNC/export | CNC tiled export refuses plans above 500 files | Loop 1 |
| L1-07 | P2 | Confirmed | Variable data/import | CSV import refuses fixed size, row, and column thresholds | Loop 1 |
| L2-01 | P1 | Confirmed | Geometry/compile | Object scaling expands canonical-curve chord error beyond the 0.025 mm machine tolerance | Loop 2 |
| L2-02 | P1 | Confirmed design conflict | Geometry/compile | Over-budget canonical curves silently fall back to compatibility polylines | Loop 2 |
| L2-03 | P2 | Confirmed | SVG import/units | SVG viewports ignore `preserveAspectRatio` and stretch by default | Loop 2 |
| L2-04 | P1 | Confirmed | SVG import/units | Primitive geometry attributes discard units, percentages, and invalid suffixes | Loop 2 |
| L3-01 | P1 | Confirmed | G-code dialects | `grbl-compatible` emits `M4` despite promising controllers without `M4` | Loop 3 |
| L3-02 | P1 | Confirmed | Raster/power | Raster power wraps modulo 65,536 above the storage width | Loop 3 |
| L3-03 | P1 | Confirmed | Raster/output scope | Selected-only output drops an image-mask dependency | Loop 3 |
| L3-04 | P1 | Confirmed | Raster/rotation | Non-square Pass-Through sampling corrupts at 90/270-degree rotation | Loop 3 |
| L3-05 | P1 | Confirmed | Compile integrity | Failed kerf/fill/raster work can be omitted while surviving output remains executable | Loop 3 |
| L3-06 | P1 | Confirmed | Follow Shape fill | The 2,000-level cap emits a known partial fill | Loop 3 |
| L4-01 | P1 | Confirmed | CNC operation order | Tool bucketing can move a profile ahead of another tool's clearing work | Loop 4 |
| L4-02 | P2 | Confirmed | CNC preview/simulation | Multi-revolution helix preview models a different route and Z history than emitted arcs | Loop 4 |
| L4-03 | P1 | Confirmed | CNC emission/preflight | Emit-precision contour collapse becomes a plunge-only program that passes preflight | Loop 4 |
| L4-04 | P1 | Confirmed | CNC Pocket | The 4,096-ring cap loses its completion state and silently leaves a centre core | Loop 4 |
| L4-05 | P1 | Confirmed contract conflict | CNC V-carve/rest | Detected planner exhaustion retains executable partial machining | Loop 4 |
| L5-01 | P1 | Confirmed | CNC tool-change/ack ownership | Continue during setup jog attributes the jog response to the resumed stream | Loop 5 |
| L5-02 | P1 | Confirmed | Serial session ownership | A stale job-write catch can error and quarantine a replacement session | Loop 5 |
| L5-03 | P1 | Confirmed evidence conflict | Laser recovery | Recovery derives a physical restart boundary from transport acknowledgements | Loop 5 |
| L5-04 | P2 | Confirmed | Status polling/transport | Unresolved realtime status writes accumulate without single-flight ownership | Loop 5 |
| L5-05 | P2 | Confirmed source/spec mismatch | Web Serial | Recoverable read errors are promoted to fatal application disconnects | Loop 5 |
| L5-06 | P2 | Confirmed guard conflict | Frame/Start | A rejected Start queue fence expires a current Frame before any job byte | Loop 5 |

## Documentation and coverage drift

| ID | Severity | State | Summary | Evidence owner |
|---|---|---|---|---|
| L1-D01 | P3 | Confirmed | Detailed workflow and tooltips retain review-before-Frame ordering | Loop 1 |
| L1-D02 | P3 | Confirmed | WORKFLOW retains an M7 refusal that production demotes to advisory | Loop 1 |
| L1-D03 | P3 | Confirmed | WORKFLOW retains Frame feed capping despite warning-only controller policy | Loop 1 |
| L1-D04 | P3 | Confirmed | ADR-129 retains a direct-jog guard after the standing no-new-guard denial | Loop 1 |
| L2-D01 | P3 | Confirmed | ADR-046 and its test prescribe per-axis SVG stretching that conflicts with the W3C default viewport algorithm | Loop 2 |
