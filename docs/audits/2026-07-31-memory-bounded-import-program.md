# Memory-bounded import program — architecture and audit ledger

**Date:** 2026-07-31  
**Branch:** `codex/memory-bounded-imports`  
**Stack base:** `b2e06360` (`codex/large-file-repair`, draft PR #527)  
**Publication:** local program branch only; no PR, merge, deployment, or hardware action.

## Claim boundary

This program targets files larger than 200 MB without promising unlimited imports.

A format is **qualified** only when all of these are true:

1. The production picker/drop path reads fixed-size slices or a bounded stream in a worker.
2. Required output is persisted in pages or tiles instead of being retained as one JavaScript
   object graph.
3. Display, save, reopen, autosave, and recovery request only bounded pages or tiles.
4. Cancellation removes or expires staging data and leaves the prior project unchanged.
5. A production worker/browser test imports a fixture of at least 256 MiB.
6. Instrumentation proves the program's JavaScript-owned working set stays within the format
   budget. Browser-process, decoder, GPU, and storage usage are reported separately when they can
   be measured; they are never inferred from JavaScript allocation counts.

“Worker-backed” alone is not a bounded-memory claim. Neither is “stream input” when the parser,
decoder, display, or persistence layer retains the complete result.

## Current source evidence

| Path | Verified current behavior | Consequence |
| --- | --- | --- |
| `src/ui/commands/import-image-action.ts:26-48` | Raster import decodes/samples, converts the original `File` to a data URL, and converts luma to base64. | Original bytes and sampled pixels become large JavaScript strings. |
| `src/ui/trace/image-loader.ts:108-116,361-404` | Decode uses `createImageBitmap`/canvas; original retention uses `FileReader.readAsDataURL`. | Resize-at-decode may help, but the current path does not prove codec-memory bounds and base64 expands retained data. |
| `src/core/scene/scene-object.ts:251,281` | `RasterImage` embeds `dataUrl` and optional `lumaBase64`. | The in-memory scene owns the complete raster payload. |
| `src/ui/workspace/draw-raster.ts:49-60` | Display creates an `HTMLImageElement` whose source is the embedded data URL. | Display decodes the complete embedded bitmap and caches it by string. |
| `src/io/project/serialize-project.ts:11-26` | Native save uses one `JSON.stringify`; typed STL positions expand through `Array.from`. | Save is whole-project and duplicates large binary/string state. |
| `src/ui/state/autosave.ts:66-87` | Project autosave serializes synchronously and writes JSON to `localStorage`. | Recovery cannot carry a 200 MB project and serialization runs on the UI thread. |
| `src/ui/import/document-import-worker.ts:14-18` | Native project, SVG, LightBurn, and material imports call `Blob.text()` in a worker. | UI responsiveness improves, but input is still whole-Blob. |
| `src/ui/import/parse-gcode-blob.ts:5-11` | G-code input is line-incremental. | Input overhead is bounded; the result/display are not. |
| `src/ui/import/parse-dxf-blob.ts:12-35` | DXF input is two line-incremental passes. | Input overhead is bounded; collected entities/result pages are not. |
| `src/io/stl/parse-stl-blob.ts:43-64,80-96` | Binary/ASCII STL input is incremental, then allocates the complete positions array. | Required mesh output still scales in one allocation. |
| `src/ui/gcode-inspector/gcode-inspector-worker-protocol.ts:9-15` | Inspector returns every source line and the complete render model. | Transfer and display retain output proportional to file content. |

## Browser/platform evidence

- The [File API](https://w3c.github.io/FileAPI/) defines `Blob` slicing and streaming, which can
  support bounded input readers.
- The [Streams Standard](https://streams.spec.whatwg.org/) marks `ReadableStream` transferable and
  defines a cross-realm proxy with backpressure. Transferring `File.stream()` avoids posting the
  original `File` to the worker, but it does not prove the browser's internal file-buffer memory.
- The [WebCodecs ImageDecoder specification](https://w3c.github.io/webcodecs/#imagedecoder-interface)
  exposes `ImageDecoder` in dedicated workers and accepts stream data, but its stream algorithm
  appends received bytes to the decoder's encoded-data slot. It therefore does not establish a
  bounded encoded-memory contract by itself.
- The [HTML `createImageBitmap` specification](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html)
  exposes resize options and transferable `ImageBitmap` results, but does not guarantee a
  codec-specific peak-memory limit.
- [IndexedDB 3.0](https://w3c.github.io/IndexedDB/#value-construct) requires support for `Blob`
  values and stores values through structured serialization.
- The [Storage Standard](https://storage.spec.whatwg.org/#usage-and-quota) makes usage and quota
  implementation-defined estimates. A successful local write is evidence for that browser
  profile, not a universal capacity promise.
- The [File System Standard](https://fs.spec.whatwg.org/#api-filesystemsyncaccesshandle) exposes
  synchronous random-access files only to dedicated workers. It is a preferred Electron/Chromium
  backend when available, with IndexedDB Blob pages as the compatibility backend.
- The [PNG specification](https://www.w3.org/TR/png-3/) defines one zlib datastream across
  arbitrarily split consecutive `IDAT` chunks, five row filters, and Adam7 interlace. A decoder
  cannot assume that PNG chunk, deflate block, or scanline boundaries coincide.
- The [Compression Streams specification](https://compression.spec.whatwg.org/) defines
  `DecompressionStream("deflate")` as zlib-format decompression. Its absence is a compatibility
  fallback condition, not evidence that the PNG is malformed.

## Shared storage and request protocol

Every qualified path uses a staged, page-backed asset:

```text
picked file
  -> transferred bounded stream or worker-read fixed slices
  -> staging manifest + numbered pages
  -> parser/decoder emits numbered output pages or tiles
  -> integrity/length validation
  -> atomic ready manifest
  -> scene stores a small asset reference
```

Staging records carry an asset id, source metadata, expected byte length, written byte length,
page count, creation epoch, and state (`staging` or `ready`). A committed scene can reference only
`ready` assets. Cancellation deletes known pages; crash leftovers remain unreferenced and are
removed by lease-based cleanup.

The first implementation uses 1 MiB source pages and permits only one write transaction in flight.
The contract is a maximum of one page read plus one page being serialized by the storage backend.
This is a JavaScript-owned working-set contract, not a claim about the browser's internal disk
cache.

All clients use one active request plus FIFO queueing:

- `queued` progress before work starts;
- `reading` with exact encoded bytes;
- format-specific `parsing`, `decoding`, `indexing`, and `persisting` phases;
- cancellation for active and queued requests;
- request ids on every message;
- no invented byte totals for generated output;
- no partially committed scene mutation.

## Supported-size and memory contracts

Budgets below are product contracts to be verified, not observations already proven.

| Format/path | Qualification fixture | Required representation | JavaScript working-set target | Current status |
| --- | ---: | --- | ---: | --- |
| PNG source ingest | 256 MiB encoded PNG | Original source pages plus row-decoded luma/display tiles | 96 MiB | Transferred stream ingest plus decode/sampling implemented for non-interlaced RGB8/RGBA8; end-to-end qualification open |
| JPEG source ingest | 256 MiB JPEG | Original pages plus MCU-row-derived luma/display tiles | 128 MiB | Open; needs an incremental codec implementation |
| SVG | 256 MiB UTF-8 XML | SAX state plus packed geometry pages and spatial index | 96 MiB | Open |
| LightBurn project/CLB | 256 MiB UTF-8 XML | SAX state plus page-backed objects, operations, and embedded assets | 128 MiB | Open |
| Native project | 256 MiB packaged project | Streaming manifest plus page-backed assets/geometry | 96 MiB | Open; legacy monolithic JSON remains compatibility-only |
| G-code Inspector/2D | 256 MiB text | Paged source lines, packed segment pages, bounded render batches | 64 MiB | Input only is incremental |
| DXF | 256 MiB text/binary | Two-pass metadata plus packed entity/path pages | 96 MiB | Input only is incremental |
| Binary/ASCII STL | 256 MiB | Packed mesh pages, page-backed height probes, bounded render batches | 96 MiB | Input only is incremental |
| Material libraries | 256 MiB JSON/XML corpus | Streaming records plus page-backed assets | 64 MiB | Open; lower practical priority |

The 256 MiB fixture is a qualification floor, not a maximum. Larger files remain available to the
same algorithm. The application does not add a size refusal, truncate content, or silently fall
back to a lossy representation.

## Raster/photo design

Raster qualification is split because PNG and JPEG require different decoders.

1. Stage original encoded bytes as fixed pages without data-URL conversion.
2. Parse dimensions and metadata from bounded header/chunk state.
3. PNG: stream chunks/IDAT through an incremental inflater and PNG row filters; feed decoded rows
   directly into area-resampling accumulators and display-tile encoders.
4. JPEG: use a reviewed worker/WASM decoder that exposes MCU rows. Browser
   `createImageBitmap` remains a compatibility path only and cannot qualify >200 MB.
5. Persist the original encoded source plus luma/display tiles. The scene stores only the asset
   reference, natural dimensions, working-grid dimensions, geometry, and adjustments.
6. Canvas draws a bounded tile pyramid; trace and compilation request luma tiles rather than
   reconstructing a `File` or base64 string.

The original source remains exact. Sampling changes only the explicit engraving/display working
grid, and its dimensions stay visible to the operator. No imported bytes are discarded.

The current PNG consumer implements only the decode/sampling portion for 8-bit, non-interlaced
truecolor (color type 2) and truecolor-alpha (color type 6). Grayscale, indexed-color, 16-bit, and
Adam7 PNGs deliberately use the unchanged browser decoder. This compatibility route is available
at every file size and is not memory-bounded. The current scene still embeds the original data URL
and sampled luma base64, so PNG is not yet qualified under the program claim.

## XML/JSON design

- SVG and LightBurn use incremental `SaxesParser.write(chunk)` state. No `Blob.text()`, complete
  DOM, or second whole-document validation pass is allowed on the qualified path.
- XML attributes and text are consumed into format-specific records as elements close. Geometry
  is flattened and packed into pages; unsupported or malformed syntax returns the existing
  explicit parse error without mutating the project.
- Native project moves from one JSON object to a streaming package: a small manifest followed by
  page entries. Legacy JSON remains readable through the current compatibility worker but is not
  qualified as memory-bounded.
- Manual save writes the same package incrementally to the existing writable-file stream.

## G-code, DXF, and STL design

- Preserve the existing incremental readers.
- Replace one final result with numbered packed pages committed as parsing proceeds.
- G-code source lines use UTF-8 page offsets; render batches read only visible/requested ranges.
- DXF metadata remains a bounded first pass. The entity pass writes packed geometry and object
  records directly to pages.
- STL writes packed triangle pages and an incremental bounds/index summary. Heightmap generation
  reads mesh pages in bounded bands; preview reuses a bounded vertex buffer.

## Display, persistence, autosave, and recovery

- Introduce an asset repository interface with OPFS and IndexedDB implementations.
- Add a streaming native-project container containing a manifest and referenced binary pages.
- Preserve legacy `.lf2` JSON read/write for compatibility; do not call it memory-bounded.
- Replace project autosave's `localStorage` payload with an IndexedDB manifest snapshot referencing
  committed assets. Autosave never copies asset pages.
- Recovery validates manifest generation and asset readiness before offering restore.
- Display caches are byte-budgeted, evictable, and reloadable. Eviction never deletes source data
  or hides content; missing tiles render after asynchronous fetch.
- Manual-save failure, quota exhaustion, decoder failure, malformed input, and cancellation keep
  the prior project intact and clean staging records. These are reported failures, not silent
  truncation.

## Fallback and refusal policy

- No proactive file-size refusal, cap, preview truncation, or silent downsampling is added.
- Existing legacy/browser decode and monolithic parser paths may remain compatibility fallbacks,
  but the UI and ledger must label them **not memory-bounded**.
- A platform decoder, storage transaction, or parser that factually fails returns its exact
  failure and leaves the project unchanged.
- Storage quota is checked and reported through actual write results and
  `navigator.storage.estimate()` where available; an estimate is never treated as guaranteed
  capacity.

## Verification program

Each slice requires:

1. A red unit/integration test proving the current path materializes or retains the whole input.
2. Boundary tests with a virtual 256 MiB slice source that assert maximum slice size, one in-flight
   page, exact byte accounting, cancellation cleanup, FIFO ordering, and no result publication
   before commit.
3. Real-worker browser coverage using the production worker URL and storage backend.
4. An opt-in production-scale fixture at least 256 MiB. CI may generate it as a sparse or repeated
   file outside the repository; the test must still make the production reader visit every byte.
5. Save/reopen and autosave/recovery round trips.
6. Malformed input, quota failure, abrupt-worker retirement, and stale-staging cleanup.
7. Allocation counters for program-owned buffers plus browser `performance.measureUserAgentSpecificMemory`
   evidence when the test browser exposes it. Unsupported measurement is reported, not replaced
   with a claim.
8. Perceptual/golden comparison for raster, SVG, LightBurn, DXF, and STL display/output.

## Sequential delivery order

1. Shared staged page store and production worker protocol.
2. PNG original-source ingest, row decode, sampling, tiles, save/reopen, autosave/recovery.
3. JPEG original-source ingest and MCU-row decode.
4. SVG SAX import.
5. LightBurn project/CLB SAX import.
6. Native streaming project package.
7. G-code paged source/render output.
8. DXF packed paged output.
9. STL packed paged mesh/heightmap/display.
10. Material-library streaming records.

Only one numbered item may be implementation-active. After its tests and audit are complete, this
ledger receives a completed entry before the next item begins.

## Slice audit entries

### Slice 1 — shared staged page store and production worker protocol

**Status:** Fixed and verified as shared infrastructure. No file format is qualified yet.

**Finding:** Production imports need a common way to move an original `Blob` off the UI thread,
persist it without JavaScript strings or boxed byte arrays, publish only complete results, and
serialize concurrent requests. The previous paths had worker queues, but no page-backed asset
contract shared by raster, XML/JSON, and packed geometry work.

**Implementation:**

- `paged-asset-stager.ts` visits the source in 1 MiB slices with one awaited write at a time,
  exact byte progress, cancellation, and abort cleanup.
- `paged-asset-indexeddb.ts` stores staging/ready manifests and numbered `Blob` pages. It updates
  durable written-byte accounting with each page, validates index and page length, rejects asset-id
  collisions without overwriting the existing asset, and publishes `ready` only after the exact
  page count is durable.
- `paged-asset-worker.ts` and its client/protocol provide the production dedicated-worker path,
  one active request, FIFO queue progress, active/queued cancellation, and cleanup acknowledgement
  before the next request starts.

**Failing-first evidence:**

- The initial stager/store run failed because the implementation modules did not exist.
- The first IndexedDB run exposed the missing test key-range injection.
- The collision test first showed that `put()` silently replaced a ready asset.
- The page-integrity test first showed that an undersized page could be accepted.

**Passing evidence:**

- `pnpm exec vitest run src/ui/import/paged-asset-indexeddb.test.ts
  src/ui/import/paged-asset-stager.test.ts src/ui/import/paged-asset-worker-client.test.ts` —
  3 files, 14 tests passed.
- `pnpm typecheck` — passed.
- `pnpm typecheck:e2e` — passed.
- `pnpm exec playwright test e2e/paged-asset-worker.e2e.ts` — Chrome, 1 test passed. The real
  production worker stored a 4 MiB + 13 byte source as five pages, removed a cancelled 32 MiB
  staging asset before starting the queued request, and kept the page event loop ticking.
- The virtual 256 MiB unit fixture required exactly 256 1 MiB slices and observed one write in
  flight. This proves program-owned slice behavior, not browser-process memory.

**Remaining boundary:** This infrastructure is not connected to a picker/import route, display,
save/reopen, autosave, or recovery yet. It does not qualify PNG or any other format. The real
browser test is 32 MiB for cancellation and 4 MiB + 13 bytes for successful storage; the 256 MiB
evidence is virtual. Browser internal Blob/IndexedDB copies were not measurable. IndexedDB is the
only implemented backend; OPFS is still designed, not built. Abrupt worker termination can leave
staging pages until a caller invokes lease cleanup. The next and only active format slice is PNG.

### Slice 2 — PNG incremental row decode and sampling

**Status:** Fixed and verified for the worker-backed decode/sampling sub-slice. PNG is not
qualified as end-to-end memory-bounded.

**Finding:** Production PNG import used browser bitmap/canvas decode on the UI thread, then
materialized RGBA, luma base64, and the original data URL. The shared page store had no format
consumer. A first integration also exposed two concrete cleanup/cancellation defects: the toolbar
did not pass its worker an abort signal, and a platform without `DecompressionStream` left an empty
luma staging manifest behind before taking the legacy fallback.

**Implementation:**

- `png-stream-reader.ts`, `png-incremental-decoder.ts`, and
  `png-row-luma-sampler.ts` parse PNG chunks from durable IndexedDB pages, validate chunk CRCs,
  feed consecutive IDAT bytes to one zlib decompressor, reverse all five PNG row filters, composite
  alpha over white, and box-sample directly into output rows. Program-owned decode state is two
  source scanlines, one reused horizontal accumulator, one vertical accumulator, and one output
  row; row memory still scales with image width.
- `png-paged-import.ts` stages the exact source, decodes only through the stored-page iterator, and
  writes sampled luma to fixed pages. Cancellation and compatibility fallback remove both source
  and luma staging records before acknowledgement.
- `png-import-worker.ts` and its client/protocol provide one active request, FIFO queue progress,
  phase/byte progress, queued and active cancellation, and cleanup acknowledgement before advancing
  the queue.
- `qualified-png-raster.ts` and `import-image-action.ts` route non-interlaced RGB8/RGBA8 PNGs
  through the production worker. The toolbar reports worker phases, supports Escape cancellation,
  and does not mutate the scene after cancellation. Unqualified PNG variants, unavailable workers,
  and worker/storage failures retain the existing browser decoder without a size refusal.
- SUPERSEDED as written. This slice preserved the self-contained scene/save representation — the
  source `File` was still converted to a data URL and sampled luma was still reassembled and base64
  encoded on the UI thread, with staged pages deleted after those compatibility fields were built.
  A later slice removed those compatibility fields: a page-backed object now carries asset ids and a
  thumbnail instead of bytes, so its saved `.lf2` is NOT self-contained. See the ownership slice
  below and ADR-283, which confines page-backing to PNGs over 25 MiB so sub-threshold imports keep
  the embedded, portable representation described here.

**Failing-first evidence:**

- Decoder, paged-service, worker-client, store-stream, and production-action tests initially failed
  because their modules or route did not exist.
- The production-action test initially observed `readImageNaturalSize` and
  `loadImageAsRawData` on the qualified PNG route.
- The platform-fallback cleanup test failed with a durable `fallback-luma` manifest in `staging`
  state; changing fallback to the common cleanup path made it pass.
- The Escape-action test proves a cancelled worker request does not invoke the legacy decoder and
  does not publish a raster object.

**Passing evidence:**

- `pnpm exec vitest run src/ui/commands/import-image-action.test.ts
  src/ui/import/png-import-worker-client.test.ts src/ui/import/png-paged-import.test.ts
  src/ui/import/png-incremental-decoder.test.ts src/ui/import/paged-asset-indexeddb.test.ts
  src/ui/import/paged-asset-stager.test.ts src/ui/import/paged-asset-worker-client.test.ts` —
  7 files and 31 tests passed on the exact audited tree.
- `pnpm typecheck` — passed on the exact audited tree.
- `pnpm typecheck:e2e` — passed on the exact audited tree.
- `pnpm exec playwright test e2e/png-incremental-worker.e2e.ts e2e/workbench.e2e.ts
  --grep "real PNG worker|synthetic bitmap reaches Trace preview"` — Chrome, 2 tests passed on the
  exact audited tree. The real production worker removed a cancelled 32 MiB staging source and
  luma, advanced its queued 313,860-byte PNG, persisted exactly 1,048,576 luma bytes, and kept the
  page event loop ticking. The toolbar imported that PNG, exposed the `png-import-worker` URL,
  opened Trace, and committed a traced object.
- `pnpm exec vitest run src/io/project/project-trace-mode.test.ts
  src/io/project/project-security-validation.test.ts src/io/project/prepare-project-autosave.test.ts
  src/ui/state/autosave.test.ts` — 4 files and 34 tests passed, covering the unchanged embedded
  raster project validation/round-trip and legacy autosave/recovery representation.
- Full `pnpm lint`, `pnpm lint:electron`, and `pnpm format:check` passed. `pnpm check:file-size`
  passed; the report-only soft limit listed 159 pre-existing files above 250 counted lines and none
  of this slice's production files. `pnpm build:web` passed and emitted
  `png-import-worker-Bv11XJ4F.js` (16.88 kB).
- Full `pnpm test` did not return a final result within 10 minutes and was terminated with its
  process tree after the command timeout. The captured output showed pre-existing jsdom/React
  warnings but no final pass/fail summary, so it is not claimed as passing.

**Remaining boundary:** The original file still crosses to the worker as one structured-cloned
`Blob`; the File API does not prove whether the browser duplicates its backing storage. Save/reopen,
display, trace handoff, autosave, and recovery still depend on whole data-URL/base64 fields. Luma is
reassembled into one `Uint8Array` and base64 string on the UI thread. Decode state scales with row
width, no 256 MiB real qualified PNG has passed, the 96 MiB budget has not been measured, and the
browser lacks a reliable memory measurement in this run. Browser/storage failures use the legacy
path, so CRC validation belongs to the staged route and is not a new universal import guarantee.
No PNG size is refused and no data is silently truncated. PNG remains the only active format until
page-backed scene persistence, display/trace consumers, save/reopen, autosave/recovery, quota,
stale-cleanup, worker-retirement, production-scale, and perceptual coverage close the qualification
contract.

### Slice 3 — transferred `File.stream()` source staging

**Status:** Fixed and verified for production PNG source handoff and staging. End-to-end PNG
qualification remains open.

**Finding:** Slice 2 posted the original `File`/`Blob` in the worker request. Although the worker
then read fixed slices, that structured-clone handoff did not provide a backpressure contract and
left browser duplication opaque. The production helper also converted any worker, storage, or
decode exception into the legacy browser path, even after partial staged pages had existed. That
made infrastructure failure indistinguishable from an intentionally unqualified PNG variant.

**Implementation:**

- `png-import-worker-client.ts` now calls `File.stream()` only when a FIFO request becomes active,
  transfers that `ReadableStream` to the production worker, and sends only byte length, MIME type,
  import options, and the stream. Queued requests do not open their file streams.
- `paged-asset-stream-stager.ts` consumes one stream read at a time, awaits each fixed-page
  IndexedDB write through `PagedAssetByteWriter`, verifies byte chunks and declared total length,
  reports exact durable-page progress, and cancels the reader plus removes staging on abort or
  write failure.
- `png-import-worker.ts` stages the transferred stream before decoding the durable pages. Existing
  qualified RGB8/RGBA8 decode, FIFO, progress, active/queued cancellation, and cleanup
  acknowledgement remain unchanged.
- `qualified-png-raster.ts` uses legacy decode only for an explicit `legacy-fallback` result or
  worker unavailability before staging starts. Worker, transfer, storage, CRC, and decode errors
  are reported after best-effort source/luma cleanup and do not mutate the scene.
- The browser toolbar assertion counts a real `Blob.stream()` call and still requires the
  production `png-import-worker` URL before Trace can proceed.

**Failing-first evidence:**

- The client test received an `import-png` request containing the original `blob` and no source
  stream metadata.
- The queued-source test had no lazy stream lifecycle to observe.
- The stream-service test failed because `importPngStreamToPagedAssets` did not exist.
- The infrastructure test resolved `null` instead of rejecting `IndexedDB write failed`, proving
  the partial-staging error would silently enter legacy decode.
- The first cross-realm stream test exposed an `instanceof Uint8Array` assumption; the stager now
  accepts only one-byte `ArrayBufferView` chunks and normalizes them into its realm.

**Passing evidence:**

- `pnpm exec vitest run` over the staged-store, PNG stream/client/service/decoder, qualification,
  and production-action suites — 8 files and 38 tests passed.
- `pnpm typecheck` and `pnpm typecheck:e2e` — passed.
- `pnpm exec playwright test e2e/png-incremental-worker.e2e.ts e2e/workbench.e2e.ts
  --grep "real PNG worker|synthetic bitmap reaches Trace preview"` — Chrome, 2 tests passed. The
  real worker cancelled a 32 MiB active stream, verified source/luma cleanup, advanced the queued
  valid PNG, and kept the UI event loop responsive. The toolbar invoked `Blob.stream()`, loaded the
  production PNG worker, imported the image, and completed Trace.
- Scoped ESLint and Prettier checks passed. `pnpm check:file-size` passed. `pnpm build:web` passed
  and emitted `png-import-worker-BdQqQxEy.js` (17.14 kB).

**Remaining boundary:** This closes only the initial production source handoff. The selected
`File` remains owned by the UI action, and the browser's internal `File.stream()` buffering is not
measured. After decode, the unchanged compatibility representation still reads the complete source
into a data URL, reassembles luma into one `Uint8Array`, and converts it to base64 on the UI thread.
Display, Trace, native save/reopen, autosave, and recovery remain whole-payload consumers and were
not changed in this slice. There is still no real 256 MiB qualified PNG success, JavaScript/browser
memory measurement, OPFS backend, abrupt-worker lease cleanup, or end-to-end bounded claim. No size
refusal or silent truncation was added.

### Slice 4 — page-backed qualified PNG scene assets and on-demand output hydration

**Finding/fix title:** Qualified PNG import retained the complete original data URL and sampled
luma base64 in the UI scene.

**Severity:** High.

**Status:** Fixed and verified for qualified PNG import, workspace display/burn preview, live
preview/estimate preparation, ordinary/tiled G-code Save, Start/Frame preparation, canvas motion
preparation, and processed-bitmap export. Trace, image editing/crop/adjust, native project
save/reopen, autosave, and recovery are explicitly not qualified by this slice.

**Finding:** After the worker had incrementally decoded PNG rows into durable luma pages, the UI
read every luma page into one `Uint8Array`, converted it to base64, read the complete source again
as a data URL, stored both strings on the `RasterImage`, and deleted the pages. Removing those
fields without changing consumers would silently compile an all-white raster because the legacy
decoder intentionally treats missing luma as white. This was an engraving-fidelity defect, not
only a memory optimization.

**Implementation:**

- Qualified RGB8/RGBA8 imports now retain a narrow `PagedRasterImageAsset` reference to ready source
  and luma manifests plus exact byte/dimension metadata. Their scene object has neither `dataUrl`
  nor `lumaBase64`. Explicit unqualified PNG fallback continues to use the legacy embedded fields.
- Incremental row decode feeds a second bounded sampler that creates a maximum-256-edge,
  uncompressed grayscale BMP thumbnail. Its worker transfer is an `ArrayBuffer`; the scene retains
  only the resulting bounded data URL for normal canvas display. At 256×256 the BMP is 196,662
  bytes and its base64 data URL is below 300,000 characters.
- The incremental PNG parser now carries validated pre-IDAT `pHYs` density metadata through the
  worker result. Qualified import no longer calls the legacy DPI wrapper, whose `File.arrayBuffer()`
  implementation otherwise rematerialized the complete source on the UI thread. Explicit
  unqualified fallback retains the legacy metadata path.
- Successful scene insertion keeps both ready page assets. A scene-mutation exception invokes the
  qualified result's rollback and removes both assets; import cancellation and decode/storage
  failures retain the earlier cleanup acknowledgement and FIFO semantics.
- `hydratePagedRasterProject` validates the referenced ready luma manifest, dimensions, MIME type,
  page lengths, and exact byte count, then base64-encodes page chunks with only a 0–2 byte carry.
  It creates a transient legacy-shaped clone for existing synchronous raster compilation. Missing
  or corrupt referenced pages reject explicitly; they never enter the all-white compatibility
  branch.
- Page-backed workspace burn preview hydrates asynchronously and discards the transient luma clone
  after its bounded preview canvas is built. Cancelling/pruning a pending preview aborts its page
  read. Embedded images preserve their prior synchronous preview behavior.
- Cheap page-backed scenes are routed to the existing production preparation worker even when
  normal complexity counters are below their thresholds. The large-preview/estimate worker and
  one-shot Save/Start worker hydrate before compilation. Variable-text/registration snapshots,
  idle canvas motion, tiled Save, and processed-bitmap export hydrate through their already
  asynchronous UI boundary.
- Project shape validation accepts exactly one of the embedded source or page-backed source
  contracts and verifies that sampled dimensions and luma length agree. This is contract
  validation only; native save/reopen behavior remains outside this slice and is not claimed.

**Failing-first evidence:**

- `import-image-action.test.ts` observed one complete-file `readFileAsDataUrl` call on the
  qualified path and no rollback after a failed scene mutation.
- `draw-raster.test.ts` assigned `undefined` to the browser image source instead of the bounded
  page-backed thumbnail.
- `paged-raster-hydration.test.ts` initially failed module resolution because no page-backed
  hydration boundary existed.
- The first focused run recorded 3 failed test files, 3 failed tests, and 13 passing tests before
  implementation. The new output-fidelity assertion then exposed the fixture's actual configured
  30% power (`S300`), which the exact embedded-vs-paged G-code equality already preserved.
- The independent post-implementation source audit found that `readImageDensity(file)` still read
  the complete qualified source into a UI `ArrayBuffer`. A new production-action assertion failed
  with one call before `pHYs` metadata was moved into the incremental worker result.
- The first Chrome run exposed two test-boundary defects rather than product fallbacks: the
  responsive Machine panel was a button, not a tab, and a 1×1 all-black unqualified fixture
  produced no useful Trace result. The final smoke uses direct non-machine store placement for
  file-only Save and a valid 64×64 grayscale PNG to exercise explicit legacy fallback.

**Passing evidence:**

- `pnpm exec vitest run` over the 29 directly impacted suites passed: 29 files and 166
  tests. This covered import retention/rollback, thumbnail creation, page
  hydration/cancellation/corruption, display and burn preview, async preview routing,
  output-worker routing, Start/Save preparation, and exact preview/G-code fidelity.
- `pnpm typecheck` and `pnpm typecheck:e2e` passed on the formatted current tree.
- `pnpm exec playwright test e2e/png-incremental-worker.e2e.ts e2e/workbench.e2e.ts --grep
  "real PNG worker|qualified PNG stays page-backed|unqualified bitmap legacy fallback"` — Chrome,
  3 tests passed. The browser cancelled and cleaned a 32 MiB staged request, advanced FIFO,
  imported the 313,860-byte qualified fixture, retained exactly 1,048,576 luma bytes as pages,
  observed no scene `dataUrl`/`lumaBase64`, decoded the 256×256 BMP thumbnail, loaded the production
  preview and output workers, observed zero qualified `File.arrayBuffer()` calls, and saved G-code
  containing nonzero `S` power. The grayscale unqualified fixture retained and completed the legacy
  Trace path.
- `pnpm check:file-size` and the no-growth public-export ratchet passed. The page-backed source
  contract was split into `project-paged-raster-validator.ts`; `project-shape-validator.ts` is 382
  counted lines. The report-only soft-size check still lists 160 files over 250 counted lines.
- A full `pnpm test` run timed out after 602.7 seconds with exit code 124 and no final
  Vitest summary. It is inconclusive and is not claimed as green.

**Remaining boundary:** This is not an unlimited-import or end-to-end memory-bounded claim. The
source and sampled luma are both durably retained in IndexedDB. Each actual preview/output
preparation still materializes a complete base64 luma string in its worker or temporary UI clone,
and Start preparation can retain that hydrated project inside its prepared execution artifact.
Browser File/stream/IndexedDB internal copies remain unmeasured. No real >200 MiB successful PNG,
96 MiB process-memory measurement, quota-pressure success, abrupt-worker lease cleanup, or
page-lifecycle cleanup after object deletion has passed. Trace, Image Editor, crop/adjust tools,
native project save/reopen, autosave, and recovery still expect legacy embedded fields and are
intentionally deferred; the qualified-path Chrome test does not invoke them, while a separate
unqualified fallback smoke preserves current Trace coverage. No import size refusal, compile
refusal, or silent truncation was added.

### Slice 5 — page-backed PNG asset lifecycle integrity

**Finding/fix title:** Qualified PNG page assets had no scene/history ownership lifecycle, and
abrupt worker retirement could leave partial staging behind.

**Severity:** High.

**Status:** Fixed and verified for quota-triggered import rollback, active cancellation, abrupt
PNG-worker error/retirement, shared scene references, undo/redo/pending-undo/clipboard ownership,
and final in-session ownership release. Process/browser crash recovery and persisted-project
ownership remain outside this slice.

**Finding:** Ready source/luma pages survived successful import but had no production cleanup path
when the last in-memory owner disappeared. Deleting one of multiple raster objects could not safely
delete shared pages, while deleting the final visible object could not delete them immediately
because the undo stack and clipboard can still restore that object. Active hydration also needed a
short read lease so a concurrent final release could not remove pages mid-preview/output. Separately,
the PNG client waited indefinitely for a cancelled worker to acknowledge its own cleanup, and a
worker error/reset rejected requests without main-thread cleanup. Luma quota failure was caught and
rolled back, but the first pressure test exposed an unhandled decode-row rejection.

**Implementation:**

- `PagedRasterAssetLifecycle` derives the unique source/luma asset ids referenced by the active
  project, undo stack, redo stack, pending interaction snapshot, and scene clipboard. Store
  transitions enqueue only ids that moved from referenced to unreferenced.
- Shared asset ids are deleted only after the final owner disappears. Failed deletes stay pending
  and retry on a later transition; cleanup failure is logged rather than silently discarded.
- IndexedDB schema version 2 adds shared read-lease and deferred-deletion stores. Page-backed
  hydration durably leases the sampled-luma asset it reads, including hydration inside
  preview/output workers. A final ownership release writes one deletion request per source/luma
  asset; the last lease release atomically removes that asset's manifest, pages, leases, and
  request. This preserves the exact preview/output luma path added in Slice 4 across JavaScript
  realms without retaining the unused source pages for the read.
- Active PNG cancellation now retires the worker immediately, removes both known asset ids from the
  main thread, and starts the next FIFO request only after cleanup completes. Worker error,
  unreadable-response, and forced-reset paths apply the same active-request cleanup before rejecting
  queued work.
- If cancellation cleanup itself fails, the request is classified as
  `PagedAssetCleanupError` instead of `AbortError`, so the import action surfaces an error rather
  than reducing the storage failure to an ordinary cancellation notice.
- The incremental decoder settles its row-consumer promise as soon as it is created. A quota error
  in asynchronous luma writes is therefore observed immediately, the decompressor is aborted, and
  both the ready source and partial luma assets are removed without an unhandled rejection.

**Failing-first evidence:**

- The initial lifecycle run failed module resolution because no ownership manager existed.
- The worker-client cancellation test timed out because the active worker was neither retired nor
  cleaned until an acknowledgement arrived; the abrupt-error test observed zero cleanup calls.
- The first quota-pressure fixture rejected and removed its manifests but also produced an
  unhandled `QuotaExceededError` from the concurrently running row consumer.
- The independent post-implementation audit added a cleanup-failure classification test. It failed
  because the combined error still had name `AbortError`, which the import UI treats as an ordinary
  successful cancellation.
- A second source audit found that the first read-lease implementation was in-memory per JavaScript
  realm, so a main-thread project replacement could not see a preview/output worker lease. The
  cross-repository test failed because no durable `acquireReadLease` protocol existed.

**Passing evidence:**

- Focused Vitest passed 9 files and 80 tests covering reference ownership, durable read leases,
  deferred deletion, cleanup
  retry, luma quota pressure, worker cancellation/error, incremental decode, hydration, production
  import action, and existing store behavior.
- Chrome passed 5 production-path tests: shared deletion/history retention and final cleanup; forced
  real-worker retirement cleanup; real-worker cancellation, FIFO advancement, and luma persistence;
  qualified page-backed preview/G-code Save fidelity; and explicit unqualified Trace fallback. The
  deletion test also held a durable luma lease through final scene/history release and observed
  that the luma pages remained ready until the lease released.
- The exact implementation tree passed the full repository Vitest run: 1,389 test files and 8,304
  tests passed, with 14 files and 22 tests intentionally skipped, in 742.11 seconds. The only
  stderr was existing jsdom not-implemented diagnostics from passing camera/save test paths.
- `pnpm typecheck`, `pnpm typecheck:e2e`, full renderer/electron ESLint, Prettier, hard file-size,
  public-export ratchet, ADR-number, license, 14/14 release-integrity, web build, and Electron-main
  build passed on the current tree.
- The report-only soft-size check remains at 160 pre-existing files over 250 counted lines; none of
  the new Slice 5 files crosses that threshold.

**Remaining boundary:** This lifecycle is durable across worker realms but is not startup garbage
collection. A browser/app/process crash can still leave staging, ready orphan, or abandoned lease
records; the existing age-based staging cleanup method is not yet connected to startup, and
ready-page/lease reconciliation cannot be defined until native save/reopen, autosave, and recovery
acquire a page-backed ownership contract. IndexedDB delete failure retries only on a later store
transition and is logged rather than shown as a persistent UI notice. No real quota-exhaustion
browser profile, abrupt process crash, real >200 MiB PNG, or process-memory measurement has passed.
Trace, Image Editor/crop/adjust, save/reopen, autosave, and recovery remain unchanged. Source plus
sampled luma coexist in IndexedDB, and preparation still transiently materializes complete luma
base64. No size refusal, new compile refusal, fallback widening, or silent truncation was added.

### Slice 6 - bounded startup reconciliation for abandoned leases

**Finding/fix title:** Expired page-asset leases abandoned by a worker or process interruption had
no bounded startup reconciliation path.

**Severity:** High.

**Status:** Fixed and verified for expired Web-Lock-protected lease rows. Ready-page orphan
collection, staging cleanup hookup, and persisted-project ownership reconciliation remain open.

**Finding:** Slice 5 made read leases durable across workers, but a worker or process interruption
could leave a lease row indefinitely. Blindly expiring a lease by wall-clock age would be unsafe:
a long-running live preview/output worker can legitimately hold an expired lease, and deleting its
asset would break fidelity. The startup path therefore needed an independent liveness proof, a
strict work bound, and a failure policy that retained data whenever liveness was uncertain.

**Implementation:**

- IndexedDB schema version 4 adds expiry and protection metadata to new lease rows plus a compound
  index for expired Web-Lock-protected candidates. Legacy and unprotected rows remain outside the
  reconciliation index and are retained.
- Each protected read lease holds a shared Web Lock. Startup reconciliation probes the same name
  with an exclusive, non-waiting request; it removes the durable lease row only when the exclusive
  lock is immediately available. A live reader keeps the shared lock, so its row is never removed.
- Reconciliation examines at most 64 candidates per startup. It re-reads and compares the exact
  current record before removal, preventing an indexed candidate from deleting a replacement lease
  that reused the same key with different protection or expiry metadata.
- Startup reconciliation deletes lease rows only. It never deletes an asset manifest, source page,
  sampled-luma page, or deferred-deletion marker. Unsupported Web Locks, lock acquisition errors,
  IndexedDB errors, and legacy rows fail closed by retaining data without delaying app render.
- True ownership re-entry cancels an existing deferred-deletion marker before the asset is treated
  as live again. Unchanged high-frequency store transitions do not repeat that durable write.

**Failing-first evidence:**

- The initial focused run failed because the startup reconciliation module and durable
  `cancelDelete` operation did not exist; lifecycle reownership made zero cancellation calls. That
  run recorded 3 failed files, 2 failed tests, and 9 passing tests.
- The independent audit then proved three additional defects before correction: an unchanged
  owned-to-owned transition doubled cancellation writes; a Web Lock `SecurityError` rejected
  `acquireReadLease` and therefore threatened preview/output fidelity; and a stale expired
  candidate removed a replacement unprotected lease row.
- A first real-worker fixture run exposed only test-boundary defects: a cross-realm `Blob`
  `instanceof` check and an unnecessary empty interface. Both fixture issues were corrected before
  the production browser check.

**Passing evidence:**

- The exact focused Vitest run passed 10 files and 54 tests covering bounded candidate selection,
  live/abandoned/unsupported lock probes, stale-candidate replacement, legacy retention,
  reownership cancellation, lock-failure fidelity, hydration, PNG worker import, preview, and
  output preparation.
- Chrome passed 6 production-path tests in 29.6 seconds. The new lifecycle test staged a real
  asset, held an already-expired lease in a real worker, proved manual reconciliation retained it,
  terminated the worker, reloaded the application, and proved startup reconciliation removed only
  the lease while retaining the manifest, page bytes, and text. The same run retained cancellation,
  FIFO, qualified page-backed preview/G-code fidelity, and explicit unqualified fallback coverage.
- The exact current tree passed the full repository Vitest run: 1,391 test files and 8,313 tests
  passed, with 14 files and 22 tests intentionally skipped, in 1,199.50 seconds. Stderr contained
  the repository's existing jsdom not-implemented diagnostics from passing camera/save paths.
- `pnpm typecheck`, `pnpm typecheck:e2e`, full renderer/electron ESLint, Prettier, hard file-size,
  public-export ratchet, ADR-number, license, 14/14 release-integrity, and `git diff --check`
  passed. The report-only soft-size check remains at 160 pre-existing files; no Slice 6 file
  crosses the soft limit.

**Independent audit:** The post-implementation audit specifically challenged liveness,
high-frequency ownership updates, lock API failure, candidate-key reuse, and startup deletion
scope. It caused the transition gate, lock-failure downgrade, and exact-record removal check above.
No manifest or page deletion API is exposed to the startup service.

**Remaining boundary:** The 24-hour expiry is eligibility for a liveness probe, not permission to
delete an asset. Only 64 candidates are examined per launch, so repeated launches drain a larger
backlog. Old, unprotected, and Web-Lock-unsupported lease rows can be retained indefinitely; that
prefers storage leakage over data loss. This slice does not collect ready orphan assets, connect
the existing stale-staging cleanup to startup, or define save/reopen, autosave, recovery, Trace, or
Image Editor ownership. The browser test terminates a real worker and reloads the app, but does not
reproduce an operating-system process kill, multi-day wall-clock passage, a quota-exhausted browser
profile, a greater-than-200-MiB import, or process-memory pressure. Source plus sampled luma still
coexist in IndexedDB, and preparation still transiently materializes complete luma base64. No size
refusal, compile refusal, fallback widening, or silent truncation was added.

### Slice 7 - bounded startup cleanup for abandoned incomplete staging

**Finding/fix title:** Interrupted page-asset staging could retain incomplete manifests and pages,
while the existing age-only cleanup could not safely distinguish an abandoned import from a live
long-running import.

**Severity:** High.

**Status:** Fixed and verified for expired Web-Lock-protected staging created by the current
repository. Ready, live, legacy, unprotected, and not-yet-expired staging are retained.

**Finding:** `cleanupStagingBefore` scanned every manifest and deleted staging solely from its
creation time. It was deliberately not connected to startup because age alone is not proof of
abandonment and an unbounded `getAll()` violates the startup work budget. A crash-safe cleanup
needed a durable eligibility marker, independent cross-realm liveness proof, exact-record race
protection, and a fixed batch limit without turning storage infrastructure into an import refusal.

**Implementation:**

- IndexedDB schema version 5 adds a compound manifest index over staging state, Web-Lock
  protection, and expiry. Only new staging that successfully acquires a shared Web Lock receives
  those optional fields. Legacy manifests and lock-unsupported/error paths have no indexed
  eligibility marker and are retained.
- Each protected staging operation holds a shared lock named for its asset until commit or abort.
  Commit publishes a ready manifest without staging protection metadata; abort deletes the
  incomplete records. Lock acquisition or release errors do not refuse an otherwise-valid import:
  acquisition failure stores unprotected staging and release failure is contained.
- Startup examines at most 64 expired protected staging candidates. It requests the corresponding
  exclusive lock without waiting and deletes only when that proves no live realm holds the shared
  lock. Unsupported or failed lock probing retains the candidate.
- The deletion transaction re-reads the manifest and requires the same asset id, staging state,
  Web-Lock protection, and exact expired timestamp before atomically deleting its manifest, pages,
  leases, and deferred-deletion marker. A replacement ready, legacy, or unprotected record cannot
  be deleted from a stale candidate.
- The prior age-only whole-store cleanup method was removed. Startup now launches the bounded
  staging reconciliation alongside the existing lease-row reconciliation without waiting to
  render the application.

**Failing-first evidence:**

- The first focused Vitest run failed both new test files at module resolution because neither the
  bounded staging reconciliation service nor its IndexedDB repository existed. No tests executed
  in that run, establishing the missing production path before implementation.
- The tests specified abandonment/live/unsupported outcomes, a hard 64-record ceiling, exact
  stale-candidate replacement protection, candidate bounding, and preservation of ready, legacy,
  and unprotected staging before the production modules were added.

**Passing evidence:**

- The exact import-directory Vitest run passed 23 files and 93 tests, including the new service,
  IndexedDB candidate/deletion, replacement-race, lock-error downgrade, existing lease
  reconciliation, staging cancellation, PNG decode, page-backed hydration, and worker-client
  coverage.
- The exact-current Chrome check passed the new real-worker lifecycle test in 22.9 seconds. It
  created expired protected staging in a real worker, proved cleanup retained it while the worker
  held the shared lock, terminated the worker, reloaded the app, and observed startup delete only
  the abandoned protected staging. A ready asset plus unprotected and legacy staging remained.
  The preceding full lifecycle run passed all 4 tests in 20.1 seconds.
- `pnpm typecheck`, `pnpm typecheck:e2e`, renderer and Electron ESLint, Prettier, hard file-size,
  report-only soft-size, and `git diff --check` passed. The focused five-file reconciliation run
  passed 19 tests before the full import-directory run.
- `pnpm test` is **not claimed green** on this tree. The exact-current attempt remained active but
  hit the 15-minute command limit after 902.7 seconds without producing final counts. Its captured
  output contained existing jsdom/WebGL/React warning stderr and no conclusive suite result.

**Independent audit:** The post-implementation source pass challenged long-lived imports,
Web-Lock absence/errors, ready-state publication, stale candidate reuse, concurrent worker
liveness, startup batch size, and deletion scope. The shared-lock/exclusive-probe sequence plus
the exact manifest re-read closes the identified deletion races. Fake IndexedDB tests and the
real-worker Chrome test independently prove the preservation boundary. No actionable Slice 7
defect remained in the audited path.

**Remaining boundary:** The 24-hour expiry only makes protected incomplete staging eligible for a
liveness probe; it never independently permits deletion. At most 64 candidates are examined per
launch, so a larger backlog requires later launches. Staging produced without Web Locks, legacy
staging, and protected staging that has not expired can remain indefinitely, preferring storage
leakage over data loss. This slice does not collect ready orphans or define ownership across
save/reopen, autosave, recovery, Trace, or Image Editor/crop/adjust. It does not change PNG decode,
preview, emitted-raster fidelity, or fallback behavior. Source plus sampled luma still coexist in
IndexedDB, and preparation still transiently materializes complete luma base64. It does not prove
greater-than-200-MiB end-to-end memory bounds, quota-pressure recovery beyond the prior slice, or
operating-system process-kill behavior. No size refusal, compile refusal, fallback widening,
silent truncation, hardware/controller/settings, Start, or Frame behavior was added.

### Follow-up audit - lifecycle test split, lock consolidation, persistence-safe retention, and 200 MiB PNG

**Workstream:** Memory-bounded import program, qualified PNG reliability follow-up.

**Finding/fix title:** Lifecycle coverage was oversized, lease/staging Web-Lock coordination was
duplicated, live-scene absence was incorrectly treated as proof that a ready page asset was an
orphan, and production-scale PNG import lacked a realistic 200 MiB browser fixture.

**Severity:** High for ready-asset ownership/data retention; Medium for lock duplication and
production-scale evidence; Low for test-file organization.

**Status:** Fixed and verified for the requested maintenance and conservative ownership boundary.
Ready-orphan collection remains intentionally open and is not safe until persistence has a
self-contained or fully enumerable ownership contract.

**Implementation:**

- The former 601-line lifecycle browser file is split by responsibility. Active project ownership,
  final-release durability, and abrupt PNG-worker cleanup remain in
  `e2e/png-asset-lifecycle.e2e.ts` (249 physical lines); startup lease and staging reconciliation
  live in `e2e/png-asset-startup-reconciliation.e2e.ts` (338 physical lines). Production code was
  not changed by the split.
- `PagedAssetCrossRealmLocks` now owns the shared-lock holder and exclusive non-waiting abandonment
  probe. Lease and staging wrappers preserve their existing public names and use distinct
  `curvedesk-page-asset-lease` and `curvedesk-page-asset-staging` namespaces, preventing one
  coordination domain from blocking or reconciling the other.
- The previous final-live-owner deletion policy is superseded. Native `.lf2` serialization uses
  JSON over the scene object, and page-backed raster objects contain IndexedDB asset ids and a
  thumbnail rather than source/luma bytes. Autosave stores that same project JSON in a separate
  localStorage slot. A saved file or recovery slot is therefore an external owner that the live
  Zustand state cannot enumerate. `PagedRasterAssetLifecycle` no longer requests deletion merely
  because an id leaves the active project/history/clipboard; it retains ready pages and only
  cancels an older deferred-deletion marker when the id becomes live again.
- A production UI browser test builds an exact 209,715,200-byte qualified RGB PNG without a single
  fixture-sized Node buffer. Its 8192 x 8192 raw rows are deflated at level zero to a file-backed
  201,365,510-byte IDAT chunk (96.0% of the PNG); a bounded ancillary chunk supplies only the exact
  remaining bytes. The test selects the real local file through `Import Image...`, observes the real
  PNG worker, and verifies 200 ready 1-MiB source pages, a 5657 x 5657 / 32,001,649-byte sampled-luma
  asset in 31 pages, correct first/last luma pixels, no UI `dataUrl` or `lumaBase64`, and a thumbnail
  bounded by the production 256-pixel edge contract.

**Failing-first evidence:**

- The new cross-realm characterization test initially failed module resolution because the shared
  helper did not exist. It then specified shared-holder/exclusive-probe behavior, unsupported Web
  Locks, and namespace separation before the wrappers were changed.
- The persistence ownership regression initially observed two `requestDelete` calls when an owned
  qualified raster left all live scene/history/clipboard state. That proved the saved-reference
  data-loss risk before the lifecycle policy was changed to retention.
- The first realistic 200 MiB run completed the production import but failed an arbitrary
  100,000-character thumbnail assertion: the valid 256 x 256 24-bit BMP data URL was 262,238
  characters. The assertion was corrected to the source-backed maximum edge and exact BMP encoding
  bound; no production cap or refusal was added.
- The first post-audit fixture-hardening attempt failed before product execution because Playwright
  requires an object-destructured hook fixture. The hook now names and verifies Chromium; this was a
  test-harness defect, not an import failure.

**Tests/checks:**

- `pnpm vitest run src/ui/import`: 24 files and 97 tests passed on the exact current tree.
- Isolated Chromium (`PLAYWRIGHT_PORT=5197`) passed the combined lifecycle/reconciliation/scale run:
  5 tests in 1.5 minutes. That run measured 31,740,936 bytes of main-frame JavaScript heap growth for
  the 200 MiB import while the 10 ms UI heartbeat advanced 932 times.
- The final strengthened 200 MiB Chromium run passed in 73.3 seconds. The import itself took 25.8
  seconds, IDAT was 201,365,510 bytes, the heartbeat advanced 1,409 times, and sampled main-frame
  JavaScript heap grew 18,530,344 bytes (30,856,584 baseline; 49,386,928 sampled maximum).
- `pnpm typecheck`, `pnpm typecheck:e2e`, renderer ESLint, Electron ESLint, Prettier, the 600-line
  source / 900-line test hard policy, report-only soft-size check, and `git diff --check` passed.
  The soft-size report lists 161 existing files over 250 counted lines; none of the requested
  follow-up files crosses the source hard limit, and both split E2E files are below 601 lines.
- The repository-wide `pnpm test` suite is not claimed green on this follow-up tree. Slice 7's last
  exact-current attempt timed out at 15 minutes without final counts, and this follow-up ran the
  complete import directory plus the affected real-browser paths instead of repeating that
  inconclusive command.

**Independent audit:** The final source pass challenged lock-name collisions, shared/exclusive lock
ordering, unsupported Web-Lock behavior, stale candidate deletion scope, ready-asset ownership,
fixture payload realism, sampled-pixel fidelity, temporary-file cleanup, and the meaning of the heap
metric. No actionable defect remains in the requested follow-up. The audit changed the scale test to
assert real IDAT proportion and decoded edge pixels, and it rejected ready-orphan deletion as
unprovable under the current persistence contract.

**PR URL/commit:** None. The work remains uncommitted on `codex/memory-bounded-imports`; no publish
or merge was performed.

**Remaining boundary:** The successful scale test proves one qualified, non-interlaced 8-bit RGB
PNG on this Chromium/machine through the production Import Image path. It does not prove unlimited
PNG sizes, other PNG variants, JPG/photo decode, SVG, LightBurn, native project, material, DXF,
G-code, or STL at 200 MiB. CDP `JSHeapUsedSize` measures the main frame only; worker heap, native
Blob buffers, browser process memory, IndexedDB implementation memory, and peak operating-system
working set were not measured. Source and sampled luma coexist in IndexedDB, and preparation can
still transiently materialize complete sampled luma. Ready assets can now consume storage
indefinitely because deleting them is unsafe until saved files, autosave, and recovery either embed
their pages or register every durable owner. Trace, Image Editor/crop/adjust, save portability,
autosave portability, and recovery portability remain outside this follow-up. No size refusal,
compile refusal, silent truncation, hardware/controller/settings, Start, or Frame behavior was
added.

## Follow-up — page-backing confined to large files (ADR-283, 2026-08-01)

**Status:** Fixed for sub-threshold imports. Portability above the threshold remains open.

**Defect found by independent audit of this program.** The paged route was gated on file type only:
`tryDecodeQualifiedPng` checked `isPngCandidate`, and the compatibility fallback fires on bit depth,
colour type, and interlacing — never on size. Every qualified PNG therefore became page-backed,
including a 20 KB logo.

That mattered because a later slice removed the embedded compatibility fields. At program HEAD
(`b2e06360`) `RasterImage.dataUrl` was a required field documented as carrying "PNG bytes embedded
in the `.lf2` file"; afterwards a page-backed object carries only IndexedDB asset ids, metadata, and
a thumbnail. `serializeProject` is plain JSON over the scene, and neither `prepareProjectForPersistence`
nor `prepareProjectForAutosave` embeds or registers page bytes. Saving any project containing a PNG
therefore produced a file whose pixels exist only in this origin's IndexedDB — it does not reopen on
another machine, browser, or profile, or after storage eviction.

The prior audit recorded the mechanism (in the ownership slice, as the reason ready pages must be
retained) but not its user-facing consequence, and slice text above it still asserted the
self-contained representation was preserved. That assertion is now marked superseded in place.

**Implementation:**

- `PAGED_PNG_MIN_BYTES` (25 MiB) and `shouldPageBackPng` in `qualified-png-raster.ts` are the single
  page-backing predicate. `tryDecodeQualifiedPng` gates on it, so no caller can page-back a small file.
- `importImageFile` computes the predicate once and uses it for both the storage route and whether
  worker-progress toasts are installed, so progress copy cannot describe a worker the import never
  reaches. `loadImageSamples` takes the decision as a parameter rather than recomputing it.
- The threshold equals `LARGE_IMPORT_ADVISORY_BYTES` by intent: the representation changes only where
  the operator is already told the import is large. They stay separate constants because one is a
  persistence boundary and the other a UX judgement.

**Failing-first evidence:**

- The sub-threshold test was observed RED against the type-only gate: a 64 KB PNG reached
  `importPngOffThread` instead of returning null. It passes against the size gate.
- `import-image-action.test.ts` gained a sub-threshold case asserting `dataUrl` + `lumaBase64`, no
  `imageAsset`, and no worker-progress toast.

**NOT verified:** portability of a page-backed `.lf2` across machines; ready-page collection; worker,
browser-process, or operating-system memory; any hardware, controller, Start, or Frame behaviour. No
new refusal, cap, or guard was added — rule 7 / ADR-228 stand, and the Start path change in this
program remains hydration-only. The 25 MiB value is a judgement aligned to the existing advisory, not
a measured memory cliff.
