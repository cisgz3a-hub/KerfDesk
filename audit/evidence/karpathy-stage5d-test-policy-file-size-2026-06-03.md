# Karpathy Stage 5D - Test Policy and File-Size Enforcement

Findings: `KF-006`, `KF-026`

## Root Cause

`CLAUDE.md` claimed CI lint rejected every source file without a direct sibling test through a `require-test-coverage` custom rule. That rule did not exist in `eslint.config.mjs`, CI, package scripts, or repository search results.

`CLAUDE.md` also described a 400-line hard file cap without saying that ESLint counts lines with `skipBlankLines: true` and `skipComments: true`. CI had a separate copied shell backstop for raw physical lines, so the written policy, lint behavior, and workflow behavior were not stated as one coherent contract.

## Red Proof

Command:

```text
corepack pnpm test src/platform/web/repo-policy.test.ts
```

Result before fix:

```text
3 failed
- CLAUDE.md still contained require-test-coverage
- CLAUDE.md did not mention excluding blank and comment lines or 600 raw physical lines
- package.json had no check:file-size script for CI/deploy to share
```

## Fix

- `CLAUDE.md` now says direct sibling tests are review policy, not a nonexistent CI lint rule.
- `CLAUDE.md` now states the actual file-size contract: 400 ESLint-counted code lines excluding blank/comment lines, plus a 600 raw physical-line CI backstop.
- Added `scripts/check-file-size-policy.mjs` as the shared cross-platform raw-line backstop.
- Added `check:file-size` to `package.json`.
- `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` now run `pnpm check:file-size`.
- Added `src/platform/web/repo-policy.test.ts` to pin the policy/workflow contract.

## Verification

```text
corepack pnpm test src/platform/web/repo-policy.test.ts
corepack pnpm test src/platform/web
corepack pnpm run check:file-size
```

Passed. File-size script output:

```text
File-size raw-line backstop passed: 600 max physical lines.
```

Additional gates:

```text
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run format:check
git diff --check
```

All passed. `lint` still prints the known `eslint-plugin-boundaries` legacy selector warning and exits 0.

## Remaining Risk

This intentionally does not implement a direct per-file sibling-test CI gate. The repo now documents the truth: source changes without tests are rejected by review unless they are pure refactors or explicitly documented policy/docs/build-only changes.
