# Coverage map

Each loop changes both the repository area and the audit technique. The order follows the product chain from governance, through geometry and executable output, into transport, inputs, persistence, presentation, distribution, and finally evidence quality.

| Loop | Area | Distinct audit design | Primary authorities | Status |
|---|---|---|---|---|
| 1 | Governance, architecture, and Frame-only guard compliance | Contract-to-code trace: enumerate actions/refusals and classify every blocking surface against ADR-228/230/232 | `CLAUDE.md`, `PROJECT.md`, `DECISIONS.md`, `WORKFLOW.md`; current action/state source | Complete |
| 2 | Core geometry, transforms, units, bounds, and numeric integrity | Invariant and metamorphic audit: trace coordinate spaces, non-finite propagation, tolerance use, determinism, and property-test strength | current core source/tests; W3C SVG geometry and units sources where used | Complete |
| 3 | Laser compile, Line/Fill/Image planning, preview/save/start identity, and G-code emission | Semantic output audit: follow representative artifacts end-to-end and compare modal/power/travel claims to emitted bytes | current compiler/emitter/tests; GRBL primary documentation; LightBurn primary documentation for parity claims | Complete |
| 4 | CNC CAM, tool geometry, Z motion, passes, tabs, V-carve, relief, and provenance | Physical-motion hazard audit: reconstruct motion phases and challenge tool/depth/clearance assumptions without operating hardware | current CNC source/tests; controller and G-code primary sources; project ADRs | Complete |
| 5 | Controller detection, serial transport, buffering, pause/abort/resume, Frame permits, and concurrency | State-machine and race audit: enumerate controller/session epochs, events, competing operations, terminal responses, and recovery transitions | current transport/store source/tests; GRBL streaming/status primary sources; Web Serial specification | Complete |
| 6 | SVG/DXF/STL/G-code/raster/font/library/project imports and hostile input handling | Threat-model and parser differential audit: entry-point inventory, trust-boundary tracing, malformed corpus review, sanitizer and budget behavior | current parsers/workers/tests; W3C SVG; DOMPurify/saxes/linkedom upstream sources; format specifications where relied on | In progress |
| 7 | Project schema, migrations, autosave/recovery, file APIs, page-backed assets, and round trips | Durability and fault-injection audit: version transitions, interrupted writes, missing assets, adapter parity, and semantic round-trip preservation | current IO/platform/state source/tests; File System Access and IndexedDB primary sources | Pending |
| 8 | UI workflows, command routing, accessibility, status/error honesty, and LightBurn parity | User-journey and alternative-input audit: map required flows to controls, keyboard paths, focus/modal behavior, fail-visible status, and side effects | current UI/tests; `WORKFLOW.md`; WCAG/WAI-ARIA and LightBurn primary documentation | Pending |
| 9 | Electron/web trust boundaries, CSP, permissions, offline/PWA, dependencies, CI, packaging, updates, and release provenance | Abuse-case and supply-chain audit: renderer-to-main boundary, permission allowlists, network egress, dependency/advisory state, artifact trust chain | current Electron/web/workflow source; Electron, Chromium/PWA, GitHub, npm/advisory primary sources | Pending |
| 10 | Test architecture, E2E/perceptual/hardware coverage, performance budgets, dead paths, docs and shipped-status drift | Claim-to-evidence audit: sample every material product claim and demand an executable, rendered, hardware, OS, or documentary proof of the right class | all prior loop evidence; current test/config/docs; official tool documentation for measured gates | Pending |

## Coverage accounting

Every tracked production, test, script, workflow, configuration, and specification path must be assigned to at least one loop. Generated output, dependency directories, and inherited untracked user work are fingerprinted but not treated as audited product source unless explicitly named in a loop report.

Cross-cutting findings are owned by the earliest loop that can prove the root cause. Later loops may add evidence or widen/narrow impact, but the final ledger keeps one canonical record.
