# Rolling audit — project persistence (.lf2 load/save round-trip)

- **When:** 2026-07-17 05:50 (+08)
- **Tree:** `6f4c5a89` on the audit branch (files identical to main at audit time)
- **Scope:** `src/io/project/{deserialize-project,serialize-project,migrations,prepare-project-persistence,persistence-semantic-integrity,normalize-layer}.ts` + validator coverage cross-checks (`project-shape-validator.ts`) and consumer traces into `src/core/cnc` and `src/core/job/planner.ts`.
- **Method:** static read with consumer tracing. **Not verified:** no runtime repro executed this iteration (unlike iter 3); the UI open/save drivers (`src/ui/app/file-actions.ts`) were not audited.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P2-1 — `machine.tools` crosses the load boundary under-validated and reaches CNC compile + v-carve math; the same values then poison Save

`validateProjectShape` does not cover the `machine` subtree at all (grep: no `machine`/`tools` references in `project-shape-validator.ts`), so `normalizeMachineValue` is the only gate — and it rebuilds stock/params/tiling field-by-field with finite guards, but `normalizeCncTools` ([deserialize-project.ts:204-215](../../src/io/project/deserialize-project.ts)) accepts a tool on just `id`/`name` string checks plus `diameterMm > 0` **without `Number.isFinite`**:

- **`diameterMm: 1e999`** in a `.lf2` parses to `Infinity`, passes `> 0`, and flows into every CNC offset/stepover computation (`compile-cnc-job.ts:153,193,214,224`, `adaptive-pocket-operation.ts:39-43`, `cnc-rest-operation.ts:41-46`). The module's own comments treat exactly this `1e999` vector as the threat model (`positiveNumberOrDefault`, [deserialize-project.ts:311-315](../../src/io/project/deserialize-project.ts)) — tools are the one place it isn't applied.
- **`tipAngleDeg` is not validated at all** — any type or value rides through. `vcarve-clearance.ts:38-42` guards `> 0` but not finiteness, so `tipAngleDeg: Infinity` yields `Math.tan(Infinity) → NaN` clamp insets; `vcarve-ladder.ts:102` applies only `?? FALLBACK`, so junk values flow into ladder depth math.
- **`kind` is not validated** — a string outside the `CncToolKind` union (`machine.ts:11`) loads into a field typed as that union.

Save-side consequence (traced, not run): `JSON.stringify(Infinity)` emits `null`, so the pre-save round-trip in `prepareProjectForPersistence` deserializes a *different* tool list (the `typeof === 'number'` filter drops the tool), the semantic-drift check flags `machine` and **blocks Save** with "saving would change `machine…` during validation; repair or reload" ([prepare-project-persistence.ts:27-33](../../src/io/project/prepare-project-persistence.ts)). So a corrupt tool entry both produces degenerate toolpaths *and* locks the operator out of saving, with a message that doesn't point at the tool.

Contrast that makes this a gap rather than a policy: per-layer CNC cut settings (feeds, plunge, rpm, depths, tabs) are all finite-guarded via `positiveOr` ([normalize-layer.ts:55-67,143](../../src/io/project/normalize-layer.ts)).

Fix direction: validate tools with the same field-by-field rebuild as stock/params — finite positive `diameterMm`, optional finite positive `tipAngleDeg` (perhaps ≤ 180), `kind` from the known union — dropping to defaults otherwise.

---

## P3-2 — `numberOrDefault` lacks the finiteness guard every sibling has (latent trap)

[deserialize-project.ts:289-291](../../src/io/project/deserialize-project.ts): `typeof value === 'number' ? value : fallback` accepts `Infinity`. It is currently shielded — its only two users (`accelMmPerSec2`, `junctionDeviationMm`) are checked earlier by the shape validator's `optionalPositiveNumber` ([project-shape-validator.ts:92-93](../../src/io/project/project-shape-validator.ts)), and the planner additionally self-defends (`Math.max(1, device.accelMmPerSec2)`, [planner.ts:62](../../src/core/job/planner.ts)). But the helper's name invites use on the next validator-uncovered field, where it would silently pass `Infinity`. One-line hardening (add `Number.isFinite`) removes the trap.

---

## P3-3 — the v1→v2 migration synthesizes a `{0,0}` curve start for an empty polyline

`rawPolylineToCurve` maps a zero-point legacy polyline to `{ start: {x:0,y:0}, segments: [], closed }` ([migrations.ts:55](../../src/io/project/migrations.ts)) — inventing a coordinate the source file never contained instead of dropping the empty polyline. Whether the post-migration validators accept such a degenerate curve was not verified; if they do, a legacy file with an empty polyline gains a phantom point at the origin. Legacy-schema-only exposure, hence P3.

---

## Verified clean (checked, no finding)

- **Boundary ordering is right:** migrate → `validateProjectShape` → normalize ([deserialize-project.ts:61-84](../../src/io/project/deserialize-project.ts)); migrated legacy content passes through full validation before normalization trusts it.
- **Schema gating both directions** (`schema-too-new` / `schema-too-old` with structured results), non-finite `schemaVersion` rejected.
- **The save path is a genuine data-loss defense:** serialize → full re-deserialize → re-serialize → semantic drift comparison, refusing any save that validation would mutate ([prepare-project-persistence.ts](../../src/io/project/prepare-project-persistence.ts)); only `scene.groups` is excluded from drift, documented as structural-only.
- **Stock, params, tiling, device fields** are rebuilt with finite/positive guards and clear "1e999 → Infinity" threat-model comments; half-valid tiling drops the whole block rather than splitting a job wrong ([deserialize-project.ts:163-187](../../src/io/project/deserialize-project.ts)).
- **Controller sanitization (ADR-094):** unknown `controllerKind`/non-positive baud are dropped to defaults so `selectControllerDriver`'s exhaustive switch can't see junk ([deserialize-project.ts:260-270](../../src/io/project/deserialize-project.ts)).
- **Deterministic serialization** claim is sound (insertion-order JSON, 2-space, LF, trailing newline; curves backfilled on legacy paths at save, [serialize-project.ts](../../src/io/project/serialize-project.ts)).
- **Legacy `reduceTravelMoves` → `travelPolicy` mapping** preserves both directions and keeps the two fields consistent ([deserialize-project.ts:331-357](../../src/io/project/deserialize-project.ts)).

## Not verified

- No runtime repro was executed for P2-1 (consequences traced by code reading; what clipper offsetting actually emits for an Infinity diameter — empty toolpaths vs NaN — is unconfirmed).
- `src/ui/app/file-actions.ts` (open/save drivers, overwrite prompts, dirty tracking) and `.lf2` embedded-font/variable validators were not audited — future iteration.
