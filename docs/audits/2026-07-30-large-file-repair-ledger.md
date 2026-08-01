# Large-file repair program — implementation and audit ledger

**Date:** 2026-07-30
**Branch:** `codex/large-file-repair`
**Base:** `e3ace9928163fcd696d074c9f0a54024f8215948` (`origin/main`, PR #525 merge)
**Publication:** draft PR #527, initially published at commit `fb4f92f5`; corrective work remains
in the same review PR. No merge, deployment, or hardware operation.

This ledger records each repair only after its focused tests and audit complete. “Worker-backed”
means CPU work is moved off the browser UI thread. It does **not** mean streaming or
memory-bounded parsing unless the entry separately proves that property.

## Step 1 — production G-code Inspector and 2D Preview

**Status:** completed and audited.

### Repair

- File-open and drag/drop now hand the selected `Blob` to the Inspector instead of calling
  `text()` on the UI thread.
- The modal Inspector and main-canvas G-code view build their render model in a dedicated
  production module worker. Environments without `Worker` retain a synchronous test fallback.
- The existing import worker parses the 2D simulator toolpath. File-backed requests carry the
  `Blob`; compiled in-memory programs are wrapped for the worker because their string already
  exists as compiler output.
- The 3D render payload and source pane retain every parsed segment and source line.
- The 2D simulator retains every parsed toolpath step.
- Above 250,000 render items, both preview surfaces display the exact count and an advisory that
  drawing may use substantial memory or respond slowly. The advisory does not cap or alter data.

### Focused verification

- Red test: `pnpm test -- src/core/gcode-view/gcode-render-model.test.ts` failed because the new
  `renderSegmentLimit` expectation observed all three segments.
- Red test: `pnpm test -- src/ui/app/gcode-2d-preview-limit.test.ts` failed because the
  display-prefix module did not yet exist.
- Focused suite: 6 files / 33 tests passed, covering the core display limit, worker client,
  Inspector UI, file picker, drag/drop, and 2D prefix.
- `pnpm run typecheck` passed.
- `pnpm run lint` passed.
- Focused Prettier check passed.
- `pnpm run build:web` passed and emitted
  `dist/web/assets/gcode-inspector-worker-DZSRw1s5.js` plus the existing import worker.

### Audit

- **Confirmed:** production file-backed Inspector paths no longer call whole-file `text()` or
  `buildGcodeRenderModel` on the UI thread.
- **Confirmed:** production 2D file Preview parsing uses `parseGcodeOffThread`; the UI-thread
  parser remains only as the explicit no-Worker fallback.
- **Superseded by the final guard audit:** the initial retained-prefix implementation was a preview
  cap prohibited by the repository's frame-only-guard rule. The draft PR now retains every item
  and uses a non-blocking pressure advisory instead.
- **Not established:** the workers still materialize the complete Blob as text. Step 1 is
  off-thread, not streaming and not memory-bounded.
- **Not established:** real browser worker execution and very-large fixture behavior remain for
  Step 5. Current worker-client coverage uses a stub; the production build proves bundling only.
- **No hardware claim:** no controller, firmware, setting, machine command, air-cut, or physical
  output was touched.

## Step 2 — STL worker preparation and typed live mesh

**Status:** completed and audited.

### Repair

- The import worker now performs both STL parsing and the coarse
  `meshToHeightmap` validation/aspect-ratio probe.
- The worker-produced `Float32Array` becomes the live relief object's `meshPositions`; the
  UI-thread import action no longer calls `meshToHeightmap` or expands the mesh with
  `Array.from`.
- Relief consumers recognize an already-typed mesh and reuse its buffer rather than allocating a
  second `Float32Array`.
- `.lf2` remains JSON-compatible. `serializeProject` converts a typed live mesh to the existing
  number-array schema at the persistence boundary; reopening returns the established project
  shape.

### Focused verification

- Red test: `pnpm test -- src/ui/import/stl-import-preparation.test.ts` failed before the worker
  preparation module existed.
- Red test: the typed-mesh case in `project-relief.test.ts` failed validation before serialization
  normalized the live typed array.
- Focused suite: 5 files / 31 tests passed, covering worker routing, preparation, buffer reuse,
  dense-relief persistence, save/reopen shape, and import advisories.
- `pnpm run typecheck`, `pnpm run lint`, focused Prettier, `git diff --check`, and
  `pnpm run build:web` passed. The production import worker emitted as
  `dist/web/assets/import-worker-BC3d406U.js`.

### Audit

- **Confirmed:** no `meshToHeightmap` or `Array.from` remains in the UI-thread STL import action.
- **Confirmed:** the live imported relief keeps the worker's typed mesh and existing downstream
  consumers can reuse it without conversion.
- **Confirmed:** a typed relief serializes and reopens as the same established `.lf2` relief
  geometry; the on-disk schema did not change.
- **Remaining cost:** manual save/autosave must still serialize the embedded mesh as JSON numbers.
  That persistence cost is not hidden and is not claimed memory-bounded.
- **Remaining duplication:** the worker response is structured-cloned today. Transfer-list
  ownership and worker-retirement cleanup belong to Step 3.
- **No hardware claim:** no controller, firmware, setting, machine command, air-cut, or physical
  output was touched.

## Step 3 — worker transfer and retention protocol

**Status:** completed and audited within the current architecture.

### Repair

- The Inspector worker posts all eight typed render/accountability buffers with a transfer list.
  Ownership moves to the UI instead of allocating cloned copies.
- The render-model pass now consumes the line iterator directly and grows only its compact
  `Uint8Array` accountability buffer. It no longer expands the complete program into an
  additional array of per-line strings inside the worker.
- The import worker transfers ownership of a successfully prepared STL mesh buffer.
- Transfer lists are derived by pure helpers, deduplicated, and empty for parse errors and
  non-transferable object-graph results.

### Focused verification

- Red tests: the two transfer-helper suites failed before their modules existed.
- Red test: the line-category builder suite failed before the growable typed builder existed.
- Focused suite: 4 files / 13 tests passed, covering Inspector buffers, STL ownership transfer,
  object-graph exclusions, and both worker clients.
- Focused render/accountability suite: 2 files / 13 tests passed, including the 600,001-line
  program case and exact category parity after removing the all-lines string array.
- `pnpm run typecheck`, `pnpm run lint`, focused Prettier, and `pnpm run build:web` passed.
  Both worker chunks were emitted after transfer-list wiring.

### Audit

- **Confirmed:** the largest typed results introduced by Steps 1–2 no longer exist
  simultaneously in worker and UI heaps after delivery.
- **Confirmed:** pending maps delete each request before resolving it; worker request-local Blob,
  text, and result references become unreachable after response delivery.
- **Confirmed:** Inspector render parsing is now line-oriented over the already-materialized
  worker text and retains one byte of category data per observed line rather than a second array
  of line strings.
- **Unchanged by design:** Blob inputs remain structured-cloned into workers; the UI does not
  materialize a second byte/text copy before posting them.
- **Not transferable:** DXF scene objects and 2D G-code `Toolpath` results are nested JavaScript
  object graphs. They still structured-clone. Replacing those domain models with packed typed
  protocols would be a separate architectural rewrite.
- **No streaming claim:** DXF and G-code workers still call `Blob.text()`, and STL still calls
  `Blob.arrayBuffer()`. Peak input memory is not proven bounded.
- **No hardware claim:** no controller, firmware, setting, machine command, air-cut, or physical
  output was touched.

## Step 4 — progress, cancellation, and request queues

**Status:** completed and audited.

### Repair

- Import-worker and Inspector-worker clients now post one active request at a time. Later requests
  stay in an explicit FIFO queue with a reported one-based queue position.
- Workers report honest phases: reading and parsing for G-code/DXF, plus preparing for STL relief.
  These are phase updates, not invented percentages.
- Cancelling a queued request removes it without posting. Cancelling active CPU work terminates
  its worker, rejects with `AbortError`, and starts the next queued request on a fresh worker.
- Closing or replacing an Inspector aborts its parse. Inspector text names the active phase and
  says Close cancels.
- DXF, STL, and 2D G-code Preview surface worker phases through informational toasts and bind
  Escape to cancellation for the lifetime of that import/preview request.

### Focused verification

- Worker lifecycle suite: 7 files / 48 tests passed. Coverage includes FIFO dispatch, queue
  positions, progress routing, queued cancellation, active cancellation, fresh-worker
  continuation, `postMessage` failure recovery, stale retired-worker event isolation, Escape
  disposal, Inspector rendering, and unchanged file/drop/advisory flows.
- `pnpm run typecheck`, `pnpm run lint`, focused Prettier, and `pnpm run build:web` passed.

### Audit

- **Confirmed:** queued large imports no longer begin multiple whole-file reads concurrently on
  the shared import worker, reducing overlapping peak input retention.
- **Confirmed:** termination is the cancellation mechanism for active synchronous parsers; the
  code does not claim cooperative mid-parse cancellation.
- **Confirmed:** a synchronous `postMessage` failure retires that worker before the queue advances,
  and late message/error events from a retired worker cannot terminate its replacement.
- **Confirmed:** cancellation affects only preview/import computation. It does not add a guard,
  alter a file, mutate G-code, or affect Frame/Start.
- **Limit:** progress is phase-based because the current whole-Blob read APIs expose no meaningful
  parser percentage. Reporting byte or line percentages would require chunked reader/parser
  protocols that do not exist yet.
- **Limit:** environments without `Worker` keep the synchronous fallback for tests/unsupported
  browsers; while that fallback is executing, browser key events cannot interrupt it.
- **No hardware claim:** no controller, firmware, setting, machine command, air-cut, or physical
  output was touched.

## Step 5 — real-worker, large-fixture, persistence, and pressure coverage

**Status:** completed and audited.

### Coverage added

- A Playwright production-path fixture opens a 260,100-segment G-code file through the actual
  Inspector worker bundle, observes the disclosed 250,000-segment pressure advisory, and verifies
  that a 10 ms UI heartbeat continues while parsing.
- A second large fixture begins an 800,000-segment parse and closes the Inspector while the worker
  is active, verifying the real worker is present and the dialog closes through the cancellation
  path.
- A browser-level client case submits two requests to the real production worker client, verifies
  the second reports queue position 1, and verifies both complete in FIFO order.
- Typed-relief persistence coverage exercises manual-save and autosave preparation/reopen,
  autosave recovery, and quota failure while confirming the previously written recovery slot
  remains readable.

### Focused verification

- `pnpm test -- src/ui/state/large-relief-persistence.test.ts`: 1 file / 3 tests passed.
- `pnpm test:e2e -- e2e/gcode-large-worker.e2e.ts`: 3 tests passed using the real browser worker,
  including large open/responsiveness, active cancellation, and FIFO queue execution.
- `pnpm typecheck` and `pnpm typecheck:e2e` passed.
- `pnpm lint`, focused Prettier, and `git diff --check` passed.

### Audit

- **Confirmed:** the production browser path creates `gcode-inspector-worker`, not the synchronous
  no-Worker fallback.
- **Confirmed after the final guard audit:** the large render advisory gives the exact observed
  count while retaining every segment through the final 260,100th motion.
- **Confirmed:** real-worker active cancellation and FIFO continuation are now covered in addition
  to deterministic worker-client unit tests.
- **Confirmed:** typed live STL meshes preserve their geometry across manual save, autosave, and
  recovery; a quota failure is explicit and does not overwrite the prior valid recovery slot.
- **Not established:** these fixtures do not prove a constant memory ceiling. Whole-file worker
  reads and JSON persistence allocations remain, as recorded in Steps 1–3.
- **Not established:** no browser automation can reproduce every storage-pressure threshold or
  operating-system out-of-memory condition. The quota test injects the browser's documented
  `QuotaExceededError` outcome at the write boundary.
- **No hardware claim:** no controller, firmware, setting, machine command, air-cut, or physical
  output was touched.

## Step 6 — remaining import-route classification

**Status:** completed as a read-only source audit. No implementation claim is made for these
routes.

### Classification

| Route | Current production path | Classification |
| --- | --- | --- |
| Native `.lf2` project | `file.text()` and `deserializeProject(text)` run from `src/ui/app/file-actions.ts:369-378`; deserialization calls `JSON.parse` in `src/io/project/deserialize-project.ts:44-47`. | Whole-file UI-thread read and JSON parse/normalization. **Not proven large-file safe, streaming, or memory-bounded.** |
| SVG picker and drag/drop | Picker calls `file.text()` then `parseSvg` at `src/ui/app/file-actions.ts:87-93`; drop does the same at `src/ui/app/use-import-drag-drop.ts:189-191`. `parseSvg` sanitizes, creates a DOM with `DOMParser`, and walks all geometry at `src/io/svg/parse-svg.ts:409-433`. | Whole-file UI-thread text, DOM, and geometry expansion. Large-size advisories do not change this classification. **Not proven large-file safe, streaming, or memory-bounded.** |
| LightBurn `.lbrn` / `.lbrn2` | Project open reads `file.text()` then calls `importLightBurnProject` at `src/ui/app/file-actions.ts:369-402`. The importer creates an XML DOM and expands geometry at `src/io/lightburn/lbrn-import.ts:24-45,157-158`. | Whole-file UI-thread text, XML DOM, and geometry expansion. **Not proven large-file safe, streaming, or memory-bounded.** |
| Native `.lfml.json` material library | `file.text()` and `deserializeMaterialLibrary(text)` run at `src/ui/app/material-library-file-actions.ts:28-50`; deserialization calls `JSON.parse` at `src/io/material-library/material-library-io.ts:70-73`. | Whole-file UI-thread read and JSON parse. **Not proven large-file safe, streaming, or memory-bounded.** |
| LightBurn `.clb` material library | `file.text()` and `importLightBurnClb` run at `src/ui/app/material-library-file-actions.ts:67-86`; the importer creates an XML DOM and enumerates entries at `src/io/lightburn/clb-import.ts:28-40,214-232`. | Whole-file UI-thread text, XML DOM, and entry expansion. **Not proven large-file safe, streaming, or memory-bounded.** |

### Audit

- **Confirmed:** all listed file actions provide size advisories before parsing when byte size is
  available. Those advisories inform and never refuse; they are not evidence of scalability.
- **Confirmed:** none of the listed production routes calls the import worker or Inspector worker.
- **Explicit boundary:** Steps 1–5 improve DXF, G-code, and STL paths only. They do not make native
  projects, SVG, LightBurn projects, or material libraries large-file safe.
- **No change made:** moving these format-specific DOM/JSON normalization pipelines to workers
  would require separate contracts and test fixtures. It was intentionally not folded into the
  completed G-code/STL repair.
- **No hardware claim:** no controller, firmware, setting, machine command, air-cut, or physical
  output was touched.

## Final readiness audit

**Status:** implementation complete locally and ready for maintainer review. Publication remains
unauthorized.

### Final verification

- `corepack pnpm release:check` passed on the completed implementation tree before this
  result-only ledger appendix:
  - TypeScript, ESLint, Electron ESLint, Prettier, ADR numbering, and production-license checks
    passed.
  - Vitest: 1,364 files / 8,210 tests passed; 14 files / 22 tests were skipped fixtures.
  - Release integrity: 14 tests passed.
  - The production web build emitted
    `dist/web/assets/gcode-inspector-worker-BFmZ7coi.js` and
    `dist/web/assets/import-worker-BlRLK_Ey.js`; the Electron main build passed.
  - Hard file-size, report-only soft-size, and public-export ratchet checks passed.
- `corepack pnpm typecheck:e2e` passed.
- `pnpm test:e2e -- e2e/gcode-large-worker.e2e.ts`: 3/3 real-browser production-worker tests
  passed.

### Readiness conclusion

- **Ready for review:** all six requested items were implemented or explicitly classified in
  sequence, with a completed audit entry after each step.
- **No streaming claim:** G-code/DXF still use whole-Blob text in workers, STL still uses a
  whole-Blob `ArrayBuffer`, and typed relief persistence still materializes JSON.
- **No broad large-file claim:** native project, SVG, LightBurn project, and material-library
  routes remain classified as whole-input UI-thread paths.
- **No publication or hardware action:** nothing was committed, pushed, opened as a PR, deployed,
  connected to a controller, or run on a machine.

## Expansion program — packed protocols, incremental parsing, and remaining import workers

**Requested:** 2026-07-30
**Status:** in progress; the earlier six-step repair remains the preserved baseline.

The maintainer requested four additional changes, which remain sequential:

1. Replace nested DXF and 2D G-code worker results with packed typed transfer protocols.
2. Replace whole-Blob G-code, DXF, and STL reads with genuinely incremental parser inputs and
   prove the resulting memory boundary before changing the scalability claim.
3. Move native project, SVG, LightBurn project, and native/LightBurn material-library imports off
   the UI thread.
4. Split `gcode-render-model.ts` below the repository size threshold without changing behavior.

Each item receives a test-first implementation and a completed audit entry before the next item
begins. No item may add an import refusal, silently discard geometry, weaken validation, change
Frame/Start, or operate hardware. Publication remains unauthorized.

### Expansion Step 1 — packed DXF and 2D G-code worker results

**Status:** completed and audited.

#### Repair

- DXF worker results now pack compatibility polylines and canonical line/cubic/elliptical-arc
  curves into transferable typed buffers. Object/path metadata stays small and cloneable.
- 2D G-code results now pack step kinds, flags, numeric fields, polyline points, optional Z,
  motion, group/pass, and raster provenance into transferable typed buffers.
- Both public clients unpack the protocol back into the unchanged `ParseDxfResult` and
  `ParseGcodeProgramResult` domain models before resolving, so callers and save/preview behavior
  retain their established shapes.
- The worker transfer list includes every packed geometry buffer. Error and empty results allocate
  no geometry protocol.

#### Test-first verification

- Red: the two new protocol suites initially failed because the packers did not exist.
- Red: transfer/client tests then failed because G-code buffers were not transferred and the
  client returned the packed protocol instead of the domain model.
- Focused Vitest: 4 files / 18 tests passed.
- `corepack pnpm typecheck` and focused ESLint passed.
- The production web build emitted `dist/web/assets/import-worker-Csn25EAz.js`.
- Playwright exercised the rebuilt production workers; all 15 selected-project tests passed,
  including the three large G-code worker open/cancel/FIFO cases.

#### Audit

- **Confirmed:** DXF and 2D G-code geometry no longer crosses the worker boundary as a deeply
  structured-cloned point/step graph.
- **Confirmed:** round-trip tests cover every current curve segment and `ToolpathStep` field,
  including optional provenance fields not currently emitted by the external G-code parser.
- **Boundary:** the worker still first constructs the normal parser result and then packs it; the
  UI reconstructs the normal domain graph after transfer. This removes cross-thread geometry
  cloning but does not establish bounded peak parsing memory.
- **No streaming claim:** input still uses whole-Blob reads at this checkpoint. Expansion Step 2
  must replace those reads before the claim changes.
- **No hardware or publication action:** none.

### Expansion Step 2A — incremental production G-code input

**Status:** completed and audited; DXF and STL remain in Expansion Step 2.

#### Repair

- The external-program parser now exposes a stateful line protocol. The original whole-text API is
  a compatibility wrapper over that same implementation, so existing callers and tests retain
  their result shape.
- The 2D Preview import worker decodes `Blob.stream()` chunks and feeds complete logical lines to
  the parser. It reports exact bytes read and total bytes while parsing.
- The production Inspector worker uses the same chunked line reader to build its typed render
  model and bounded source pane in one pass. Blob sources no longer materialize a whole-file
  string in either production worker.
- Blob routes no longer fall back to `Blob.text()` plus synchronous parsing on the UI thread when
  workers are unavailable. Already-materialized text callers retain their compatibility path.
- `gcode-render-model.ts` is now a 12-line compatibility wrapper. Its stateful builder and
  unsupported-word accounting were split into focused modules; the largest resulting module is
  391 counted lines, below the 400-line hard limit.

#### Test-first verification

- Red: stateful parser, production Blob parser, stateful render builder, and streamed Inspector
  tests each failed before their implementations existed.
- Red: the 2D UI-thread fallback test observed a Blob read before that fallback was removed.
- Focused G-code parser/import tests: 4 files / 28 tests passed.
- Focused Inspector/render-model tests: 4 files / 19 tests passed.
- Focused production action/Inspector client tests: 3 files / 12 tests passed.
- `corepack pnpm typecheck` passed after both production paths changed.
- `corepack pnpm check:soft-size -- --all` reports the split builder at 391 counted lines and no
  `gcode-render-model.ts` entry.

#### Audit

- **Confirmed:** production Blob-backed 2D Preview and Inspector parsing no longer retain an input
  string proportional to the complete file.
- **Confirmed:** CRLF, bare CR, split UTF-8 sequences, trailing lines, modal state, validation line
  numbers, render-model results, source-pane counts, and exact byte progress are covered.
- **Honest memory boundary:** input decoding retains the current stream chunk plus the unfinished
  logical line. Parsed output still scales with the retained toolpath/render model; an individual
  unbounded-length line can itself be large. This is not a constant-total-memory claim.
- **Preview pressure disclosed without a cap:** Inspector retains every render segment and source
  line; 2D Preview retains every parsed step. Above 250,000 render items, the UI gives the exact
  count and warns about memory/responsiveness without reducing the result.
- **No silent loss or new policy guard:** validation and parser results are unchanged; the pressure
  advisory does not sample, cap, delay, or refuse preview or any machine action.
- **No hardware or publication action:** none.

### Expansion Step 2B — incremental production DXF input

**Status:** completed and audited; STL remains in Expansion Step 2.

#### Repair

- ASCII DXF group-code/value parsing is now stateful and line-driven. It preserves binary-sentinel,
  malformed-code, truncation, CR/LF, whitespace, EOF, and trailing-blank behavior.
- Raw entities are assembled one at a time, including classic
  `POLYLINE`/`VERTEX`/`SEQEND`, instead of retaining a tag graph for the whole file.
- Production DXF parsing makes two streamed passes: metadata first (`$INSUNITS`, layer colors,
  block definitions), then top-level entities. This preserves block resolution even when an
  `ENTITIES` section appears before `BLOCKS`, without retaining all top-level raw entities.
- Progress covers both passes honestly: total work is reported as twice the source bytes.
- The existing `parseDxf({ dxfText })` API is a compatibility wrapper over the same two-pass
  incremental collectors. The production Blob route no longer calls `Blob.text()`.
- A reachable Blob is never routed back through whole-file UI-thread parsing when the worker is
  unavailable; text-only adapters retain their compatibility path.

#### Test-first verification

- Red: tag-line parser, raw-entity stream, two-pass Blob parser, and no-UI-fallback tests each
  failed before their implementations existed.
- Full DXF Vitest suite plus production Blob coverage: 12 files / 69 tests passed.
- DXF action plus full DXF/Blob coverage: 13 files / 77 tests passed.
- The Blob suite proves exact whole-result parity, two-pass byte progress, and late block
  resolution.
- Focused ESLint, Prettier, `corepack pnpm typecheck`, and `git diff --check` passed.

#### Audit

- **Confirmed:** the production DXF worker no longer materializes a whole-file string, whole-file
  line array, whole-file tag array, or whole top-level raw-entity array.
- **Required retained state:** block definitions and their child entities remain proportional to
  the definitions because later `INSERT`s require them. Expanded output remains proportional to
  imported geometry. The active input state is the stream chunk, unfinished line, pending tag,
  and current raw entity.
- **Two-pass cost:** the Blob is decoded twice to preserve arbitrary section ordering. This trades
  I/O/CPU for lower peak input retention and is reflected in progress totals.
- **Validation unchanged:** malformed/truncated/binary rejection and unreadable-geometry skipping
  retain their previous messages and behavior; no geometry is silently discarded by the stream
  boundary.
- **No constant-total-memory claim:** blocks, a single extreme entity/line, and final expanded
  geometry can be large. The defensible claim is bounded input working state plus required
  definitions/output, not constant memory.
- **No hardware or publication action:** none.

### Expansion Step 2C — incremental production STL input

**Status:** completed and audited. Expansion Step 2 is complete for G-code, DXF, and STL.

#### Repair

- Binary STL parsing reads a bounded prefix, validates the declared triangle count against
  `Blob.size` before allocating output, then fills one exact `Float32Array` from streamed 50-byte
  records. A fixed 50-byte staging record handles stream-chunk boundaries.
- ASCII STL parsing uses two streamed token passes. The first preserves vertex validation and
  counts exact output size; the second fills an exact `Float32Array`. It never builds a whole-file
  string, token array, boxed coordinate array, or grow/copy typed buffer.
- The bounded format sniff preserves the authoritative binary length signature, including binary
  files whose header begins with `solid`, and retains the prior truncated/padded diagnosis.
- Production STL parsing and the mesh-to-heightmap aspect-ratio probe both stay in the import
  worker. The typed positions buffer remains transferable to the UI.
- The UI action no longer falls back to `file.arrayBuffer()`, main-thread parsing, or
  main-thread heightmap conversion when the worker is unavailable.

#### Test-first verification

- Red: binary-stream, two-pass ASCII, binary-integrity, and no-main-thread-fallback tests failed
  before implementation.
- Focused STL/import Vitest: 5 files / 26 tests passed.
- `corepack pnpm typecheck` and focused ESLint passed.
- Binary coverage uses 2,000 records so the fixture crosses the runtime stream chunk boundary;
  ASCII coverage verifies exact typed output and two-pass byte progress.

#### Audit

- **Confirmed:** binary input working state is a bounded prefix, the current source chunk, and one
  50-byte record plus the exact final positions buffer.
- **Confirmed:** ASCII input working state is a bounded prefix, current decoded chunk/unfinished
  line, at most three pending coordinate tokens, and the exact final positions buffer.
- **Required retained output:** mesh positions remain proportional to triangle count because
  save/reopen, preview, and relief compilation require them. Worker-side heightmap probing may
  allocate a grid proportional to the selected probe resolution, but that allocation no longer
  occurs on the UI thread and is released before the worker transfers the mesh.
- **No boxed expansion after transfer:** the worker result, `ReliefObject.meshPositions`,
  persistence encoder, and typed-array cache preserve the typed mesh path established in the
  earlier STL repair.
- **No constant-total-memory claim:** the final mesh and probe grid scale with content, and a single
  extreme ASCII line can be large. The supported claim is bounded input parsing overhead plus
  required output/probe state.
- **No hardware or publication action:** none.

### Expansion Step 3 — dedicated workers for remaining document imports

**Status:** completed and audited.

#### Repair

- Native project, SVG, LightBurn project, native material-library, and LightBurn CLB imports now
  share a dedicated worker client with one active request, FIFO queueing, progress events, and
  cancellation.
- Production picker and drag/drop routes pass the reachable `Blob` to that worker. They do not
  call `Blob.text()` or parse these formats on the UI thread.
- Native project and material imports preserve the existing JSON parsers and validators inside the
  worker.
- SVG imports use a worker-safe DOM implementation, strict XML well-formedness validation, and an
  explicit inert-SVG sanitizer before calling the established geometry parser. Active elements,
  event attributes, and external references are rejected or removed without weakening the
  existing browser sanitization path.
- LightBurn project and CLB imports validate XML well-formedness incrementally before constructing
  their worker-local inert DOM. The existing DOCTYPE/ENTITY rejection, depth limits, schema
  validation, and result models remain in force.
- The production bundle now contains a hashed `document-import-worker-*.js` asset.

#### Test-first verification

- Red: the worker protocol/client suites initially failed because the worker path did not exist.
- Red: action tests observed production `Blob.text()` reads until project, SVG, LightBurn, and
  material routes were rewired.
- Red: SVG parity and malicious-active-content fixtures failed until worker-local parsing and
  sanitization were implemented.
- Focused document-import Vitest: 62 files / 399 tests passed.
- Focused typecheck, ESLint, and SVG/action parity tests passed.
- `corepack pnpm license-check` passed for 49 production packages across 8 licenses.
- The release-integrity suite passed 14/14 after adding the exact reviewed upstream
  `saxes@6.0.0` license fallback required by the repository's fail-closed notice generator.
- The production web build completed and emitted the dedicated document worker bundle.

#### Audit

- **Confirmed:** the five remaining production Blob-backed import families no longer perform
  whole-document parsing on the UI thread.
- **Confirmed:** FIFO queue order, active and queued cancellation, progress forwarding, worker
  termination, malformed XML rejection, parser parity, and malicious SVG handling have focused
  coverage.
- **Compatibility boundary:** already-materialized text adapters used by tests/integrators keep
  their synchronous compatibility APIs. Production web picker/drop adapters provide the `Blob`
  and take the worker route.
- **Honest memory boundary:** these five routes intentionally use `Blob.text()` and
  `JSON.parse()` or worker-local DOM construction inside the worker. They remove UI stalls but
  are not incremental or memory-bounded, and nested result models may still incur
  structured-clone duplication.
- **No silent loss or new guard:** format validation and user-visible parse failures are
  preserved; the worker migration does not cap, hide, or silently truncate imported content.
- **No hardware or publication action:** none.

### Expansion Step 4 — production-worker verification correction

**Status:** completed and audited.

#### Repair

- The real-browser FIFO fixture exposed that text-backed Inspector requests could report
  `queued`, then `reading`, then complete without an explicit `parsing` event because their
  established compatibility parser is synchronous.
- The Inspector worker now emits the phase transition before it begins either text or Blob
  parsing. Blob inputs continue to add exact byte progress; text inputs make no invented byte
  claim.
- The stale oversized-STL advisory test no longer requires the removed UI-thread
  `arrayBuffer()` fallback. It now proves the size warning remains while the Blob is offered only
  to the worker and worker unavailability is reported explicitly.

#### Test-first verification

- Red: the first real-browser run passed large-file open and active cancellation but failed FIFO
  progress because the queued text request had no `parsing` event.
- Green: `corepack pnpm typecheck:e2e` passed.
- Green: all 3 real-worker Playwright cases passed: large production-worker open, active
  cancellation, and FIFO queue order/progress.
- Green: the corrected STL advisory/no-fallback pair passed 2 files / 12 tests.
- Green baseline: the immediately preceding full `corepack pnpm release:check` passed 8,247
  Vitest tests, release-integrity 14/14, web and Electron builds, and repository policy gates
  before the final one-line progress correction and this ledger entry.
- Exact-current monolithic reruns reached 8,245 passing tests but were red on two unrelated,
  load-sensitive checks: the Windows WSL `bash.exe` launcher timed out in the release-shell test,
  and the button-hover contract exceeded its 5-second timeout under full-suite load. With Git Bash
  selected explicitly, both tests passed together in isolation (2 files / 2 tests).
- Green exact-current downstream checks: release-integrity 14/14, production web build, Electron
  build, raw/soft file-size policies, and the public-export ratchet.

#### Audit

- **Confirmed:** every accepted Inspector request now has an observable
  `queued` (when applicable) → `reading` → `parsing` lifecycle before completion.
- **Confirmed:** the production browser stays responsive while the real worker parses the large
  fixture; active cancellation retires the worker; queued work starts FIFO on the successor
  worker/client slot.
- **Honest progress boundary:** only streamed Blob reads report byte counts. Text compatibility
  sources report phase progress without fabricating byte totals.
- **Publication boundary:** this ledger and all completed slices form one draft review PR. No merge
  to `main` and no deployment or hardware action are part of this step.

## Corrective audit 1 — remove preview truncation guards

**Status:** completed and audited.

### Finding

- The first published review boundary retained only 20,000 Inspector source lines and 250,000
  Inspector/2D render items. Repository policy defines caps, truncation, and hidden output as
  guards, so those limits were not acceptable even though the UI disclosed them.

### Repair

- Inspector parsing now retains every source line and render segment returned by the parser.
- 2D Preview now retains every parsed toolpath step.
- Above 250,000 render items the existing surfaces display an informational render-pressure
  advisory with the exact count. The advisory does not cap, delay, hide, refuse, or rewrite the
  preview.
- The core render model, worker protocol, overlay status, docs, and real-worker fixture now use
  pressure terminology rather than a render-limit contract.

### Test-first verification

- Red: the pre-repair Inspector stream test received only 20,000 of 20,005 source lines.
- Red: the pre-repair render-model test had no `renderPressure` result because its protocol still
  modeled truncation.
- Red: the replacement 2D pressure module did not exist while the old prefix-returning module did.
- Green focused progression: 4 files / 16 tests, then 9 files / 41 tests, then the exact affected
  7 files / 24 tests passed.
- Green real-browser verification: all 3 production G-code worker cases passed, including a
  260,100-segment preview that retains every segment while showing the pressure advisory.
- Green full release gate on the corrected pre-SVG-repair tree: 1,380 Vitest files / 8,248 tests,
  14 skipped files / 22 skipped tests, release integrity 14/14, typecheck, lint, formatting,
  license checks, web build, Electron build, and policy checks passed.

### Audit

- **Confirmed:** no preview or source data is sampled or truncated by these UI paths.
- **Confirmed:** the advisory is informational only and does not affect import, preview, save,
  compile, Frame, Start, or transport behavior.
- **Remaining memory boundary:** retained render output still scales with content. This repair
  removes silent loss; it does not claim constant-memory rendering.
- **No hardware or merge action:** none.

## Corrective audit 2 — PR #527 Chrome SVG worker cold-start repair

**Status:** completed and audited locally; second GitHub rerun pending publication of the
cold-optimizer correction.

### Finding

- PR #527 browser smoke failed 1 of 15 cases on GitHub: after importing the synthetic SVG,
  `Objects: 1` did not become visible before the 10-second assertion timeout.
- The retained Playwright trace showed the document worker cold-loading native-project,
  LightBurn, material, and SVG parser graphs before it could service the SVG request.
- A deterministic browser reproduction delayed only
  `src/io/project/deserialize-project.ts` for 12 seconds when requested by the document worker.
  Before the repair, the SVG case failed at the same `Objects: 1` timeout, proving that an
  unrelated parser graph blocked SVG startup.
- Commit `721890f5` removed that unrelated worker graph and passed 15/15 locally, but its first
  GitHub rerun still failed the SVG case 1/15. The second retained trace showed the page's Vite
  client connecting twice: the cold dev dependency optimizer first discovered `saxes` and
  `linkedom/worker` only after the SVG click, then reloaded the page and discarded the in-flight
  import. The final snapshot therefore showed `Objects: 0` with no application error.

### Repair

- The document worker keeps only the shared SVG XML/parser path in its startup graph.
- Native project, LightBurn project, native material, and LightBurn CLB parsers are loaded with
  request-kind-specific dynamic imports.
- Canonical direct imports in the project and LightBurn modules avoid circular re-export chunks.
- `parseDocumentImportText` is asynchronous so the worker can await only the requested parser
  family without changing validation or result semantics.
- The real-Chrome SVG test retains the 12-second unrelated-project-module delay as regression
  coverage.
- Vite now explicitly pre-bundles `saxes` and `linkedom/worker`, so a cold development server
  cannot discover those worker-only dependencies during the first import and reload the page.
- A repository-policy test pins that pre-bundle contract.

### Verification

- Green focused parser/import suite on the final tree: 7 files / 44 tests.
- Green final-tree `pnpm typecheck`, `pnpm typecheck:e2e`, and `pnpm lint`.
- Green final-tree `pnpm format:check` after formatting the direct-import change.
- Green final-tree production web build. It emitted a 270.20 kB document-worker entry plus
  request-specific project, LightBurn, CLB, and material chunks; the circular chunk warnings are
  gone. The existing application chunk-size advisory remains.
- Green final-tree real-Chrome smoke: 15/15 passed in 1.6 minutes. The synthetic SVG case passed
  in 8.0 seconds with the deterministic 12-second unrelated-module delay active; the three
  production G-code worker cases also passed.
- Red live check after the first repair: GitHub run `30571939808`, job `90970561660`, passed
  14/15 and failed only the SVG `Objects: 1` assertion. Its network trace recorded the two
  post-click dependency requests followed by the second Vite connection/page reset.
- Green forced-cold verification after the pre-bundle repair: a separate Vite server started
  with `--force`, and the exact SVG Playwright case passed 1/1 in 12.1 seconds without a
  mid-import reload.
- Green final forced-cold browser audit: a second `--force` server ran the complete real-Chrome
  suite; all 15/15 cases passed in 1.3 minutes, including SVG in 6.5 seconds and all three
  production G-code worker cases.
- The exact-current monolithic `release:check` was not rerun after this SVG cold-start repair.
  Its last complete green run is the 8,248-test corrected tree recorded above; all directly
  affected final-tree suites and downstream checks are listed here without extending that claim.

### Audit

- **Confirmed:** SVG startup no longer waits for the unrelated native-project parser graph.
- **Confirmed:** the worker migration retains the existing XML/JSON validation and error paths.
- **Honest memory boundary:** document imports still call `Blob.text()` and build JSON or XML/DOM
  structures inside the worker. They remove UI-thread parse stalls but remain whole-Blob,
  output-scaled, and not memory-bounded.
- **Publication boundary:** update draft PR #527 only. No merge to `main`, deployment, hardware,
  controller, settings, Frame, or Start action is part of this correction.

## Corrective audit 3 - constructor-time worker-unavailable fallback

**Status:** fixed and independently verified locally; publication and fresh CI pending.

### Finding

- PR #527 returned a worker-unavailable error whenever `Worker` was absent or its constructor
  threw. That refused otherwise-valid DXF, G-code 2D/Inspector, STL, SVG, native project,
  LightBurn project/CLB, and native material-library input.
- This was a new import/preview guard under repository rule 7. Worker availability determines
  responsiveness, not whether those existing parsers can produce a valid result.

### Repair

- Normal production requests retain the existing worker-backed clients and FIFO/cancellation
  behavior.
- A client returns `null` only when no request has begun because `Worker` is absent or construction
  throws. Callers then run their existing valid text/ArrayBuffer parser and warn that processing is
  continuing on the main thread and may make the app unresponsive.
- Pre-aborted requests reject before worker construction is considered. Once a request exists,
  `postMessage` failure, worker error, active/queued cancellation, or reset rejects that promise and
  never retries through the fallback.
- The G-code Inspector displays the main-UI-thread disclosure during a Blob read and after parsing;
  it no longer says that a worker is preparing a request after construction has already failed.
- No size threshold, truncation, compile refusal, silent fallback after partial work, or validation
  weakening was added.

### Test-first verification

- Red: the stable pre-repair focused run recorded 10 failed and 42 passed tests. Every Blob-backed
  format refused before reading its established fallback input; the pre-cancelled G-code request
  was incorrectly reported as worker unavailable.
- Green: the stable focused suite passed 13 files and 84 tests across all format actions, the three
  worker clients, advisory behavior, and Inspector UI. It includes constructor throws and a
  pre-aborted request that proves no fallback read occurs.
- Green real Chrome: 5/5 production cases passed - large Inspector worker parsing, active
  cancellation, FIFO, the real import worker used by G-code 2D preparation, and the SVG document
  worker used by the assembled workbench.
- Green static checks before the publication gate: renderer and Electron lint, renderer and E2E
  typecheck, Prettier, hard file-size, report-only soft-size, public-export ratchet, and
  `git diff --check`.

### Independent audit

- A separate read-only reviewer inspected the frozen tree and reported no actionable findings.
- The reviewer confirmed that the three clients test pre-abort before construction and return
  `null` only before request creation; post-message failures and worker errors reject already
  created promises. Every production caller selects fallback only from that constructor-time
  `null`.
- The audit first caught an exact-optional TypeScript defect in the newly isolated native-project
  fallback test while the tree was still changing. The final rerun confirmed it fixed.

### Remaining boundary

- The constructor-failure path intentionally parses on the UI thread and can stall on large input;
  the warning is an honest availability fallback, not a responsiveness or memory-bounded claim.
- Real-browser tests prove normal workers run but do not force the browser's `Worker` constructor
  to fail; constructor failure is simulated in focused tests.
- DXF/G-code/STL incremental parsing still has format-specific output-scaled retention, and
  document workers still call whole-Blob `text()`. No unlimited, constant-memory, or greater-than
  200 MiB claim is made.
- The exact rebased tree must pass the full release gate and fresh GitHub checks before review.
  Draft PR #527 only; no merge, deployment, hardware, controller, settings, Frame, or Start action.

## Corrective audit 4 - indexed lazy G-code Inspector source

**Status:** fixed and locally verified; publication and fresh GitHub checks pending.

### Finding

- The G-code Inspector worker retained every decoded source line in a nested `string[]` after
  parsing and structured-cloned that full graph back to the UI. The source pane virtualized DOM
  rows, but the worker result still duplicated source-line strings in UI memory.

### Repair

- Text and Blob parsing now build a packed `Float64Array` of source-line starts while feeding the
  existing render-model builder. Blob offsets are UTF-8 bytes; generated-text offsets are UTF-16
  code units, matching the source type that the UI already owns.
- The worker transfers the packed offset buffer with the existing render-model buffers. It no
  longer returns a source-line string array.
- The full Inspector keeps its original immutable Blob or string and decodes only the visible
  window plus an off-screen selected line. Source/index mismatch or read failure is shown instead
  of substituting incorrect text.
- The preview-only canvas does not hydrate source lines. Parsing, render-pressure disclosure,
  cancellation, FIFO behavior, and worker-unavailable fallback semantics are unchanged.
- No source truncation, size refusal, validation weakening, or new import/preview guard was added.

### Test-first verification

- Red: the new 20,005-line protocol regression failed because `sourceIndex` was absent and the
  result still exposed `lines`.
- Green focused suite: 12 Inspector files / 58 tests. Direct and streamed parsing retain identical
  render results; line windows cover LF, CR, CRLF across chunks, Unicode UTF-8 boundaries, final
  empty lines, mismatch errors, parse-error transfers, and full-dialog source rendering.
- Green static checks: renderer and E2E typecheck, focused ESLint, hard file-size policy, and
  `git diff --check`.
- Green real Chrome: 4/4 production cases passed, covering a 260,100-segment Inspector with a
  populated lazy source window, active cancellation, FIFO with a transferred source index and no
  cloned `lines` property, and the separate G-code 2D import worker.

### Independent audit corrections

- The first frozen-diff review caught a worker-constructor-unavailable Blob mismatch: fallback
  parsing produced a UTF-16 text index, but the source pane still received the original Blob and
  correctly rejected the incompatible pair. A failing dialog regression reproduced the missing
  source text. Ready inspection state now retains the exact source representation used to build
  its index, so fallback source hydration uses the already-read text and preserves the disclosed
  main-thread behavior.
- The same review reproduced an embedded UTF-8 BOM fidelity edge case. `Blob.text()` treated a BOM
  at every nonzero slice boundary as a file marker and removed it, even though the worker's
  full-stream decode preserves a later-line U+FEFF. Nonzero lazy windows now decode with
  BOM-preserving `TextDecoder` semantics; file-leading BOM handling remains unchanged.
- Direct coverage now splits actual multibyte code points across chunks, preserves an embedded BOM
  on a non-first Blob line, and requires fallback source text without a source-unavailable alert.

### Remaining boundary

- This removes the Inspector's duplicate source-line string graph; it does not make the full
  render model constant-memory. Render typed arrays, findings, events, and the original source
  still scale with the program.
- Blob parsing remains incremental by chunk and visible source hydration is range-bounded, while
  generated text is already resident in UI memory before inspection.
- No greater-than-200 MiB, unlimited-import, persistence, autosave, recovery, PNG, lifecycle, STL,
  DXF, hardware, controller, settings, Frame, Start, or deployment claim is part of this repair.
## Corrective audit 5 - incremental production SVG source

**Status:** implementation corrected after independent exact-diff audit and rebased onto current
main; fresh GitHub checks remain required on the corrected draft head.

### Finding

- The shared document import worker called `Blob.text()` before every format parser. SVG therefore
  retained a whole decoded source string while `linkedom` built a second, output-scaled XML DOM,
  despite already running outside the UI thread.
- Current-main refresh confirmed that the earlier STL persistence, transfer, cancellation/FIFO, and
  real-worker coverage findings were already repaired. This slice addresses SVG only and does not
  duplicate those completed changes.

### Repair

- Qualified SVG requests now read `Blob.stream()` through a streaming UTF-8 `TextDecoder` and the
  existing `saxes` XML validator. SAX events construct the worker `linkedom` document incrementally;
  the established worker sanitizer and geometry parser then consume that document unchanged.
- The worker reports `reading` while consuming/building the source DOM and `parsing` before the
  existing sanitizer/geometry pass. Existing FIFO and worker-termination cancellation semantics are
  unchanged.
- A stream error after any input has been consumed is surfaced and never retried through
  `Blob.text()`. Environments without `Blob.stream()` retain the established text parser, and
  constructor-time Worker failure retains the existing disclosed main-thread fallback.
- Native project, LightBurn project/CLB, material-library, PNG, persistence, autosave, and recovery
  paths are outside this one-fix boundary.

### Test-first verification

- Red: the production-source regression failed because `document-import-source` did not exist and
  the worker had only the unconditional whole-Blob text route.
- Green final focused compatibility suite: 14 files / 141 tests. The direct stream suite passes
  13/13. Coverage compares the streamed result with the existing
  worker result across `<use>`/xlink, transforms, entities, CDATA/DOCTYPE, sanitizer removals,
  multibyte chunk boundaries, literal LF/CR/TAB and XML 1.1 NEL/line-separator attribute values,
  malformed XML, no-stream fallback, non-SVG routing, and partial-stream failure after one consumed
  chunk without text retry.
- Green real Chrome: a measured 24 MiB SVG composed of bounded 4 KiB inert XML comments plus one
  rectangle imported through `document-import-worker` in 7.7 seconds, produced one object/layer,
  and advanced the reset UI heartbeat before the scene-commit mutation.
- Renderer and E2E typecheck, focused ESLint, focused Prettier, production web and Electron-main
  builds, release-integrity 14/14, file-size and public-export gates, and `git diff --check` passed
  on the rebased implementation tree.
- The composite exact-tree `pnpm release:check` did not finish green. Typecheck, renderer/Electron
  lint, formatting, ADR numbering, and license checks passed; the repo-wide unit run then reported
  two unrelated timing-budget failures under load and the outer command reached 30 minutes before
  later stages. Both failures passed immediately in isolation: output preparation 4/4 with its
  large case at 1.019 seconds, and canvas-motion budgets 2/2 with the 50k plan at 32.66 ms. The
  later gate stages were then run separately and passed as listed above. This is not recorded as a
  fully green composite release gate; exact-head GitHub CI remains required.

### Audit and corrections

- The first independent exact-diff audit found that `saxes` XML normalization changed literal
  LF/CR/TAB inside attribute values, while the established `linkedom` parser retained them. That
  could change a valid reference match and therefore imported geometry.
- The repaired builder keeps a bounded raw opening-tag scanner beside the validating SAX parser and
  applies the established `linkedom` attribute values only for the rare tag containing literal
  attribute whitespace. LF, CR, TAB, XML 1.1 NEL, and XML 1.1 line-separator reproductions now match
  the old worker result.
- A second independent pass found the XML 1.1 NEL and line-separator normalization hole after the
  first three cases were repaired. Both cases failed before the detector was extended and pass
  afterward.
- The frozen-head audit then found the same class of geometry change for character references.
  `linkedom` and `saxes` decode numeric C1 references differently, so a mixed literal/reference
  `<use>` ID could gain or lose its referenced path. Eight hex/decimal, ID/href, match/no-match
  regressions failed first. The raw-tag fallback now also covers quoted character references, and
  those cases plus predefined, greater-than, non-breaking-space, and ancestor-scoped xlink
  attributes match the established worker again.
- The functional re-audit then found the new parser file over the 250 counted-line soft policy.
  `RawOpenTagScanner` was moved unchanged into a cohesive sibling module: the two new production
  files are 121 and 191 raw physical lines and neither appears in the soft-limit report.
- The split-diff audit also found an unnecessary `parseSvgInWorker` barrel re-export that raised
  `src/io/svg/index.ts` from 10 to 11 symbols. Production exports only the new document parser now;
  the established text helper remains directly importable where its existing tests need it.
- The same audit found that the original partial-failure fixture errored from `start()` before a
  read was proven and that production source imports crossed the SVG module boundary. The fixture
  now errors from the second `pull()` after one chunk, and the production code imports through
  `src/io/svg/index.ts`.
- The corrected branch remains draft until its current-main GitHub gates and final exact-head review
  complete.

- **Confirmed:** the normal production SVG worker no longer materializes or retains a whole source
  string before DOM construction.
- **Confirmed:** the same `saxes` validation, sanitizer, root checks, geometry conversion, progress,
  FIFO, cancellation, and error response surfaces remain in the production request path.
- **No new refusal:** missing stream support uses the valid legacy text path; a genuinely failed
  active stream reports its error instead of silently duplicating work or substituting partial data.
- **Honest memory boundary:** the input working set is the browser stream chunk, decoder state, and
  current SAX token, but the XML DOM and imported scene graph still scale with document content. A
  single enormous attribute, comment, or text token can itself be large.
- **Evidence boundary:** the 24 MiB bounded-token fixture proves that production route only. It does
  not establish a greater-than-200 MiB contract, unlimited imports, constant total memory, storage
  pressure behavior, or equivalent behavior for native project, LightBurn, or material imports.
- No hardware, controller, firmware, setting, Frame, Start, deployment, or merge action is part of
  this repair.

## Corrective audit 7 - incremental production LightBurn XML source

**Status:** corrected and re-verified after independent exact-diff audit on current main; final
audit approval and fresh draft-PR checks pending.

### Finding

- The production document worker called `Blob.text()` before both LightBurn project and CLB
  parsing. This retained a complete decoded XML source string while the worker also built the
  output-scaled `linkedom` document and imported result.
- The already-merged SVG route had an incremental UTF-8/SAX document builder, but it was
  SVG-specific. Native-project and material-library JSON still use their established whole-text
  parsers and are not part of this XML-family repair.

### Repair

- LightBurn project and CLB requests now consume `Blob.stream()` through an incremental UTF-8
  decoder and `saxes`, construct the worker `linkedom` document from SAX events, and pass that
  document directly to the established project or library importer.
- The SVG reader and raw-tag compatibility scanner were moved into shared XML modules without
  changing the SVG production API. The raw-tag fallback still preserves the established
  `linkedom` attribute semantics for literal whitespace and character references.
- Main advanced during verification with SVG scanner repair #585. The shared scanner now uses that
  corrected implementation byte-for-byte, including astral-name handling, SAX-matched DTD states,
  and its fail-open `null` result when raw replay cannot be paired safely. The generic XML reader
  also verifies the raw tag name before replay and otherwise uses the already-validated SAX values;
  scanner drift cannot newly refuse a valid SVG or LightBurn document.
- Active `DOCTYPE`/`ENTITY` declarations are detected across chunk boundaries, but their existing
  refusal is applied only after well-formedness validation so malformed-input error ordering stays
  identical to the text path.
- Environments without `Blob.stream()` keep the established valid text parser. An active stream
  failure is propagated without a whole-text retry, partial-result substitution, or new refusal.
  Worker-constructor fallback, FIFO, cancellation, and progress phase names are unchanged. For the
  streamed route, `reading` now covers incremental decode plus DOM construction and `parsing`
  begins before the existing importer pass; malformed or active-declaration failures can therefore
  finish without a `parsing` phase.

### Test-first verification

- Red: the first two production-source regressions failed because both project and CLB requests
  invoked a `Blob.text()` spy that throws.
- Green final focused compatibility suite: 12 files / 88 tests. The 17-case direct suite proves
  project and CLB streaming, ten checked-in external-corpus parity cases, no-stream fallback,
  multibyte UTF-8 chunk boundaries, active declarations split across chunks, established
  extension/declaration precedence, malformed XML without text retry, and propagation after a
  partial stream failure. Existing SVG streaming plus #585's astral-name, SAX-parity, and
  8,000-mutant scanner coverage remain green after the shared-module extraction.
- Green full unit corpus on main `38187ff1`: 1,500 files / 9,299 tests passed, with 14 files / 22
  tests skipped. The branch was then rebased over path-disjoint CNC-only main commit `a2a1faad`;
  final-base focused/static/build checks and exact-head GitHub CI cover the published boundary.
- Green final-base static and repository checks: renderer and E2E TypeScript, full renderer and
  Electron ESLint, full Prettier, ADR numbering, license, release-integrity 14/14, raw file-size,
  soft-size report, export ratchet, `git diff --check`, and web/Electron production builds.
- Green final real Chrome: a measured 24 MiB `.lbrn2` fixture made from bounded 4 KiB XML comments
  plus one rectangle imported through `document-import-worker` in 8.5 seconds, produced one
  object/layer, and advanced the reset UI heartbeat before scene commit. No hardware operation was
  exercised.
- A compatibility regression was caught during implementation: active declarations were initially
  reported before malformed XML. The final builder closes the SAX parser first; the corrected
  malformed-declaration reproduction and the full focused suite pass.

### Independent audit corrections

- The frozen-diff review found a validation-precedence mismatch for a well-formed active
  declaration sent as a project request with a non-LightBurn filename. The streamed path returned
  the active-declaration reason before reaching the importer, while the established text path
  returned the extension reason first. A direct parity test failed 1/17 before repair. The active
  declaration handler now preserves the established extension result for that case without reading
  or retaining the whole source string.
- The review also found that the new shared XML directory lacked its module barrel, leaving three
  production cross-module imports on deep paths. `src/io/xml/index.ts` now exposes the narrow
  reader, errors, options, and scanner API; SVG and UI production imports use that boundary.
- The review narrowed the progress claim: protocol phases remain the same, but streamed decode and
  DOM construction are `reading`, while `parsing` begins only for the importer pass. The repair and
  remaining-boundary text now states that timing explicitly.

### Remaining boundary

- The normal production LightBurn worker no longer materializes a whole decoded source string.
  The original `Blob`, XML DOM, imported scene graph or material result, and transfer result still
  scale with source/output content. A single enormous XML token can itself be large.
- The 24 MiB bounded-token browser fixture verifies this route only. It does not establish a
  greater-than-200 MiB contract, constant total memory, unlimited import, save/autosave/recovery,
  storage-pressure, or ready-orphan behavior.
- Native-project and material-library JSON remain whole-text routes. Worker-unavailable or
  stream-unavailable environments retain the disclosed synchronous/text fallbacks so valid files
  are not newly refused.
- No PNG/lifecycle, Trace, Image Editor, hardware, controller, firmware, setting, Frame, Start,
  deployment, or merge action is part of this repair.

## Corrective audit 8 - incremental production native-project JSON source

**Status:** fixed, exact-tree release-verified, and independently audit-approved; draft publication
remains pending.

### Finding

- The production document worker received native `.lf2` files as `Blob` values but still called
  `Blob.text()` and then `JSON.parse`. The normal worker path therefore retained a complete decoded
  source string while also building the parsed object graph and normalized project.
- Worker execution removed the UI-thread parse stall but did not remove this duplicate whole-input
  retention. Native material-library JSON remains a separate whole-text route outside this fix.

### Repair

- Native-project requests with `Blob.stream()` now decode UTF-8 incrementally, tokenize and
  assemble JSON with small local state machines, and produce one parsed value without first
  materializing the whole decoded document string.
- The parsed value enters the exact existing schema checks, migrations, security validators, and
  normalization through a value-level extraction of `deserializeProject`; string callers continue
  through `JSON.parse` and the same value-level path.
- The local token assembler defines every object key as an own enumerable data property, preserving
  `JSON.parse` behavior for duplicate and prototype-shaped keys such as `__proto__` without changing
  an object's prototype.
- `reading` now includes streamed UTF-8 decode, tokenization, and parsed-value construction;
  `parsing` begins before the established project validation/normalization pass. Malformed JSON or a
  failed active stream can therefore finish without a `parsing` phase.
- Malformed JSON returns the established native-project `invalid` result shape. A source-stream
  infrastructure failure propagates and is never retried through `Blob.text()`. Environments
  without `Blob.stream()` and constructor-time Worker failure keep the established valid whole-text
  compatibility fallbacks and their existing responsiveness disclosure.

### Test-first verification

- Red: the production native-project regression failed 1/1 because the worker source path invoked a
  `Blob.text()` spy that throws instead of using the supplied stream.
- Green post-correction compatibility sweep: 47 files / 293 tests. This includes the complete
  selected project
  persistence/validation/migration corpus, document-worker routing and fallback coverage, malformed
  syntax, no-stream compatibility, partial-stream failure without text retry, one-byte UTF-8 chunk
  splits, BOM and malformed-byte decoding, duplicate/prototype-shaped and UTF-16-sensitive keys,
  strings spanning the local 4 KiB token buffer, and 2,000 deterministic generated JSON documents
  compared with `JSON.parse`.
- Green real Chrome default fixture: a measured 24 MiB whitespace-heavy but valid `.lf2` opened
  through `document-import-worker`, kept the reset UI heartbeat advancing, and produced the expected
  one-object scene in 4.5 seconds for the test and 5.7 seconds total.
- Green one-off real Chrome scale run: the same production test passed with
  `CURVEDESK_NATIVE_PROJECT_TEST_MIB=200`, measuring at least 200 MiB of valid `.lf2` input and
  completing the open in 5.6 seconds for the test and 6.8 seconds total while the UI heartbeat
  advanced.
- Green exact-tree full unit corpus: `pnpm test --reporter=json` exited 0 after 1,108.4 seconds. Its
  JSON result reported 3,653/3,653 suites passed, 9,351 tests passed, 22 pending/skipped, zero failed,
  and overall success across 9,373 tests.
- Green exact-tree release constituents: TypeScript application and E2E configs; application and
  Electron ESLint; formatting; ADR numbering; 50-package license closure; 14/14 release-integrity
  tests; web and Electron-main builds; raw/soft file-size policy; and index-export ratchet.
- Fresh independent exact-diff audit of staged patch `e348580e` found no actionable issue. The
  reviewer independently reran 3 files / 60 focused tests, the real Chrome 24 MiB production-worker
  check, targeted staged-path lint/format, typecheck, release integrity, and size/export policies;
  the primary verification separately covered the full lint/build/unit gates and 200 MiB fixture.

### Audit corrections

- The first UTF-8 parity run caught that the provisional dependency's raw-byte writer corrupted a
  supplementary code point when its four-byte sequence was divided across write calls. A streaming
  `TextDecoder` now owns byte-boundary handling and feeds bounded decoded chunks to the tokenizer;
  one-byte split coverage and the generated corpus pass.
- Source inspection then found that the dependency's object assembler did not preserve
  `JSON.parse` semantics for an own `__proto__` property. The local grammar/object assembler defines
  own data properties explicitly; direct coverage proves an own property and unchanged prototype.
- The first independent frozen-diff audit found two blockers in the remaining dependency tokenizer:
  valid escaped lone surrogates and a string-leading U+FEFF were silently deleted/replaced, and the
  published package omitted the LICENSE file required by the release-integrity closure. Six exact
  code-unit cases failed 5/6 before correction, including the auditor's serialized project-note
  reproduction. The dependency has been removed; the local tokenizer preserves UTF-16 escape code
  units and literal U+FEFF, and both direct and production project-note regressions pass.
- The same audit found a cross-module deep import of the value-level project deserializer. The
  project barrel now exports that narrow function and the worker imports it through the barrel.
- The first full lint pass found that the local tokenizer's central state method exceeded the
  repository's method-size and complexity policies. It was split into state-specific consumers;
  focused ESLint, parity tests, full lint, and the independent final audit all pass afterward.
- A focused test initially used the test environment's `Blob`, which lacks `stream()`. The corrected
  test supplies the same explicit one-byte `ReadableStream` used by the parity corpus; production
  Chrome coverage exercises the browser's real `File.stream()`.

### Remaining boundary

- This removes the normal worker path's complete decoded input string. The original `Blob`, parsed
  raw graph, normalized project/scene, worker transfer result, and rendering state still scale with
  project content; normalization can transiently retain both raw and normalized output graphs.
- Any single JSON string or number token can itself be large. Browser stream chunk size is not a
  CurveDesk memory contract. This is incremental input parsing, not constant total memory.
- The 200 MiB fixture is whitespace-heavy and output-light. It proves that this valid native `.lf2`
  input route can open that measured size in the tested Chrome environment; it does not prove that a
  dense 200 MiB object/bitmap/relief project, another format, another device, or storage pressure has
  the same peak memory or completion behavior.
- Native material-library JSON remains whole-text. Save, autosave, recovery, PNG/lifecycle, Trace,
  Image Editor, hardware, controller, firmware, settings, Frame, Start, deployment, and merge are
  outside this one-fix repair.

## Corrective audit 9 - incremental production native material-library JSON source

**Status:** fixed, exact-tree release-verified, and independently audit-approved on the stacked
native-JSON branch; dependent draft publication remains pending.

### Finding

- The production document worker still called `Blob.text()` and then `JSON.parse` for native
  `.lfml.json` material libraries. The route avoided a UI-thread parse stall when the worker was
  available, but retained a complete decoded source string beside the parsed raw graph and
  normalized library.
- This is a distinct consumer of the streamed JSON reader introduced by Corrective audit 8. It is
  intentionally developed as a stacked one-fix change so that the shared parser is not duplicated
  and the material-library diff remains separately reviewable.

### Repair

- Stream-capable native material-library requests now use the same incremental UTF-8 JSON reader
  inside the production document worker, then enter the exact existing material schema checks and
  canonicalization through a value-level extraction of `deserializeMaterialLibrary`.
- The existing text deserializer still owns `JSON.parse` for string callers and delegates the
  parsed value to that same validation path. A new one-symbol stream submodule barrel exposes the
  worker-only value entry without growing the legacy over-soft-limit material-library barrel.
- Malformed JSON keeps the established `invalid` result shape. A failed active stream propagates
  without retrying through `Blob.text()`. Environments without `Blob.stream()` and constructor-time
  Worker failure retain the established valid whole-text compatibility fallbacks and their existing
  responsiveness disclosure.
- Reading, FIFO queueing, cancellation, worker termination, and parsing progress keep the shared
  document-worker semantics; no size refusal, content cap, truncation, or new guard is added.

### Test-first verification

- Red: the new production-source regression failed 1/1 because the material route invoked a
  throwing `Blob.text()` spy instead of the supplied stream.
- Green direct compatibility suite: 6 files / 84 tests, covering streamed JSON parity, project and
  SVG coexistence, native material schema/canonicalization, malformed syntax, no-stream fallback,
  and partial-stream failure without text retry. The broader material/import sweep passed 22 files /
  141 tests, including production file actions, worker client, size advisory, collection,
  persistence, management, and Saved Libraries dialog behavior.
- Focused TypeScript, E2E TypeScript, ESLint, Prettier, and index-export ratchet checks pass after the
  material-specific source handler was extracted to keep the shared dispatcher below the hard
  complexity limit.
- Green real Chrome default fixture: a measured 24 MiB whitespace-heavy but valid `.lfml.json`
  imported through `document-import-worker`, advanced the reset UI heartbeat, and loaded the
  expected empty material library in 3.8 seconds for the test and 5.6 seconds total.
- Green one-off real Chrome scale run: the same production test passed with
  `CURVEDESK_MATERIAL_LIBRARY_TEST_MIB=200`, measured at least 200 MiB, advanced the UI heartbeat,
  and loaded the expected library in 6.0 seconds for the test and 7.2 seconds total.
- Green exact-tree `pnpm release:check`: full unit corpus, TypeScript, application and Electron
  ESLint, formatting, ADR numbering, 50-package license closure, 14/14 release-integrity tests, web
  and Electron-main builds, raw/soft file-size policy, and index-export ratchet all passed.
- Fresh independent exact-diff audit of staged patch `5fa0f85c` found no actionable issue. The
  reviewer independently reran 6 files / 84 focused tests, TypeScript and E2E TypeScript, targeted
  staged-path lint/format, the export ratchet, and the real Chrome 24 MiB fixture; the primary
  verification separately covered the broader 22/141 sweep, full release gate, and 200 MiB fixture.

### Remaining boundary

- This removes the normal worker path's complete decoded input string. The original `Blob`, parsed
  raw graph, normalized/canonical library, worker transfer result, material collection, persistence,
  and UI state still scale with material content; normalization can transiently retain raw and
  canonical graphs together.
- Any single JSON string or number token can itself be large. Browser stream chunk size is not a
  CurveDesk memory contract. This is incremental input parsing, not constant total memory.
- The 200 MiB fixture is whitespace-heavy and contains an empty `entries` array. It proves that this
  valid native `.lfml.json` input route can import that measured fixture in the tested Chrome
  environment; it does not prove that a dense 200 MiB preset library, another format/device, or
  storage/quota pressure has the same peak memory or completion behavior.
- The separate LightBurn project/CLB incremental XML repair remains draft PR #593. Save, autosave,
  recovery, PNG/lifecycle, Trace, Image Editor, hardware, controller, firmware, settings, Frame,
  Start, deployment, and merge are outside this one-fix repair.
