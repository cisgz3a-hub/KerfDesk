# CLAUDE.md — Operating manual for Claude Code

> **Read this file at the start of every session.** Every rule here is enforced in CI or rejected at PR review. If you find yourself reasoning toward an exception, write a new ADR in `DECISIONS.md` first.

---

## Read-in-order on session start

1. This file (`CLAUDE.md`).
2. `PROJECT.md` — what to build, current phase, scope.
3. `DECISIONS.md` — every architectural choice and why.
4. `WORKFLOW.md` — exact user flows for the current phase.
5. The specific ticket you've been given.

If any of these contradict each other, **stop and ask.** Do not proceed.

---

## Size limits — hard

These are enforced by ESLint and `tsc`, not by judgment.

| Unit | Soft limit | Hard limit | Rule |
|---|---|---|---|
| File | 250 lines | 400 lines | Lint warning at soft, error at hard. No exceptions. |
| React component | 150 lines | 250 lines | If approaching, split into sub-components in a folder. |
| Function | 40 lines | 80 lines | If approaching, extract helpers. |
| Cyclomatic complexity per function | 8 | 12 | Lint error at hard. |
| Default exports per file | 1 | 1 | Named exports allowed if cohesive. |
| Public exports from a module's `index.ts` | 10 | 20 | If exceeded, the module is doing too much; split it. |

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

Enforced by `eslint-plugin-boundaries`. Violation is a CI fail, not a warning.

Cross-module imports must go through `index.ts`. Reaching into `../scene/internal/foo.ts` from outside `scene/` is forbidden.

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
- No mutation of objects after construction. Use spread or `produce` from Immer (already a Zustand dependency).
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

Enforced by ESLint `no-restricted-globals` and `no-restricted-imports`.

---

## Tests — co-located, written first for bug fixes

- Source file `Foo.ts` → test file `Foo.test.ts` in the same folder.
- A file with no test is rejected by CI lint (`require-test-coverage` custom rule).
- Property tests for all invariants (`PROJECT.md` non-negotiables 1–7).
- Snapshot tests for G-code output on the fixture corpus.
- **Bug fix workflow**: write a failing test that demonstrates the bug, then fix it, then verify the test passes. PR must include both the test (new) and the fix.

CI rejects PRs that:
- Modify source without modifying or adding tests, except for pure refactors flagged as such.
- Modify the G-code snapshot without an explicit acknowledgment line in the PR description: `Snapshot change acknowledged: <reason>`.

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

## When you don't know — say so

You are not penalized for saying "I don't know." You are penalized for inventing.

If you are about to:
- Reference an API you haven't verified
- Assume a file structure you haven't read
- Claim a behavior you haven't tested
- Quote a config value you haven't checked

**Stop.** Read the actual code, run the actual command, check the actual docs. Then proceed.

If you cannot verify something in the current session, say:

> I don't know X. To proceed, I need to [read file / run command / verify in docs]. Should I do that now, or do you want to confirm Y?

This is the most important rule in the file. Most "AI broke my codebase" stories are this rule violated.

---

## Session hygiene

- Run `pnpm test` before declaring work done.
- Run `pnpm lint` before declaring work done.
- Run `pnpm typecheck` before declaring work done.
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
