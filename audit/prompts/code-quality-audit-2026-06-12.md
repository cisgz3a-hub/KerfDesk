# Code Quality Audit Prompt - 2026-06-12

Audit LaserForge-2.0 as a real laser-control application, not as a generic web app.

Repo rules:
- Read `CLAUDE.md`, `PROJECT.md`, `WORKFLOW.md`, `DECISIONS.md`, and current audit reports before scoring.
- Audit only unless the maintainer explicitly asks for fixes.
- Every finding needs file path, function/module, trigger path, failure mode, consequence, severity, confidence, and concrete fix.
- Reject vague best-practice advice and duplicate findings.
- Do not score until false positives are removed.

Code-quality focus:
1. Release gates: typecheck, lint, formatting, tests, builds, file-size, license, dependency audit.
2. Maintainability: file/function size, complexity, module boundaries, duplicated logic, naming, stale docs, god-file risk.
3. Type safety: `any`, unsafe casts, non-null assertions, `@ts-ignore`, unchecked async, broad JSON validation.
4. Architecture: pure core, platform boundaries, UI/platform separation, mutable module state, hidden side effects.
5. Safety-critical code quality: GRBL streaming, pause/stop/disconnect, G-code emission, preflight, raster/fill/trace workflows.
6. Frontend quality: theme consistency, dialog accessibility, component test coverage, browser-visible regressions.
7. Dependency posture: vulnerable packages, license policy, bundle risks.

Scoring:
- Rate out of 10 only after confirmed findings and false-positive rejection.
- Separate "current tree health" from "product parity with LightBurn".
- State exactly what was and was not verified.
