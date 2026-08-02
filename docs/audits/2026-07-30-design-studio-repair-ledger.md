# Design Studio repair ledger - current-main continuation

Scope: Design Studio only. This continuation records one reproduced defect,
the smallest coherent repair, focused verification, and an independent audit
before publication. The full historical ledger remains preserved on
`codex/design-studio-repair`; it is not copied onto current main because that
branch spans obsolete and overlapping work.

Worktree: `C:\Users\Asus\.codex\worktrees\7294\LaserForge-2.0`

Branch: `codex/design-studio-point-tools`

Base: `origin/main` at `8a078dc7eba551942cacb801070ae69d0b39b052`

Controller, firmware, Apply, Frame, Start, hardware, deployment, and main merge
are outside this repair.

## Current-main Repair 1 - Polyline and Arc cannot arm no-op states

### Reproduction

- `design-tool.ts` presented Polyline and Arc as built, so their rail buttons
  and P/A shortcuts armed normally.
- `design-draft.ts` and `use-design-pointer.ts` dispatched only Line,
  Rectangle, Circle, Fillet, Chamfer, and Select. A pointer press with Polyline
  or Arc armed captured the pointer and changed no state.
- Failing-first interaction evidence:
  `pnpm exec vitest run src/ui/design-studio/use-design-pointer.test.tsx`
  failed with zero entities after Polyline clicks, then again with zero entities
  after Arc centre/start/end clicks.

### Repair

- Added a transient discriminated point-sequence state outside sketch history.
- Polyline clicks collect corners, double-click finishes open, and a near-start
  click previews and commits the exact closing edge. A distinct object snap near
  the start is preserved instead of being silently converted into closure.
- Arc uses centre -> start/radius -> end direction. Preview and commit share the
  same fixed-radius sampled geometry; off-radius endpoint snaps are not claimed.
- An Arc end clicked at the centre remains live rather than reusing a previous
  hover direction, and only numerical-radius equality retains an Arc snap.
- Both tools use the shared 2D/3D `DesignSurface`, active design layer, snapping,
  Ortho, phase-specific status guidance, Escape ladder, and atomic one-step undo.
- Middle/right 3D camera buttons never dispatch a design point. Native-like
  double-click sequencing cannot leave a duplicate Polyline point or stray Arc.

### Initial focused verification checkpoint

- Point sequence, status hint, pointer interaction, Escape, 2D overlay, and 3D
  overlay: 6 files / 52 tests passed at this historical checkpoint.
- Coverage includes a secondary active layer, undo/redo, same-tool re-arm,
  invalid/repeated points, exact closure preview, object-snap-over-Ortho,
  near-start snap priority, off-radius Arc snap honesty, and camera buttons.
- Scoped format, lint, full Design Studio tests, native browser behavior, and
  exact diff audit remain to be recorded at the publication checkpoint.

### Post-change audit checkpoint

- Fixed during independent review: same-tool re-arm no longer erases a sequence.
- Fixed during independent review: non-primary 3D navigation clicks no longer
  add points.
- Fixed during independent review: Polyline close preview no longer jumps and
  no longer overrides a distinct geometric snap.
- Fixed during independent review: even a distinct snap only `0.005 mm` from
  the first point wins; only the numerically same point can close while a snap
  is active.
- Fixed during independent review: native double-click rollback does not rely
  on `pointerdown.detail` (Chrome reports zero for both pointer presses), and a
  completed first constituent click cannot leave the point tool armed.
- Fixed during independent review: an Arc end clicked at its centre cannot
  commit a stale preview direction, and near-radius snaps are not announced as
  exact matches.
- Workflow and project-stage contracts now describe the completed point tools.
- No project Apply, G-code, controller, Frame, Start, firmware, or hardware path
  changed.

### Publication checkpoint

- **Workstream:** Design Studio point tools.
- **Finding/fix title:** visible Polyline and Arc controls armed no-op states.
- **Severity:** release-blocking interaction defect.
- **Status:** fixed and independently audited on the exact current-main base.
- **Exact evidence/reproduction:** before the repair, the rail and P/A shortcuts
  armed built-looking tools while `use-design-pointer.ts` had no point-tool
  dispatch; failing-first mounted tests produced zero entities after valid
  Polyline and Arc gestures. Native Chrome now creates each entity, and the
  persisted open Polyline is exactly three points rather than a double-click
  artifact.
- **Tests/checks:** focused point-tool tests 6 files / 56 passed; full Design
  Studio 25 files / 273 passed; Playwright Chrome 2 / 2 passed; repository
  Vitest in four deterministic shards 3,735 suites / 9,604 tests total (9,582
  passed, 22 pending, 0 failed); app and E2E typechecks, full ESLint, Electron
  ESLint, full Prettier, web build, Electron-main build, 14 release-integrity
  tests, license closure, file-size, soft-size, ADR-number, index-export, and
  diff checks passed.
- **PR/commit:** pending publication after the staged-diff audit.
- **Remaining boundary:** Arc creation is fixed-radius positive-sweep only, as
  documented. Signed-sweep interaction and the inherited Grid-hidden snap
  mismatch are separate product/repair decisions. No hardware behavior was
  exercised.
- **Source ledger:**
  `docs/audits/2026-07-30-design-studio-repair-ledger.md`.
