# Engineering guide

`AGENTS.md` is the canonical, tool-neutral operating contract. This file defines
repository engineering standards for Claude Code and every other contributor.
Rules are labeled so guidance is not confused with a CI gate.

## Before changing code

1. Confirm the current checkout and preserve unrelated work.
2. Read `PROJECT.md` for scope, the relevant `WORKFLOW.md` section, and the
   governing ADRs. Use [`docs/README.md`](docs/README.md) to route the task; do
   not read the multi-thousand-line logs end to end unless the task requires it.
3. Reproduce a bug before fixing it. Search with `rg` and inspect callers, tests,
   state transitions, persistence, and recovery paths.
4. Identify what automated, browser, perceptual, simulator, or hardware evidence
   can actually prove the result.

Scope changes require a `PROJECT.md` update. Architecturally significant,
machine-policy, dependency, persistence-schema, or trust-boundary changes require
an ADR. Routine bug fixes, tests, documentation corrections, and behavior-neutral
refactors do not.

## Collaboration and evidence — review conventions

- Keep diffs cohesive and reviewable. Do not batch unrelated fixes.
- Audits are report-only unless the user asks for implementation.
- Never invent an API, file, setting, or behavior. Verify it in the current tree.
- Green tests do not establish visual fidelity or physical burn quality. Use the
  perceptual harness, rendered output, isolated browser verification, simulator
  evidence, or the documented hardware protocol, and report what remains untested.
- Do not drive the maintainer's real browser scene with synthetic events or commit
  actions. Use an isolated test project/profile or ask for supervised verification.
- LightBurn is the default behavior and UX reference where the product contract
  adopts it. Deliberate divergences are allowed when documented by the maintainer;
  do not call an unverified behavior parity.
- Follow the frame-first machine-control policy in `AGENTS.md`. It governs
  ordinary Start policy, not security, capability, recovery, or integrity checks.

## Enforced architecture

These rules are enforced by TypeScript, ESLint, or repository scripts.

### Size and complexity

| Unit | Policy | Enforcement |
|---|---|---|
| Production source file | 250 counted lines is report-only; 400 counted lines is an error | `pnpm check:soft-size`, ESLint `max-lines` |
| Source/config physical size | 600 raw lines | `pnpm check:file-size` |
| Function, including React components | 80 counted lines | ESLint `max-lines-per-function` |
| Cyclomatic complexity | 12 | ESLint `complexity` |
| New `index.ts` barrel | 10 exports is the soft target; 20 is the hard cap | `pnpm check:index-exports` |

Tests and fixtures have documented exceptions for function length, non-null
assertions, module boundaries, and Node imports. Legacy over-cap barrels use the
checked-in no-growth ratchet. Do not describe the 250-line tier as a lint warning;
it is a non-blocking report.

### Module boundaries

```text
core/              imports core/
io/                imports core/, io/
platform/types.ts  imports core/
platform/web/      imports core/, platform/types
platform/electron/ imports core/, platform/types
ui/                imports core/, io/, platform/types
```

Cross-module imports go through the owning module's public surface. Production
code must not create import cycles. `src/ui/app/main.tsx` is the composition-root
exception, and tests/fixtures may cross boundaries for scaffolding.

### Pure core and type safety

Production `src/core/` code must not read browser or Node globals, perform I/O,
read the clock, generate randomness, or log directly. Pass those capabilities in
or move the work to the appropriate boundary.

TypeScript is strict. Production code forbids explicit `any` and non-null
assertions, enforces type-only imports and exhaustive switches, and checks
floating/misused promises. Prefer discriminated unions for mutually exclusive
states. Use `unknown` plus narrowing at untrusted boundaries.

Module-level mutable state is not categorically banned. Keep it isolated and
lifecycle-owned; ADR-050 permits narrow memoized loader caches, and platform or
worker handles may need bounded mutable ownership. Do not introduce hidden
cross-project state.

### UI and async safety

- Raw `window.alert`, `confirm`, and `prompt` are forbidden outside the
  job-aware wrapper because they can freeze the renderer during a job.
- UI chrome colors use shared theme tokens; justified scene-data colors are the
  documented exception.
- Await or explicitly handle promises. Async continuations that can outlive a
  project, session, modal, worker, or controller epoch must reject stale results.

## Design guidance — review conventions

- Choose the smallest cohesive home for a change. Create a new file when it owns
  a distinct concept; extend an existing file when the behavior belongs to its
  current responsibility and remains within enforced limits.
- Prefer clear names: `PascalCase` for types/components, `camelCase` for values,
  `handleX` for local handlers, and `onX` for callback props. Follow the existing
  folder's filename convention and make the primary export easy to find.
- Name domain limits, units, tolerances, protocol values, and reused messages.
  Obvious local literals do not need ceremonial constants.
- Comments explain constraints and reasons. Public APIs should document
  non-obvious contracts; internal helpers need comments only when the reason is
  not clear from code.
- Avoid god files, copy/paste variants, boolean-flag APIs, stringly typed modes,
  mutated arguments, floating promises, and platform checks inside UI logic.
  Cohesion and change risk—not whether a sentence contains the word “and”—decide
  when to split a module.

## Tests and change process

- Co-locate directly relevant tests with source. CI does not require one sibling
  test for every source file, but behavior changes need focused evidence.
- For a bug, add a failing reproduction when practical, make the smallest fix,
  then prove the reproduction and affected regression suite pass.
- Property-test safety/output invariants and snapshot intentional G-code changes.
  A G-code snapshot change must include `Snapshot change acknowledged: <reason>`
  in the PR description.
- Keep behavior-neutral refactors separate from feature work when the refactor is
  not required to deliver the feature safely.
- Use Conventional Commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`,
  `docs:`, `chore:`, `ci:`.

## Verification commands

Choose commands proportional to the change:

```powershell
pnpm typecheck
pnpm lint
pnpm lint:electron
pnpm format:check
pnpm test
pnpm test:e2e
pnpm release:check
```

`pnpm release:check` is the full blocking release gate: typecheck, lint, Electron
lint, formatting, license and dependency audit, Vitest, web/Electron builds, and
size/export policies. `pnpm test:e2e` is the separate Playwright browser-smoke
suite. Documentation-only work normally does not justify running every source and
browser test; verify formatting, relative links, commands, and factual claims.

When handing off, list the meaningful files changed, the verification performed,
and any unverified browser, perceptual, controller, or hardware behavior.
