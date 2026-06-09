# Material Library Recipe Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first pure-core Material Library recipe foundation so LaserForge can capture, validate, and assign reusable layer cut settings without yet adding storage, UI, `.clb` import, or Link behavior.

**Architecture:** Create a small pure module under `src/core/material-library/` that treats a material recipe as the stable subset of `Layer` fields used by preview/save/start output. Recipe assign returns a patch for an existing layer, preserving layer identity and project/session fields.

**Tech Stack:** TypeScript, Vitest, existing `src/core/scene` layer model.

---

## Research Anchors

- Official LightBurn Material Library docs: stores and reapplies Cut Settings presets; Library Window is near the Laser panel in the default layout; Create New from Layer captures the active layer settings; Assign copies settings to the layer; Link is a separate sync/lock workflow; libraries are saved as `.clb`.
- Official LightBurn Cut Settings Editor docs: mode-specific settings include Line, Fill, Image, and shared settings such as Speed and Power.
- Repo research: `audit/reports/lightburn-material-library-research-2026-06-05.md` recommends phased delivery, LaserForge-native deterministic JSON later, Assign before Link, and no preset capture of `id`, `color`, `visible`, or `output`.

## Scope

This slice builds only the recipe model.

In scope:

- Capture a `MaterialRecipe` from a `Layer`.
- Validate recipes from unknown values.
- Normalize/clamp numeric fields used by output.
- Apply a recipe to an existing layer while preserving `id`, `color`, `visible`, and `output`.
- Export the pure module API.

Out of scope:

- UI panel.
- `.lfml.json` serializer/deserializer.
- LightBurn `.clb` import/export.
- Material Library `Link`.
- Device association warnings.
- Store actions, undo/redo, and file picker behavior.

## Files

- Create: `src/core/material-library/material-library.ts`
- Create: `src/core/material-library/material-library.test.ts`
- Create: `src/core/material-library/index.ts`

## Task 1: Red Tests

- [ ] **Step 1: Write failing capture/apply/validation tests**

Add tests that import from `./material-library` and assert:

- `captureMaterialRecipe(layer)` includes backed recipe fields.
- Capture excludes `id`, `color`, `visible`, and `output`.
- Image fields are preserved: `ditherAlgorithm`, `linesPerMm`, `negativeImage`, `passThrough`, `dotWidthCorrectionMm`.
- `applyMaterialRecipe(layer, recipe)` updates recipe fields but preserves `id`, `color`, `visible`, and `output`.
- Validation rejects invalid mode, non-finite numbers, speed <= 0, power outside 0..100, minPower greater than power, and passes < 1.
- Normalization clamps `minPower` to `power` and rounds passes down to an integer minimum of 1.

- [ ] **Step 2: Run red tests**

Run: `corepack pnpm exec vitest run src/core/material-library/material-library.test.ts`

Expected: fails because `src/core/material-library/material-library.ts` does not exist.

## Task 2: Minimal Core Module

- [ ] **Step 1: Implement `material-library.ts`**

Define:

- `MaterialRecipe`
- `MATERIAL_RECIPE_FIELDS`
- `captureMaterialRecipe(layer: Layer): MaterialRecipe`
- `materialRecipePatch(recipe: MaterialRecipe): MaterialRecipe`
- `applyMaterialRecipe(layer: Layer, recipe: MaterialRecipe): Layer`
- `normalizeMaterialRecipe(recipe: MaterialRecipe): MaterialRecipe`
- `isMaterialRecipe(value: unknown): value is MaterialRecipe`

Recipe fields:

- `mode`
- `minPower`
- `power`
- `speed`
- `passes`
- `hatchAngleDeg`
- `hatchSpacingMm`
- `fillOverscanMm`
- `fillBidirectional`
- `fillCrossHatch`
- `ditherAlgorithm`
- `linesPerMm`
- `negativeImage`
- `passThrough`
- `dotWidthCorrectionMm`

- [ ] **Step 2: Add index export**

Export types and functions from `src/core/material-library/index.ts`.

- [ ] **Step 3: Run focused tests**

Run: `corepack pnpm exec vitest run src/core/material-library/material-library.test.ts`

Expected: pass.

## Task 3: Verification

- [ ] **Step 1: Run quality gates**

Run:

- `corepack pnpm run typecheck`
- `corepack pnpm run lint`
- `corepack pnpm run check:file-size`
- `corepack pnpm run format:check`
- `git diff --check`

- [ ] **Step 2: Run full test suite**

Run: `corepack pnpm test`

- [ ] **Step 3: Run production web build**

Run: `corepack pnpm run build:web`

- [ ] **Step 4: Browser smoke**

Use the in-app Browser connector if available. If it is still unavailable, run the established headless Chrome local smoke against the active dev server at `http://127.0.0.1:5176/`.

## Task 4: Commit and Push

- [ ] **Step 1: Audit diff**

Run: `git diff -- src/core/material-library docs/superpowers/plans/2026-06-09-material-library-recipe-foundation.md`

- [ ] **Step 2: Commit exact files**

Commit message: `feat(core): add material library recipe foundation`

- [ ] **Step 3: Push branch**

Run: `git push origin wip/checkpoint-2026-06-03`
