# CLAUDE.md — Operating manual for Claude Code

> **Read this file at the start of every session.** Every rule here is enforced in CI or rejected at PR review. If you find yourself reasoning toward an exception, write a new ADR in `DECISIONS.md` first — **except for collaboration rule 7 (Frame is the only guard), where no ADR, test, or grant of permission can ever create an exception**: put the concern in the Job Review warnings list and stop.

---

## Read-in-order on session start

1. This file (`CLAUDE.md`).
2. `PROJECT.md` — what to build, current phase, scope.
3. `DECISIONS.md` — every architectural choice and why.
4. `WORKFLOW.md` — exact user flows for the current phase.
5. The specific ticket you've been given.

If any of these contradict each other, **stop and ask.** Do not proceed.

---

## Working with the maintainer — collaboration rules

These are behavioral norms for *how* to work in this repo. Unlike the coding rules below, they are **not CI-enforced** — they are enforced by the maintainer's review. They exist because LaserForge's hard problem is **output fidelity vs LightBurn**, which the automated suite does not measure.

1. **Tight leash — small, individually-verified diffs.** Make the smallest reviewable change that advances the goal, verify it, and let the maintainer review each diff before continuing. No large unreviewed rewrites, no multi-concern diffs, no batching unrelated fixes. When **auditing, report findings and let the maintainer choose what to fix — do not auto-fix.**

2. **Verify perceptually — green tests are NOT proof a feature works.** The suite asserts *structure and determinism* (SVG prefixes, path counts, byte-identical G-code over fuzz seeds), never *fidelity* (does the trace / fill / engrave look like the input?). Output can be geometrically wrong and still pass everything. Never call a trace/fill/engrave/raster feature "working" because `pnpm test` is green. Render it and compare to the source — the perceptual harness (`src/__fixtures__/perceptual/`, ADR-025), a rendered preview, or a golden-image diff — and **state plainly what was NOT verified.** When unsure, say "I have not verified the output looks correct," not "it works."

3. **LightBurn is the reference for every behavior.** For any behavior, UX, default, layer/cut semantics, mode (Line/Fill/Image), or G-code decision, match LightBurn unless the maintainer says otherwise. State the LightBurn behavior and check ours against it; call divergences bugs, not choices. Baseline semantics: Line = vector outline cut; Fill/Scan = hatch-fill interior; Image = dithered/grayscale raster engrave of a bitmap (not vectors). Layers are keyed by color; a layer's mode applies to every object on it; hiding a layer hides its objects on the canvas.

4. **Live-app verification must be side-effect-free.** The dev-server preview shares the maintainer's *real* working scene — treat its canvas as live work, not a sandbox. Validate a changed function in isolation (real browser APIs on throwaway DOM nodes / a throwaway canvas), not by driving the real file `<input>` or clicking commit buttons. Synthetic DOM events (`change`, `keydown` on `window`) DO fire real handlers — they have committed objects into the maintainer's scene before. If a full UI render is truly needed, ask the maintainer to do the import, or confirm first.

5. **No invention.** Don't state an API, file, config value, or behavior you haven't verified in the current tree — read the code or run the command first. "I don't know" is fine; inventing is not. (Restated from "When you don't know — say so" because it is the rule most often violated here.)

6. **End every response with a recommended action.** After any fix, audit, answer, or investigation, close with a line that starts with **Recommended action:** (or **Recommended fix:**) stating plainly the single best next step — not a menu of options. If the best next step is "nothing, ship as-is" or "no change needed," say exactly that. When a genuine either/or decision is the maintainer's to make, name your recommended option first and label it as recommended, then the alternative in one line. The maintainer should never have to ask "so what do you suggest?" — every message already answers it.

7. **FRAME IS THE ONLY GUARD — no guard will ever be created again. Hard rule, no exceptions.** (Maintainer, 2026-07-17; ADR-228, clarified by ADR-232.) A *guard* is any behavior that blocks, refuses, gates, caps, clamps, delays, hides, disables, rewrites, or adds confirmation before an otherwise available action, input, output, machine command, job start, preview, save, import, export, or G-code emission. The ONE Start guard is the frame-first gate: a completed Frame for the exact current job (bounds signature + origin identity) opens Start on both laser and CNC; the Job Review dialog is the single warning surface the operator confirms. **Frame is the source of truth: calculated bed bounds, configured no-go zones, and controller-setting policy may warn in Job Review, but must never refuse Frame or Start. The actual clean Frame completion decides whether a permit exists.** Never add a new guard, re-add a deleted one, expand any refusal surface, or promote a warning into a block — not for "safety," not for "defense in depth," not with tests or an ADR, not ever. Anything an agent believes the operator should know goes into the Job Review warnings list, which informs and never refuses. The only non-guard refusals permitted to exist are: (a) transport preconditions — the serial channel factually cannot accept a stream (disconnected, no status yet, controller Alarm/not-Idle, a job/jog/frame/operation already running, MPG owning control, a line larger than the RX buffer) — each of which must offer its fix in place where one exists; (b) compile integrity — the program factually cannot be produced or contains unstreamable bytes (compile failure, NaN coordinates, empty output); and (c) handoff consistency — the exact reviewed program/setup must be the one streamed (evidence epochs, attestation binding, resume fingerprints). Re-labeling a policy judgment as one of these three categories is a violation of this rule. Narrowing, correcting, or removing refusals remains normal work; widening any of them requires the maintainer's explicit prior permission in chat, which should be presumed denied (PROJECT.md non-negotiable #21).

---

## Size limits — hard

Every **hard** limit below is enforced by ESLint, `tsc`, or a CI script, not by judgment — except the React-component row, which has no lint rule and is enforced at review. Every **soft** limit is advisory: `pnpm check:soft-size` lists files over the soft file limit but always exits 0 (ADR-132). ESLint's file line limit counts code lines excluding blank and comment lines; CI also runs a 600 raw physical lines backstop to catch files that grow too large physically.

| Unit | Soft limit | Hard limit | Rule |
|---|---|---|---|
| File | 250 counted code lines | 400 counted code lines | Report-only listing at soft (`pnpm check:soft-size`, always exits 0 — ADR-132), ESLint `max-lines` error at hard, excluding blank and comment lines. No exceptions to this counted-code limit; CI also enforces 600 raw physical lines. |
| React component | 150 lines | 250 lines | **Review-enforced — no component-specific lint rule exists**; the 400-counted-line file cap is the only mechanical limit on a `.tsx`. If approaching, split into sub-components in a folder. |
| Function | 40 lines | 80 lines | If approaching, extract helpers. |
| Cyclomatic complexity per function | 8 | 12 | Lint error at hard. |
| Default exports per file | 1 | 1 | Named exports allowed if cohesive. |
| Public exports from a module's `index.ts` | 10 | 20 | New barrels are capped at 20. Legacy over-cap barrels are CI-ratcheted to their checked-in baseline and may only shrink until they reach the cap. |

If a generated file exceeds the soft limit during a session, **stop and split before continuing.** Do not finish the file then refactor.

---

## File creation — default action

When implementing a feature, the default is **create a new file**, not "add to an existing file."

- Adding a new utility used by two callers? New file in the nearest shared folder.
- Adding a new React component? New file, new folder if it has subcomponents.
- Adding a new pipeline stage? New module under `src/core/` with its own `index.ts`.
- Adding a new test? New file alongside the source (`Foo.ts` → `Foo.test.ts`).

You may only add to an existing file when:
- The addition is < 20 lines and clearly part of the same single responsibility, AND
- The existing file is under 60% of its soft limit, AND
- The addition doesn't introduce a new concept worth naming.

If any of those three is false, create a new file.

---

## Single responsibility — operationally defined

A file has one responsibility if you can describe what it does in one sentence without using "and."

- ✅ "Parses an SVG string into a Scene." → one responsibility.
- ❌ "Parses an SVG string into a Scene and applies layer color mapping." → two; split.
- ❌ "Renders the layers panel and handles layer reordering and persists layer state." → three; split.

**If your one-sentence description has "and" in it, split before continuing.**

---

## Naming conventions — non-negotiable

- **Files**: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- **Types and interfaces**: `PascalCase`. No `I` prefix on interfaces.
- **Functions and variables**: `camelCase`.
- **Constants**: `SCREAMING_SNAKE_CASE` at module level only. Local constants are `camelCase`.
- **Booleans**: prefix with `is`, `has`, `can`, `should`. Never `flag`, never negative names (`isNotReady` is banned; use `isPending` or `isLoading`).
- **Event handlers**: `handleX` for the function definition, `onX` for the prop name (`handleSubmit` defined locally is passed as `onSubmit` to a child).
- **Test files**: same name as source + `.test.ts` / `.test.tsx`.

File name must match the primary export. `Layer.ts` exports `Layer`. `svg-parser.ts` exports `svgParser` or `parseSvg`.

---

## Imports — boundaries enforced

```
core/  ← imports from: core/, nothing else
io/    ← imports from: core/, io/
platform/ ← imports from: core/, platform/types, nothing in ui/ or io/
ui/    ← imports from: core/, io/, platform/types (never platform/web or platform/electron directly)
```

Enforced by `eslint-plugin-boundaries`. Violation is a CI fail, not a warning. Two scoped exceptions, both deliberate: `src/ui/app/main.tsx` is the composition root and may wire `platform/web` → `ui` (ADR-011), and **test files (`*.test.ts`, `*.test.tsx`) plus `src/__fixtures__/` are exempt from boundary enforcement** — a test may import across modules for scaffolding. Do not read the exemption as license to couple production code through a test.

Cross-module imports must go through `index.ts`. Reaching into `../scene/internal/foo.ts` from outside `scene/` is forbidden — **a review-enforced convention, not a mechanical one**: `boundaries/entry-point` is not configured, and because elements are declared in folder mode a deep path still classifies as its top-level module and passes lint.

No circular imports. ESLint rule `import/no-cycle` set to error.

---

## State — discriminated unions only

When a thing can be in one of N states, model it as a tagged union:

```ts
type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; startedAt: number }
  | { kind: 'loaded'; data: Project }
  | { kind: 'failed'; error: Error };
```

Not:

```ts
// ❌ banned
type LoadState = {
  isLoading: boolean;
  isLoaded: boolean;
  isFailed: boolean;
  data?: Project;
  error?: Error;
};
```

When pattern-matching on `kind`, the default arm must be `assertNever(state)` so TypeScript catches missing cases at compile time. This is how Phase D and Phase E land cleanly — the compiler tells you exactly where new variants need handling.

---

## Mutable state — none, except in Zustand slices

- No module-level mutable variables.
- No `let` outside function bodies.
- No mutation of objects after construction. Build a new value with spreads — the store uses spreads throughout. (Immer is **not** a dependency: it is only an optional peer of Zustand and is absent from the tree, so do not import `produce`.)
- React state lives in either local `useState` or a Zustand slice — never a global object, never a singleton.

---

## Pure core

Nothing in `src/core/` is allowed to:
- Read from disk
- Read from the network
- Read from `process`, `navigator`, `window`, `document`
- Read the system clock (`Date.now()`) — pass time in as a parameter for testability
- Generate random values — pass an RNG in as a parameter
- Call `console.*` (use a logger passed in)
- Throw exceptions for control flow — return a `Result<T, E>` discriminated union

Enforced by ESLint `no-restricted-globals`, `no-restricted-imports`, and `no-restricted-syntax` (the clock and randomness bans). The Result-instead-of-throw rule is **review-enforced only** — no lint rule detects a `throw` inside `src/core/`.

---

## Tests — co-located, written first for bug fixes

- Source file `Foo.ts` → test file `Foo.test.ts` in the same folder when the source has direct testable behavior.
- CI does not enforce a direct sibling-test rule. PR review rejects source changes without modified or added tests unless the change is a pure refactor or an explicitly documented policy/docs/build-only change.
- Property tests for all invariants (`PROJECT.md` non-negotiables 1–7).
- Snapshot tests for G-code output on the fixture corpus.
- **Bug fix workflow**: write a failing test that demonstrates the bug, then fix it, then verify the test passes. PR must include both the test (new) and the fix.

PR review rejects PRs that:
- Modify source without modifying or adding tests, except for pure refactors flagged as such.
- Modify the G-code snapshot without an explicit acknowledgment line in the PR description: `Snapshot change acknowledged: <reason>`.

(These are review conventions, not CI-mechanical gates — `release:check` runs lint, typecheck, format, license, audit, tests, builds, and file-size, none of which inspect test-file presence or the PR description. See "Session hygiene" below and PROJECT.md #16.)

---

## Type strictness

- `tsconfig.json` has `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- `any` is banned. Use `unknown` and narrow.
- Type assertions (`as Foo`) require a comment justifying why narrowing isn't sufficient.
- Non-null assertions (`!`) banned outside test files.

---

## Magic numbers, magic strings

Inline literals are allowed for:
- `0`, `1`, `-1`
- `''` (empty string)
- Array indices in obviously-bounded loops

Everything else gets a named constant. Tolerances, default values, limits, error messages, key names, route paths, file extensions — all named.

```ts
// ✅
const MAX_BED_DIMENSION_MM = 1500;
if (workspace.width > MAX_BED_DIMENSION_MM) ...

// ❌
if (workspace.width > 1500) ...
```

---

## Comments — why, not what

Code says what; comments say why.

```ts
// ✅
// GRBL $30 defines the max S value the firmware maps to 100% laser power.
// We scale our 0-100 percentage into this range at the strategy boundary.
const sValue = (powerPercent / 100) * device.maxPowerS;

// ❌
// Multiply power percent by max power S
const sValue = (powerPercent / 100) * device.maxPowerS;
```

JSDoc on public exports. Internal helpers don't need doc comments unless the why isn't obvious.

---

## Anti-patterns — recognize and refactor

Watch for these in your own output. If you generate code that matches one of these patterns, **stop and refactor before continuing the session.**

- **God file.** Any file approaching 250 lines. The fix is *split*, not "add a TODO."
- **Copy-paste duplication.** Same logic written twice with small variations. The fix is *extract* to a helper module the second time it appears, not the third.
- **Long parameter list.** Function with > 4 parameters. The fix is *introduce a parameter object* type.
- **Boolean parameter.** `doThing(input, true)`. The fix is *split into two functions* or use a discriminated union for the option.
- **Stringly-typed.** `mode: string` where it should be `mode: 'line' | 'fill' | 'image'`.
- **Comment instead of refactor.** `// TODO: this is messy` is a code smell. Refactor or open an issue.
- **Conditional platform code.** `if (isElectron()) { ... }` inside `ui/`. The fix is *push to platform adapter*.
- **Mutable args.** Function that modifies an array or object passed in. The fix is *return a new value*.
- **Throwing for control flow.** `try { parseX() } catch { return null }`. The fix is *return a Result type from parseX*.
- **Ignored async.** `await`able functions called without `await`. CI rule `no-floating-promises`.

---

## Adding a new feature — checklist

Before writing code:

- [ ] Does the feature appear in `PROJECT.md` under the current phase?
- [ ] If it's architectural, is there an ADR in `DECISIONS.md`?
- [ ] Are user flows in `WORKFLOW.md` for the four states (success, error, empty, edge)?
- [ ] Have I identified which module(s) the change lives in?
- [ ] Have I checked which existing files might need updates? (Use grep, don't guess.)
- [ ] Have I planned tests? Which invariants apply?
- [ ] What's the smallest reviewable diff that accomplishes this?

If any answer is no, fix it before writing code.

---

## Fixing a bug — checklist

- [ ] Have I reproduced the bug?
- [ ] Have I written a failing test that demonstrates it?
- [ ] Have I identified the root cause, not just the symptom?
- [ ] Have I checked whether the same pattern exists elsewhere in the codebase? (`grep -r` for similar code.)
- [ ] Have I made the smallest fix that makes the failing test pass?
- [ ] Have I run the full test suite, not just the new test?
- [ ] Does my PR description explain root cause, not just symptom?

---

## Refactoring — separate from features

Refactors and feature work do not go in the same PR. Two principles:

1. **Tidy first.** If a feature would be easier to implement after a refactor, do the refactor *first*, in its own PR, with no behavior change. Merge. Then do the feature.
2. **Same diff = same intent.** A reviewer should be able to look at a PR and answer "what is this trying to do?" in one sentence. If the answer is "refactor X *and* add Y," split it.

PR titles use Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`.

---

## We only build with verified research — never guess, never hallucinate

You are not penalized for saying "I don't know." You are penalized for inventing — and
equally for **speculating out loud instead of going and finding out.** When you don't know
something, go do the research: read the source, run the command, fetch the upstream document.
Then answer. Uncertainty is a trigger to investigate, never a licence to guess.

**Banned moves.** If you catch yourself writing one of these, stop mid-sentence and go
research instead:
- "Maybe I should…" / "I think it works like this" / "It probably…" / "This should be fine"
- Proposing a design whose feasibility you have not checked
- Stating an API, flag, version range, CVE range, config key, default, or firmware behavior
  from memory
- Recommending a fix you have not confirmed actually fixes the thing

**Evidence you must hold, from this session, before stating a fact or recommending a fix:**
- The actual source read in the current tree — cite `file:line`; or
- The actual command run, with its real output and exit code; or
- The **upstream primary source fetched and read** — vendor docs, the advisory record, the
  spec, the changelog, the firmware manual, the issue thread; or
- A reproduction you ran yourself.

"I read it somewhere," "that's how it usually works," and "the docs probably say" are not
sources. **External research is expected, not a last resort** — fetch the page, read the
GRBL/LightBurn documentation, read the advisory, read the datasheet. Cite what you used so
the maintainer can check it. Time spent verifying is never wasted; a confident wrong answer
costs far more, and on this project it can mean a ruined workpiece or an unsafe machine move.

Highest-risk category, look every one up every time: version numbers and semver ranges,
CVE/advisory affected-vs-patched ranges, controller settings (`$` numbers) and their
semantics, G-code word behavior, API signatures, and what LightBurn actually does.

If you are about to:
- Reference an API you haven't verified
- Assume a file structure you haven't read
- Claim a behavior you haven't tested
- Quote a config value you haven't checked

**Stop.** Read the actual code, run the actual command, fetch the actual documentation. Then
proceed.

If you cannot verify something in the current session, say:

> I don't know X. To proceed, I need to [read file / run command / verify in docs]. Should I do that now, or do you want to confirm Y?

This is the most important rule in the file. Most "AI broke my codebase" stories are this rule violated.

---

## Session hygiene

- Run `pnpm test` before declaring work done.
- Run `pnpm lint` before declaring work done.
- Run `pnpm typecheck` before declaring work done.
- Run `pnpm format:check` before declaring work done — CI runs `prettier --check .` repo-wide (in `release:check`), and it is NOT part of `pnpm lint`, so a Prettier-dirty file passes lint locally but fails the release gate.
- Report what you changed, by file. Not "I updated the layer panel" — list `src/ui/layers/CutsLayersPanel.tsx` and `src/ui/layers/index.ts`.
- Report what you didn't verify. If you didn't run the E2E suite, say so.
- Don't write `// TODO` without opening a corresponding issue.

---

## When in doubt — defer to these documents

- Product question? → `PROJECT.md`
- Architecture question? → `DECISIONS.md`
- "What should happen when…?" → `WORKFLOW.md`
- Coding rule? → this file.
- Contradiction between them? → ask the user.

Never invent the answer. The answer is in one of the four files, or it doesn't exist yet and we need to write it down before the code.
