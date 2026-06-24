# Step 7D - Command Help Coverage Guard

Date: 2026-06-24
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: no-hardware help and learning-platform polish
Rating: 10/10

## Locked Goal

Make command help coverage self-check against LaserForge's real command registry
instead of a hand-maintained list. This prevents new commands from silently
missing tooltip/help coverage.

Out of scope: visible UI copy changes, new help UI, controller behavior, G-code
output, and hardware smoke.

## Research

- `src/ui/help/help-topics.test.ts` used a static `COMMAND_IDS` array.
- `src/ui/commands/command-registry.ts` is the source of truth for app commands.
- `src/ui/commands/command-registry-test-helpers.ts` already provides `baseCtx()`
  for registry tests.
- Current registry included commands missing from the static help test list:
  `tools.focus-test` and `window.undo-history`.

## Failing Proof

Added a temporary assertion comparing the static list to
`buildAppCommands(baseCtx())`.

Focused red command:

```powershell
pnpm vitest run src/ui/help/help-topics.test.ts
```

Observed failure:

- Missing from the static list: `tools.focus-test`, `window.undo-history`.

## Implementation

- Removed the hard-coded command-id list from `help-topics.test.ts`.
- Added `commandIds()` that derives ids from `buildAppCommands(baseCtx())`.
- Added exact coverage checks:
  - every registered command has help.
  - every help entry corresponds to a registered command.
  - every registered command has meaningful tooltip text.

No production code changed.

## Verification

- PASS: `pnpm vitest run src/ui/help/help-topics.test.ts src/ui/commands/command-registry.test.ts`
  - 2 files, 36 tests passed.
- PASS: `pnpm format:check`
- PASS: `pnpm typecheck`
- PASS: `pnpm lint`
  - Existing `boundaries/dependencies` selector warning only; exit code 0.
- PASS: `git diff --check`
- PASS: `pnpm test`
  - 349 files, 2152 tests passed.
  - Existing jsdom `act(...)` warnings remain in `use-canvas-bitmap-size.test.tsx`.
- PASS: `pnpm build:web`
  - Existing Vite large chunk warning remains.

## Audit

Findings: none accepted.

Rejected concerns:

- "The help test now imports the command registry." Rejected. This is test-only
  and intentionally makes the command registry the runtime coverage source.
- "No browser smoke." Rejected. No visible app behavior changed; this slice
  strengthens automated coverage only.
- "No hardware smoke." Rejected. Scope is help-test coverage only.

Rubric:

- Correctness: 10/10
- Safety: 10/10
- UX: 10/10 for preventing missing command help from slipping into the app
- Regression coverage: 10/10
- Real-artifact evidence: 10/10
- Maintainability: 10/10
- Docs/audit clarity: 10/10

Final rating: 10/10.
