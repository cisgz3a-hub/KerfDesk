# LaserForge full-code audit — self-prompt

This is the prompt the audit follows. The audit's goal is a
**professional, code-by-code review of every sector of the
LaserForge codebase**, suitable for handing to an engineering
manager or a security reviewer. **No skipping.**

The audit's output is a single living document: `AUDIT-2026-05-11.md`.
Every finding lands there with severity, location, evidence, and a
recommended action.

## Operating rules

1. **Read before judging.** CLAUDE.md hard rule: verify every claim
   against actual code. Never write a finding from memory or
   speculation. Always cite `file.ts:line` and quote the offending
   code.
2. **Safety paths get the heightened bar.** Touched files: anything
   under `src/controllers/`, `src/communication/`, `src/app/MachineService.ts`,
   `src/app/ExecutionCoordinator.ts`, `src/core/preflight/`,
   `src/core/output/`, `src/core/plan/MachineTransform.ts`,
   `src/core/job/JobCompiler.ts`, `electron/serial.ts`,
   `electron/falcon-wifi/`. A bug here can burn down the user's
   workshop.
3. **Cross-reference tests.** For every sector, scan `tests/` for
   coverage; flag safety paths with no end-to-end test.
4. **Pin every finding with grep evidence.** Future readers must be
   able to reproduce.
5. **Don't fix anything during the audit.** Findings only — the
   user will decide which ones to ship as tickets.
6. **Track scope as you go.** If a sector takes longer than
   expected, document why and proceed.

## Severity scale

- **Critical** — can directly cause a fire, mechanical damage, data
  loss, or remote-controllable security compromise. Drop everything.
- **High** — silent wrong behavior in a safety path, or a defense
  layer that doesn't actually defend. Should be a P0 ticket.
- **Medium** — correctness or robustness bug in non-safety code, or a
  safety bug that another layer happens to catch. Should be filed.
- **Low** — style, naming, dead code, missing JSDoc. File only if
  trivial to fix.
- **Info** — observation worth recording but not actionable
  (architecture note, design comment, test-coverage observation).

## Finding categories

- **Safety** — could cause physical harm or property damage.
- **Security** — could compromise the user's machine or data.
- **Correctness** — wrong output for valid input.
- **Robustness** — crashes / undefined behavior on edge cases.
- **Performance** — measurable user-visible slowness.
- **Concurrency** — races, deadlocks, listener leaks.
- **Type-safety** — `any`, unchecked casts, `@ts-ignore`.
- **API surface** — public API mismatched with usage / docs.
- **Design** — coupling, layering, naming, smells.
- **Test coverage** — missing test for stated contract.
- **Dead code** — unreachable / unused.
- **Documentation** — wrong / missing / misleading comment.

## Finding template

```
### F-NNN: <one-line description>

- **Severity:** Critical | High | Medium | Low | Info
- **Category:** Safety | Security | Correctness | Robustness | ...
- **Location:** `<file>:<line>` (and any related citations)
- **Evidence:**
  ```ts
  // exact quote of the problematic code
  ```
- **Analysis:**
  <2–4 sentences explaining why this is a problem, what the
  user-visible impact is, and what the current code does instead
  of what it should do>
- **Recommendation:**
  <concrete action: ticket number to file, specific code change to
  consider, or "no action — design intent" with reasoning>
```

## Sector order (priority-weighted, safety first)

For each sector: list the files, read each, scan for issues, cross-
reference tests, record findings. Sectors are sized to fit one
audit pass each.

1. **Phase 0 — Project survey** (file inventory, hotspots, dead
   directories).
2. **Phase 1 — Controllers + communication** (`src/controllers/`,
   `src/communication/`).
3. **Phase 2 — MachineService + ExecutionCoordinator + safety state**
   (`src/app/MachineService.ts`, `ExecutionCoordinator.ts`,
   `SafetyStateMachine.ts`, `SafetyActionResult.ts`,
   `MachineCommandGateway.ts`, related).
4. **Phase 3 — Preflight rules** (`src/core/preflight/`).
5. **Phase 4 — Output (G-code emission)** (`src/core/output/`,
   `src/core/plan/MachineTransform.ts`).
6. **Phase 5 — Pipeline math** (`src/core/job/JobCompiler.ts`,
   `src/core/plan/PlanOptimizer.ts`, `FillGenerator`,
   `RasterGenerator`, `ContainmentOrder`, `PathOptimizer`,
   `VelocityProfile`).
7. **Phase 6 — Scene model + geometry** (`src/core/scene/`,
   `src/geometry/`, `src/core/types.ts`).
8. **Phase 7 — Persistence + IO** (`src/io/`, `src/core/storage/`,
   project integrity, migrations, autosave).
9. **Phase 8 — Entitlements + materials** (`src/entitlements/`,
   `src/core/materials/`).
10. **Phase 9 — Falcon WiFi** (`electron/falcon-wifi/`,
    `src/security/FalconWiFiTrust.ts`).
11. **Phase 10 — Electron shell** (`electron/main.ts`, `preload.ts`,
    `serial.ts`, `storage.ts`).
12. **Phase 11 — UI orchestrator** (`src/ui/components/App.tsx`,
    `src/ui/stores/`, `src/ui/hooks/`).
13. **Phase 12 — UI surfaces** (`ConnectionPanelMain`, `CanvasViewport`,
    `PropertiesPanel`, `LayerPanel`, `SceneRenderer`,
    `FileToolbar`, `WelcomeWizard`).
14. **Phase 13 — Import / export** (`src/import/svg/`, dithering,
    trace).
15. **Phase 14 — Debug / runtime** (`src/debug/`, `src/runtime/`).
16. **Phase 15 — Tests audit** (skipped tests, KNOWN_FAILURES,
    gaps, fixture quality).
17. **Phase 16 — Build + scripts** (`scripts/`, `electron-builder`,
    `package.json`, `tsconfig`).
18. **Phase 17 — Cross-cutting scans** (any-types, ts-ignore,
    unused exports, console.error usage, network/disk without
    timeout, TODO/FIXME).
19. **Phase 18 — Documentation** (CLAUDE.md, ROADMAP, README,
    audit ledger).
20. **Phase 19 — Executive summary + recommendations**.

## Per-sector checklist

For every sector before moving on:

- [ ] File inventory written into the findings doc.
- [ ] Each file read top-to-bottom (or excerpted in defensible
      chunks for >800-line files, with the unread portions noted).
- [ ] Tests scanned for coverage of the sector's contracts.
- [ ] Findings recorded in `AUDIT-2026-05-11.md`.
- [ ] Sector marked done in the audit doc's progress table.

## Definition of done

- Every `src/` directory has at least one finding entry OR an
  explicit "no findings" record.
- Every `electron/` file is covered.
- Every safety-touching file has at least 3 sentences of audit notes,
  not just a "no findings" pass.
- The executive summary lists every Critical and High finding.
- The audit doc is committed to git.
