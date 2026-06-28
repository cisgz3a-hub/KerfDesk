# Audit Fix Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the current audit blockers, re-run the audit gates, and repeat until the branch is clean enough to trust for GitHub and Cloudflare.

**Architecture:** Keep fixes small and evidence-driven. Release gates live in `package.json`, route-preview truth lives in `src/core/job/toolpath.ts` plus preview mapping/tests, and file-size discipline stays enforced by the existing raw-line backstop.

**Tech Stack:** TypeScript, React, Vite, Vitest, pnpm, Cloudflare Pages/Wrangler.

---

## Current Findings To Close

- [ ] `pnpm test` fails on `src/ui/a11y/button-hover-contract.test.ts` for Preview route controls.
- [ ] `pnpm format:check` fails on 10 files.
- [ ] `pnpm check:file-size` fails on `src/core/job/compile-job.ts`.
- [ ] Route Preview omits origin-to-first and final park travel.
- [ ] Route Preview omits fill scan-offset geometry used by G-code output.
- [ ] Manual `pnpm deploy:web` can publish without the full release gate.
- [ ] `README.md` and `AUDIT.md` contain stale test/deploy status.

## Task 1: Protect Manual Deploy

**Files:** `package.json`

- [ ] Add `release:check` that runs repo guard, typecheck, lint, electron lint, format check, license check, dependency audit, full tests, web build, electron build, and file-size check.
- [ ] Change `deploy:web` and `deploy:web:preview` to run `pnpm release:check` before Wrangler publishes.
- [ ] Verify `package.json` parses with `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`.

## Task 2: Fix Preview Hover Contract

**Files:** `src/ui/workspace/preview-overlays.tsx`

- [ ] Confirm red with `pnpm test --run src/ui/a11y/button-hover-contract.test.ts`.
- [ ] Add `title` and stable `data-help-id` to Play/Pause, Restart, and Speed controls.
- [ ] Verify green with `pnpm test --run src/ui/a11y/button-hover-contract.test.ts`.

## Task 3: Fix Route Preview Truth

**Files:** `src/core/job/toolpath.ts`, `src/core/job/toolpath.test.ts`, `src/ui/workspace/draw-preview.ts`, `src/ui/workspace/draw-preview.parity.test.ts`

- [ ] Add failing tests for machine-origin travel into the first cut and final park travel back to origin.
- [ ] Add failing test for reverse fill scan-offset preview geometry.
- [ ] Implement `BuildToolpathOptions` with `startPoint`, `parkPoint`, and `scanningOffsets`.
- [ ] Pass `{ x: 0, y: 0 }` start/park plus `project.device.scanningOffsets` from `buildPreviewToolpath`.
- [ ] Verify route bundle: `pnpm test --run src/core/job/toolpath.test.ts src/ui/workspace/draw-preview.parity.test.ts src/ui/workspace/draw-preview.test.ts src/ui/workspace/preview-overlays.test.tsx`.

## Task 4: Restore File-Size Discipline

**Files:** `src/core/job/compile-job.ts`, `src/core/job/index.ts`, `src/core/job/compile-job-defaults.ts`

- [ ] Confirm red with `pnpm check:file-size`.
- [ ] Remove the stale `eslint-disable max-lines` escape hatch.
- [ ] Move `DEFAULT_OVERSCAN_MM` to a tiny defaults module so public imports no longer depend on `compile-job.ts`.
- [ ] Trim stale comments/import bloat until `compile-job.ts` is at or below the raw-line cap.
- [ ] Verify `pnpm check:file-size`, `pnpm typecheck`, and focused compile-job tests.

## Task 5: Format and Docs

**Files:** files reported by Prettier plus `README.md` and `AUDIT.md`

- [ ] Run Prettier on touched files and all previously reported format failures.
- [ ] After fresh full verification, update README/AUDIT counts and deployment status from actual command output.

## Task 6: Full Fix/Audit Loop

- [ ] Run `pnpm release:check`.
- [ ] If it fails, inspect the first failure, identify root cause, add/adjust the smallest regression test where relevant, fix, and repeat.
- [ ] Inspect local browser/dev-server truth and live Cloudflare truth.
- [ ] Stop only when release gates pass and the remaining audit findings are documented as non-blocking or already fixed.
