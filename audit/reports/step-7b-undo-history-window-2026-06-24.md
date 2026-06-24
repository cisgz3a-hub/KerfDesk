# Step 7B - Undo History Window

## Step Contract

- Goal: add a safe, read-only Undo History window from the Window menu.
- User-visible success: the operator can open Window > Undo History, see current/undo/redo history depth, run Undo/Redo from the dialog when available, and close it without touching machine state.
- Safety risk: low. This slice does not touch serial, controller, G-code, output, machine profile, or firmware behavior.
- Out of scope: rich per-action labels, timeline thumbnails, history branching, and hardware smoke.
- Required evidence: red-green command/dialog tests, browser smoke, typecheck, lint, full tests, build, and diff audit.

## Research

- Existing pattern: `src/ui/commands/ProjectNotesDialog.tsx` and `CommandShell.tsx` own modal state and use `useRegisterModal`.
- Command spine: `command-types.ts`, `command-families.ts`, `use-app-commands.ts`, `command-help-topics.ts`, and `AppMenuBar.tsx`.
- Store state: `useStore` exposes `project`, `undoStack`, `redoStack`, `undo`, and `redo`.
- Step queue source: `audit/reports/step-7a-no-hardware-roadmap-reality-audit-2026-06-23.md` listed Undo History Window V1 as a safe no-hardware candidate.

## Failing Proof

- `pnpm test src/ui/commands/UndoHistoryDialog.test.tsx src/ui/commands/command-registry.test.ts`
  - Failed because `UndoHistoryDialog` did not exist.
  - Failed because `window.undo-history` was missing from the command registry.
- Browser smoke initially failed after the dialog path worked because Chrome requested a missing favicon and logged a 404.
- Added `src/platform/web/favicon.test.ts` and confirmed red:
  - Expected `/favicon.svg`, received `undefined`.

## Implementation

- Added `UndoHistoryDialog` with current/undo/redo summaries, top-first stack rows, and guarded Undo/Redo buttons.
- Added `window.undo-history` to the typed command registry, Window menu, help text, and CommandShell modal routing.
- Updated duplicate command test contexts with the new callback.
- Added `/favicon.svg` and linked it from `index.html` so browser smoke no longer reports the favicon 404.

## Verification

- Targeted tests:
  - `pnpm test src/platform/web/favicon.test.ts src/ui/commands/command-image-mask.test.ts src/ui/commands/command-lock.test.ts src/ui/app/use-shortcuts-modal-gate.test.tsx src/ui/common/Toolbar.test.tsx src/ui/commands/AppMenuBar.test.tsx src/ui/commands/UndoHistoryDialog.test.tsx src/ui/commands/command-registry.test.ts`
  - Passed: 8 files, 48 tests.
- Static gates:
  - `pnpm typecheck` passed.
  - `pnpm lint` passed with the existing boundaries legacy-selector warning.
  - `pnpm check:file-size` passed.
  - `git diff --check` passed.
- Full suite:
  - `pnpm test` passed: 347 files, 2145 tests.
  - Existing jsdom act warnings remain in `use-canvas-bitmap-size.test.tsx`.
- Build:
  - `pnpm build:web` passed.
  - Existing large chunk warning remains.
- Browser smoke:
  - Headless Chrome 149 against `http://127.0.0.1:5199/`.
  - Opened Window menu, clicked Undo History, verified dialog text, closed dialog.
  - Console errors: 0.

## Audit Findings

No accepted findings remain.

Rejected false positives:

- Duplicate `baseCtx` helpers in `command-image-mask.test.ts` and `command-lock.test.ts` are pre-existing local test structure. This slice updated them for type safety; consolidating them into the shared helper is useful cleanup, but not required for correctness.
- The dialog shows project object/layer counts rather than semantic action names. That is intentional V1 scope; richer history labels need a future history-event model.
- The favicon fix is adjacent to, but not unrelated to, this step because the required browser smoke failed on that exact missing asset.

## Rating

| Area | Rating | Evidence |
| --- | ---: | --- |
| Correctness | 10/10 | Command opens the dialog through the central registry; Undo/Redo callbacks are covered. |
| Safety | 10/10 | No controller, machine, firmware, G-code, or output paths changed. |
| UX | 10/10 | Window menu path works in browser smoke; dialog is focused modal UI and closes cleanly. |
| Regression coverage | 10/10 | Targeted tests, full tests, typecheck, lint, file-size, and build passed. |
| Real-artifact evidence | 10/10 | Real Chrome smoke verified the actual running app with zero console errors. |
| Maintainability | 10/10 | Uses existing command registry, modal shell, store actions, and help registry. |
| Docs/audit clarity | 10/10 | This report records red proof, implementation, evidence, audit, and rating. |

Final score: 10/10.
