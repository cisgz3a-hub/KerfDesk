# Code quality audit C1 — ledger

**Requested by** the maintainer on 2026-11-10: "audit my codebase and make sure my app is of the highest quality and standards and well coded. Do a full in-depth area by area code inspection."

**Tree.** `origin/main` @ `f61a0757a`. Evidence and method: [REPORT.md](REPORT.md).

This is the first audit of the code itself. The rolling audits check behaviour, and [quality-q1](../2026-10-27-quality-q1/LEDGER.md) checked burn output.

## Verdict

The code is held to a high standard, and the standard is enforced by tools, not by habit. Shipped `src/` has no `any`, no non-null assertions, no skipped unit tests and five TODO markers in about 670,000 lines. Unit tests cover 93.7 % of lines and 84.6 % of branches. The desktop app's privileged surface is small and well guarded.

The weak points are at the edges of those gates, not in the product code:

1. `main` has been failing CI since 2026-11-09 17:31 UTC, and six pull requests merged onto it while it was red.
2. Some code is outside every check. 155 Electron test files are never typechecked or linted, and three script test files run nowhere. Both gaps already hold real failures.
3. Small helpers are copied from file to file instead of shared, and the copies have drifted apart.

## Severity

| Level | Meaning in this audit |
|---|---|
| P1 | Broken now, or lets breakage reach `main` unchecked. |
| P2 | A gap in the checks that already holds a real failure. |
| P3 | A structural or tidiness weakness. No defect was found behind it. |

## Totals

| # | Area | P1 | P2 | P3 |
|---|---|---|---|---|
| C1 | Gates, CI and tooling | 2 | 2 | 4 |
| C2 | `src/core` | 0 | 0 | 2 |
| C3 | `src/io` | 0 | 0 | 1 |
| C4 | `src/platform` and Electron main | 0 | 0 | 0 |
| C5 | `src/ui/state` and workers | 0 | 0 | 2 |
| C6 | `src/ui` components | 0 | 0 | 2 |
| C7 | Services | 0 | 0 | 1 |
| C8 | Tests | 0 | 0 | 1 |
| C9 | Dependencies | 0 | 0 | 1 |
| **Total** | | **2** | **2** | **14** |

## Findings

| ID | Summary | Evidence | Status |
|---|---|---|---|
| C1-P1-1 | **`main` fails CI at `f61a0757a`: two unit suites and one browser spec.** (a) `rotary-summary.test.ts` expects the Job Review text from before #1672 added the feed clause. (b) `returning-user-rotary-1-0-30.test.ts` fails 12 of its cases: #1670 pinned the bytes 1.0.30 emitted, and #1672 changes the feed on scaled rotaries on purpose (ADR-127 Amendment 2). (c) `workspace-responsive.e2e.ts:91` finds two `role="status"` elements in the toolbar since #1668 added one. | CI runs 42693573999 and 42693574292; (a) reproduced locally | **Fix open: #1677** (another session) |
| C1-P1-2 | **Nothing stops a pull request merging onto a red `main`, or two green pull requests breaking it together.** The ruleset has `strict_required_status_checks_policy: false` and no merge queue rule. A pull request's browser check runs 11 core specs plus the specs it touched (ADR-647), so #1668 never ran the spec it broke. Browser smoke on `main` failed five runs in a row and six pull requests merged after the first. The workflows already have `merge_group` triggers. | `gh api …/rulesets/19573147`; `scripts/run-pr-browser-smoke.mjs`; main's run history | Open. Needs the owner: turn on the merge queue, or require up-to-date branches |
| C1-P2-1 | **155 Electron test and test-support files are never typechecked or linted.** `electron/tsconfig.json` excludes them, the root `tsconfig.json` includes only `src/`, the root ESLint config ignores `electron/**`, and the Electron ESLint config ignores the tests. Vitest strips types without checking them. A typecheck of those files finds 22 real errors in 10 files, mostly test doubles that no longer match the production types. | REPORT §C1 | Open |
| C1-P2-2 | **Three script test files run nowhere, and one of them fails.** `test:release-integrity` lists 93 files by hand. `browser-apis-fixture`, `build-artcraft-preview` and `large-file-benchmark-cases` are in no list and no workflow. `build-artcraft-preview.test.mjs` fails on `main`: it asserts a line of `src/ui/app/main.tsx` that has since changed. | REPORT §C1 | Open |
| C1-P3-1 | The 258 `.mjs` files under `scripts` (tests included) have no type checking (no `@ts-check`) and no line cap below the 600-line backstop. They include the payment and release tools: `refresh-sandbox-script.mjs` (588 counted lines), `prepare-commercial-desktop.mjs` (551), `apply-payment-settings.mjs` (550). | census | Open |
| C1-P3-2 | Browser specs get the basic lint only, so `no-floating-promises` does not run on them. A missing `await` on a Playwright assertion passes silently. All 21 candidates found by search were correct, so this is a gap with nothing in it today. | REPORT §C1 | Open |
| C1-P3-3 | `eslint-plugin-react` is installed and never loaded, so no React rule runs beyond the two hooks rules. Shipped UI has 35 `key={index}` list keys. | `eslint.config.mjs` | Open |
| C1-P3-4 | Names and references have drifted. `eslint.config.mjs` cites `CLAUDE.md` sections eight times that no longer exist there. `package.json` is `laserforge` 0.1.0 for KerfDesk 1.0.30. 50 shipped `src/` files still say LaserForge. | grep | Open |
| C2-P3-1 | **Small helpers are re-declared per file and have drifted.** `samePoint`: 46 definitions, 29 different bodies, tolerances of exact, 1e-9, 1e-7 and 1e-6. `clamp`: 29 definitions and 16 bodies beside the shared `core/math/clamp.ts`; 15 pass NaN through and 5 return the minimum. `pointInPolygon`: three identical copies of the exported one. `signedArea` 11, `distanceToSegment` 10, `isRecord` 45, number validators about 60. 304 groups of identical function bodies, about 2,900 repeated lines. The NaN callers checked all filter first. | REPORT §C2 | Open |
| C2-P3-2 | 74 exports are used by nothing and 220 only by tests, of 17,085. Examples: four `laser-safety-notice.ts` message constants, `memoizedFillHatching`, and `ROTARY_AXES` / `isRotaryAxis` (the loader repeats the list `['Y','A','Z']` instead). | REPORT §C2 | Open |
| C3-P3-1 | The hand-written load validators are not tied to the types they produce. Shipped code has 55 `as unknown as` casts, 15 of them where projects and profiles load (`deserialize-project.ts` ends `normalized as unknown as Project`). A field added to a type and missed in its validator compiles. | REPORT §C3 | Open |
| C5-P3-1 | `src/ui/state` is one flat folder of 1,291 files (563 shipped). Six of its files sit at exactly the 400-line cap, and `store.ts` has 78 imports. Files are split by line count (`laser-store.ts`, `laser-store-helpers.ts`), not by idea. 65 files in the repository are within 20 lines of the cap. | census | Open |
| C5-P3-2 | Ten Web Worker clients each write their own lifecycle: 10 different `ensureWorker` bodies, 7 `retireWorker` bodies and 11 `abortError` bodies. Three retire a worker without clearing its handlers and rely on an identity check instead. | REPORT §C5 | Open |
| C6-P3-1 | A length is formatted 21 different ways. `formatMm` has 24 definitions: 0 to 6 decimals, with and without " mm", with and without digit grouping. The same value can read "12.3" in one panel and "12.300 mm" in another. An error-to-text helper has about 37 copies. | REPORT §C6 | Open |
| C6-P3-2 | 27 shipped files read or write `localStorage` directly, each with its own try/catch. `src/ui` has 86 catch blocks that hold only a comment. Each one read was a deliberate "storage may be unavailable" case. | census | Open |
| C7-P3-1 | The phone page's hand-written scripts (`services/remote-control/public/*.js`, 3,872 lines) are plain JavaScript with no types, and three sit at the cap (`control.js` 400, `control-touch.js` 401, `control-machine.js` 396). | `wc -l` | Open |
| C8-P3-1 | Some opt-in probe tests return early when their switch is off, so they count as passed with no assertion. Others in the same folder use `it.skipIf`, which reports them as skipped. | `src/__fixtures__/perceptual/_new-problems-audit.test.ts:52` | Open |
| C9-P3-1 | 26 dependencies are pinned exactly and 33 use a caret range. The lockfile decides, so builds repeat; the mix only makes intent unclear. React 18 and zustand 4 are each one major version behind. | `package.json` | Open, owner's call |

## What was checked and found sound

- **Type and lint discipline.** No `any`, three `@ts-expect-error` (all for untyped third-party modules), about 20 lint disables outside the UI colour rule, and lint on `main` reports no rule warnings.
- **Layering.** `core` imports only `core`; `io` adds `io`; `ui` never imports a platform implementation. The rule is enforced, with import cycles banned.
- **Electron.** Sandbox on, context isolation on, Node integration off. No preload and no IPC: the window reaches the main process only through `app://app/api/…` routes that check the exact address, the origin and a per-route header. Navigation, redirects, new windows and external links are all allow-listed.
- **Licensing service.** Signatures and tokens are compared with `crypto.subtle.verify`, and the payment webhook checks one timestamp within 5 seconds.
- **Unguarded `JSON.parse`, `innerHTML`, timers and listeners.** Every candidate read was correct.

## Limits

This audit measured every tracked source file with scripts and read the highest-risk files by hand. It did not read all 5,668 shipped files line by line. The duplicate and dead-export counts come from pattern matching: they are lower bounds for duplication and may include a few false positives for dead exports (three of 74 were checked and all were dead). Lint and typecheck results are CI's, not local runs.
