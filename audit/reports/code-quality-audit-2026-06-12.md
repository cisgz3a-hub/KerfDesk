# LaserForge 2.0 Code Quality Audit - 2026-06-12

## Scope

Audit target: `C:\Users\Asus\LaserForge-2.0`

Branch: `main`

Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`

This was an audit-only pass. I did not patch production code. Existing working-tree edits before this audit were:

- `index.html`
- `public/404.html`
- `src/ui/theme/tokens.css`

Audit artifacts added in this pass live under `audit/`.

## Score

Code quality rating: **8.0 / 10**

Reasoning:

- Strong positives: strict TypeScript, ESLint boundaries, format gate, license gate, 197 test files / 1411 tests passing, web build passing, Electron main build passing, repository identity guard passing.
- Main drag: dependency audit fails on a critical Vitest advisory, and CI/deploy do not run dependency audit.
- Secondary drag: main web chunk is over the configured 500 kB warning limit, several high-risk files are large enough to slow review, and a few repo policy/docs contracts drift from the current code.

Release-readiness rating: **7.2 / 10** until the Vitest advisory and audit-gate gap are fixed.

## Commands Run

All commands were run from `C:\Users\Asus\LaserForge-2.0`.

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm guard:repo` | pass | `audit/evidence/code-quality-guard-repo-2026-06-12.txt` |
| `pnpm typecheck` | pass | `audit/evidence/code-quality-typecheck-2026-06-12.txt` |
| `pnpm lint` | pass, with non-fatal boundaries v6 migration warning | `audit/evidence/code-quality-lint-2026-06-12.txt` |
| `pnpm exec prettier --check .` | pass | `audit/evidence/code-quality-format-2026-06-12.txt` |
| `pnpm check:file-size` | pass | `audit/evidence/code-quality-file-size-2026-06-12.txt` |
| `pnpm test` | pass: 197 files, 1411 tests | `audit/evidence/code-quality-test-2026-06-12.txt` |
| `pnpm build:web` | pass, but bundle-size warning | `audit/evidence/code-quality-build-web-2026-06-12.txt` |
| `pnpm build:electron-main` | pass | `audit/evidence/code-quality-build-electron-main-2026-06-12.txt` |
| `pnpm lint:electron` | pass | `audit/evidence/code-quality-lint-electron-2026-06-12.txt` |
| `pnpm license-check` | pass | `audit/evidence/code-quality-license-2026-06-12.txt` |
| `pnpm audit --prod` | pass | `audit/evidence/code-quality-audit-prod-2026-06-12.txt` |
| `pnpm audit --audit-level=low` | fail: 1 critical dev vulnerability | `audit/evidence/code-quality-audit-low-2026-06-12.txt` |

## Findings

### CQ-001 - Dependency audit fails on a critical Vitest advisory

Severity: **P1 release hygiene / security**

Confidence: **High**

File/module: `package.json`, dev dependencies

Evidence:

- `package.json:53` pins `@vitest/coverage-v8` to `^3.2.4`.
- `package.json:70` pins `vitest` to `^3.2.4`.
- `audit/evidence/code-quality-audit-low-2026-06-12.txt:2-18` reports a critical `vitest` advisory: vulnerable `<3.2.6`, patched `>=3.2.6`, advisory `GHSA-5xrq-8626-4rwp`.
- `audit/evidence/code-quality-audit-prod-2026-06-12.txt` reports no production vulnerabilities, so this is scoped to dev tooling.

Trigger path:

- Run `pnpm audit --audit-level=low`.
- Or run Vitest UI / browser-mode dev tooling on a vulnerable version.

Failure mode:

- The dependency tree contains vulnerable `vitest <3.2.6`.

Consequence:

- Dev tooling dependency hygiene is red. Even though this does not ship in the production bundle, it is a real repo quality and safety-process gap because test servers are developer-facing networked tools.

Concrete fix:

- Bump both `vitest` and `@vitest/coverage-v8` to `^3.2.6` or newer compatible patch.
- Refresh `pnpm-lock.yaml`.
- Re-run `pnpm audit --audit-level=low`, `pnpm test`, and `pnpm typecheck`.

### CQ-002 - CI/deploy do not run dependency audit

Severity: **P1 release process**

Confidence: **High**

File/module:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `package.json`

Evidence:

- `.github/workflows/ci.yml:57-69` runs license, tests, build, and file-size checks, but no `pnpm audit`.
- `.github/workflows/deploy.yml:87-99` repeats license, tests, build, and file-size checks before Cloudflare deploy, but no `pnpm audit`.
- `package.json` has no dedicated `audit` script.
- The current local audit fails in `audit/evidence/code-quality-audit-low-2026-06-12.txt`.

Trigger path:

- Push a commit with a vulnerable dev dependency that still passes lint, typecheck, tests, build, license-check, and file-size checks.

Failure mode:

- GitHub CI and the production deploy workflow can go green without noticing the dependency advisory.

Consequence:

- Security/dependency regressions rely on a human remembering to run `pnpm audit` locally. That is weaker than the rest of the repo's "gates catch it" design.

Concrete fix:

- Add `audit:deps`: `pnpm audit --audit-level=low`.
- Run it in CI.
- In deploy, either rely on successful CI after adding the gate or repeat the same audit before publish.
- Keep `pnpm audit --prod` optional if deploy time becomes too slow; the current failing signal is the full dev audit.

### CQ-003 - Web main chunk exceeds the configured 500 kB warning limit

Severity: **P2 performance / maintainability**

Confidence: **High**

File/module:

- `vite.config.ts`
- web bundle entry graph

Evidence:

- `vite.config.ts:56` sets `chunkSizeWarningLimit: 500`.
- `audit/evidence/code-quality-build-web-2026-06-12.txt:24-30` shows `assets/index-Dm1iT9Po.js` at `537.14 kB` minified, `170.99 kB` gzip, and Vite's "Some chunks are larger than 500 kB" warning.

Trigger path:

- Run `pnpm build:web`.

Failure mode:

- The app builds, but the main JS chunk crosses the repo's configured chunk-size warning threshold.

Consequence:

- The warning is not fatal today, but it is a regression pressure point. Initial app load grows, and future trace/raster/material features are more likely to land in the main path by accident.

Concrete fix:

- Inspect the rollup graph.
- Lazy-load heavy optional surfaces that do not need to be in first paint: trace dialog, convert-to-bitmap dialog, material library panel, text/font tooling, and possibly calibration dialogs.
- Consider explicit `build.rollupOptions.output.manualChunks` for stable vendor chunks once the graph is understood.
- Keep the 500 kB warning; do not simply raise it.

### CQ-004 - Theme decision docs still describe dark chrome while code is now light chrome

Severity: **P2 documentation-as-spec drift**

Confidence: **High**

File/module:

- `DECISIONS.md`
- `src/ui/theme/tokens.css`
- `index.html`

Evidence:

- `src/ui/theme/tokens.css:12` documents "Theme: unified light chrome."
- `index.html:6` sets `color-scheme` to `light`.
- `DECISIONS.md:2411-2449` still records ADR-047 as "dark chrome, light bed", says the maintainer chose unified dark chrome, and frames a future light theme as not yet implemented.

Trigger path:

- A future agent or maintainer follows ADR-047 while touching theme code.

Failure mode:

- The repo's decision record tells future work to preserve/recreate the old dark UI while the current code and user preference moved to light.

Consequence:

- High chance of accidental design regression or confused audits. This project treats docs as spec, so stale ADR text is not harmless.

Concrete fix:

- Add a new ADR superseding or amending ADR-047 for "unified light chrome, light bed".
- Update ADR-047's status or add a clear "superseded by ADR-049" note.
- Keep `theme-sync.test.ts` aligned to the light-token contract.

### CQ-005 - Core compile path uses module-level mutable caches despite the repo policy

Severity: **P2 policy drift / testability**

Confidence: **Medium-high**

File/module:

- `CLAUDE.md`
- `src/core/job/compile-job.ts`
- `src/core/job/fill-hatching-cache.ts`
- `src/core/job/compile-job-fill-cache.test.ts`

Evidence:

- `CLAUDE.md:144` says "No module-level mutable variables."
- `src/core/job/compile-job.ts:50-52` declares a module-level `WeakMap` cache.
- `src/core/job/fill-hatching-cache.ts:6` declares another module-level `WeakMap` cache.
- `src/core/job/compile-job-fill-cache.test.ts` verifies the cache behavior, so this is intentional code, not accidental dead state.

Trigger path:

- Repeated `compileJob()` calls with unchanged scene object arrays and fill settings.

Failure mode:

- The core compile path has hidden cross-call state. The cache is bounded per object-array key, but the code violates the written repo rule unless documented as an exception.

Consequence:

- Hidden state makes pure-core reasoning weaker, especially for long-running browser sessions, tests that depend on fresh evaluation, and future worker/shared-state moves.

Concrete fix:

- Either:
  - Move these caches behind an explicit `CompileJobCache` passed by the caller, preserving pure function semantics by default, or
  - Add a narrow ADR exception that documents why WeakMap caches are allowed here, their invalidation model, and the tests that protect stale-cache bugs.
- If keeping the cache, add pruning/behavior tests for all settings in the cache key.

### CQ-006 - `.lf2` deserialization still ends with a broad `unknown as Project` cast

Severity: **P2 type-boundary integrity**

Confidence: **Medium**

File/module:

- `src/io/project/deserialize-project.ts`
- `src/io/project/project-shape-validator.ts`

Evidence:

- `src/io/project/deserialize-project.ts:68-69` says field-level validation is a Phase C improvement.
- `src/io/project/deserialize-project.ts:123` returns `normalized as unknown as Project`.
- `src/io/project/project-shape-validator.ts` now validates many fields, but it does not return a typed builder result. The final trust step remains a cast.

Trigger path:

- Open a hand-edited or older `.lf2` file that passes the current shape validator but violates a deeper invariant that TypeScript assumes later.

Failure mode:

- Runtime JSON is accepted as `Project` without a compiler-enforced construction path.

Consequence:

- Future schema changes can accidentally become "validated" by a broad cast. This is not an immediate crash finding because the validator is much stronger than it used to be, but the boundary is still not as honest as the rest of the codebase.

Concrete fix:

- Replace the final cast with typed parse/build functions that construct `Project`, `Layer`, and each `SceneObject` variant explicitly.
- Keep additive normalization in the builders.
- Add malformed `.lf2` tests for cross-field invariants: bounds order, raster luma length, color format, transform scale finiteness, and layer/object mode consistency.

### CQ-007 - Several high-risk production files are physically large

Severity: **P3 maintainability**

Confidence: **High**

File/module:

- `src/core/trace/trace-image.ts`
- `src/ui/state/store.ts`
- `src/core/job/compile-job.ts`
- `src/core/raster/emit-raster.ts`
- `src/ui/state/scene-mutations.ts`
- `src/ui/state/laser-store.ts`

Evidence:

- `audit/evidence/code-quality-largest-files-2026-06-12.txt` lists the largest production files:
  - `src/core/trace/trace-image.ts`: 518 raw physical lines
  - `src/ui/state/store.ts`: 458
  - `src/core/job/compile-job.ts`: 430
  - `src/core/raster/emit-raster.ts`: 408
  - `src/ui/state/scene-mutations.ts`: 407
  - `src/ui/state/laser-store.ts`: 404
- `pnpm check:file-size` passes because the raw backstop is 600 lines and ESLint counts code lines excluding comments/blanks.

Trigger path:

- Editing trace/raster/job/store logic.

Failure mode:

- The formal gates pass, but review and regression risk grow because dense, high-risk modules are near or above 400 physical lines.

Consequence:

- Harder audits and higher chance of shotgun fixes in exactly the areas that matter most: image trace, raster output, job compilation, scene state, and live laser control.

Concrete fix:

- Do not refactor just to refactor. On the next functional change in each file, extract one cohesive helper:
  - `trace-image.ts`: split preset prep / filter math / tracer boundary.
  - `compile-job.ts`: move raster group compile and fill group compile behind focused modules.
  - `emit-raster.ts`: split span detection, row emission, and command formatting.
  - `store.ts` / `laser-store.ts`: continue slice extraction so root stores are wiring only.

## False-positive Rejections

These looked risky in a broad scan but are not findings after inspection:

- `TracePreview.tsx` uses `dangerouslySetInnerHTML`, but the string comes from `coloredPathsToSvg()` and the file documents the boundary. I did not count this as a security finding.
- Module-level worker clients in `src/ui/trace/use-trace-worker-client.ts` and `src/ui/raster/convert-bitmap-worker-client.ts` are UI resource singletons, not pure-core state. They are already tested for timeout/termination behavior.
- The full production dependency audit is clean. The vulnerability finding is dev-tooling scoped, not shipped-web-bundle scoped.
- The web build bundle warning is not a failed build. It is a performance/maintainability warning because the repo intentionally configured a 500 kB threshold.

## Suggested Fix Order

1. Bump Vitest packages and refresh lockfile.
2. Add `audit:deps` and run it in CI/deploy.
3. Add/supersede the theme ADR so the white UI decision is protected.
4. Split the main web chunk by lazy-loading optional heavy surfaces.
5. Decide whether compile-job fill caches should be explicit passed caches or an ADR-approved exception.
6. Replace the `.lf2` broad cast with typed builders.
7. Opportunistically shrink the largest high-risk modules during normal feature work.

## Overall Conclusion

The codebase is in good shape mechanically: strict gates pass, tests are broad, and the architecture has real boundaries. The current weak points are mostly process drift and maintainability debt, not obvious broken runtime behavior. The one urgent item is the critical Vitest advisory plus the missing audit gate that allowed it to sit outside CI.
