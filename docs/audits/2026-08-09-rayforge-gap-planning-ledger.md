# CurveDesk RayForge gap planning ledger

**Date:** 2026-08-09

**CurveDesk planning baseline:** `origin/main` at `71cf83221a951bd7487e151d83c38eab90be116b`

**RayForge comparison baseline:** separate study checkout at `528fa402678318330e05a244302164dffa10e510`

**Status:** planning only; no listed scope is adopted and no implementation is authorized

**Worktree note:** the visible `claude/vcarve-stamp-subcell` worktree is dirty and divergent; its pre-existing changes are not part of this ledger

## Executive decision

RayForge remains study material, not implementation authority. CurveDesk will not copy its source,
data structures, tolerances, tests, or execution model. Each accepted feature must be designed from
CurveDesk requirements, current primary specifications, and public mathematics.

Detailed planning changes the delivery order from the original feature-priority table:

1. ship isolated, low-risk foundations before a general solver or new controller dimension;
2. keep only one implementation slice active at a time;
3. complete tests, exact-diff audit, evidence labels, and a focused PR before advancing;
4. treat executable addons, cloud AI, generic network endpoints, and unframed lifecycle G-code as
   rejected designs rather than presumed parity work; and
5. reopen every plan against current `main` before implementation because this ledger is deferred
   planning, not a standing change authorization.

## Evidence language

- **SOURCE-CONFIRMED:** behavior read from the named CurveDesk source at the pinned baseline.
- **TEST-DEFINED:** a committed test expresses the contract; it was inspected, not rerun here.
- **PLANNED:** a CurveDesk-native design exists below but no code has been written.
- **RESEARCH REQUIRED:** primary specifications, licensing, dependency, corpus, or hardware evidence
  must exist before design freeze.
- **HARDWARE-ONLY:** only a controlled physical qualification can establish the claim.

## Program-wide contracts

1. **Frame remains the only Start guard.** No plan may add a block, refusal, confirmation, cap,
   clamp, delay, hide, disable, rewrite, or new warning surface. Policy concerns belong in the one
   Job Review; only factual transport, compile-integrity, and exact-handoff failures remain refusals
   (`CLAUDE.md:23-35`, `PROJECT.md:388`).
2. **One exact output authority.** Preview, estimate, Save, Frame, Start, recovery, and resume must
   consume the same prepared artifact. New transforms cannot mutate bytes after review or Frame.
3. **Defaults stay byte-identical.** Every opt-in feature needs a disabled/default snapshot proving
   existing emitted bytes and ordinary workflows are unchanged.
4. **Offline first.** No application data service, account, telemetry, entitlement, remote registry,
   or cloud model is introduced (`PROJECT.md:432-434`).
5. **Immutable project model.** New editor UX extends immutable values and scoped histories; it does
   not replace the Project with a mutable callback tree.
6. **Clean-room only.** RayForge may identify a workflow gap. It does not supply implementation
   code, tolerances, schemas, or tests.
7. **Large inputs warn, not gate.** Size and complexity budgets drive worker architecture and
   advisories. Actual parser/resource failure may fail factually; thresholds do not refuse import.
8. **Evidence stays separated.** Unit/simulator results never become controller, installer, camera,
   burn, rotary, or CNC hardware claims.

## Adoption decisions

| # | Capability | Decision | Relative effort |
|---:|---|---|---|
| 1 | Parametric sketch round-trip and constraints | Adopt in staged clean-room form after DS-9/DS-7 prerequisites | XL |
| 2 | Localization | Adopt incrementally; first major program | L |
| 2b | Linux desktop packaging | Defer until Preview governance and a real-OS matrix are funded | XL |
| 3 | Manual tabs and typed laser postprocessors | Adopt as separate ordered slices | M–XL |
| 4 | DXF export | Adopt | M |
| 4b | PDF import | Research dependency/security first, then adopt in stages | XL |
| 4c | Ruida `.rd` import | Defer until an independent corpus and opcode provenance exist | XL |
| 5 | Live network transports | Reject generic endpoints; defer one fixed protocol at a time | XL |
| 6 | Per-operation WCS and true fourth axis | Defer as two separate machine-specific programs | XL |
| 7 | Editable dialects, macros, and hooks | Consider typed declarative profiles; reject executable hooks/macros | L–XL |
| 8 | Addon ecosystem | Adopt local declarative Data Packs; reject executable addons/remote registry | M |
| 9 | Named transactional history UX | Adopt while retaining immutable snapshots | M/L |
| 10 | Point-rotation arrays | Adopt first as the smallest isolated feature slice | S |
| 11 | Per-operation laser-head selection | Defer until one automatically selectable machine is specified | XL |
| 12 | Maintenance counters | Adopt as an offline, warning-only ledger | M |
| 13 | AI SVG/sketch generation | Reject cloud/API AI; defer local AI pending a verified model/runtime/license | XL/unknown |

## Recommended single-slice delivery queue

Only one numbered item may be implementation-active. A later item does not start because an earlier
PR was opened; it starts only after verification, independent diff audit, and final disposition.

1. Point-rotation arrays.
2. Offline maintenance ledger.
3. Localization catalog, pseudo-locale, and byte-equivalence harness.
4. Named immutable project-history entries and save checkpoint.
5. Local declarative Data Packs.
6. DXF export.
7. Manual/cardinal/equidistant laser tab placement.
8. Fixed typed postprocessor ordering, then crop, exact-overlap deduplication, shrink-wrap,
   smoothing, and powered leads as separate PRs.
9. PDF import after dependency/security approval.
10. Linux Preview packaging after its support matrix and governance decision.
11. Ruida import after independent evidence exists.
12. One named network transport after a controller owner and hardware fixture exist.
13. Machine-specific multi-head research, then per-operation head selection only for a named
    automatically switching machine.
14. Project-level WCS research, per-operation WCS, and true fourth axis as separate programs.
15. Native SketchShape round-trip, local driving dimensions, then the clean-room constraint solver.
16. Typed declarative dialect profiles; executable macros/hooks remain rejected.
17. Local AI only if the current policy is revised and one offline package passes its evidence gate.

## Plan 1 — Native parametric sketches and constraints

**Current foundation:** Design Studio already has an immutable sketch model and local snapshot
history (`src/core/design/sketch-entity.ts:17`, `src/ui/design-studio/design-history.ts:18`). Native
round-trip is already planned as DS-9 (`PROJECT.md:316`). The current decision rejects a general
solver, so a new ADR must explicitly amend that choice (`DECISIONS.md:13855`).

### Slices

1. **DS-9 carrier proof:** specify one `SketchShape` that stores the complete immutable sketch and
   deterministic materialized paths per Design layer. Prove operation identities survive re-edit.
2. **Native round-trip:** add a `kind: 'sketch'` ShapeSpec arm, nested validation, save/reopen,
   transform rules, and legacy project compatibility. Downstream compilation continues consuming
   materialized ordinary paths.
3. **DS-7 local dimensions:** drive line length, rectangle width/height, and circle radius/diameter
   without a general solver.
4. **Constraint model:** stable entity-feature references plus immutable constraint/dimension
   collections; deletion removes dependent relations in the same undo transaction.
5. **Exact local relations:** coincident, horizontal, and vertical before coupled numerical work.
6. **Numerical foundation:** extract the existing deterministic Levenberg–Marquardt kernel from
   `src/core/camera/levmar.ts:1-90` into neutral numerics without changing camera behavior. Specify
   underconstrained/rank behavior before Design Studio consumes it.
7. **Coupled relations:** distance, equal length/radius, parallel, perpendicular, angle,
   concentric, and tangent, solved by connected component.
8. **Diagnostics and interaction:** DOF, residual/satisfied state, inferred constraints, editing,
   selection/deletion, and one history entry per gesture. Diagnostics stay inside Design Studio and
   never gate Apply, save, preview, Frame, Start, or output.

### Acceptance

- Apply → save → reload → reopen restores entity IDs, construction flags, layers, constraints, and
  operation bindings exactly.
- A no-edit round-trip retains byte-identical materialized paths and G-code.
- Loading never auto-solves or changes saved geometry; solver-version changes take effect only
  after an explicit edit.
- Underconstrained sketches remain editable; singular/overconstrained cases terminate with finite
  diagnostics; entity-order permutations produce equivalent geometry.
- Legacy projects load unchanged and malformed nested sketch data fails at the existing document
  integrity boundary.

## Plan 2 — Localization and Linux distribution

### Localization slices

1. Add a bundled typed English catalog, stable message keys, parameter formatting, local preference,
   and deterministic English fallback. Do not select a dependency until ADR-017 research is done.
2. Add pseudo-localization, missing-key CI, keyboard/a11y coverage, overflow fixtures, and a harness
   proving identical projects produce identical programs and Frame signatures in every locale.
3. Migrate non-critical shell/editor sectors one at a time.
4. Migrate Job Review, transport, recovery, and machine-state language only with bilingual semantic
   review. Persisted identifiers, enum values, parser tokens, and G-code remain locale-neutral.

### Linux slices

1. Approve supported distributions, package format, Electron sandbox, serial permissions, camera,
   and media behavior from current primary documentation. Linux desktop is currently out of scope
   (`PROJECT.md:583`).
2. Produce an unpublished CI artifact and run startup/offline smoke tests.
3. Qualify file dialogs, serial enumeration/connection, recovery, camera, and representative
   hardware on real supported installations.
4. Extend exact asset allowlists, manifests, checksums, SBOM, provenance attestations, and
   downloaded-release verification before any Preview tag.

### Acceptance

- Locale changes affect presentation only; missing translations visibly fall back to reviewed
  English.
- Linux artifacts are exact-tag, immutable, independently downloadable/verifiable, and labeled
  Preview until real-OS qualification exists.
- CI packaging is never reported as real Linux serial/camera/controller proof.

## Plan 3 — Laser tabs and fixed postprocessors

**Current foundation:** automatic equidistant hard-skip tabs, Follow Shape inward offsets,
multipass, kerf, overscan, scan correction, and deterministic path optimization already exist
(`src/core/geometry/tabs-bridges.ts:24-86`, `src/core/job/offset-fill.ts:5-47`,
`src/core/scene/layer.ts:21-48`). Those existing capabilities do not receive duplicate tickets.

### Ordered slices

1. Define one fixed compile-stage order and fixture matrix. No plugin graph.
2. Add `equidistant | cardinal | manual` tab placement. Persist normalized manual anchors against
   stable object/path identity; cardinal anchors use deterministic N/E/S/W extrema; old defaults
   remain byte-identical.
3. Add optional laser stock and operator-selected crop-to-stock. It is a transform, never an
   automatic bounds guard. Preserve tool-off runways in the full motion envelope.
4. Add exact whole-contour deduplication, then same-operation collinear partial-overlap union.
   Never merge across different power, speed, pass, air, source, or protected tab boundaries.
5. Add shrink-wrap as a non-destructive generated vector object using the existing geometry kernel;
   define open-path capture width, closing radius, clearance, exterior-ring, and hole policy first.
6. Generalize compile-only smoothing with maximum deviation, target segment length, and pinned
   corner angle. Rejected fairing retains the original contour and reports a diagnostic.
7. Add powered laser lead-in/out only after ordering is stable. Keep it distinct from existing
   tool-off feed-matched runways; define waste side, line/arc form, tangent, kerf, tabs, crop, and
   neighboring-part behavior.
8. Determine whether RayForge “wavefront” is already CurveDesk Follow Shape. If yes, close with
   naming/help/fixtures. A different adaptive front requires a new topology and termination contract.

### Acceptance

- Old tab/default output remains byte-identical; manual anchors survive transforms, undo, save, and
  reopen; preview gaps register with emitted gaps.
- A pipeline-order golden covers smoothing → kerf → overlap → tabs → leads → placement → crop →
  optimization.
- Crop, overlap, shrink-wrap, smoothing, and leads each have topology/property fixtures plus
  perceptual inspection.
- Retention, scorching, chatter, edge finish, and lead quality remain HARDWARE-ONLY until controlled
  air-cuts/burns exist.

## Plan 4 — DXF export, PDF import, and Ruida import

### DXF export — adopt first

1. Research and pin the exact DXF revision/entity subset from the primary specification.
2. Add a pure deterministic ASCII writer under `src/io/dxf`; materialize transforms, invert the
   existing Y-down import normalization, declare units, and use deterministic layer naming.
3. Emit verified native line/circle/arc/ellipse entities and a tolerance-declared polyline fallback
   for unsupported canonical curves.
4. Add selection/all-artwork save actions and export → re-import fixtures.

Acceptance includes locale-independent repeated byte output, transforms/mirrors, closed seams,
multiple operation colors, Unicode normalization, empty scope, large-scene advisory, and geometry
equivalence within the declared tolerance.

### PDF import — research, then staged adoption

1. Complete dependency/license/security evaluation; PDF is currently out of scope
   (`PROJECT.md:598-599`).
2. Add worker parsing, progress/cancel, metadata and page selection while preserving MediaBox,
   CropBox, rotation, clipping, and unsupported-operator diagnostics.
3. Add faithful vector operators and outlined text where supported.
4. Add embedded raster/image operators and page compositing.
5. Never silently truncate; actual malformed/encrypted/resource failures report exact facts, while
   input size/object count remain advisories.

### Ruida `.rd` import — evidence-gated

1. Do not reuse the test decoder as production truth. Obtain independently sourced files and opcode
   provenance; own encoder round-trips are secondary fixtures only.
2. Add a bounded binary tokenizer/parser with byte-offset errors and no guessed resynchronization.
3. Recover only evidenced vector motion/layers/settings and report unknown commands explicitly.
4. Add worker progress/cancel. Raster recovery waits for independent evidence.

No import plan proves original design fidelity, controller execution, or physical output.

## Plan 5 — Live network transports

**Decision:** reject generic TCP/UDP/WebSocket endpoints. Consider one fixed controller/protocol only
after an ADR, current primary documentation, a named owner, and a physical fixture. Current platform
and controller seams are serial/file-only (`src/platform/types.ts:36-81`,
`src/core/controllers/controller-capabilities.ts:33-46`).

1. Generalize the platform boundary to a discriminated machine connection while keeping serial
   transcripts byte-identical.
2. Add a desktop-only fixed-purpose adapter; renderer code receives no unrestricted socket access.
3. Bind protocol, endpoint/device identity, session epoch, exact artifact, and Frame permit.
4. Carry already-materialized bytes only; the transport cannot compile, normalize, inject, or
   ambiguously retry.
5. Test loss, duplication, reordering, delayed ACKs, disconnect/reconnect, stale sessions, abort,
   and competing sender ownership before bench/hardware qualification.
6. Evaluate GRBL/Smoothie Telnet, OctoPrint, and Ruida UDP as separate projects, not one “network
   support” feature. Ruida remains file-only until its lane qualifies.

## Plan 6 — WCS and true fourth axis

These are separate projects. Current output intentionally normalizes to G54 and rotary substitutes
surface Y (`src/core/output/grbl-strategy.ts:75-94`, `src/core/devices/rotary.ts:1-62`).

### WCS

1. Define one concrete multi-fixture workflow and whole-job Frame semantics.
2. Start with explicit project-level G54 default, then persisted per-operation WCS and ordered
   transitions in Job IR.
3. Bind fresh readback for every referenced WCS to the exact artifact and Frame permit.
4. Require one faithful Frame of the complete multi-WCS job. If that cannot be produced, reject the
   feature rather than adding per-WCS Start gates.

### Fourth axis

1. Select exact hardware/controller/firmware and verify axis letter, units, interpolation, homing,
   limits, and modal behavior from primary documentation.
2. Add explicit axis topology and coordinates to device capability and Job IR; never overload Y.
3. Carry the axis through bounds, preview, timing, parser, executable artifact, Frame signature,
   recovery, and resume.
4. Qualify export/simulator first, then controller transcript, air-cut, and loaded hardware.

G54-only and disabled-rotary defaults must remain byte-identical. No stage may silently drop A/B/C.

## Plan 7 — Declarative dialect profiles; no executable hooks

1. Define a versioned declarative profile containing only bounded, already-modeled choices.
2. Parse all customization into typed IR before preview/preflight; no raw callback or post-prepare
   mutation exists.
3. If author-defined commands are ever admitted, they must have modeled semantics and appear as
   visible project operations included in preview, output, Job Review, Frame, recovery, and resume.
4. Bind the canonical profile hash to exact output. Unknown or unmodeled commands cannot become a
   streamable program because the program cannot be constructed faithfully.

Built-in profiles remain byte-identical. Event scripts, hidden lifecycle injection, and arbitrary
raw macros are rejected.

## Plan 8 — Safe extensibility through Data Packs

1. Define canonical, versioned, hashed local Data Packs.
2. Initially allow only data accepted by existing native validators: machine profiles and material
   libraries (`src/io/machine-profile/machine-profile-io.ts:24-109`,
   `src/io/material-library/material-library-io.ts:19-123`).
3. Add manual offline import, contents/diff review, provenance, and explicit copy/apply into local
   state. Applying nothing changes nothing.
4. Pack removal/update never changes resolved values in existing projects; projects reopen without
   the source pack.
5. Later pack kinds require their own schema. No JavaScript, Wasm, Python, emitter, transport,
   command, or lifecycle authority is allowed. Any signature is provenance only, never an import or
   Start guard.

## Plan 9 — Named immutable history

1. Replace session history’s anonymous `Project[]` entries with
   `{ project, revision, descriptor }`, retaining the 50-snapshot bound
   (`src/ui/state/scene-mutations.ts:79`). Descriptors are structured keys so localization can render
   them later.
2. Label a first vertical slice: Array, Duplicate, Delete, transform gesture, Design Apply, and
   Machine Setup.
3. Migrate all `pushUndo` callers and require a descriptor at compile time.
4. Add atomic undo-to/redo-to, applying selection/probe-epoch repair once at the destination.
5. Track the saved revision as a session checkpoint; undoing to it clears dirty state, while
   branching behaves predictably.
6. Add clickable named rows, saved/current markers, and trimmed-history information.

History remains session-only and out of `.lf2`; project serialization and G-code stay byte-identical.

## Plan 10 — Point-rotation arrays

1. Add a transient `PointRotationArraySpec` with `count` and signed `totalAngleDeg`.
2. Emit identity first, followed by overlapping copies rotated around the combined selection center.
3. Add a Point Rotation tab with Copies and Total angle. Apply is one immutable mutation and one
   undo entry; cancel mutates nothing.
4. Add optional live draft/direct manipulation only after the pure mode ships.

Acceptance covers asymmetric single/multi-object selections, count one, positive/negative/partial/
full turns, composition with existing rotation, groups, unique IDs, undo, unchanged grid/circular
fixtures, perceptual rosette inspection, and intentional overlap without deduplication.

## Plan 11 — Per-operation laser-head selection

Defer until one machine with documented automatic head selection, offsets, focus behavior, power
scaling, and interlocks is named. Current device and operation models assume one laser profile and no
head identity (`src/core/devices/device-profile.ts:110-163`, `src/core/scene/layer.ts:21-80`).

1. Add stable device `laserHeads[]` and operation `laserHeadId` only for the selected machine model.
2. Incorporate offsets, focus, maximum S, and material compatibility into compilation, preview,
   bounds, exact output, and the ordered head plan.
3. Emit only modeled transitions and include them in Frame identity and recovery.
4. Preserve byte-identical single-head projects. A missing head fails factual preparation rather
   than silently substituting; manual mid-job swaps are rejected.

## Plan 12 — Offline maintenance ledger

1. Add a local append-only ledger keyed by stable `profileId` and terminal `runId`, separate from
   project files. Existing recovery/timing already supplies bounded terminal records and estimates
   (`src/ui/state/recovery/recovery-model.ts:89-109`, `src/ui/state/live-job-timing.ts:29-115`).
2. Make event insertion idempotent and distinguish completed/interrupted runs.
3. Label wall-clock runtime as observed; label beam/spindle/motion totals as estimates unless live
   controller evidence supports stronger wording.
4. Add operator-defined service intervals and informational reminders in existing UI/Job Review.
   They never disable, delay, confirm, or gate Frame/Start/output.
5. Record service/reset actions as immutable events and support canonical local export/import.

Acceptance covers crash/replay double-counting, rename/import identity, clock anomalies, corruption
isolation, interrupted jobs, offline operation, and zero effect on prepared output.

## Plan 13 — AI SVG/sketch generation

Cloud/API generation is rejected under the current no-application-data-services policy. Local AI
remains deferred until an ADR identifies a specific permissively licensed model, inference runtime,
distribution method, supported hardware, memory budget, and sandbox boundary.

If reopened:

1. import model packages manually with hash, version, license, and provenance; no download service;
2. run prompt/seed work off-thread with cancellation and resource accounting;
3. treat results as untrusted SVG and pass them through the existing sanitizer/importer;
4. insert ordinary editable artwork in one undo action; never assign CAM, machine commands, or Start
   authority automatically; and
5. prove the full workflow succeeds with network access denied and a malicious-SVG corpus.

Until those prerequisites exist, invest in deterministic native sketch/procedural generators.

## Per-slice completion gate

Every implementation slice must end with:

1. governing ADR/PROJECT/WORKFLOW changes where current scope excludes the feature;
2. red-to-green pure tests plus serialization, undo, and malformed-input coverage as applicable;
3. default/disabled exact-byte snapshots and preview/estimate/Save/Frame/Start parity;
4. browser/Electron coverage for any platform-facing UI;
5. perceptual render evidence for geometry/UI changes;
6. simulator, transcript, real-OS, controller, air-cut, and loaded evidence labeled separately;
7. `pnpm release:check` and the relevant E2E/production-scale fixtures;
8. exact-diff audit proving the PR contains only that slice; and
9. a ledger update recording achieved, partial, rejected, or blocked status before the next slice.

## Recommended first action

Write the governing scope/acceptance ADR for the program, then implement **Point-rotation arrays** as
the first isolated PR. It is the smallest confirmed gap, requires no persistence migration or output
pipeline redesign, and establishes the one-slice evidence loop before higher-risk work.
