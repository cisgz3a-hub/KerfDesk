# 2 — The pipeline spine

The chain both machine kinds share, and the exact point where they diverge.

## The chain

```
   import / draw / type / trace
              ↓
          Scene            SceneObject[] + Layer[] + artworkOrder   (persisted truth)
              ↓
     ┌────────┴────────┐   ← THE FORK: project machine kind
     ↓                 ↓
 compileJob      compileCncJob                                      (pure, deterministic)
     ↓                 ↓
   Job = { groups: Group[] }   cut | fill | raster | cnc
     ↓                 ↓
 grblStrategy    cncGrblStrategy                                    (emit → G-code string)
 marlinStrategy
 smoothiewareStrategy
              ↓
        pre-emit invariant scan                                     (refuse before write/stream)
              ↓
     ┌────────┴────────┐
     ↓                 ↓
  save to disk     stream to controller
```

**`Job`, `Plan`, `Output`, and emitted G-code are pure derivations from `Project` and are never
persisted as project truth** (`PROJECT.md:416`). This is the single most important architectural
fact: nothing downstream of the Scene is ever saved, so a reopened project recompiles from
scratch and cannot inherit a stale toolpath.

## Stage 1 — Scene

`SceneObject` is an extensible discriminated union (ADR-014, `DECISIONS.md:441`) with six
variants, verified from the exhaustive switch at `src/core/job/compile-job.ts:331-357`:

`imported-svg` · `text` · `traced-image` · `raster-image` · `shape` · `relief`

Two never produce laser vector segments: `raster-image` routes to the dedicated raster path, and
`relief` is CNC-only — the laser compiler explicitly skips it (`compile-job.ts:352`). Every
switch over the union ends in `assertNever`, so adding a seventh variant is a compile error at
every site rather than a silent no-op.

**Operation binding.** Artwork binds to named operations by explicit `operationIds`, not by
colour (ADR-211, `DECISIONS.md:9013`). Geometry colour is now only *appearance* plus a
schema-v2 migration fallback (`PROJECT.md:412`). This is a deliberate divergence from
LightBurn's colour-is-identity model and a prime cross-reference target.

**Run order** comes from `scene.artworkOrder`, independent of canvas stacking (`PROJECT.md:397`).

## Stage 2 — Compile (the fork)

Both compilers are pure: no clock, no randomness, no I/O. Determinism comes from indexed
iteration over arrays — never `Set`/`Map` iteration order (`compile-job.ts:9-10`).

### Laser: `compileJob(scene, device) → Job`

`src/core/job/compile-job.ts:61`. Walks `artworkOperationRuns(scene)` and, per output operation
layer:

- mode `≠ image` → `compileVectorGroupsForLayer` → `cut` or `fill` groups
- always → `compileRasterGroupsForLayer` → `raster` groups

Per-object power overrides bucket a layer into distinct groups **only when objects actually
disagree** (`compile-job.ts:86-130`), so the common case stays byte-identical to the
no-override path. That "byte-identical unless the feature is actually used" discipline recurs
through every emitter and is what keeps the G-code snapshots stable across feature work.

### CNC: `compileCncJob(scene, device, config) → Job`

`src/core/cnc/compile-cnc-job.ts:55`. Same shape, different ordering guarantee — and the
ordering *is* the safety design (`compile-cnc-job.ts:3-8`):

1. **Pockets and engraves first** — they never free the part.
2. **Profiles last, inner contours before outer** — a part is machined completely before the
   cut that could let it move.

Then `orderGroupsIntoToolSections` (`compile-cnc-job.ts:98`) forms contiguous per-bit sections
with profile-carrying sections last, so a freed part is never re-machined after a tool change.

## Stage 3 — Emit

`OutputStrategy` (`src/core/output/output-strategy.ts:28`) is a two-field contract: an `id`
discriminator and `emit(job, device, options) → string`. Routing is at
`src/core/output/select-output-strategy.ts:15`:

| `controllerKind` | Strategy |
|---|---|
| `marlin` | `marlinStrategy` |
| `smoothieware` | `smoothiewareStrategy` |
| `grbl-v1.1`, `grblhal`, `fluidnc`, `undefined` | `grblStrategy` |
| `ruida` | `grblStrategy` — **preview/estimate only**; Save routes to the binary `io/rd` encoder |

**CNC short-circuits before this table.** `select-output-strategy.ts` never returns
`cncGrblStrategy`; machine-kind CNC dispatches earlier (`output-strategy.ts:31-32`). A `cnc`
group reaching the laser strategy is treated as a pipeline bug and emits a visible marker
comment instead of motion (`grbl-strategy.ts:411-415`) — fail-loud, not fail-silent.

## Stage 4 — Pre-emit refusal

`src/core/preflight/pre-emit.ts` runs the invariant predicates over the *final emitted text*,
not over intermediate structures. Deliberate: the predicates
(`src/core/invariants/predicates.ts:1-11`) are liberal about formatting, so they can validate
G-code from external tools too, and they catch a regression introduced anywhere upstream
because they read what will actually be sent.

**Non-negotiable #4 — no partial output**: pipeline failure writes no file and sends no stream
(`PROJECT.md:306`).

## What is shared vs forked

| Concern | Laser | CNC | Shared? |
|---|---|---|---|
| Scene / SceneObject | ✅ | ✅ | **Shared** |
| Origin transform | ✅ | ✅ | **Shared** — see [03](03-coordinates-and-origin.md) |
| Compile | `compileJob` | `compileCncJob` | Forked |
| Group kinds | cut/fill/raster | cnc | Forked |
| Emitter | `grblStrategy` +2 | `cncGrblStrategy` | Forked |
| Preamble `G21 G90 G54 G94` | ✅ | ✅ | **Same discipline, separate code** |
| Streaming / driver seam | ✅ | ✅ | **Shared** — see [06](06-controllers-and-transport.md) |
| Frame-first Start permit | ✅ | ✅ | **Shared** — see [07](07-frame-permit-model.md) |

The duplicated-but-not-shared preamble is worth noting: both emitters independently emit
`G21 G90 G54 G94`, each with its own comment giving the same rationale
(`grbl-strategy.ts:79-97`, `cnc-grbl-strategy.ts:106-112`) — GRBL's active WCS selection and
feed mode are modal and survive a soft reset, so an unpinned job runs in whatever WCS a console
command or `$N` startup block last left active, and a stale `G93` would reinterpret every feed
as inverse-time.

## Cross-reference slot — Phase 2

1. **Where does LightBurn apply its transform stack?** Ours materializes polylines in machine
   coordinates at compile time. Does LightBurn stay in scene space until emit, and does that
   change how hatch spacing interacts with object rotation?
2. **Operation binding.** LightBurn is colour-as-layer. We moved to explicit operation IDs
   (ADR-211). Does any LightBurn workflow depend on colour identity in a way our model breaks?
3. **Cut ordering.** Do Easel/Carbide put profiles last and inner-before-outer as we do, and do
   they order *across* artwork or only within a single object?
4. **Recompile-on-open.** Do `.lbrn` / Easel projects cache toolpaths? If so, what invalidates
   the cache, and does that expose a case we silently recompute differently?
5. **Preview = output.** ADR-040 (`DECISIONS.md:2190`) claims one shared prepared-output
   pipeline for preview/save/start/estimate. Confirm whether LightBurn's preview is the same
   artifact it sends or a separate re-plan.
