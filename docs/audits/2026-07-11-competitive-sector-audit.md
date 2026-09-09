> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# KerfDesk Competitive Sector Audit

**Audit date:** 2026-07-11
**Revision:** 2.0 (continued code-evidence pass, 2026-07-12)
**Shipped source snapshot:** `3e4530748ad9b266f5a21904f033f68e2c0014bb` (`origin/main`)
**Production build observed:** `KerfDesk v0.1.915 - 3e453074`
**Scope:** Laser and CNC design, CAM, machine operation, output, resilience, UX, engineering quality, and value
**Comparison set:** LightBurn 2.1.02 Pro, xTool Studio, Rayforge, LaserGRBL, Easel, Carbide Create Pro with Motion, and VCarve Pro

## Executive Verdict

**KerfDesk is good code and already a credible hybrid laser/CNC product. It is not yet feature-equivalent to the category leaders.**

The shipped product scores **7.5/10 overall**. Its strongest areas are output safety, broad controller and machine coverage, material/test workflows, laser CAM, trace mask fidelity, engineering transparency, and free/open-source value. Its weakest areas are variable-data text, automatic nesting, advanced CNC automation, rotary/registration workflows, large-trace geometry density, hardware-validated recovery, and UX discoverability.

This is a stronger technical foundation than the score alone suggests. Most of the remaining gap is product depth and validation, not evidence of a fundamentally poor architecture. The highest-risk exception is machine-control behavior that is well tested in software but still lacks enough real-hardware evidence.

### Headline Ratings

| View | KerfDesk | Current leader | Leader score | Verdict |
|---|---:|---|---:|---|
| Laser feature/workflow | 7.4 | LightBurn | 9.4 | Competitive core, substantial specialist-feature gap |
| CNC end-to-end stack | 7.5 | Easel | 8.2 | Real 2D/2.5D and relief CAM, behind in automation and polish |
| CNC CAM depth | 7.5 | VCarve Pro | 8.9 | VCarve is CAM-only here; KerfDesk also controls machines |
| Engineering quality | 8.5 | KerfDesk | 8.5 | Best inspectable evidence in this comparison |
| Value, offline use, openness | 9.5 | Rayforge | 10.0 | Major product advantage |

Scores are arithmetic means of relevant sectors, not market-share rankings. `N/A` means the category is outside the product's intended scope. `NR` means a defensible rating was not possible from public evidence.

## Evidence Policy

| Grade | Meaning |
|---|---|
| A | Reproduced against the exact shipped source/build or verified by a completed CI run |
| B | Reproduced in the product or a local competitor installation, but without hardware |
| C | Supported by current official product documentation or release notes |
| D | Inference, historical audit evidence, or an incomplete validation path |

Closed-source competitors can be rated for observable capability and workflow, but not internal code quality. Hardware-dependent claims remain provisional until tested on representative machines.

## Sector Scorecard

| # | Sector | KerfDesk | Evidence | Assessment |
|---:|---|---:|:---:|---|
| 1 | Onboarding and device setup | 7.5 | A/B | Broad wizard and profile coverage; expert concepts appear early and can feel dense. |
| 2 | Import, projects, interoperability | 8.0 | A | Strong common-format support and LightBurn device import; no `.clb` material-library import. |
| 3 | 2D design and editing | 7.0 | A/B | Solid everyday editing and booleans; below dedicated design/CAM leaders in breadth and refinement. |
| 4 | Text and variable data | 5.0 | A/C | Ordinary text is present; variable text, serialization, and production-data workflows are absent. |
| 5 | Image adjustment, trace, raster | 8.5 | A/B | High mask fidelity and useful presets; generated vector geometry is still too dense and preset behavior needs broader visual gates. |
| 6 | Layers, materials, test workflows | 8.0 | A/B | Strong material library and test suite; ecosystem/import depth trails LightBurn. |
| 7 | Layout, nesting, tiling, generators | 6.5 | A | Tiling and box-fit tools exist; automatic nesting and drag-place tabs do not. |
| 8 | Laser CAM | 8.5 | A | Mature cut/fill/image setup, air-assist consolidation, framing, kerf, tabs, and safety logic. |
| 9 | CNC 2D/2.5D CAM | 7.5 | A | Profiles, pockets, contours, drilling, tabs, stock, bits, and native arcs form a credible base. |
| 10 | Advanced CNC and 3D | 7.5 | A | STL relief import, roughing, finishing, V-carving, and 3D cut preview are real; adaptive/rest machining, automated inlays, and helical entry remain absent. |
| 11 | Preview, simulation, estimates | 8.0 | A/B | Strong preview/simulation direction and job visibility; needs more adversarial and hardware correlation tests. |
| 12 | Machine profiles and connectivity | 8.0 | A | Multiple controller families and useful catalogs; detected controller kind can still drift from the retained streaming-mode choice. |
| 13 | Jog, frame, origin, probing | 8.0 | A/B | Broad operational controls and recent recovery fixes; physical-machine proof is incomplete. |
| 14 | Rotary, camera, registration, print-and-cut | 5.5 | A | Rotary math/output exists without a complete discoverable UI and rejects raster; print-and-cut is absent; camera trust/registration remains incomplete. |
| 15 | Streaming, pause, recovery, tool changes | 7.5 | A | Strong state-machine work and recent fixes; still needs representative hardware fault campaigns. |
| 16 | Output correctness and safety | 8.0 | A | Extensive invariants, preflight, travel hard-off behavior, and CI evidence; external controller validation is not comprehensive. |
| 17 | Performance and large jobs | 6.5 | A/B | Functional, but current-main trace output is excessively point-dense and increases editing, rendering, and output cost. |
| 18 | UX, accessibility, documentation | 6.5 | B/D | Feature-rich but dense; important capabilities are buried and fixed rails reduce clarity on constrained layouts. |
| 19 | Engineering, security, testing | 8.5 | A | Large automated suite, strict gates, source transparency, and focused invariants; no browser E2E suite, unsigned updater, and hardware coverage gaps. |
| 20 | Value, platforms, offline use, openness | 9.5 | A/C | Free, MIT-licensed, web plus Windows desktop, and inspectable; Rayforge has a slightly broader public multi-axis/open-platform claim. |

The full competitor-by-sector matrix is in `2026-07-11-competitive-scorecard.csv` beside this report.

## Laser Comparison

| Product | Laser score | Where it leads | Main limitation in this comparison |
|---|---:|---|---|
| LightBurn | 9.4 | Editing depth, variable text, nesting, camera, rotary, print-and-cut, device ecosystem | Paid; internal engineering quality cannot be audited |
| xTool Studio | 8.6 | Onboarding, assets/fonts, automatic image adjustment, guided ecosystem workflows | Primarily optimized for xTool hardware; closed source |
| Rayforge | 8.0 | Open architecture, 3D simulation, rotary/multi-axis direction, automatic layout | Smaller maturity/ecosystem footprint than LightBurn |
| **KerfDesk** | **7.4** | Hybrid laser/CNC scope, tests, safety, materials/tests, value | Specialist workflow gaps and incomplete hardware validation |
| LaserGRBL | 5.7 | Lightweight GRBL operation, raster conversion, simplicity | Limited design, production automation, and advanced workflow depth |

LightBurn's official reference documents variable text, nesting, tracing, camera alignment, rotary, print-and-cut, tabs, kerf, perforation, lead-in/out, and broad test tools: [LightBurn Reference](https://docs.lightburnsoftware.com/2.0/Reference/).

xTool's current product documentation describes layers, more than 1,800 fonts/assets, automatic image adjustment, parameter presets, material libraries, preview, rotary, and batch workflows: [xTool Studio release notes](https://support.xtool.com/article/1773).

Rayforge presents 2D CAD/CAM/control, 3D simulation, rotary and multi-axis support, automatic layout, and material recipes: [Rayforge](https://rayforge.org/). LaserGRBL documents GRBL connection/control, jog, overrides, alarms, raster conversion, dithering, and vectorization: [LaserGRBL usage](https://lasergrbl.com/usage/).

## CNC Comparison

| Product | Relevant CNC score | Where it leads | Main limitation in this comparison |
|---|---:|---|---|
| VCarve Pro | 8.9 | Deep 2D/2.5D CAM, true nesting, inlays, text, tracing, 3D toolpaths | CAM product, not an equivalent integrated sender/controller; paid |
| Easel | 8.2 | Beginner workflow, machine integration, fonts/assets, guided toolpaths | Less inspectable and less open; advanced use often depends on paid plans |
| Carbide Create Pro + Motion | 8.1 | Tight CAM-to-machine workflow, rest machining, ramping, 3D rough/finish | Best inside its ecosystem; closed source |
| **KerfDesk** | **7.5** | Integrated control, probing, arcs, tiling, surfacing, STL relief rough/finish, openness | Missing adaptive/rest, helical, inlay automation, nesting, and draggable tabs |

Easel describes an all-in-one CNC workflow, STL/3D support, more than 300 fonts, V-carving, raster toolpaths, and broad router support: [Easel](https://www.easel.com/). Carbide Create Pro documents 3D roughing/finishing, rest machining, ramping, STL import, tiling, and standard G-code: [Carbide Create Pro](https://carbide3d.com/carbidecreate/pro/).

VCarve documents profiling, pocketing, inlays, drilling, text, tracing, 2.5D/3D workflows, and true-shape nesting in Pro: [VCarve](https://www.vectric.com/products/vcarve/) and [VCarve documentation](https://docs.vectric.com/docs/V12.5/VCarveDesktop/ENU/Help/page/user-guide/).

## Trace Head-to-Head

The exact Arch House fixture was traced in shipped KerfDesk current-main and in a local LightBurn Pro 2.1.02 installation.

### KerfDesk Current-Main Line Art

- Raster comparison: IoU `0.953`, precision `0.979`, recall `0.973`.
- Apex fidelity: worst sampled distance `1.41 px` for Line Art, `1.71 px` for Smooth, and `3.41 px` for Sharp.
- Geometry: `72` closed polylines, `38` holes, `27,423` polyline points.
- Focused audit result: `6` tests passed and `1` environment-gated test skipped.

### LightBurn Default Trace

- Settings observed: threshold `128`, ignore less than `2`, smoothness `1.0`, optimize `0.2`.
- Export: `96` SVG paths and `1,071` SVG path commands.
- Audit artifact: `lightburn-arch-house-default.svg` in the audit artifact directory.

SVG commands and KerfDesk polyline points are **not identical units**, so the counts are not a direct quality ratio. They are nevertheless strong evidence that KerfDesk's current-main result is much denser and more expensive to edit, render, serialize, and emit than the LightBurn result. Visually, the current-main masks preserve the source well; geometry economy and local curve quality are now the more important trace problems.

An experimental, unshipped trace branch reduced Line Art to `5,612` points and produced promising preset metrics, including Sharp IoU `0.9927`. Those results are **not included in the shipped rating** because the branch was behind `main` and had not been integrated.

## Verified Strengths

1. **Hybrid product breadth:** one application covers design, laser CAM, CNC CAM, machine setup, streaming, probing, framing, tests, and material workflows.
2. **Safety-oriented output:** preflight checks, explicit laser-off travel behavior, state invariants, and controller-aware policies are first-class code concerns.
3. **Engineering discipline:** current-main passed local typecheck, web/electron lint, format, and file-size gates; focused trace/box tests passed; GitHub CI and deployment were green for the audited commit.
4. **Box generator math:** the current property benchmark passed `1,114/1,114` cases across `54` specifications.
5. **Controller breadth:** GRBL 1.1, grblHAL, FluidNC, Marlin, Smoothieware, and Ruida are represented in the shipped source.
6. **CNC foundation:** native G2/G3 output, machine/bit catalogs, stock setup, probing, tiling, surfacing, V-carving, and STL relief roughing/finishing are meaningful capabilities, not placeholders.
7. **Trace fidelity:** current masks are objectively close to the reference fixture; the remaining issue is primarily vector quality and efficiency.
8. **Value and inspectability:** MIT licensing, offline-capable desktop/web delivery, and source-level auditability are durable advantages over closed competitors.

## Verified Gaps

### Product Capability

1. No automatic nesting workflow.
2. No variable-text/data-production system.
3. No print-and-cut registration workflow.
4. No LightBurn `.clb` material-library import.
5. Rotary output exists, but the shipped UI is incomplete and rotary raster is refused.
6. No adaptive clearing strategy.
7. No automated CNC inlay workflow.
8. No helical-entry strategy for CNC operations.
9. No canvas-draggable tabs.
10. The existing STL relief workflow is drag-and-drop driven and trails the discoverability, strategy selection, rest machining, and production validation of dedicated 3D CAM products.

### Quality and Operations

1. Current-main trace vectors are far denser than necessary despite good rasterized fidelity.
2. Camera/registration needs exact hosted-origin trust handling and real-machine calibration evidence.
3. CNC recovery, probing, and tool-change behavior needs a repeatable hardware fault matrix.
4. A detected controller kind can replace the selected profile kind without recalculating the profile's streaming mode; no focused test pins that cross-field combination.
5. `.lbdev` and Ruida validation lack a sufficiently broad real-world/external corpus.
6. Desktop update/signing provenance is not release-grade.
7. CI is strong at unit/integration level but lacks a maintained Playwright-style browser E2E suite.
8. Important tools remain difficult to discover, and control density increases operator error risk.

## Code Evidence Map

| Audit claim | Current-main evidence | Confidence | Meaning |
|---|---|:---:|---|
| Preview, estimate, save, and start share prepared output | `src/io/gcode/prepare-output.ts:49`, `src/io/gcode/emit-gcode.ts:46`, `src/ui/laser/live-job-estimate.ts:46`, `src/ui/laser/start-job-readiness.ts:213` | A | Users do not preview one output pipeline and run another. |
| Laser-off travel is executable policy | `src/core/invariants/predicates.ts:53`, `src/core/output/grbl-strategy.property.test.ts:128`, `src/core/raster/emit-raster.test.ts:385` | A | Safety is checked after generation, including property and raster cases. |
| Advanced CNC relief is shipped | `src/core/cnc/compile-cnc-relief.ts:42`, `src/core/cnc/compile-cnc-relief.ts:121`, `src/core/cnc/vcarve-perceptual.test.ts:92` | A | Relief roughing, finishing, and analytic V-carve verification justify the revised `7.5` sector score. |
| STL relief discoverability is weak | `src/ui/app/stl-import-action.ts:30`, `src/ui/app/use-import-drag-drop.ts:88` | A | Import works, but it depends on discovering drag-and-drop rather than a normal File/Import route. |
| Rotary backend is real but incomplete | `src/core/devices/rotary.ts:37`, `src/io/gcode/emit-gcode.ts:113`, `src/io/gcode/emit-gcode-rotary.test.ts:96` | A | Math, transform, persistence, and refusal behavior exist; raster is explicitly unsupported and no shipped UI route was found. |
| `.clb` import is absent | `src/ui/app/material-library-file-actions.ts:29` | A | The actual open picker accepts only `.lfml.json`; a LightBurn reference in a persistence comment is not an importer. |
| Controller/streaming cross-field drift is possible | `src/core/devices/profile-application.ts:23` | A | Detection can overwrite `controllerKind` after spreading the profile while retaining its existing `streamingMode`. |
| Several profiles are simulator-only | `src/core/devices/profile-catalog.ts:132`, `src/core/devices/profile-catalog.ts:160`, `src/core/devices/profile-catalog.ts:185`, `src/core/devices/profile-catalog.ts:206` | A | FluidNC, Marlin, Smoothieware, and Ruida labels correctly disclose incomplete hardware proof. |
| Desktop signing is not release-grade yet | `.github/workflows/release-desktop.yml:13` | A | The workflow explicitly says v1 builds are unsigned until signing secrets exist. |
| Browser E2E is absent | Repository/package search found no Playwright, Cypress, or WebDriver configuration or dependency | A | Vitest coverage is broad, but real browser workflow regressions lack an automated gate. |

## Risk Register

Impact and likelihood use a `1-5` audit scale. Exposure is their product; it is a prioritization aid, not a statistical failure probability.

| Risk | Impact | Likelihood | Exposure | Priority | Why it matters |
|---|---:|---:|---:|---|---|
| Unsigned desktop installer/updater chain | 4 | 4 | 16 | P0 | Trust warnings and update provenance affect every desktop release. |
| Hardware-unproven recovery/tool-change paths | 5 | 3 | 15 | P0 | Simulator correctness cannot prove physical motion, spindle, or laser state. |
| Controller-kind/streaming-mode mismatch | 5 | 3 | 15 | P0 | A wrong streaming policy can stall, overrun, or desynchronize a real controller. |
| Experimental Ruida output without controller acceptance | 5 | 3 | 15 | P0 | Self-round-trip is not independent proof that a machine will safely accept the file. |
| Trace geometry density | 3 | 5 | 15 | P1 | It predictably increases editing, preview, serialization, and machine-output cost. |
| Missing production automations | 3 | 5 | 15 | P2 | Nesting, variable data, and advanced CNC automation determine throughput more than basic capability. |
| Rotary raster/UI incompleteness | 3 | 4 | 12 | P2 | A technically present backend remains difficult to use and excludes common image jobs. |

## Recommended Build Order

### P0: Prove Machine Safety

1. Build a hardware test matrix covering framing speed, travel speed, pause/resume, disconnect/reconnect, alarm recovery, origin changes, probing, tool changes, and laser hard-off boundaries.
2. Add golden controller transcripts and physical-motion measurements for the highest-volume GRBL/FluidNC profiles.
3. Establish signed desktop releases and a verifiable updater chain.

### P1: Make Existing Quality Visible

1. Finish trace geometry simplification with topology, corner, curve, counter, and text-legibility judges across every preset.
2. Add browser E2E tests for setup, import, trace, layer assignment, frame, start, pause/resume, CNC stock/tool setup, and export.
3. Enforce controller-kind compatibility with streaming mode, dialect, baud, RX-buffer, and power-range choices after every profile/detection merge.
4. Rework feature discovery and compact-layout behavior around operator tasks rather than implementation modules.

### P2: Close High-Value Workflow Gaps

1. Automatic nesting and drag-place tabs.
2. Variable text/data production.
3. Complete rotary setup plus raster rotary support.
4. Print-and-cut/camera registration.
5. `.clb` import with explicit field mapping and compatibility reporting.

### P3: Deepen CNC

1. Helical entry and configurable ramp strategies.
2. Adaptive clearing and rest machining.
3. Automated inlay generation and tolerance controls.
4. Harden the existing STL relief workflow with visible import, more strategy controls, golden fixtures, and hardware validation.

## Verification Record

- Local gates passed: `typecheck`, web lint, Electron lint, format check, and file-size check.
- Focused property/trace suite: `6` passed, `1` skipped; box benchmark `1,114/1,114` passed.
- Continued evidence bundle: `9` files and `50` tests passed across relief rough/finish, V-carve, rotary, material-library actions, device setup, and desktop release gating.
- Audited-commit CI: [GitHub Actions run 29154377160](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/29154377160).
- Audited-commit deployment: [GitHub Actions run 29154845583](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/29154845583).
- The optional `ARCH_LOOP=1` artifact run was not completed in this audit; focused trace and apex tests were used instead.
- No laser or CNC hardware was moved during this audit.
- Closed-source competitor engineering/security scores are `NR`, not assumed.

## Bottom Line

KerfDesk should not claim full LightBurn, Easel, or VCarve parity today. It can accurately claim a broad, free, inspectable laser-and-CNC workspace with unusually strong automated safety and correctness work. The shortest path to a genuinely category-leading product is to prove hardware behavior, reduce trace geometry without losing topology, simplify the operating workflow, and then add the missing production automations in the priority order above.
