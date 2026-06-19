# Lane 9 Object Locking V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conservative object-locking foundation so locked artwork cannot be selected or transformed by normal workspace tools.

**Architecture:** Store a per-object `locked?: boolean` flag on every `SceneObject` variant and preserve it through `.lf2` IO. V1 uses two commands: `Lock Selection` locks currently selected unlocked objects and clears selection; `Unlock All` clears every locked flag so users cannot trap themselves. Hit-test, marquee, select-all, and store selection helpers skip locked objects.

**Tech Stack:** TypeScript, Zustand store slices, Vitest, React command registry/menu.

---

### Task 1: Core Model And IO

**Files:**
- Modify: `src/core/scene/scene-object.ts`
- Modify: `src/core/scene/hit-test.ts`
- Modify: `src/core/scene/hit-test.test.ts`
- Modify: `src/io/project/project-shape-validator.ts`
- Add: `src/io/project/project-object-locking.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that locked objects round-trip, invalid `locked` values are rejected, and `hitTest` ignores a locked top object to reach the unlocked object beneath it.

- [ ] **Step 2: Run red tests**

Run:

```bash
pnpm test --run src/core/scene/hit-test.test.ts src/io/project/project-object-locking.test.ts
```

Expected: fail because `locked` is not part of the model/validator yet and hit-test still returns locked objects.

- [ ] **Step 3: Implement minimal model**

Add `readonly locked?: boolean` to the shared scene object metadata, export no new runtime behavior except the optional flag, teach the project validator to accept only boolean `locked`, and skip locked objects in `hitTest`.

- [ ] **Step 4: Run green tests**

Run the same focused command and expect all tests to pass.

### Task 2: Store Lock Actions And Selection Guards

**Files:**
- Add: `src/ui/state/scene-lock-actions.ts`
- Add: `src/ui/state/scene-lock-actions.test.ts`
- Modify: `src/ui/state/store.ts`
- Modify: `src/ui/state/store-actions.ts`
- Modify: `src/ui/workspace/selection-marquee.ts`
- Modify: `src/ui/workspace/selection-marquee.test.ts`
- Modify: `src/ui/state/selection-transform-actions.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving lock selection is undoable, clears selection, select-all skips locked objects, marquee skips locked objects, selection by id ignores locked objects, unlock all is undoable, and stale transform edits do not move locked objects.

- [ ] **Step 2: Run red tests**

Run:

```bash
pnpm test --run src/ui/state/scene-lock-actions.test.ts src/ui/state/store-select-objects.test.ts src/ui/workspace/selection-marquee.test.ts src/ui/state/selection-transform-actions.test.ts
```

Expected: fail because the store actions and locked-object filters do not exist.

- [ ] **Step 3: Implement minimal store behavior**

Add `lockSelection()` and `unlockAllObjects()` store actions. Update `selectObject`, `toggleSelectObject`, `selectAllObjects`, `selectObjects`, marquee selection, and transform application to ignore objects with `locked === true`.

- [ ] **Step 4: Run green tests**

Run the same focused command and expect all tests to pass.

### Task 3: Command Surface

**Files:**
- Modify: `src/ui/commands/command-types.ts`
- Modify: `src/ui/commands/edit-command-family.ts`
- Modify: `src/ui/commands/use-app-commands.ts`
- Modify: `src/ui/commands/command-registry.test.ts`
- Modify: `src/ui/help/command-help-topics.ts`
- Modify: `src/ui/help/help-topics.test.ts`
- Modify: `src/ui/app/shortcuts.test.ts`

- [ ] **Step 1: Write failing tests**

Add command registry tests for disabled/enabled `Lock Selection` and `Unlock All`, and help-topic coverage for both command ids.

- [ ] **Step 2: Run red tests**

Run:

```bash
pnpm test --run src/ui/commands/command-registry.test.ts src/ui/help/help-topics.test.ts
```

Expected: fail because the command ids and context fields do not exist.

- [ ] **Step 3: Implement minimal command wiring**

Add `edit.lock-selection` and `edit.unlock-all` without keyboard shortcuts. Wire `canLockSelection`, `hasLockedObjects`, `lockSelection`, and `unlockAllObjects` through `useAppCommands`.

- [ ] **Step 4: Run green tests**

Run the same focused command and expect all tests to pass.

### Task 4: Docs And Verification

**Files:**
- Modify: `WORKFLOW.md`

- [ ] **Step 1: Update workflow truth**

Change the stale marquee section from “NOT YET IMPLEMENTED” to shipped behavior, and replace the old “Phase A has no layer locking” line with the V1 object-locking behavior.

- [ ] **Step 2: Run full gates**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build:web
pnpm check:file-size
```

Expected: all pass; lint may still show the existing boundaries selector warning.

- [ ] **Step 3: Browser smoke**

Open the local app, confirm the Edit menu shows `Lock Selection` disabled with no selection and `Unlock All` disabled with no locked objects.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-19-lane-9-object-locking-v1.md WORKFLOW.md src
git commit -m "feat: add object locking actions"
```
