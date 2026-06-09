# Material Library IO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic native `.lfml.json` Material Library IO so LaserForge can safely save, load, validate, and merge reusable material presets before adding UI.

**Architecture:** Keep recipe semantics in `src/core/material-library/`. Add `src/io/material-library/` for file document types, serializer/deserializer, validation, and deterministic merge. Do not add UI, hidden persistence, active-layer state, or Link behavior in this slice.

**Tech Stack:** TypeScript, Vitest, existing pure core MaterialRecipe model, JSON with 2-space LF formatting.

---

## Research Anchors

- Official LightBurn Material Library docs say the library stores reusable Cut Settings presets, Create New from Layer captures active-layer settings, Assign copies preset settings, Link is a different synced/read-only workflow, and Manage Library exposes Load, Save, Save As, Create New, and Merge Library With.
- Official LightBurn docs identify `.clb` as LightBurn's saved library extension, but do not document a stable interchange schema.
- Repo research in `audit/reports/lightburn-material-library-research-2026-06-05.md` recommends a LaserForge-native deterministic JSON foundation first, with `.clb` compatibility deferred until fixture-backed research proves it is safe and legal.

## Scope

In scope:

- `MaterialLibraryDocument` type.
- `MaterialPreset` metadata:
  - `id`
  - `materialName`
  - `thicknessMm` or `title`
  - `description`
  - `recipe`
  - `revision`
- Optional `MaterialLibraryDeviceHint` copied from backed `DeviceProfile` fields.
- Deterministic serializer:
  - JSON
  - two-space indentation
  - LF line endings
  - trailing newline
- Deserializer with structured errors:
  - malformed JSON
  - wrong top-level shape
  - wrong format
  - schema too new / too old
  - invalid entries
  - duplicate IDs
  - invalid recipe
- Deterministic merge:
  - preserve base library metadata
  - append incoming unique presets
  - skip duplicate IDs and report them
- `PROJECT.md` and `DECISIONS.md` scope update so Material Library native IO is no longer contradicted by "storage deferred" wording.

Out of scope:

- UI panel.
- File picker wiring.
- Hidden app-data persistence.
- LightBurn `.clb` parser/writer.
- Assign store action.
- Link metadata or linked-layer sync.
- Device mismatch blocking.

## Files

- Create: `src/io/material-library/material-library-io.ts`
- Create: `src/io/material-library/material-library-io.test.ts`
- Create: `src/io/material-library/index.ts`
- Modify: `PROJECT.md`
- Modify: `DECISIONS.md`
- Create: `docs/superpowers/plans/2026-06-09-material-library-io.md`

## Task 1: Red Tests

- [ ] **Step 1: Write failing tests**

Create `src/io/material-library/material-library-io.test.ts` with tests for:

- deterministic serialization format;
- round-trip deserialize;
- invalid JSON and non-object roots;
- wrong format;
- schema too new / too old;
- invalid preset metadata;
- invalid recipe;
- duplicate IDs;
- device hint capture from `DeviceProfile`;
- merge appends unique entries and reports skipped duplicate IDs.

- [ ] **Step 2: Run red tests**

Run: `corepack pnpm exec vitest run src/io/material-library/material-library-io.test.ts`

Expected: fail because `src/io/material-library/material-library-io.ts` does not exist.

## Task 2: Implementation

- [ ] **Step 1: Implement IO module**

Define:

- `MATERIAL_LIBRARY_FORMAT = 'laserforge-material-library'`
- `MATERIAL_LIBRARY_SCHEMA_VERSION = 1`
- `MaterialLibraryDocument`
- `MaterialPreset`
- `MaterialLibraryDeviceHint`
- `DeserializeMaterialLibraryResult`
- `MergeMaterialLibrariesResult`
- `createMaterialLibraryDeviceHint(device)`
- `serializeMaterialLibrary(document)`
- `deserializeMaterialLibrary(jsonText)`
- `mergeMaterialLibraries(base, incoming)`

- [ ] **Step 2: Validate by construction**

Deserializer must assemble a typed document from validated fields rather than returning a broad cast.

- [ ] **Step 3: Export the IO module**

Add `src/io/material-library/index.ts`.

- [ ] **Step 4: Run focused tests**

Run: `corepack pnpm exec vitest run src/io/material-library/material-library-io.test.ts`

Expected: pass.

## Task 3: Scope Docs

- [ ] **Step 1: Update `PROJECT.md`**

Change Phase F.5 and Out-of-scope wording so it says native Material Library IO foundation is scoped, while full UI, linked presets, manufacturer profiles, hidden persistence, and `.clb` compatibility remain out of scope.

- [ ] **Step 2: Add ADR-045 to `DECISIONS.md`**

Record native `.lfml.json` IO as the accepted foundation and explicitly defer `.clb` compatibility and Link.

## Task 4: Verification

- [ ] **Step 1: Run quality gates**

- `corepack pnpm run typecheck`
- `corepack pnpm run lint`
- `corepack pnpm run check:file-size`
- `corepack pnpm run format:check`
- `git diff --check`

- [ ] **Step 2: Run full tests**

Run: `corepack pnpm test`

- [ ] **Step 3: Run production build**

Run: `corepack pnpm run build:web`

- [ ] **Step 4: Browser smoke**

Use the in-app Browser connector if available. If it is unavailable, run headless Chrome against `http://127.0.0.1:5176/`.

## Task 5: Commit And Push

- [ ] **Step 1: Audit diff scope**

Expected files:

- `src/io/material-library/*`
- `PROJECT.md`
- `DECISIONS.md`
- this plan file

- [ ] **Step 2: Commit**

Commit message: `feat(io): add material library document format`

- [ ] **Step 3: Push**

Run: `git push origin wip/checkpoint-2026-06-03`
