# Competitive Comparative Audit - KerfDesk / LaserForge-2.0 - 2026-07-05

Target repo: `C:\Users\Asus\LaserForge-2.0`

Target HEAD: `93eb09d` (`2026-07-05 11:42:00 +0800`) on `main`, clean and
aligned with `origin/main` at audit time.

Prompt/rubric used:
`audit/prompts/competitive-comparative-audit-prompt-2026-07-05.md`

## Executive Verdict

KerfDesk / LaserForge-2.0 is good code and a serious product foundation. It is
not yet at LightBurn's market/product maturity, and it is not broader than
Rayforge as an open-source laser studio. It is, however, stronger than most
inspected open-source comparators in release discipline, typed architecture,
test density, proprietary dependency hygiene, and safety-first G-code contracts.

Current overall rating for KerfDesk: **83 / 100, B+**.

Confidence: **High for code architecture and verification discipline; Medium
for real-world hardware/product maturity**. The codebase is heavily tested and
currently release-gate clean, but several CNC/router, box-generator, and
non-primary-controller claims remain marked as claimed, simulator/file-only, or
not fully hardware-verified in the project contract.

Plain verdict: **yes, the code is good; no, the product is not yet a market
leader.** It is above average for an independent CAM/control codebase, but it
still needs hardware proof, workflow polish, docs reconciliation, and ecosystem
depth before it can be scored like LightBurn.

## Scope And Source Basis

This audit compares KerfDesk against:

- LightBurn, official docs and release notes only, source not inspected.
- Rayforge, local source checkout plus docs inspected.
- Grid.Space / Kiri:Moto, local source checkout plus docs inspected.
- LaserGRBL, local source checkout plus docs inspected.
- CNCjs, local source checkout plus docs inspected.
- LaserWeb4 / CNCWeb, local source checkout plus docs inspected.
- Easel, official product page plus prior local 1v1 audit evidence.
- xTool Studio / Creative Space, official release notes only, source not
  inspected.

No product source files were changed during this audit. The only intended
changes are audit documentation files.

Closed-source products are rated for product capability and market maturity,
not for inspected code quality. Their architecture and verification scores are
therefore lower-confidence estimates.

## Anti-Vibe Scoring Method

Scores use the prompt rubric:

| Category | Weight |
| --- | ---: |
| Capability breadth | 20 |
| CAM/toolpath correctness and safety | 20 |
| Machine/control integration | 15 |
| Architecture/maintainability | 15 |
| Verification/release discipline | 15 |
| UX/operator workflow | 10 |
| Packaging/ecosystem | 5 |

Grade bands:

- A: 90-100
- B: 80-89
- C: 65-79
- D: 50-64
- F: below 50

Ratings are current-state judgments. They are not permanent rankings and should
move when hardware verification, release evidence, feature depth, or comparator
versions change.

## Local Evidence Matrix

### KerfDesk / LaserForge-2.0

Evidence:

- Git root verified as `C:\Users\Asus\LaserForge-2.0`.
- HEAD `93eb09d`, clean/aligned with `origin/main`.
- `package.json` stack: TypeScript, React 18, Vite 6, Electron 42, Zustand,
  Three.js, Vitest, jsdom, ESLint 9, Prettier, Wrangler, PWA tooling.
- `package.json` release gate: `pnpm release:check` runs repo guard,
  typecheck, lint, Electron lint, format check, license check, dependency
  audit, tests, web build, Electron main build, and file-size policy.
- Release evidence from this audit run: `pnpm release:check` passed at
  `93eb09d`; after that, git status was rechecked clean/aligned.
- `PROJECT.md` identifies KerfDesk as the user-facing product and
  LaserForge-2.0 as the repo/internal architecture name.
- `PROJECT.md` states the app deliberately follows LightBurn's core workflow
  shape but does not copy its feature breadth or controller fan-out.
- `PROJECT.md` records laser, raster/image, material, CNC/router,
  multi-controller, camera, and box-generator scope.
- Hardware truth is mixed: GRBL v1.1 plus grblHAL are hardware-verified on the
  Falcon path, while remaining controller families and several CNC/box claims
  are not all fully hardware-proven.
- Current audit ledger still records open delta findings, mostly low/medium,
  around docs drift, finite-value guards, trace option validation, UI number
  field edges, jsdom canvas/WebGL warning noise, diagnostic harness ownership,
  and build chunk-size warning.

Heuristic source/test metrics refreshed during this audit:

| Repo | Head | Last commit date | Tracked files | Source files | Prod files | Test files | Prod LOC | Test LOC |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| KerfDesk | `93eb09d` | 2026-07-05 | 1700 | 1429 | 804 | 625 | 92176 | 78362 |

The LOC scan is a heuristic over `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`,
`.py`, and `.cs` files. It is useful for comparison, not a formal cloc report.

### Rayforge

Evidence:

- Local checkout: `C:\Users\Asus\Rayforge`.
- Origin: `https://github.com/barebaric/rayforge.git`.
- HEAD `bd7dd8ab`, clean/aligned with `origin/main`.
- README/docs describe a modern cross-platform 2D CAD, G-code sender, and
  control application for GRBL, Marlin, Ruida, and Smoothieware.
- Developer docs describe layered UI/editor/process/core architecture and a
  DAG pipeline with artifact management.
- Local source shows 31 device profile directories, 68 material files, 28
  machine-driver files, and 340 files under tests.
- Local metrics: 1198 source files, 828 production files, 370 test files,
  160731 production LOC, 89296 test LOC.

Interpretation: Rayforge is the strongest inspected open-source comparator for
laser-studio breadth, material/device ecosystem, and extensibility.

### Grid.Space / Kiri:Moto

Evidence:

- Local checkout:
  `C:\Users\Asus\LaserForge-2.0\references\comparative-audit\grid-apps`.
- Origin: `https://github.com/GridSpace/grid-apps.git`.
- HEAD `c2eca07`, clean/aligned with `origin/master`.
- Official GitHub page says Kiri:Moto is a browser-based slicer for 3D
  printers, CNC mills, and laser cutters.
- Local source shows 12 laser device configs, 28 CAM device configs, 3
  laser-mode files, and 47 CAM-mode files.
- Local metrics: 313 source files, 313 production files, no test files found by
  the heuristic, 128975 production LOC.

Interpretation: Grid.Space/Kiri is algorithmically broad and mature as a
browser CAM/slicer, but it is not a focused laser safety/control app in the same
shape as KerfDesk, Rayforge, or LightBurn.

### LaserGRBL

Evidence:

- Local checkout:
  `C:\Users\Asus\LaserForge-2.0\references\comparative-audit\lasergrbl`.
- Origin: `https://github.com/arkypita/LaserGRBL.git`.
- HEAD `1f9337b`, clean/aligned with `origin/master`.
- Official GitHub page describes a Windows GUI for GRBL laser cutters and
  engravers, specifically for GRBL v0.9/v1.1 style laser machines.
- Docs acknowledge minimal Z-axis control; LaserGRBL is primarily for XY laser
  machines.
- Local source includes GRBL, Smoothie, Marlin, and Vigo core classes, image
  conversion/vectorization code, and a large WinForms-style application.
- Direct test search found one xUnit test project plus a few in-product test
  helper files; the visible automated test surface is small.
- Local metrics: 752 source files, 748 production files, 4 test-like files,
  170359 production LOC, 455 test LOC.

Interpretation: LaserGRBL is battle-tested for Windows GRBL diode/engraver
workflows, but the inspected source looks older, narrower, and much less
test-disciplined than KerfDesk.

### CNCjs

Evidence:

- Local checkout:
  `C:\Users\Asus\LaserForge-2.0\references\comparative-audit\cncjs`.
- Origin: `https://github.com/cncjs/cncjs.git`.
- HEAD `fb39c0d`, clean/aligned with `origin/master`.
- Official README describes a full-featured web interface for CNC controllers
  running Grbl, Marlin, Smoothieware, or TinyG.
- Local source includes server-side controllers for Grbl, Marlin, Smoothie, and
  TinyG/g2core-style workflows, a sender, serial connection, workflow logic,
  and autolevel support.
- Direct search found 11 server-side test/fixture paths under `src/server`;
  broad heuristic found 21 test files and 4681 test LOC.
- Local metrics: 450 source files, 429 production files, 21 test files, 57734
  production LOC, 4681 test LOC.

Interpretation: CNCjs is stronger than KerfDesk as a mature sender/control
ecosystem, but it is not a full design/CAM laser application.

### LaserWeb4 / CNCWeb

Evidence:

- Local checkout:
  `C:\Users\Asus\LaserForge-2.0\references\comparative-audit\laserweb4`.
- Origin: `https://github.com/LaserWeb/LaserWeb4.git`.
- HEAD `9403a65`, branch `dev-es6`, aligned with `origin/dev-es6`.
- Official docs describe generating G-code from DXF/SVG/BITMAP/JPG/PNG for
  lasers and CNC mills, and controlling connected CNC/laser machines.
- `package.json` is AGPL-3.0 and uses an older React/Webpack-era stack.
- Local source includes CAM laser cut, raster, mill, operation, material, jog,
  and communications code.
- Local metrics: 121 source files, 121 production files, no test files found by
  the heuristic, 23158 production LOC.

Interpretation: LaserWeb4 is historically important and broad, but the inspected
source has weak modern verification evidence and an older architecture.

## Official Closed-Source Evidence

### LightBurn

Evidence:

- Official docs identify LightBurn as design and control software for laser
  work.
- Official docs list support for GCode controller/firmware families including
  GRBL, Smoothieware, Marlin, FluidNC, grblHAL, and xTool; DSP controllers
  including Ruida, Trocen, and TopWisdom; and galvo controllers including
  EZCAD2, EZCAD2 Lite, EZCAD3, and BSL.
- Official preview docs say the preview represents what will be sent to the
  laser and distinguishes cut moves from travel moves.
- Official 2.1 release notes dated May 19, 2026 add Quick Nest, enhanced camera
  support, Undo History, Tangent Circle Generator, Cuttle integration, and
  expanded camera controls.

Interpretation: LightBurn remains the market/product leader for laser workflow,
controller breadth, camera/nesting/polish, and user trust. Source code was not
inspected, so code-quality confidence is not high.

### Easel

Evidence:

- Official Easel page describes all-in-one CNC software for starting carving
  quickly.
- Prior local 1v1 audit evidence recorded Easel strengths in persistent split
  2D/3D workflow, per-object cut depth, auto feeds/speeds, and guided carve
  flow.

Interpretation: Easel is not a laser/control competitor in the full KerfDesk
sense, but it is a strong benchmark for beginner CNC/router workflow.

### xTool Studio / Creative Space

Evidence:

- Official xTool support release notes list Creative Space Desktop V2.7.22 on
  June 19, 2025 with official consumables QR recognition, AI Assistant, and
  optimizations for xTool MetalFab CNC Cutter and Apparel Printer.
- Older notes list device-specific features including templates, AI cutout,
  camera/material UX, fire detection, rotary preview guidance, and hardware
  ecosystem improvements.

Interpretation: xTool is strongest where software is tightly paired with its
own hardware ecosystem. Source code was not inspected and the ecosystem is
hardware/vendor-specific.

## Overall Scorecard

| Product | Score | Grade | Confidence | Short reason |
| --- | ---: | --- | --- | --- |
| LightBurn | 94 | A | Medium | Best laser product breadth, controller breadth, camera/nesting/polish; code not inspected. |
| Rayforge | 88 | B+ | High | Strongest open-source laser-studio comparator; broad devices/materials/tests/architecture. |
| KerfDesk / LaserForge-2.0 | 83 | B+ | High/Medium | Excellent code discipline and safety contracts; product breadth and hardware proof still behind leaders. |
| Easel | 82 | B+ | Medium | Excellent beginner CNC workflow; not a laser app and source not inspected. |
| xTool Studio / XCS | 80 | B | Medium | Strong device ecosystem integration; closed and hardware-specific. |
| Grid.Space / Kiri:Moto | 80 | B | High/Medium | Huge browser CAM/slicer breadth; weaker visible laser-control/test fit for this target rubric. |
| CNCjs | 75 | C+ | High | Excellent sender/control ecosystem; not a design/CAM laser product. |
| LaserGRBL | 69 | C | High | Mature Windows GRBL laser sender; narrow scope, old stack, thin automated test evidence. |
| LaserWeb4 / CNCWeb | 60 | D+ | High | Broad historical laser/CNC app; old stack and little visible automated verification. |

These are **not** all-purpose rankings. They are scores against the whole
KerfDesk target surface: laser design/control plus CNC/router plus safe G-code
generation plus maintainable code plus release discipline.

## Category Scores

| Product | Breadth /20 | CAM/safety /20 | Machine /15 | Architecture /15 | Verification /15 | UX /10 | Packaging /5 | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LightBurn | 20 | 19 | 15 | 13 | 12 | 10 | 5 | 94 |
| Rayforge | 18 | 17 | 14 | 13 | 14 | 8 | 4 | 88 |
| KerfDesk | 16 | 18 | 11 | 14 | 14 | 7 | 3 | 83 |
| Easel | 17 | 16 | 12 | 11 | 11 | 10 | 5 | 82 |
| xTool Studio / XCS | 16 | 15 | 15 | 10 | 9 | 10 | 5 | 80 |
| Grid.Space / Kiri:Moto | 19 | 18 | 9 | 13 | 8 | 8 | 5 | 80 |
| CNCjs | 14 | 8 | 15 | 13 | 12 | 8 | 5 | 75 |
| LaserGRBL | 13 | 13 | 12 | 9 | 4 | 8 | 4 | 69 |
| LaserWeb4 / CNCWeb | 16 | 13 | 12 | 7 | 2 | 6 | 4 | 60 |

## KerfDesk Score Rationale

### Capability breadth: 16 / 20

KerfDesk has laser design/import/trace/raster, G-code generation, controller
streaming, CNC/router mode, DXF/NC/STL-related scope, material tooling, camera
calibration paths, and a parametric box generator. That is broad.

The missing points are for market-leader breadth KerfDesk does not yet match:
deep rotary/galvo/DSP support, large machine/material ecosystems, mature camera
ecosystem, nesting, macro/addon/plugin marketplaces, and the sheer surface area
of LightBurn/Rayforge/Grid.Space.

### CAM/toolpath correctness and safety: 18 / 20

This is KerfDesk's strongest area. The project contract emphasizes bounds,
origin honesty, laser-off travel, deterministic G-code, unit/power honesty,
preflight checks, and pure core logic. The release gate includes typecheck,
lint, tests, builds, license checks, dependency audit, and file-size policy.

The missing points are for open delta findings in numeric/finite guards and
trace option validation, plus incomplete hardware verification for the full CNC
and multi-controller surface.

### Machine/control integration: 11 / 15

KerfDesk has real GRBL/grblHAL direction and a WebSerial/Electron path, plus
multi-controller architecture. It is not yet as mature as LightBurn, CNCjs,
Rayforge, or xTool in controller breadth, remote/pendant ecosystem, hardware
catalog depth, or proven non-primary-controller operation.

### Architecture/maintainability: 14 / 15

The codebase is modern TypeScript with strong boundaries, a pure core
orientation, platform separation, discriminated unions, co-located tests, and
release tooling. It is cleaner than the older open-source comparator codebases
inspected here.

The missing point is for current docs/status drift, warning debt, and the size
and complexity that now require continued architecture policing.

### Verification/release discipline: 14 / 15

KerfDesk is unusually strong here. The inspected repo has a full release gate
and high test density relative to comparator projects. The latest gate passed
at the audited HEAD, and the tree was still clean afterward.

The missing point is for warning noise in jsdom canvas/WebGL and React
`act(...)` paths, Vite chunk-size warning, and incomplete hardware verification
coverage for all claimed product surfaces.

### UX/operator workflow: 7 / 10

KerfDesk follows a LightBurn-style core loop and has serious safety/recovery
thinking. It still appears less polished and less guided than LightBurn, Easel,
or xTool for a new operator who wants to go from setup to first successful job
with minimal CAM knowledge.

### Packaging/ecosystem: 3 / 5

KerfDesk ships from one web/Windows Electron codebase and has Cloudflare Pages
deployment scripts. It does not yet match competitors with multi-OS desktop
distribution, mature extension ecosystems, large public device catalogs, or
vendor-hardware integration.

## Where KerfDesk Is Ahead

1. Source discipline versus older open-source tools.
   KerfDesk's typed contracts, release gate, and test footprint are stronger
   than LaserWeb4, LaserGRBL, and likely Grid.Space under this audit's visible
   test evidence.

2. Safety-first architecture versus generic CAM/sender tools.
   The project explicitly centers bounds, origin honesty, laser-off travel,
   no-partial-output, power/unit honesty, and preflight behavior.

3. Integrated CAM plus sender versus CNCjs.
   CNCjs is stronger as a sender/control ecosystem, but KerfDesk owns the
   design/import/trace/CAM/output path in one app.

4. Modern local-first product posture.
   KerfDesk's proprietary local-first app, no-telemetry posture, dependency
   license gate, and web/desktop shared codebase are commercially cleaner than
   copying from AGPL/GPL comparator codebases.

5. Verification density.
   The source/test ratio is unusually high for this domain. That does not make
   every feature correct, but it makes the codebase easier to trust and evolve.

## Where KerfDesk Is Behind

1. LightBurn product maturity.
   LightBurn has much broader controller support, camera/nesting features,
   galvo/DSP/GCode coverage, user workflow maturity, and market proof.

2. Rayforge open-source breadth.
   Rayforge has a wider visible device/material/addon ecosystem and a mature
   documented pipeline architecture.

3. Easel beginner CNC workflow.
   Easel is better evidence for guided carving, per-object depth UX, and
   beginner-friendly carve setup.

4. xTool hardware ecosystem.
   xTool's own software can integrate tightly with consumables, cameras,
   rotary/fire/device-specific workflows, and vendor hardware because it
   controls the ecosystem.

5. CNCjs sender ecosystem.
   CNCjs has deeper remote/multi-client/controller-control heritage than
   KerfDesk, though it does not solve the same CAM/design problem.

6. Grid.Space/Kiri algorithm breadth.
   Grid.Space is broader in general browser slicing/CAM territory, especially
   outside laser-only workflows.

## Findings

### KCD-COMP-001 - Hardware truth is the main blocker to higher score

Severity: High for market-readiness scoring.

KerfDesk's source and release discipline are strong, but hardware proof is not
uniform. GRBL/grblHAL Falcon paths have stronger proof than remaining
controller families, CNC/router operations, and box-generator fit claims.

Impact: the app can be excellent code while still scoring below market leaders
because real users judge hardware success, not test architecture.

### KCD-COMP-002 - Docs/status drift lowers trust

Severity: Medium.

The repo has a rich audit history, but README/project/audit status surfaces can
lag the current implementation. The existing audit ledger also records open
delta findings around sector maps and completion ledger coverage.

Impact: future reviewers can validate the wrong status, overclaim hardware
readiness, or miss newly landed trace/CNC changes.

### KCD-COMP-003 - Controller breadth lags LightBurn and Rayforge

Severity: Medium.

LightBurn officially covers GCode, DSP, and galvo families. Rayforge visibly
contains multiple driver families and a larger profile ecosystem. KerfDesk has
multi-controller architecture, but the proof/maturity is not equivalent yet.

Impact: KerfDesk is strong for its primary GRBL path but cannot honestly claim
leader-level controller maturity yet.

### KCD-COMP-004 - UX guidance lags Easel, xTool, and LightBurn

Severity: Medium.

KerfDesk has serious workflow structure, but the comparison suggests less
first-run guidance, material/device automation, and beginner-friendly
"successful first job" scaffolding than Easel/xTool/LightBurn.

Impact: even if G-code quality is high, operator confidence can lag.

### KCD-COMP-005 - Material/device ecosystem is still thin

Severity: Medium.

Rayforge has visible device and material catalogs. xTool has vendor-specific
consumables integration. LightBurn has broad machine-controller reach. KerfDesk
has the foundations but not the ecosystem depth.

Impact: setup friction and recipe trust remain competitive disadvantages.

### KCD-COMP-006 - Test/release warning debt should be cleaned

Severity: Low/Medium.

The release gate passes, but the audit ledger and release output identify
jsdom canvas/WebGL warning noise, React `act(...)` warnings, and a Vite
chunk-size warning.

Impact: warnings do not equal failing behavior, but they reduce confidence and
make it harder to spot real regressions.

### KCD-COMP-007 - Closed-source competitor scores are product scores, not code scores

Severity: Audit caveat.

LightBurn, Easel, and xTool source was not inspected. Their scores reflect
official product evidence, feature maturity, and ecosystem strength. They
should not be interpreted as audited code-quality scores.

Impact: KerfDesk can be better-verified code while still being a less mature
product.

### KCD-COMP-008 - GPL/AGPL comparator code is not implementation material

Severity: Medium for commercialization.

LaserGRBL is GPL-family and LaserWeb4 is AGPL-3.0. Rayforge is study/reference
only under the user's stated no-copy boundary. These projects are useful for
ideas and market comparison, not direct code import.

Impact: copying code would create license and provenance risk. KerfDesk should
continue clean-room implementation.

## Recommended Next Moves

1. Reconcile docs and hardware truth.
   Bring README, PROJECT, WORKFLOW, AUDIT, and current release notes into one
   consistent status model: built, hardware-verified, simulator-verified,
   file-only, claimed, deferred.

2. Build a hardware verification ladder.
   Prioritize repeatable evidence for primary laser, CNC 4040 jobs, box fit,
   FluidNC/Marlin/Smoothieware paths, and any Ruida/file-only export story.

3. Add a guided "first safe job" flow.
   Use Easel/xTool as workflow benchmarks: device setup, material selection,
   preview, frame/air-cut, checklist, start, pause, recovery, and result
   confirmation.

4. Expand device/material catalogs with clean-room data.
   Do not copy competitor catalogs. Add own profiles, recipes, and validation
   fixtures with provenance.

5. Clean release warning debt.
   Add stable canvas/WebGL mocks or targeted test environment handling, fix
   recurring `act(...)` warnings, and decide on chunk splitting.

6. Keep Rayforge as reference, not authority.
   Rayforge is valuable for architecture and ecosystem comparison, but KerfDesk
   should keep its own product shape and source lineage.

7. Re-score after hardware proof.
   If docs are reconciled and hardware verification catches up, KerfDesk can
   plausibly move from 83 toward the high 80s without adding flashy features.
   Moving into the 90s requires real product/ecosystem breadth, not only cleaner
   code.

## Source Links

- LightBurn laser/controller docs:
  https://docs.lightburnsoftware.com/2.1/GetStarted/LaserID/
- LightBurn preview docs:
  https://docs.lightburnsoftware.com/2.1/Reference/Preview/
- LightBurn 2.1 release notes:
  https://lightburnsoftware.com/blogs/news/lightburn-2-1-quick-nest-enhanced-camera-support-undo-history-and-more
- Rayforge:
  https://rayforge.org/
- Rayforge GitHub:
  https://github.com/barebaric/rayforge
- Grid.Space / Kiri:Moto GitHub:
  https://github.com/GridSpace/grid-apps
- LaserGRBL GitHub:
  https://github.com/arkypita/LaserGRBL
- CNCjs GitHub:
  https://github.com/cncjs/cncjs
- CNCjs docs/site:
  https://cnc.js.org/
- LaserWeb / CNCWeb:
  https://laserweb.yurl.ch/
- LaserWeb4 GitHub:
  https://github.com/LaserWeb/LaserWeb4
- Easel:
  https://easel.com/
- xTool Studio / Creative Space release notes:
  https://support.xtool.com/article/1773

## Local Evidence Paths

- Target project contract: `PROJECT.md`
- Target release scripts: `package.json`
- Current repository audit ledger:
  `audit/REPOSITORY-SECTOR-AUDIT-2026-07-03.md`
- Existing Easel comparison:
  `audit/reports/easel-1v1-comparison-2026-07-03.md`
- Rayforge checkout: `C:\Users\Asus\Rayforge`
- Local comparator checkouts:
  `C:\Users\Asus\LaserForge-2.0\references\comparative-audit`
