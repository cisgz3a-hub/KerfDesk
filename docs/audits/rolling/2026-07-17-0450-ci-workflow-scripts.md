# Rolling audit — CI workflows + policy scripts

- **When:** 2026-07-17 04:50 (+08)
- **Tree:** `941dcb66` on the audit branch (main at `677e60fe` at audit time)
- **Scope:** `.github/workflows/{ci,deploy,e2e,release-desktop}.yml`, `scripts/{check-file-size-policy,check-soft-line-limit,check-index-exports,assert-correct-repo}.mjs`, `scripts/index-export-baseline.json`, the `release:check` composition in `package.json`, and their claims in CLAUDE.md.
- **Method:** static read + one live run of `check-index-exports.mjs` to compare baseline vs current counts. **Not verified:** no workflow was executed on CI; no deploy or release was exercised.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.
- Note: iterations scheduled 02:16–04:16 coalesced into this one; the session was occupied landing the approved P2-1 fix (PR #260).

---

## P2-1 — browser smoke never gates main or deploys

`e2e.yml` triggers on `pull_request` and `workflow_dispatch` only (`.github/workflows/e2e.yml:3-5`). `deploy.yml` gates solely on the **CI** workflow's success (`.github/workflows/deploy.yml:13-16`), and CI runs `release:check` (`package.json:32`), which does not include `test:e2e`. Consequences:

- A direct push to main — which happens in this repo (past sessions record main going red from direct pushes) — never runs the browser smoke at all.
- The deploy pipeline publishes kerfdesk.com having never exercised a real browser: the only Playwright-level regression net has no say in what ships.

The unit/property suite asserts structure and determinism, not rendered behavior (CLAUDE.md collaboration rule 2), so the browser smoke is the only automated check that loads the actual app. Cheap remedies for the maintainer to choose from: add `push: branches: [main]` to `e2e.yml`, and/or have `deploy.yml` also require the Browser smoke workflow. Report-only; not changed.

---

## P3-2 — the barrel "ratchet" permits silent regrowth back to baseline after a shrink

The regression check is `count > (baseline[path] ?? HARD_CAP)` (`scripts/check-index-exports.mjs:107`), and baseline maintenance is advisory only: the "remove them in the same change" nudge (lines 122-125) covers only entries that dropped to/below the hard cap, and prints without failing. So if an over-cap barrel shrinks but stays over the cap (e.g. `src/core/scene/index.ts` 208 → 150) and its baseline entry is not manually lowered, it can silently grow back to 208.

CLAUDE.md's size table claims legacy over-cap barrels "may only shrink until they reach the cap" — the enforced invariant is weaker: "may not exceed the checked-in baseline." Live check (script run at audit time): all 15 baseline entries currently equal their live counts, so there is no open headroom today — this is a mechanism gap, not an active regression. A one-line strengthening would be to fail (or auto-shrink) when `count < baseline[path]`.

---

## P3-3 — stale header comment in check-index-exports.mjs

Lines 8-12 still say "Report-only for now (exit 0) … a later change flips hard-cap violations to exit 1 and wires it into release:check (ARC-06 PR5)." Both halves are superseded: the script exits 1 on ratchet regressions (`scripts/check-index-exports.mjs:112-120`) and is wired into `release:check` (`package.json:32`). The comment describes the pre-ratchet state and will misdirect the next editor.

---

## P3-4 — `pnpm audit --audit-level=low` sits on every critical path with no override

`audit:deps` (`package.json:28`) is `&&`-chained into `release:check` (`package.json:32`), which gates CI on every PR, every main push, every deploy (`deploy.yml:74-75`), and every desktop release (`release-desktop.yml:73-76`). Any new upstream advisory — even low severity, even in a dev-only dependency — simultaneously blocks all four pipelines until the dependency is bumped or an exception is configured. Informational: this is a legitimate strictness choice, but there is no documented escape hatch, and the failure will look like an unrelated red X on whatever PR lands first after the advisory publishes.

---

## Verified clean (checked, no finding)

- **Deploy race-pinning:** `deploy.yml` checks out `workflow_run.head_sha`, not the branch tip (M33 fix intact, `deploy.yml:42-49`); manual dispatch is gated to `refs/heads/main` (`deploy.yml:38`) and re-runs the full release gate.
- **Repo guard:** `assert-correct-repo.mjs` validates identity via `git rev-parse --git-common-dir`, so linked worktrees pass while a look-alike clone fails; remote-URL allowlist is the strong check (`scripts/assert-correct-repo.mjs:35-53`).
- **Desktop release fail-closed signing:** tag builds require signing secrets up front (`release-desktop.yml:78-90`), force code signing, and verify the Authenticode signature post-build (`release-desktop.yml:118-132`); manual dispatch embeds `kerfdeskUpdateChannelTrusted=false` and the R2 publish step is tag-gated (`release-desktop.yml:151-152`).
- **CLAUDE.md release:check description matches** the actual chain in `package.json:32` (typecheck, lint ×2, format, license, audit, tests, both builds, file-size + soft-size + index-exports; none inspect test-file presence or the PR description).
- **600 raw-line backstop exists** as documented (`scripts/check-file-size-policy.mjs:4`), scoped to src/electron/scripts/root configs; the soft-250 reporter is genuinely non-blocking and documents why ESLint cannot express both tiers (ADR-132 note, `scripts/check-soft-line-limit.mjs:4-15`).
- **Toolchain pinning** is consistent across all four workflows: pnpm version from `packageManager`, Node 22, `--frozen-lockfile`.

## Not verified

- No CI run was triggered or observed live; all claims are from workflow/script sources in the tree.
- The Playwright smoke's actual coverage (what `test:e2e` asserts) was not reviewed — only its triggers.
