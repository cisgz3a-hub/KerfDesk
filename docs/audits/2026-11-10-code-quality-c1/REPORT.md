# Code quality audit C1 — evidence

Tree: `origin/main` @ `f61a0757a` (2026-11-10). Ledger: [LEDGER.md](LEDGER.md).

## Method

1. **Census.** A script read every tracked `.ts`, `.tsx`, `.mjs` and `.js` file under `src`, `electron`, `services`, `scripts`, `e2e` and `website` (11,267 files, vendored and generated type files left out). It counted lines, identical function bodies, same-named helpers, exports and their uses, empty catch blocks, unbalanced timers and listeners, and risky calls.
2. **Gate review.** The lint configs, the four `tsconfig` files, the CI workflows, the branch ruleset and `main`'s CI history were read to find what each check covers and what it leaves out.
3. **Reading.** Every candidate the census flagged in shipped `src/` was read in context, and the Electron security boundary and the licensing service's signature checks were read in full.
4. **Proof by running.** Where a gap was suspected, the unchecked code was run: the three unlisted script tests, a typecheck of the Electron tests, and the failing unit test.

## Size

| Area | Shipped files | Counted lines | Test files |
|---|---|---|---|
| `src/core` | 1,617 | 218,688 | 1,355 |
| `src/io` | 298 | 36,871 | 329 |
| `src/platform` | 54 | 7,238 | 79 |
| `src/ui` | 3,332 | 408,940 | 2,874 |
| `electron` | about 180 | — | 155 |
| `scripts` | 258 `.mjs` (tests included) | — | 124 `.test.mjs` with `services/desktop-licensing` |

Shipped files by counted lines (blank and comment lines skipped, as the lint rule counts): 1,875 under 50; 2,332 from 50 to 149; 1,148 from 150 to 299; 228 from 300 to 379; 65 from 380 to 399; 20 at 400 or more. All 20 are scripts, the website or the phone service, which the 400-line rule does not cover.

## C1 — Gates, CI and tooling

### What the gates enforce

| Gate | Covers | Rules of note |
|---|---|---|
| Root ESLint | `src/**` | 400-line files, 80-line functions, complexity 12, layer boundaries, no import cycles, no `any`, no `!`, no floating promises, exhaustive switches |
| Pure-core block | `src/core/**` | no `window`, `document`, `fetch`, `console`, `process`, `Date.now`, `new Date`, `Math.random`, no Node imports |
| Electron ESLint | `electron/**/*.ts` except tests | same size and type rules |
| `tsc` | `src/**`; `electron` except tests; `e2e` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Policy scripts | file size backstop, boot bundle, ADR numbers, action pins, secret scopes, licences, barrel exports | |

Census of escape hatches in shipped code:

| Escape | `src/core` | `src/io` | `src/platform` | `src/ui` | `electron` |
|---|---|---|---|---|---|
| `any` | 0 | 0 | 0 | 0 | 0 |
| `@ts-expect-error` | 2 | 1 | 0 | 0 | 0 |
| `eslint-disable` | 2 | 0 | 1 | 83 | 1 |
| `as unknown as` | 14 | 17 | 3 | 18 | 5 |
| TODO / FIXME | 0 | 0 | 0 | 2 | 1 |

Most of the 83 UI disables are the raw-colour rule on scene data colours. Across all shipped code, 10 are `react-hooks/exhaustive-deps`, 4 are `complexity` and 2 are `max-lines-per-function`. Lint on `main` (run 42690121633) reports no rule warnings.

### C1-P1-1 — `main` is red

CI run 42693573999 on `f61a0757a`:

- `src/ui/laser/rotary-summary.test.ts`, "names both ends in Job Review, and only while the taper is on". Reproduced locally. Expected `…one revolution = 40 machine mm`; received the same text followed by `· each move's feed holds the layer speed on the part`. #1672 added that clause and updated the two tests it knew; #1670's test landed 22 minutes earlier.
- `src/io/gcode/returning-user-rotary-1-0-30.test.ts`: 12 failures, on chuck, reversed chuck and scaled roller, in all three placements and with the taper saved off. The surface-calibrated roller and the disabled rotary pass. That matches ADR-127 Amendment 2's stated consequence: "Rotary vector and angled-fill output changes bytes … surface-calibrated rollers do not."

Browser smoke run 42693574292: `e2e/workspace-responsive.e2e.ts:91`, light and dark, "strict mode violation: … `getByRole('status')` resolved to 2 elements". The second is `ToolbarUpdateButton.tsx:73`, added by #1668.

Merge order: #1668 `0401887d5` (smoke cancelled), #1669 `42cb2bf50` (first failing smoke, 17:31 UTC), then #1671, #1673, #1674, #1670 and #1672.

### C1-P1-2 — why it reached `main`

- #1672's branch last merged `main` at 04:07:42 (+08:00). #1670 merged at 04:08:47. #1672 merged at 04:30:13 on checks that never saw #1670.
- The ruleset requires five checks with `strict_required_status_checks_policy: false`. It has no `merge_queue` rule.
- `ci.yml`, `e2e.yml` and `desktop-package-check.yml` already run on `merge_group`.
- A pull request's "Chrome UX smoke" is `scripts/run-pr-browser-smoke.mjs`: 11 core specs plus changed specs. `workspace-responsive.e2e.ts` is not core and #1668 did not touch it.

Either a merge queue or required up-to-date branches would have caught the rotary pair. Only a merge queue (which runs the full browser suite) would have caught #1668.

### C1-P2-1 — Electron tests are outside the checks

- `electron/tsconfig.json`: `"exclude": ["**/*.test.ts", "**/*.test-support.ts"]`.
- Root `tsconfig.json`: `"include": ["src/**/*", …config files]`.
- `eslint.config.mjs`: ignores `electron/**`. `eslint.electron.config.mjs`: ignores `electron/**/*.test.ts` and `*.test-support.ts`.

A temporary config that included only those 155 files, with the module resolution Vitest uses, gave 64 errors. 42 come from the temporary config itself (font `?url` imports, build-time constants, `.mjs` files without declarations, JSX). The other 22 are real:

| File | Errors | Kind |
|---|---|---|
| `electron/mcp/authoring.test.ts` | 8 | possibly-undefined value used; property read on `{}` |
| `electron/native-smoke-licence-renderer.test.ts` | 4 | licence state fixture does not match the type |
| `electron/mcp/media-result.test.ts` | 2 | property read on `{}` |
| `electron/serial-port-choice.test.ts` | 2 | possibly-undefined argument |
| `electron/remote-access/routes.test.ts`, `runtime-control-lease.test.ts`, `runtime-live.test.ts` | 3 | identity store double is missing a member |
| `electron/artcraft-process.test.ts`, `commercial-update.test.ts`, `window-close-guard.test.ts` | 3 | wrong value type |

A test double that no longer matches the real type can keep a test green on a shape production never produces.

### C1-P2-2 — unlisted script tests

`test:release-integrity` in `package.json` names 93 files and two globs on one line. Of 124 `.test.mjs` files under `scripts` and `services/desktop-licensing`, five are not on it. Two of those run in `release-desktop-dry-run.yml`. Three run nowhere:

| File | Result when run |
|---|---|
| `scripts/browser-apis-fixture.test.mjs` | 3 pass |
| `scripts/large-file-benchmark-cases.test.mjs` | 4 pass |
| `scripts/build-artcraft-preview.test.mjs` | **1 of 2 fails**: `assert.ok(transformed.includes('<ErrorBoundary softwareAbort={softwareAbort}>'))` |

A glob (`scripts/*.test.mjs`) in place of the hand-kept list would close this.

### C1-P3-2 — browser specs and floating promises

Search found 10 `expect(` statements and 11 action calls without `await` in `e2e/`. All are correct: synchronous assertions on plain values, DOM calls inside `page.evaluate`, typed-array and canvas `fill`, or a promise that is returned and awaited by the caller (`startup-splash.e2e.ts:290`).

## C2 — `src/core`

### C2-P3-1 — drifted helper copies

Same-named helpers, grouped by body after removing comments and spacing:

| Helper | Definitions | Different bodies | Drift |
|---|---|---|---|
| `samePoint` | 46 | 29 | exact equality (11 files), 1e-9, 1e-7, 1e-6; `<` in one and `<=` in the rest; one uses distance, the rest per-axis |
| `isRecord` | 45 | 6 | `job-machine-lock.ts` accepts arrays; the other 44 reject them |
| `clamp` | 29 | 16 | of the three-argument copies, 15 pass NaN through, 5 return the minimum and 1 a fallback; `core/math/clamp.ts` exists |
| `formatMm` | 24 | 21 | see C6 |
| `signedArea` | 11 | 9 | same maths, different guards |
| `distanceToSegment` | 10 | 10 | zero-length test is `=== 0`, `<= 0`, `> 0` or `<= DOMAIN_EPSILON` |
| `pointInPolygon` | 4 | 2 | three copies of `core/geometry/point-in-polygon.ts`; `board-outline.ts` counts the boundary as inside |

Tolerance constants in shipped code: `1e-9` declared 40 times under four names, `1e-7` 5 times, `1e-6` twice.

The census found 304 groups of byte-identical function bodies in more than one file, about 2,900 repeated lines. That count misses copies that differ by a name.

No defect was found. The two UI `clamp` copies that pass NaN through (`LayerSpeedInput.tsx`, `LayerImageFields.tsx`) are called only after a finite check. The risk is the next copy: there is no one place that says what "the same point" means.

A likely cause is that a three-line local helper can never break the layer or cycle rules, and the 400-line cap rewards moving code out of a file more than finding it a shared home.

### C2-P3-2 — dead exports

17,085 exported names in shipped `src/`. 74 are referenced nowhere else and once in their own file. 220 are referenced only by tests. By area: `core` 36 dead and 81 test-only; `ui` 36 and 129; `io` 2 and 7; `platform` 0 and 3.

Checked by hand and confirmed dead: `CONTROLLER_REBOOT_DURING_JOB_MESSAGE` and three `DISCONNECT_DURING_*_MESSAGE` constants (`ui/state/laser-safety-notice.ts`; the functions they call are used, the constants are not), `memoizedFillHatching` (`core/job/fill-hatching-cache.ts`; only the `…WithMetadata` form is used), and `ROTARY_AXES`, `isRotaryAxis`, `isDedicatedRotaryAxis` (`core/devices/rotary-axis.ts`).

Also measured: 190 functions take seven or more positional parameters; the largest take 12 (`addFacet`, `facetContact` in `core/relief`).

## C3 — `src/io`

### C3-P3-1 — validators and types are separate

Project and profile loading uses hand-written validators that take `unknown` and end in a cast: `deserialize-project.ts` (`normalized as unknown as Project`), `machine-profile-io.ts` (`value as unknown as DeviceProfile`), and 13 more in `src/io/project`. The compiler cannot tell when a type gains a field its validator does not check. `zod` is already a dependency, used by the MCP schemas and three `src` files.

`project-device-profile-validator.ts:132` lists `['Y', 'A', 'Z']` and `['A', 'Z']` inline while `rotary-axis.ts` exports the same sets unused.

Seven shipped files call `JSON.parse` with no `try` in the file. All seven are correct: the parse runs on the app's own output, or the function is documented to throw and its caller catches.

## C4 — `src/platform` and Electron main

No finding.

- `desktop-window-options.ts`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, as a literal type.
- No `ipcMain`, `ipcRenderer`, `contextBridge` or preload in shipped Electron code. Every privileged call is a `fetch` to `app://app/api/…` served by `protocol.handle`.
- `app-route-guard.ts`: exact scheme and host; no port, credentials, query or fragment; the route's own header set to `1`; origin absent or `app://app`; `Sec-Fetch-Site` absent, `same-origin` or `none`.
- `main.ts`: the content security policy is set on response headers; `will-navigate` and `will-redirect` block untrusted origins using the always-present `url` argument; `setWindowOpenHandler` denies by default.
- `external-links.ts`: only credential-free `https:` links reach `shell.openExternal`.
- Serial permission is granted for the picked port only.

Timers and listeners: the census flagged `laser-connection-actions.ts` (interval kept in `refs.pollHandle` and cleared elsewhere) and `desktop-project-files.ts` (one listener for the app's life, installed once). Both are correct.

## C5 — `src/ui/state` and workers

### C5-P3-1 — one flat folder

`src/ui/state` holds 1,291 files at one level (563 shipped, 728 tests) plus a `recovery` folder of 94. The next largest flat folders are `ui/laser` (797), `ui/workspace` (523), `core/cnc` (387) and `core/job` (363).

Shipped `src/` files at exactly 400 counted lines: `laser-interactive-command.ts`, `laser-store-helpers.ts`, `laser-store.ts`, `recovery-repository.ts`, `store-actions.ts`, `store.ts` (all `ui/state`), and `machine-profile-io.ts`, `deserialize-project.ts`, `project-shape-validator.ts` (`io`). `store.ts` has 78 import statements, and a block of them sits above the file's header comment.

### C5-P3-2 — ten worker clients

`box-generation`, `gcode-inspector`, `kerf-check`, `document-import`, `import`, `png-import`, `output-preparation`, `trace`, `design-scene` and `preparation` each define `ensureWorker`, `retireWorker` and usually `abortError` and `cancelRequest`. No two `ensureWorker` bodies match. `retireWorker` has 7 forms: three call `terminate()` and drop the reference; four first clear `onmessage`, `onerror` and `onmessageerror`; two also release a memory reservation.

## C6 — `src/ui` components

### C6-P3-1 — one quantity, many formats

`formatMm` bodies include `toFixed(3)`, `toFixed(2) + ' mm'`, `toFixed(3) + ' mm'`, `Number(value.toFixed(3)).toString()`, the same with 2 and 4 decimals, one decimal with whole numbers bare, `toLocaleString('en-US', { maximumFractionDigits: 1 })`, the same with 2, and six decimals with trailing zeros trimmed. Two are G-code writers, where a fixed format is right. The rest are labels.

`errorMessage`, `errMsg`, `describeError`, `messageOf` and similar: about 37 definitions of `error instanceof Error ? error.message : String(error)`.

### C6-P3-2 — storage access

27 shipped files call `localStorage.getItem`, `setItem` or `removeItem` directly. `camera-preference-storage.ts` alone has 8 comment-only catch blocks. Hand-written code has no empty catch without a comment; the 25 bare ones are all in generated bundles.

`TracePreview.tsx:196` uses `dangerouslySetInnerHTML` on SVG the app builds from numbers and hex colours, with a comment saying imported markup must be sanitised first. Correct as written.

## C7 — Services

`services/desktop-licensing` (about 20 modules, about 2,700 shipped lines): bearer tokens and webhook signatures are compared through `crypto.subtle.verify`; the Paddle webhook accepts exactly one `ts` of ten digits within 5 seconds and one or more `h1` values.

`services/remote-control`: its own strict lint and typecheck, run by CI. The phone page's `public/*.js` files are hand-written JavaScript under a 400-line rule with no types (C7-P3-1).

## C8 — Tests

- Coverage run 42624378615 (2026-11-09): lines 93.71 %, branches 84.57 %, functions 93.10 %, statements 91.29 %. No threshold fails the build; a weekly report tracks the trend.
- No `.skip`, `.only` or `.todo` in unit tests. Four browser specs skip unless an opt-in variable is set.
- 16 perceptual probe files (`src/__fixtures__/perceptual/_*.test.ts`) write images for a person to read and assert nothing. Most use `it.skipIf`; `_new-problems-audit.test.ts:52` returns early instead and is counted as a pass.

## C9 — Dependencies

- `audit.yml` passed on 2026-11-09, 11-08 and 11-05.
- `pnpm-workspace.yaml` documents each override and each build-script permission with its reason.
- No dependency is unreferenced except `eslint-plugin-react` (C1-P3-3). Type packages and resolver plugins are used implicitly.

## Suggested order of work

1. Done: #1677 merged on 2026-11-10 and `main` (`4c4b98fd0`) has the fix for C1-P1-1.
2. Owner: add the merge queue to the ruleset (C1-P1-2).
3. Typecheck and lint the Electron tests, and fix the 22 errors (C1-P2-1).
4. Replace the hand-kept script test list with a glob, and fix `build-artcraft-preview.test.mjs` (C1-P2-2).
5. Give `core` one home for point comparison, clamping and the number validators, and add a lint rule that stops new local copies (C2-P3-1). Move callers over a folder at a time.
6. The remaining P3s as time allows.
