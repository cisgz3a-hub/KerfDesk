# Karpathy Stage 5B - Deploy Workflow Gate

Finding: `KF-020`

## Root Cause

The Cloudflare Pages workflow allowed `workflow_dispatch` to pass without proving the selected GitHub ref was `main`. The same workflow also installed dependencies and ran only `pnpm build:web` before publishing, so a manual production deploy did not prove repo identity, lint, tests, formatting, license policy, or Electron main build.

The local repo guard also compared the origin URL with a strict `.git` suffix. GitHub Actions can expose the same canonical HTTPS origin without `.git`, so adding `guard:repo` to CI would have been brittle without URL normalization.

## Red Proof

Command:

```text
corepack pnpm test src/platform/web/deploy-workflow-gate.test.ts
```

Result before fix:

```text
3 failed
- missing github.ref == 'refs/heads/main'
- missing workflow command: pnpm guard:repo
- Repository guard failed: expected origin https://github.com/cisgz3a-hub/LaserForge-2.0.git, got https://github.com/cisgz3a-hub/LaserForge-2.0
```

## Fix

- `.github/workflows/deploy.yml` now permits manual production deploys only from `refs/heads/main`.
- The deploy job now runs `pnpm guard:repo`, typecheck, lint, Electron lint, Prettier check, license audit, Vitest, web build, Electron main build, and the file-size backstop before the Cloudflare publish step.
- `scripts/assert-correct-repo.mjs` now normalizes an optional trailing `.git` while still requiring `cisgz3a-hub/LaserForge-2.0`.

The Cloudflare Pages upload still uses `--branch=master` because that is the existing Cloudflare production environment label. The GitHub source ref gate is `main`.

## Verification

```text
corepack pnpm test src/platform/web/deploy-workflow-gate.test.ts
```

Passed: 1 file, 3 tests.

```text
corepack pnpm test src/platform/web
```

Passed: 3 files, 7 tests.

```text
corepack pnpm test src/platform/web src/core/job src/core/text src/core/trace src/io/svg src/ui/app src/ui/laser src/ui/text src/ui/workspace
```

Passed: 65 files, 447 tests.

```text
corepack pnpm run guard:repo
```

Passed: `Repository guard passed: C:\Users\Asus\LaserForge-2.0`.

```text
corepack pnpm run typecheck
corepack pnpm run format:check
corepack pnpm run lint
git diff --check
```

All passed. `lint` still prints the known `eslint-plugin-boundaries` legacy selector warning and exits 0.

## Remaining Risk

This proves the repository-side deploy gate. It does not inspect the live Cloudflare project settings or secrets; production remains dependent on the Pages project still treating branch label `master` as production.
