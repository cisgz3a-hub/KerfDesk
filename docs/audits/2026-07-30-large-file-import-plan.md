# Large-file import (>100 MB) — research and implementation plan

**Date:** 2026-07-30
**Status:** IMPLEMENTED as ADR-268, except where noted below. This document is kept as the
research record; the decision and its verification live in `DECISIONS.md` under ADR-268.

| Phase | State |
|---|---|
| 0 — Instrument | **Partly done.** Parser and core-JS throughput measured in Node (§1). The real-browser measurement, including the `parseSvg` gap, is still open. |
| 1 — Autosave freeze | **Done.** `prepareProjectForAutosave`; measured 971 ms → 327 ms (2.97×) on a project holding a 100 MB image. |
| 2 — Demote the refusals | **Done.** All ten removed; `import-size-advisory` replaces both guard modules. Five checked-in test files pinned the refusals and were rewritten to assert the inverse. |
| 3 — Import Worker | **Done for DXF / G-code / STL.** SVG cannot move: `DOMParser` is `[Exposed=Window]` per the WHATWG HTML spec. |
| 4 — Streaming parsers | **Done.** `core/util/iterateLines`, property-tested equal to `split()`; G-code and DXF tokenizer both swapped. The DXF tokenizer additionally keeps its pre-change implementation as an oracle in `dxf-tags-streaming-parity.test.ts`. |
| 5 — Blob-backed raster + relief | **Relief done** (`cachedFloat32Array`). **Raster `dataUrl` NOT done** — see §5 Phase 5 for why it was deliberately left. |

---

## 0. What "upload" means here — verified, not assumed

There is **no network upload anywhere in this product**. Verified by searching the whole tree
for `FormData` used as a request body, `XMLHttpRequest`, and `method: 'POST'`: every `FormData`
hit is HTML form *reading* (`src/ui/layers/cut-settings-draft.ts`, the material-library wizard),
never a request. KerfDesk is local-first; there is no server to upload to.

"Upload a file bigger than 100 MB" therefore means **import a >100 MB file into the app**:
`.svg`, `.dxf`, `.png/.jpg`, `.stl`, `.nc/.gcode/.tap`, `.lf2`, `.lbrn/.lbrn2`, `.clb`.

Both delivery targets use **one** code path. `src/ui/app/main.tsx:27` composes the Electron
adapter as `{ ...webAdapter, id: 'electron' }`, and `electron/` exposes **no** `contextBridge`
and **no** `ipcMain.handle` — so the desktop app reads files through the same File System
Access API as the browser. One fix serves both. That also means the fix has a free foundation:
`showOpenFilePicker` → `FileSystemFileHandle.getFile()` returns a `File`, which **is** a `Blob`,
so `.stream()`, `.slice()`, and lazy re-reads are already available today without any new API.

---

## 1. Measured baseline

All numbers from this session, Node 22 / V8 — the same engine Chromium runs, so they transfer
(they do **not** account for a browser's extra GC pressure or a busy render thread).

### Parser throughput (`vitest`, 10 MB synthetic input, extrapolated to 100 MB)

| Parser | Rate | 100 MB projected | Note |
|---|---|---|---|
| `parseStl` | 172 MB/s | **0.6 s** | Fast — STL's problem is caps, not parsing |
| `parseGcodeProgram` | 13 MB/s | **7.6 s** | |
| `parseDxf` | 9 MB/s | **11.4 s** | Slowest measured |
| `parseSvg` | **not measured** | — | jsdom's DOMParser is not representative of Chromium; needs a real-browser measurement |

### Core JS operations on a 100 MB payload

| Operation | Time | Peak heap | Where it bites |
|---|---|---|---|
| `base64` encode 100 MB | 51 ms | → 133 MB string | `readFileAsDataUrl` in image import |
| `JSON.stringify` (133 MB dataUrl) | 189 ms | 271 MB | every save + every 30 s autosave |
| `String.split` → 3.3 M lines | 374 ms | **570 MB** | `parse-gcode-program.ts:63` |
| `JSON.parse` project | 82 MB/s → **1.2 s** | 609 MB | `handleOpenProject` |
| `Array.from(Float32Array 18M)` | 624 ms | 803 MB | `stl-import-action.ts:94` |

**Read this as: raw throughput is survivable; memory amplification and main-thread residency are not.**

---

## 2. Why a 100 MB file fails today — blocker inventory

Nine hard refusals fire before any performance work matters. A 100 MB file of most types is
**refused outright**, not slow.

| # | Limit | Value | Location | Effect at 100 MB |
|---|---|---|---|---|
| B1 | `IMPORT_SOURCE_LIMITS['native-project']` | 64 MB | `src/ui/app/import-source-limits.ts:14` | `.lf2` **refused** |
| B2 | `IMPORT_SOURCE_LIMITS.gcode` | 64 MB | `import-source-limits.ts:18` | G-code **refused** |
| B3 | `IMPORT_SOURCE_LIMITS.stl` | 64 MB | `import-source-limits.ts:19` | STL **refused** |
| B4 | `IMPORT_SOURCE_LIMITS['material-library']` | 16 MB | `import-source-limits.ts:17` | **refused** |
| B5 | `MAX_LBRN_BYTES` | 20 MB | `src/io/lightburn/lbrn-import.ts:4` | `.lbrn` **refused** |
| B6 | `MAX_CLB_BYTES` | 5 MB | `src/io/lightburn/clb-import.ts:9` | `.clb` **refused** |
| B7 | `MAX_PROGRAM_LINES` | 500 000 | `src/io/gcode/parse-gcode-program.ts:28` | 100 MB ≈ 3.3 M lines → **refused** |
| B8 | `RELIEF_EMBED_TRIANGLE_LIMIT` | 200 000 | `src/core/scene/scene-object.ts:389` | 100 MB STL ≈ 2 M tris → **refused** |
| B9 | `MAX_SHAPES` (lbrn) | 50 000 | `lbrn-import.ts:6` | **refused** |
| B10 | `confirmOversizeImport` | 25 MB | `src/ui/app/import-size-guard.ts:9` | blocking modal on **every** SVG/DXF/image import |

Secondary caps that bite above 100 MB but not at it: `MAX_STL_TRIANGLES` = 5 M
(`parse-stl-binary.ts:13`, ≈ 250 MB), `MAX_RASTER_SOURCE_PIXELS` = 256 M
(`project-shape-validator.ts:42`), `MAX_MINSERT_INSTANCES` = 10 000 (`dxf-insert-grid.ts:4`).

SVG, DXF and images have **no byte cap at all** — only the B10 confirm. They will attempt a
100 MB import today and simply freeze.

### These are rule-7 violations already on the books

CLAUDE.md rule 7 defines a guard as anything that "blocks, refuses, gates, caps, clamps,
delays, hides, disables, rewrites, or adds confirmation before an otherwise available action,
input, output, machine command, job start, preview, save, **import**, export, or G-code
emission." **Import is named explicitly.** B1–B10 are policy caps, not integrity facts, so
every one of them is a standing violation.

The repo has already settled the direction. ADR-241 removed the segment-budget refusal;
**ADR-243** deleted `raster-too-large` and the compiled-output budget, converting both into
Job Review advisories; **ADR-244** moved large-job preparation onto a Worker. ADR-243 point 4
fixed the one legitimate exception: `materializeProgram` still fails on a **real** engine
`RangeError` (V8's ~512 MB single-string ceiling) — an integrity fact, never a predictive estimate.

**This work is not a new feature. It is extending the ADR-241/243/244 "any size" line into the
import path — the one surface that line never reached.**

---

## 3. Root causes of the lag (independent of the refusals)

**L1 — Everything runs on the main thread.** `await file.text()` → parse → store, all in the
UI thread. 7.6 s (G-code) to 11.4 s (DXF) of frozen canvas, no progress, no cancel.

**L2 — Whole-file materialization, repeatedly.** `file.text()` allocates one 100 MB string;
`parse-gcode-program.ts:63` then `.split()`s it into 3.3 M more strings (+570 MB). Peak
residency runs 4–6× file size, on top of whatever the scene already holds.

**L3 — base64 data URLs live in the store.** `import-image-action.ts` sets
`dataUrl: await readFileAsDataUrl(file)` — the **entire original file**, base64'd, held in the
Zustand `Project` and written into `.lf2`. A 100 MB image becomes a 133 MB string that is
re-serialized on every save.

**L4 — Autosave re-serializes it every 30 seconds.** `writeAutosave` →
`prepareProjectForPersistence` (`src/io/project/prepare-project-persistence.ts:13`) does
**three full passes**: `serializeProject` → `deserializeProject` (parse + full validation) →
`serializeProject` again → then `firstPersistenceSemanticDrift` string-compares the two results.
On a project holding a 100 MB image that is multiple seconds of hard freeze **every 30 s** —
and then it writes to `localStorage`, whose ~5 MB cap guarantees a quota failure. The entire
cost is paid to throw the result away. There is no size short-circuit anywhere in that path.
**This is the single worst offender and the most likely thing the maintainer is actually feeling.**

**L5 — `Array.from(Float32Array)` in the STL path.** `stl-import-action.ts:94` converts the
mesh to a plain `number[]` — 624 ms for 18 M floats, ~3× the memory of the typed array, and it
serializes into `.lf2` as 18 M decimal literals.

**L6 — Undo retention.** `HISTORY_DEPTH = 50` (`scene-mutations.ts:39`) full `Project`
snapshots. JS strings are shared by reference, so an *unedited* large image is not held 50×;
but every edit that rewrites `dataUrl`/`lumaBase64` pins a **new** blob, and up to 50 can be
retained. (`core/image-edit/history.ts` already sidesteps this for pixel edits with its own
256 MB tile budget — the same reasoning has not been applied to import.)

---

## 4. Architecture

Four principles, each following precedent already in this tree.

1. **No refusal survives on size.** B1–B10 become Job Review / toast advisories. The only
   permitted blocks are ADR-243-style integrity facts: the engine factually cannot produce the
   value (a real `RangeError`), or the bytes are factually unparseable. Never a predictive estimate.
2. **Parse off the main thread.** A dedicated import Worker, modelled directly on
   `src/ui/workspace/preparation-worker.ts` + `preparation-worker-client.ts` (ADR-244) — the
   protocol/client/worker triple is a proven pattern here, and `convert-bitmap-worker` shows the
   Vite bundling works.
3. **Stream, never materialize.** The `File` from the picker is a `Blob`. Feed
   `blob.stream().pipeThrough(new TextDecoderStream())` into chunk-wise parsers so peak memory is
   O(chunk + result), not O(file). This mirrors what ADR-243 did for rasters: a rolling window
   instead of a materialized buffer.
4. **Keep bytes out of the store.** Hold large payloads as `Blob`s in a side-table keyed by
   object id; the `Project` keeps the key. Serialize to base64 **only** when writing `.lf2`, and
   never for autosave.

---

## 5. Phased plan

Each phase is one reviewable PR under CLAUDE.md rule 1, verifiable on its own, ordered so the
highest pain/lowest risk lands first.

### Phase 0 — Instrument (no behavior change)
- **Do:** add an import-timing harness that logs per-stage ms + `performance.memory` behind the
  existing Labs flag. Capture a real-browser `parseSvg` number (the gap in §1) and a real
  autosave-freeze measurement on a scene holding a large image.
- **Why first:** §1 has one measurement hole and all Chromium numbers are extrapolated from Node.
- **Done when:** a table of real Chromium numbers for all five formats exists.

### Phase 1 — Kill the autosave freeze (L4) ← **highest value, lowest risk**
- **Files:** `src/ui/state/autosave.ts`, `src/io/project/prepare-project-persistence.ts`
- **Do:** (a) give autosave a serialization path that does **one** `stringify` — the
  parse-and-re-stringify drift check is a *save-integrity* check and does not belong on a
  30-second timer; (b) skip the autosave write entirely when the payload cannot fit
  `localStorage`, and surface "scene too large for autosave recovery — save manually" as a toast.
- **Not a rule-7 guard:** this refuses nothing the operator asked for. It stops spending seconds
  computing a value that is then discarded by a storage cap.
- **Done when:** a scene holding a 100 MB image no longer freezes on the autosave tick.

### Phase 2 — Demote every size refusal (B1–B10)
- **Files:** `import-source-limits.ts`, `import-size-guard.ts`, `lbrn-import.ts`,
  `clb-import.ts`, `parse-gcode-program.ts`, `scene-object.ts`, plus the callers in
  `file-actions.ts`, `gcode-open-action.ts`, `stl-import-action.ts`, `use-import-drag-drop.ts`.
- **Do:** delete the refusals; re-express each as an advisory carrying the same information
  ("2.1 M triangles — expect a slow import"). Follow the ADR-243 pattern exactly.
- **Watch out:** memory `project_rule7-save-export-refusals-2026-07-27` records that **checked-in
  tests pinned** these refusals last time. Expect to update the tests that assert them, and read
  each one to be sure it is asserting *policy*, not integrity.
- **Rule 7 note:** per memory `feedback_demoted-refusal-keeps-its-timing`, each advisory must fire
  **where the refusal stood** (at import time), not later.

### Phase 3 — Import Worker (L1)
- **New:** `src/ui/import/import-worker.ts`, `import-worker-protocol.ts`, `import-worker-client.ts`
- **Do:** move `parseDxf` / `parseGcodeProgram` / `parseStl` / `parseSvg` behind the worker;
  post progress; support cancel via `terminate()` (ADR-244 established that computes cannot be
  interrupted cooperatively). Keep the synchronous path for `vitest`/jsdom, exactly as
  `preparation-worker-client.ts` does — this is what makes the existing suite keep passing.
- **Done when:** a 100 MB DXF import leaves the canvas interactive with a live progress readout.

### Phase 4 — Streaming parsers (L2)
- **Do:** convert the two line-oriented parsers to consume a chunk stream instead of a
  materialized string — `parse-gcode-program.ts` (drop the `.split()` at line 63) and the DXF
  tokenizer (`dxf-tags.ts`), which is already tag-pair oriented and maps cleanly onto chunks.
- **Invariant:** streamed output must be **byte-identical** to materialized output, property-tested
  across chunk boundaries. This is precisely how ADR-243 proved its row-streamed ditherer.

### Phase 5 — Blob-backed raster + relief (L3, L5)
- **Do:** replace `RasterImage.dataUrl` in the *live store* with a handle into a Blob side-table;
  base64 only at `.lf2` write time. Replace `Array.from(mesh.positions)` with the retained
  `Float32Array`.
- **Cost:** touches the `.lf2` schema surface and `project-shape-validator.ts` → needs its own ADR
  and a migration. **Largest and riskiest phase — do it last, and only if Phases 1–4 leave a real gap.**

### Phase 6 — Verify perceptually (CLAUDE.md rule 2)
- Import a real >100 MB DXF and a real >100 MB G-code; **render and compare** against the source.
  Green tests prove structure and determinism, never fidelity. State plainly what was not verified.

---

## 6. Test strategy

- **Property:** streamed parse ≡ materialized parse, byte-identical, chunk boundaries fuzzed
  (mirrors `dither-rows.test.ts`).
- **Pinning:** each demoted refusal gets a test asserting an **advisory** is produced and
  **import proceeds** — the inverse of the tests being deleted.
- **Worker client:** stub-`Worker` tests copied from `preparation-worker-client.test.ts`
  (no-Worker fallback, single-flight, supersede, cancel, error propagation).
- **G-code snapshots:** must not move. Any movement needs
  `Snapshot change acknowledged: <reason>` in the PR description.
- **Not covered by any of the above:** whether a 100 MB import *looks* right. Phase 6 only.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Demoting refusals reads as "removing safety" | Rule 7 mandates it; ADR-243 is the precedent. Information moves to Job Review, it is not lost. |
| Checked-in tests pin the refusals | Known from `project_rule7-save-export-refusals-2026-07-27`; budget for it in Phase 2. |
| Streaming changes parser output | Byte-identical property tests gate every phase. |
| Phase 5 touches the `.lf2` schema | Own ADR + migration; deferred to last; skippable. |
| Node numbers ≠ Chromium numbers | Phase 0 exists precisely to close this. |
| V8's ~512 MB single-string ceiling | A real integrity limit. Streaming avoids it; `materializeProgram` already converts the `RangeError` correctly. |

---

## 8. Explicitly out of scope

Network upload (does not exist), changing the File System Access API dependency, raising
`MAX_STL_TRIANGLES`/`MAX_RASTER_SOURCE_PIXELS` (>100 MB territory — reassess after Phase 2),
and any change to Frame/Start (rule 7 — untouched by this work).
