# Fix sweep — code quality audit C1

The maintainer asked on 2026-11-10 to "fix all" of the [C1 ledger](LEDGER.md). This file records what became of every finding.

Status is one of:

- **Fixed (#N)**: a pull request changed the code.
- **Maintainer decision**: the fix is a choice only the maintainer can make. Each has a one-line recommendation.
- **Measured**: the work was sized and is too large for a sweep. The size is given.

No sweep pull request changes G-code, a saved file format or a default.

When this file was written, #1693 had merged, and #1699 and #1700 were open with auto-merge on and CI running. #1700 is stacked on #1699.

## Results

| ID | Finding | Status |
|---|---|---|
| C1-P1-1 | `main` failed CI | Fixed (#1677), before the sweep began. |
| C1-P1-2 | Nothing stops a merge onto a red `main` | **Maintainer decision.** It needs a change to the branch ruleset on GitHub. Recommendation: turn on the merge queue; the workflows already have `merge_group` triggers. |
| C1-P2-1 | 155 Electron test files never typechecked or linted | Fixed (#1693). `pnpm typecheck:electron-tests` is new and runs in CI and `release:check`; `pnpm lint:electron` covers the tests. 22 type errors and 25 lint errors fixed. Five test files over the 400-line cap were split. |
| C1-P2-2 | Script tests that ran nowhere | Fixed (#1693). Five files joined `test:release-integrity`, and `scripts/script-tests-listed.test.mjs` fails when one is missing. `build-artcraft-preview.test.mjs` passes again. |
| C1-P3-1 | 258 scripts have no type checking | **Measured.** With the loosest settings (`checkJs`, `strict` off) TypeScript reports 1,151 errors in 134 files, almost all from untyped object shapes. Recommendation: convert the three payment and release tools to TypeScript first, as their own task. |
| C1-P3-2 | Browser specs had no typed promise rules | Fixed (#1693). `no-floating-promises` and `no-misused-promises` run on `e2e/`. No spec needed a change. The specs lint in their own process, because their TypeScript project next to the root one ran out of memory in CI. |
| C1-P3-3 | `eslint-plugin-react` installed and never loaded | Fixed (#1693). 19 defect-catching rules run on shipped components. 19 buttons in `src/ui/laser/second-pass` had no `type` and now have one. `no-array-index-key` stays off: all 39 index keys were read, and each list is positional. |
| C1-P3-4 | Names and references have drifted | Part fixed (#1693): nine messages said LaserForge and now say KerfDesk, and `eslint.config.mjs` no longer cites CLAUDE.md sections that do not exist. **Maintainer decision** for `package.json`, still `laserforge` 0.1.0: Electron derives folder names from it, so a rename can move a user's profile. Recommendation: leave the name, and set the version from the release. Saved keys and file-format names keep `laserforge` on purpose. |
| C2-P3-1 | Small helpers re-declared per file | Part fixed (#1699), see [Shared helpers](#shared-helpers). **Maintainer decision** for the helpers that compare with a tolerance. |
| C2-P3-2 | Exports nothing uses | Fixed (#1700), see [Dead exports](#dead-exports). |
| C3-P3-1 | Load validators are not tied to their types | **Maintainer decision.** It is a design choice: a schema library, or a compile-time check per validator. Recommendation: start with a `Record<keyof Project, true>` coverage table in `deserialize-project.ts`, so a new field without a validator fails to compile. |
| C5-P3-1 | `src/ui/state` is one flat folder of 1,291 files | **Maintainer decision.** Moving hundreds of files conflicts with every open pull request. Recommendation: do it in a quiet window, one sub-folder per pull request, starting with `recovery`, which is already a folder. |
| C5-P3-2 | Ten worker clients each write their own lifecycle | Part fixed (#1700). `ui/common/stop-worker.ts` drops a worker's handlers and terminates it; six clients use it, including the three that only called `terminate()`. The start-up code stays per client: each loads a different worker and routes different messages. |
| C6-P3-1 | A length is formatted 21 different ways | Part fixed (#1699). Six number formats that four or more files each had written out now sit side by side in `core/util/number-format.ts`, under names that say what they print. Nothing a user sees changed. **Maintainer decision** on choosing one format for lengths. Recommendation: `formatUpTo3Decimals` plus " mm" everywhere a length is read, never typed. |
| C6-P3-2 | 27 files use `localStorage` directly | **Measured.** 30 files call it directly today and 31 use `browserLocalStorage()`. Each direct call has its own fallback, so converting them is file-by-file work, best done when a file is next changed. |
| C7-P3-1 | The phone page's scripts have no types | **Measured.** The page is served as written, with no bundler, and some of its files are generated. The service has its own lint. Adding types means `// @ts-check` and JSDoc on 3,872 lines; not started. |
| C8-P3-1 | A probe test that passes without asserting | Fixed (#1693). It is skipped when its switch is off. |
| C9-P3-1 | Mixed version pinning | **Maintainer decision.** Recommendation: pin everything exactly, since the lockfile already decides, and plan React 19 and zustand 5 as their own upgrades. |

Totals: 7 fixed, 4 part fixed, 4 maintainer decisions, 3 measured.

## Shared helpers

Pull request #1699 gives 61 small helpers one home each and replaces more than 500 copies with an import. On `main` before it, shipped code had 149 groups of three or more identical function bodies, about 2,700 repeated lines. After it there are 83 groups and about 930 lines.

A copy was replaced only when its body matched the shared function token for token, after comments and spacing were dropped and parameters renamed by position. A body that reads a module-level name, such as a tolerance constant, was never replaced, because the same name can hold a different value in each file. So no result changes.

`src/core/util/shared-helpers-not-copied.test.ts` fails when a shipped file declares a private function whose body is the body of a shared export.

### Left for the maintainer

These copies differ in what they compute. Merging them is a choice, and some of it could move toolpaths.

| Helper | What differs | Recommendation |
|---|---|---|
| `samePoint` with a tolerance | Tolerances of 1e-9, 1e-7 and 1e-6, some as `<=` on each axis and some as a distance | Name the three tolerances in one file and keep each call's own value. |
| `clamp`, nine copies | They take the minimum first, so they return the maximum when min > max; the shared `clamp` returns the minimum | Check that no caller passes min > max, then switch them. |
| `clamp` with a NaN guard, five copies | They return the minimum for NaN; the shared `clamp` returns NaN | Add `clampFinite` and use it for values read from forms. |
| `distanceToSegment`, ten copies | Different formulas, 2D and 3D, different zero-length handling | Keep one 2D and one 3D version; compare outputs on the golden projects first. |
| `signedArea`, nine bodies | Some skip missing points, some assume none are missing | One version for dense arrays; the results match there. |

## Dead exports

Pull request #1700 removes 73 exports whose names appear in no other tracked file, with the private code only they used: about 750 lines.

Kept on purpose:

- `isRotaryAxis`, `isDedicatedRotaryAxis` and `brownProject` were added in the week before the sweep and may belong to work in flight.
- `CC0_LIBRARY_ENTRIES` is a catalogue of eight public-domain pictures that the library does not show. **Maintainer decision:** ship them or delete the file and its eight SVG assets.
- `ROTARY_AXES` was unused while two places repeated `['Y', 'A', 'Z']`. Both now read it.

Not changed: 1,745 exports that only their own file uses. The `export` keyword on them is unneeded, and removing it changes nothing a user or a test can see.

## Limits

- The full unit suite and the full lint were not completed on the maintainer's PC: the lint ran 40 minutes and the suite 55 minutes before each was stopped. Targeted runs passed, and CI is the authority for each pull request.
- The check for a dead export is a whole-word search of tracked files. A name built at run time from strings would be missed; none of the 73 has that shape.
