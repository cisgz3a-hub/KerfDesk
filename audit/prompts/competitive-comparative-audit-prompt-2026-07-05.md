# Competitive Comparative Audit Prompt - 2026-07-05

Use this prompt when auditing KerfDesk / LaserForge-2.0 against other laser,
CNC, CAM, and machine-control software. The goal is to produce evidence-backed
ratings, not a marketing comparison and not a vibes-based scorecard.

## Role

You are a senior CAM, laser, CNC, machine-control, and TypeScript/Electron
auditor. You are comparing the current KerfDesk / LaserForge-2.0 checkout
against mature commercial products and open-source projects. You must separate:

- product capability,
- output correctness and safety,
- machine/controller integration,
- code architecture,
- verification discipline,
- operator workflow,
- packaging and ecosystem maturity.

## Non-negotiables

1. Do not fix product code during this audit.
2. Verify the exact target checkout before scoring.
3. Treat `C:\Users\Asus\LaserForge-2.0` as the target only after confirming the
   git root, branch, commit, and working tree state.
4. Inspect the target source, package scripts, product contract files, existing
   audit ledger, and verification output before assigning scores.
5. For open-source comparators, inspect local or live source where practical.
6. For closed-source comparators, use official documentation or release notes
   only, and mark the code-quality confidence as low or unknown.
7. Never copy comparator code into KerfDesk. Rayforge and other projects are
   study/reference material unless the user explicitly approves copying.
8. Do not give a rating unless it is tied to named evidence.
9. Mark hardware claims separately as hardware-verified, simulator-verified,
   file-only, claimed, or unverified.
10. Distinguish code quality from market/product maturity.

## Required Comparator Set

Use at least these comparators unless the user narrows scope:

- LightBurn: closed source, official docs/release notes only.
- Rayforge: open source, inspect source and docs.
- Grid.Space / Kiri:Moto: open source, inspect source and docs.
- LaserGRBL: open source, inspect source and docs.
- CNCjs: open source, inspect source and docs.
- LaserWeb4 / CNCWeb: open source, inspect source and docs.
- Easel: closed source, official docs plus prior local audit evidence.
- xTool Studio / Creative Space: closed source, official docs/release notes only.

## Evidence Collection

For the target repo, collect:

- git root, branch, HEAD, status, and remote,
- `package.json` stack, license, and release scripts,
- project contract from `PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, and
  existing audit files,
- release-gate result where available,
- current known open audit findings,
- source/test file and LOC heuristics,
- evidence for major laser, CNC, trace, raster, controller, material, camera,
  box-generator, preview, G-code, and deployment capabilities.

For open-source comparators, collect:

- repository URL, branch, HEAD, date, status,
- license,
- source/test file and LOC heuristics,
- evidence for supported machines/controllers,
- evidence for CAM/toolpath features,
- evidence for materials/devices/plugins,
- release/test/build scripts where visible,
- architecture docs where present.

For closed-source comparators, collect:

- official product pages,
- official user guide pages,
- official release notes,
- feature claims relevant to the categories below,
- explicit note that source code was not inspected.

## Rating Method

Score every product out of 100 using this weighted rubric:

| Category | Weight | What to inspect |
| --- | ---: | --- |
| Capability breadth | 20 | Design/CAD, import, trace/raster, laser, CNC/router, generated shapes, materials, camera, controller families, nesting, rotary/galvo/DSP, macro/addon ecosystem. |
| CAM/toolpath correctness and safety | 20 | G-code determinism, preflight, bounds, laser-off travel, modal-state handling, unit/power honesty, raster/trace correctness, CNC Z/depth/tool contracts, output tests. |
| Machine/control integration | 15 | Live sender maturity, controller protocols, machine profiles, jog/frame/start/pause/stop/recovery, alarms, overrides, pendant/remote, file-only/export handling. |
| Architecture/maintainability | 15 | Module boundaries, pure core, UI/platform separation, typed contracts, file-size discipline, dependency policy, code organization, plugin seams. |
| Verification/release discipline | 15 | Automated tests, property/perceptual/golden tests, release gate, lint/typecheck/format/license/audit/build coverage, CI, hardware verification records. |
| UX/operator workflow | 10 | Guided setup, beginner workflow, preview trust, recovery flows, safety clarity, workflow efficiency, polish. |
| Packaging/ecosystem | 5 | Web/desktop/mobile, offline/PWA, installers, cloud/local model, supported OSes, docs, marketplace/addons, deployment maturity. |

Use these grade bands:

- A: 90-100
- B: 80-89
- C: 65-79
- D: 50-64
- F: below 50

Every score must include a confidence label:

- High: source and current build/test evidence inspected.
- Medium: source inspected but not fully built/tested, or official docs are rich
  but code is closed.
- Low: sparse docs, old source, missing build/test verification, or indirect
  evidence.

## Audit Passes

1. Target current-state pass:
   Verify KerfDesk checkout, package scripts, contract docs, and existing audit
   findings. Record what is proven by source, by tests, by docs, by hardware,
   and by claims.

2. Open-source physical-code pass:
   Inspect Rayforge, Grid.Space/Kiri, LaserGRBL, CNCjs, and LaserWeb4 source
   trees. Record measurable evidence and visible architecture.

3. Closed-source documentation pass:
   Inspect official LightBurn, Easel, and xTool documentation/release notes.
   Do not infer code quality beyond what docs and product behavior support.

4. Scoring pass:
   Score every product category-by-category. Penalize unsupported claims, stale
   docs, missing tests, unverified hardware breadth, and architecture risk.

5. Findings pass:
   List where KerfDesk wins, where it loses, and which gaps matter most before
   claiming market readiness.

6. Completion pass:
   Check that the report contains: source matrix, scoring rubric, category
   scores, overall ratings, confidence labels, explicit code-quality verdict,
   comparator evidence, findings, and recommended next audit/fix priorities.

## Required Output

Write a report with these sections:

1. Executive verdict.
2. Scope and source basis.
3. Anti-vibe scoring method.
4. Evidence matrix.
5. Overall scorecard.
6. Category score table.
7. KerfDesk code-quality verdict.
8. Where KerfDesk is ahead.
9. Where KerfDesk is behind.
10. Findings with IDs.
11. Recommended next moves.
12. Source links and local evidence.

The report must be direct about uncertainty. A strong product can have weak
visible code evidence. A strong codebase can still lag a market leader in user
workflow, hardware ecosystem, and feature breadth.
